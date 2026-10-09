package services

import (
	"os"
	"path/filepath"
	"testing"
)

func writeFixture(t *testing.T, root, rel, content string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
}

func TestFileServiceRejectsTraversal(t *testing.T) {
	root := t.TempDir()
	t.Setenv("RIG_PROJECT_DIR", root)
	service := NewFileService()

	for _, rel := range []string{
		"../outside.txt",
		"nested/../../outside.txt",
		"..",
		filepath.Join("a", "..", "..", "outside.txt"),
	} {
		if _, err := service.ReadFile(rel); err == nil {
			t.Fatalf("ReadFile(%q) should be rejected", rel)
		}
		if _, err := service.ReadDir(rel); err == nil {
			t.Fatalf("ReadDir(%q) should be rejected", rel)
		}
		if _, err := service.Stat(rel); err == nil {
			t.Fatalf("Stat(%q) should be rejected", rel)
		}
	}
}

func TestFileServiceAcceptsRelativePaths(t *testing.T) {
	root := t.TempDir()
	t.Setenv("RIG_PROJECT_DIR", root)
	writeFixture(t, root, "notes/hello.md", "hello rig")
	service := NewFileService()

	content, err := service.ReadFile("notes/hello.md")
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if content.Content != "hello rig" || content.Truncated {
		t.Fatalf("unexpected content: %+v", content)
	}
	if content.Path != "notes/hello.md" {
		t.Fatalf("unexpected path: %q", content.Path)
	}

	entries, err := service.ReadDir("notes")
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	if len(entries) != 1 || entries[0].Name != "hello.md" || entries[0].IsDir {
		t.Fatalf("unexpected entries: %+v", entries)
	}

	info, err := service.Stat("notes/hello.md")
	if err != nil {
		t.Fatalf("Stat: %v", err)
	}
	if info.IsDir || info.Name != "hello.md" || info.Size != int64(len("hello rig")) {
		t.Fatalf("unexpected info: %+v", info)
	}

	if _, err := service.ReadFile("notes"); err == nil {
		t.Fatal("ReadFile on a directory should fail")
	}
	if _, err := service.ReadDir("missing"); err == nil {
		t.Fatal("ReadDir on a missing directory should fail")
	}
}
