// FileService exposes read-only project file access to the frontend via
// Wails v3 service bindings (method names:
// "rigdesktop/services.FileService.ReadFile" etc.).
//
// Every path is resolved relative to RIG_PROJECT_DIR (default: process cwd)
// and constrained to that root: absolute paths, `..` segments and symlinks
// that escape the root are rejected with typed FileError codes.
//
// This replaces the dev-only Vite `server.fs.allow` + `/@fs/` + `define`
// hack: the UI can read the data folder in the packaged app too.
package services

import (
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// maxReadBytes caps a single ReadFile payload (4 MiB); larger files are
// returned truncated with Truncated=true.
const maxReadBytes = 4 << 20

// FileError is a typed error surfaced to the frontend (Code: INVALID_PATH,
// OUTSIDE_PROJECT, NOT_FOUND, IS_A_DIRECTORY, NOT_A_DIRECTORY, READ_FAILED,
// NO_PROJECT).
type FileError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *FileError) Error() string { return e.Code + ": " + e.Message }

func fileErr(code, message string) *FileError {
	return &FileError{Code: code, Message: message}
}

// NewFileService creates the service; the project root is resolved per call so
// tests and `wails3 dev` can change RIG_PROJECT_DIR without a restart.
func NewFileService() *FileService {
	return &FileService{}
}

type FileService struct{}

// ServiceName implements application.ServiceName.
func (s *FileService) ServiceName() string { return "FileService" }

// FileContent is a UTF-8 (or best-effort) file payload.
type FileContent struct {
	Path      string `json:"path"`
	Content   string `json:"content"`
	Size      int64  `json:"size"`
	Truncated bool   `json:"truncated"`
}

// DirEntry is one entry of a directory listing.
type DirEntry struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	IsDir bool   `json:"isDir"`
	Size  int64  `json:"size"`
}

// FileInfo describes a file or directory.
type FileInfo struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	IsDir    bool   `json:"isDir"`
	Size     int64  `json:"size"`
	Modified string `json:"modified"`
}

// ReadFile reads a project-relative file.
func (s *FileService) ReadFile(rel string) (FileContent, error) {
	abs, path, _, err := s.resolve(rel)
	if err != nil {
		return FileContent{}, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return FileContent{}, fileErr("NOT_FOUND", err.Error())
	}
	if info.IsDir() {
		return FileContent{}, fileErr("IS_A_DIRECTORY", "not a file: "+rel)
	}
	handle, err := os.Open(abs)
	if err != nil {
		return FileContent{}, fileErr("READ_FAILED", err.Error())
	}
	defer handle.Close()
	data, err := io.ReadAll(io.LimitReader(handle, maxReadBytes+1))
	if err != nil {
		return FileContent{}, fileErr("READ_FAILED", err.Error())
	}
	truncated := len(data) > maxReadBytes
	if truncated {
		data = data[:maxReadBytes]
	}
	return FileContent{
		Path:      path,
		Content:   string(data),
		Size:      info.Size(),
		Truncated: truncated,
	}, nil
}

// ReadDir lists a project-relative directory (sorted, directories first by
// name via plain lexical sort).
func (s *FileService) ReadDir(rel string) ([]DirEntry, error) {
	abs, _, root, err := s.resolve(rel)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return nil, fileErr("NOT_FOUND", err.Error())
	}
	if !info.IsDir() {
		return nil, fileErr("NOT_A_DIRECTORY", "not a directory: "+rel)
	}
	items, err := os.ReadDir(abs)
	if err != nil {
		return nil, fileErr("READ_FAILED", err.Error())
	}
	entries := make([]DirEntry, 0, len(items))
	for _, item := range items {
		entryAbs := filepath.Join(abs, item.Name())
		entryRel, relErr := filepath.Rel(root, entryAbs)
		if relErr != nil {
			continue
		}
		entry := DirEntry{
			Name:  item.Name(),
			Path:  filepath.ToSlash(entryRel),
			IsDir: item.IsDir(),
		}
		if entryInfo, statErr := item.Info(); statErr == nil {
			entry.Size = entryInfo.Size()
		}
		entries = append(entries, entry)
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
	return entries, nil
}

// Stat describes a project-relative file or directory.
func (s *FileService) Stat(rel string) (FileInfo, error) {
	abs, path, _, err := s.resolve(rel)
	if err != nil {
		return FileInfo{}, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return FileInfo{}, fileErr("NOT_FOUND", err.Error())
	}
	name := info.Name()
	if path == "" {
		name = "."
	}
	return FileInfo{
		Name:     name,
		Path:     path,
		IsDir:    info.IsDir(),
		Size:     info.Size(),
		Modified: info.ModTime().UTC().Format(time.RFC3339),
	}, nil
}

// resolve maps a project-relative path to an absolute path inside the project
// root. It returns (absPath, slashRelativePath, root, error).
func (s *FileService) resolve(rel string) (string, string, string, error) {
	root, err := s.projectRoot()
	if err != nil {
		return "", "", "", err
	}
	if rel == "" {
		rel = "."
	}
	if strings.ContainsRune(rel, '\x00') {
		return "", "", "", fileErr("INVALID_PATH", "path contains NUL")
	}
	if filepath.IsAbs(rel) {
		return "", "", "", fileErr("INVALID_PATH", "absolute paths are not allowed: "+rel)
	}
	cleaned := filepath.Clean(filepath.FromSlash(rel))
	if cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return "", "", "", fileErr("OUTSIDE_PROJECT", "path escapes the project data folder: "+rel)
	}
	abs := filepath.Join(root, cleaned)
	relative, relErr := filepath.Rel(root, abs)
	if relErr != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", "", "", fileErr("OUTSIDE_PROJECT", "path escapes the project data folder: "+rel)
	}
	if resolved, linkErr := filepath.EvalSymlinks(abs); linkErr == nil {
		realRel, realErr := filepath.Rel(root, resolved)
		if realErr != nil || realRel == ".." || strings.HasPrefix(realRel, ".."+string(filepath.Separator)) {
			return "", "", "", fileErr("OUTSIDE_PROJECT", "path escapes the project data folder via a symlink: "+rel)
		}
	}
	if relative == "." {
		return abs, "", root, nil
	}
	return abs, filepath.ToSlash(relative), root, nil
}

func (s *FileService) projectRoot() (string, error) {
	root := os.Getenv("RIG_PROJECT_DIR")
	if root == "" {
		cwd, err := os.Getwd()
		if err != nil {
			return "", fileErr("NO_PROJECT", "resolve project dir: "+err.Error())
		}
		root = cwd
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return "", fileErr("NO_PROJECT", "resolve project dir: "+err.Error())
	}
	return filepath.Clean(abs), nil
}
