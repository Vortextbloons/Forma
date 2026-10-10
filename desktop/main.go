// Forma desktop host (Wails v3).
//
// Responsibilities (strictly generic — no agent logic):
//   - native application lifecycle + window
//   - spawn/supervise the Forma worker process (Node) and bridge its
//     JSONL IPC protocol to frontend events
//   - native open/reveal dialogs and file/folder pickers
//
// The Svelte UI in `app/` owns everything visual and talks to the worker
// through the bridge events documented in services/workerservice.go.
package main

import (
	"embed"
	"encoding/json"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"rigdesktop/services"
)

// The app build (app/dist, produced by `npm run build` in the sibling app/)
// is copied into desktop/app/dist by scripts/build.ps1 before compiling.
//
//go:embed all:app/dist
var assets embed.FS

func main() {
	worker := services.NewWorkerService()
	workspace := services.NewWorkspaceService()

	app := application.New(application.Options{
		Name:        "Forma",
		Description: "Forma presentation and poster studio",
		Services: []application.Service{
			application.NewService(worker),
			application.NewService(workspace),
			application.NewService(&services.UpdateService{}),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	// Frontend -> Go. The frontend sends worker command frames
	// {id, name, params}; results stream back on "rig:result" (and the
	// worker's event stream on "rig:event").
	app.Event.On("rig:command", func(event *application.CustomEvent) {
		var frame struct {
			ID     string         `json:"id"`
			Name   string         `json:"name"`
			Params map[string]any `json:"params"`
		}
		data, err := json.Marshal(event.Data)
		if err == nil {
			_ = json.Unmarshal(data, &frame)
		}
		worker.SendCommand(frame.ID, frame.Name, frame.Params)
	})

	// Frontend -> Go lifecycle control.
	app.Event.On("rig:worker-restart", func(event *application.CustomEvent) {
		worker.Restart()
	})
	app.Event.On("rig:worker-stop", func(event *application.CustomEvent) {
		worker.Stop()
	})

	// Frontend opens a project: rebind the worker to the project folder so
	// agent sessions live inside the project.
	app.Event.On("rig:open-project", func(event *application.CustomEvent) {
		var payload struct {
			Dir string `json:"dir"`
		}
		data, err := json.Marshal(event.Data)
		if err == nil {
			_ = json.Unmarshal(data, &payload)
		}
		if payload.Dir == "" {
			return
		}
		worker.SetProjectDir(payload.Dir)
		worker.Restart()
	})

	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "Forma",
		Width:            1440,
		Height:           900,
		MinWidth:         1000,
		MinHeight:        700,
		BackgroundColour: application.NewRGB(242, 245, 246),
		URL:              "/",
		EnableFileDrop:   true,
	})

	window.OnWindowEvent(events.Common.WindowFilesDropped, func(event *application.WindowEvent) {
		files := event.Context().DroppedFiles()
		if len(files) == 0 {
			return
		}
		app.Event.Emit("rig:files-dropped", map[string]any{"files": files})
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
