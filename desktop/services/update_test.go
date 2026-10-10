package services

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestNewerVersion(t *testing.T) {
	for _, test := range []struct {
		latest, current string
		newer           bool
	}{
		{"v0.2.1", "0.2.0", true},
		{"v0.10.0", "0.2.0", true},
		{"v1.0.0", "0.99.0", true},
		{"v0.2.0", "0.2.0", false},
		{"v0.1.9", "0.2.0", false},
	} {
		t.Run(test.latest+"/"+test.current, func(t *testing.T) {
			got, err := newerVersion(test.latest, test.current)
			if err != nil || got != test.newer {
				t.Fatalf("got %v, %v; want %v", got, err, test.newer)
			}
		})
	}
	for _, version := range []string{"v0.3.0-beta.1", "latest", "0.3", "0.-3.0"} {
		if _, err := newerVersion(version, "0.2.0"); err == nil {
			t.Fatalf("accepted invalid stable version %q", version)
		}
	}
}

func TestLatestRelease(t *testing.T) {
	for _, test := range []struct {
		name, body string
		status     int
		tag        string
		fails      bool
	}{
		{"stable", `{"tag_name":"v0.3.0","assets":[]}`, 200, "v0.3.0", false},
		{"no releases", ``, 404, "", false},
		{"prerelease", `{"tag_name":"v0.3.0-beta.1","prerelease":true}`, 200, "", false},
		{"draft", `{"tag_name":"v0.3.0","draft":true}`, 200, "", false},
		{"rate limit", ``, 403, "", true},
		{"invalid response", `{`, 200, "", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(test.status)
				fmt.Fprint(w, test.body)
			}))
			defer server.Close()
			release, err := latestRelease(server.Client(), server.URL)
			if (err != nil) != test.fails || release.Tag != test.tag {
				t.Fatalf("got tag %q, error %v", release.Tag, err)
			}
		})
	}
}

func TestDownloadInstallerVerification(t *testing.T) {
	payload := []byte("installer contents")
	digest := sha256.Sum256(payload)
	valid := "sha256:" + hex.EncodeToString(digest[:])
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(payload) }))
	defer server.Close()
	for _, test := range []struct {
		name, digest string
		size         int64
		fails        bool
	}{
		{"verified", valid, int64(len(payload)), false},
		{"tampered", "sha256:" + hex.EncodeToString(make([]byte, 32)), int64(len(payload)), true},
		{"truncated", valid, int64(len(payload) + 1), true},
		{"too large", valid, int64(len(payload) - 1), true},
		{"missing digest", "", int64(len(payload)), true},
	} {
		t.Run(test.name, func(t *testing.T) {
			destination := filepath.Join(t.TempDir(), "setup.exe")
			err := downloadInstaller(server.Client(), releaseAsset{URL: server.URL, Digest: test.digest, Size: test.size}, destination)
			if (err != nil) != test.fails {
				t.Fatalf("unexpected error: %v", err)
			}
			if !test.fails {
				contents, err := os.ReadFile(destination)
				if err != nil || string(contents) != string(payload) {
					t.Fatalf("unexpected download: %q, %v", contents, err)
				}
			}
		})
	}
}
