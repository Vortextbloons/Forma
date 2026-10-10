package services

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf16"

	"github.com/wailsapp/wails/v3/pkg/application"
)

var Version = "0.2.0"
var ReleaseRepository = "Vortextbloons/Forma"

type UpdateService struct {
	mu sync.Mutex
}

type UpdateInfo struct {
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	Available      bool   `json:"available"`
}

type releaseAsset struct {
	Name   string `json:"name"`
	URL    string `json:"browser_download_url"`
	Digest string `json:"digest"`
	Size   int64  `json:"size"`
}

type githubRelease struct {
	Tag        string         `json:"tag_name"`
	Draft      bool           `json:"draft"`
	Prerelease bool           `json:"prerelease"`
	Assets     []releaseAsset `json:"assets"`
}

func versionParts(version string) ([3]int, error) {
	var result [3]int
	parts := strings.Split(strings.TrimPrefix(version, "v"), ".")
	if len(parts) != 3 {
		return result, fmt.Errorf("invalid release version: %s", version)
	}
	for i, part := range parts {
		n, err := strconv.Atoi(part)
		if err != nil || n < 0 {
			return result, fmt.Errorf("invalid release version: %s", version)
		}
		result[i] = n
	}
	return result, nil
}

func newerVersion(latest, current string) (bool, error) {
	left, err := versionParts(latest)
	if err != nil {
		return false, err
	}
	right, err := versionParts(current)
	if err != nil {
		return false, err
	}
	for i := range left {
		if left[i] != right[i] {
			return left[i] > right[i], nil
		}
	}
	return false, nil
}

func latestRelease(client *http.Client, endpoint string) (githubRelease, error) {
	var release githubRelease
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return release, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "Forma/"+Version)
	response, err := client.Do(req)
	if err != nil {
		return release, fmt.Errorf("check for updates: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return release, nil
	}
	if response.StatusCode != http.StatusOK {
		return release, fmt.Errorf("GitHub update check failed (HTTP %d)", response.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&release); err != nil {
		return release, err
	}
	if release.Draft || release.Prerelease {
		return githubRelease{}, nil
	}
	return release, nil
}

func (s *UpdateService) Check() (UpdateInfo, error) {
	info := UpdateInfo{CurrentVersion: Version}
	release, err := latestRelease(&http.Client{Timeout: 30 * time.Second}, "https://api.github.com/repos/"+ReleaseRepository+"/releases/latest")
	if err != nil {
		return info, err
	}
	if release.Tag == "" {
		return info, nil
	}
	info.LatestVersion = strings.TrimPrefix(release.Tag, "v")
	info.Available, err = newerVersion(release.Tag, Version)
	return info, err
}

func downloadInstaller(client *http.Client, asset releaseAsset, destination string) error {
	expected, err := hex.DecodeString(strings.TrimPrefix(asset.Digest, "sha256:"))
	if err != nil || !strings.HasPrefix(asset.Digest, "sha256:") || len(expected) != sha256.Size {
		return fmt.Errorf("release installer has no valid SHA-256 checksum")
	}
	response, err := client.Get(asset.URL)
	if err != nil {
		return fmt.Errorf("download update: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("update download failed (HTTP %d)", response.StatusCode)
	}
	file, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	hash := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(file, hash), io.LimitReader(response.Body, asset.Size+1))
	closeErr := file.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if written != asset.Size || hex.EncodeToString(hash.Sum(nil)) != hex.EncodeToString(expected) {
		return fmt.Errorf("update verification failed; the current installation was not changed")
	}
	return nil
}

func (s *UpdateService) Install() error {
	if !s.mu.TryLock() {
		return fmt.Errorf("an update is already in progress")
	}
	defer s.mu.Unlock()
	if runtime.GOOS != "windows" {
		return fmt.Errorf("automatic updates are available on Windows")
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	directory := filepath.Dir(executable)
	if !fileExists(filepath.Join(directory, "runtime", "node.exe")) {
		return fmt.Errorf("install the GitHub release of Forma to enable automatic updates")
	}
	client := &http.Client{Timeout: 20 * time.Minute}
	release, err := latestRelease(client, "https://api.github.com/repos/"+ReleaseRepository+"/releases/latest")
	if err != nil {
		return err
	}
	if release.Tag == "" {
		return fmt.Errorf("no release is available yet")
	}
	newer, err := newerVersion(release.Tag, Version)
	if err != nil {
		return err
	}
	if !newer {
		return fmt.Errorf("Forma is already up to date")
	}
	name := "Forma-" + strings.TrimPrefix(release.Tag, "v") + "-windows-" + runtime.GOARCH + "-setup.exe"
	var asset releaseAsset
	for _, candidate := range release.Assets {
		if candidate.Name == name {
			asset = candidate
			break
		}
	}
	if asset.URL == "" || asset.Size <= 0 || !strings.HasPrefix(asset.URL, "https://github.com/"+ReleaseRepository+"/releases/download/") {
		return fmt.Errorf("the release has no installer for this Windows architecture")
	}
	temporary, err := os.MkdirTemp("", "forma-update-")
	if err != nil {
		return err
	}
	launched := false
	defer func() {
		if !launched {
			_ = os.RemoveAll(temporary)
		}
	}()
	installer := filepath.Join(temporary, "setup.exe")
	if err := downloadInstaller(client, asset, installer); err != nil {
		return err
	}
	config, err := json.Marshal(map[string]any{
		"pid": os.Getpid(), "installer": installer, "directory": directory,
		"executable": executable, "temporary": temporary,
	})
	if err != nil {
		return err
	}
	script := "$config = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + base64.StdEncoding.EncodeToString(config) + "')) | ConvertFrom-Json\n" + updateScript
	encoded := utf16.Encode([]rune(script))
	bytes := make([]byte, len(encoded)*2)
	for i, value := range encoded {
		bytes[i*2] = byte(value)
		bytes[i*2+1] = byte(value >> 8)
	}
	command := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", base64.StdEncoding.EncodeToString(bytes))
	hideUpdateWindow(command)
	command.Dir = temporary
	if err := command.Start(); err != nil {
		return fmt.Errorf("start update installer: %w", err)
	}
	launched = true
	_ = command.Process.Release()
	go application.Get().Quit()
	return nil
}

const updateScript = `
$ErrorActionPreference = 'Stop'
try {
    $parent = Get-Process -Id $config.pid -ErrorAction SilentlyContinue
    if ($parent -and -not $parent.WaitForExit(60000)) { throw 'Forma did not close in time. Open Forma and try updating again.' }
    $arguments = '/S /D=' + $config.directory
    $installer = Start-Process -FilePath $config.installer -ArgumentList $arguments -PassThru -Wait -WindowStyle Hidden
    if ($installer.ExitCode -ne 0) { throw ('Installation failed (code ' + $installer.ExitCode + ').') }
    Start-Process -FilePath $config.executable -WorkingDirectory $config.directory
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Forma update failed') | Out-Null
    if (Test-Path -LiteralPath $config.executable) { Start-Process -FilePath $config.executable -WorkingDirectory $config.directory }
} finally {
    $temporary = [IO.Path]::GetFullPath($config.temporary)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($temporary.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($temporary).StartsWith('forma-update-')) {
        Set-Location -LiteralPath $tempRoot
        Remove-Item -LiteralPath $temporary -Recurse -Force
    }
}
`
