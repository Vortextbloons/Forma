// WorkspaceService exposes native file actions to the frontend via Wails v3
// service bindings. Wails resolves methods by fully-qualified name
// `<package path>.<Type>.<Method>`, i.e.
// "rigdesktop/services.WorkspaceService.OpenPath"; ServiceName() aliases are
// not used for bound-method lookup in v3.
//
// All methods are intentionally non-blocking: they spawn platform helpers
// and return immediately, so no native dialog loop can stall the app's main
// thread while a binding call is in flight.
package services

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// NewWorkspaceService creates the service (file actions are fire-and-forget;
// dialog methods block their caller until dismissed, never the main thread).
func NewWorkspaceService() *WorkspaceService {
	return &WorkspaceService{}
}

type WorkspaceService struct{}

// ServiceName implements application.ServiceName (binding name: "Workspace").
func (s *WorkspaceService) ServiceName() string { return "Workspace" }

// PickDirectory shows the native folder picker and returns the chosen path.
func (s *WorkspaceService) PickDirectory(title string) (string, error) {
	if title == "" {
		title = "Choose a folder"
	}
	return application.Get().Dialog.OpenFileWithOptions(&application.OpenFileDialogOptions{
		CanChooseDirectories: true,
		CanCreateDirectories: true,
		Title:                title,
	}).PromptForSingleSelection()
}

// PickFiles shows the native multi-file picker for importable context files.
func (s *WorkspaceService) PickFiles(title string) ([]string, error) {
	if title == "" {
		title = "Add files"
	}
	return application.Get().Dialog.OpenFileWithOptions(&application.OpenFileDialogOptions{
		CanChooseFiles:          true,
		AllowsMultipleSelection: true,
		Title:                   title,
		Filters: []application.FileFilter{
			{
				DisplayName: "Images and documents",
				Pattern:     "*.png;*.jpg;*.jpeg;*.webp;*.svg;*.pdf;*.txt;*.md",
			},
		},
	}).PromptForMultipleSelection()
}

// PickSaveFile shows the native save dialog for an export destination.
func (s *WorkspaceService) PickSaveFile(title string, defaultFilename string, pattern string) (string, error) {
	if title == "" {
		title = "Save export"
	}
	options := &application.SaveFileDialogOptions{
		CanCreateDirectories: true,
		Title:                title,
		Filename:             defaultFilename,
	}
	if pattern != "" {
		options.Filters = []application.FileFilter{{DisplayName: "Export", Pattern: pattern}}
	}
	return application.Get().Dialog.SaveFileWithOptions(options).PromptForSingleSelection()
}

// OpenPath opens a file or folder with the OS default application.
func (s *WorkspaceService) OpenPath(path string) error {
	switch runtime.GOOS {
	case "windows":
		return runDetached("cmd", "/c", "start", "", path)
	case "darwin":
		return runDetached("open", path)
	default:
		return runDetached("xdg-open", path)
	}
}

// RevealInFolder opens the containing folder with the file selected
// (Windows Explorer / macOS Finder; Linux opens the folder).
func (s *WorkspaceService) RevealInFolder(path string) error {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	switch runtime.GOOS {
	case "windows":
		return runDetached("explorer", "/select,"+absolute)
	case "darwin":
		return runDetached("open", "-R", absolute)
	default:
		return runDetached("xdg-open", filepath.Dir(absolute))
	}
}

// runDetached starts a helper without waiting for it (fire and forget).
func runDetached(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	hideConsoleWindow(cmd)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start %s: %w", name, err)
	}
	go func() { _ = cmd.Wait() }()
	return nil
}
