// WorkerService spawns and supervises the Rig worker (a Node process talking
// the v1 JSONL IPC protocol from packages/rig/src/ipc/protocol.ts) and bridges
// it to the frontend.
//
// Bridge events (Go -> frontend), emitted via app.Event.Emit:
//
//	rig:ready         {projectId, projectDir, agentName, capabilities} (after hello+ready)
//	rig:event         one RigEvent envelope (worker "event" lines)
//	rig:result        {id, ok, data?, error?} — worker "result" lines, id echoes the command
//	rig:log           {level, message, fields?} — worker "log" lines and raw stderr
//	rig:worker-error  {message, fatal?} — worker "error" lines
//	rig:worker-exit   {code, restartable, restarts}
//
// Frontend -> Go:
//
//	rig:command       {id, name, params} — dispatched to the worker stdin
//	rig:worker-restart / rig:worker-stop
//
// The frontend generates command ids, sends the frame, and matches the
// "rig:result" event with the same id; the worker event stream arrives
// independently via "rig:event". Commands never block Go: writes are
// fire-and-forget behind a mutex, so prompt-style long-running commands
// cannot freeze the UI.
//
// Worker resolution: RIG_NODE_BIN (node binary), RIG_WORKER_ENTRY or
// FORMA_WORKER_ENTRY (worker module), RIG_PROJECT_DIR (project root, default:
// process cwd), RIG_WORKER_LOG_LEVEL (default "info"). When no override is
// set the project-owned worker (src/worker/index.ts in a checkout, or
// worker/index.js next to the installed app) wins over the stock rig worker.
package services

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	ipcVersion      = 1
	shutdownTimeout = 5 * time.Second // mirrors IPC_SHUTDOWN_TIMEOUT_MS
	maxRestarts     = 3
	restartBackoff  = 500 * time.Millisecond
	maxLineBytes    = 16 << 20 // 16 MiB per worker stdout line
)

// NewWorkerService creates the service; the app reference is resolved from
// application.Get() at startup.
func NewWorkerService() *WorkerService {
	return &WorkerService{}
}

type WorkerService struct {
	app *application.App

	mu          sync.Mutex
	cmd         *exec.Cmd
	waitCh      chan struct{}
	stdinPipe   io.WriteCloser
	ready       atomic.Bool
	restarts    int
	stopping    atomic.Bool
	cmdSeq      atomic.Int64
	stdin       sync.Mutex
	projectDir  string
	nodeBin     string
	workerEntry string
}

// ServiceStartup implements application.ServiceStartup: resolve the project
// from RIG_PROJECT_DIR (default: process cwd) and boot the worker.
func (s *WorkerService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	s.app = application.Get()
	s.projectDir = os.Getenv("RIG_PROJECT_DIR")
	if s.projectDir == "" {
		cwd, err := os.Getwd()
		if err != nil {
			return fmt.Errorf("resolve project dir: %w", err)
		}
		s.projectDir = cwd
	}
	s.nodeBin = os.Getenv("RIG_NODE_BIN")
	s.workerEntry = os.Getenv("RIG_WORKER_ENTRY")
	s.logInfo(fmt.Sprintf("worker project: %s", s.projectDir))
	s.logInfo(fmt.Sprintf("worker entry: %s", s.resolveWorkerEntry(s.projectDir, s.workerEntry)))
	s.Start()
	return nil
}

// ServiceShutdown implements application.ServiceShutdown: stop the worker.
func (s *WorkerService) ServiceShutdown() error {
	s.Stop()
	return nil
}

// ServiceName implements application.ServiceName.
func (s *WorkerService) ServiceName() string { return "Worker" }

/* --------------------------------- lifecycle -------------------------------- */

// Start spawns the worker process. Idempotent while running.
func (s *WorkerService) Start() {
	s.mu.Lock()
	if s.cmd != nil {
		s.mu.Unlock()
		return
	}
	projectDir := s.projectDir
	workerEntry := s.workerEntry
	s.mu.Unlock()

	exeDir := ""
	if exe, err := os.Executable(); err == nil {
		exeDir = filepath.Dir(exe)
	}
	nodeBin := s.nodeBin
	if nodeBin == "" && exeDir != "" {
		if bundled := filepath.Join(exeDir, "runtime", "node.exe"); fileExists(bundled) {
			nodeBin = bundled
		}
	}
	if nodeBin == "" {
		bin, err := exec.LookPath("node")
		if err != nil {
			s.fail(fmt.Sprintf("node not found on PATH (set RIG_NODE_BIN): %v", err), true)
			return
		}
		nodeBin = bin
	}
	entry := s.resolveWorkerEntry(projectDir, workerEntry)
	if entry == "" {
		s.fail("worker entry not found (set FORMA_WORKER_ENTRY or install the forma worker)", true)
		return
	}
	logLevel := os.Getenv("RIG_WORKER_LOG_LEVEL")
	if logLevel == "" {
		logLevel = "info"
	}

	args := []string{entry, "--project", projectDir, "--log-level", logLevel}
	if loader := filepath.Join(filepath.Dir(entry), "pi-bundle-loader.mjs"); fileExists(loader) {
		// Route the pi SDK to its bundled build: the unbundled entry loads
		// ~1500 modules and dominates worker boot time.
		args = append([]string{"--import", fileURL(loader)}, args...)
	}

	cmd := exec.Command(nodeBin, args...)
	hideConsoleWindow(cmd)
	cmd.Dir = projectDir
	if exeDir != "" {
		chrome := filepath.Join(exeDir, "runtime", "chrome", "chrome-headless-shell.exe")
		if !fileExists(chrome) {
			chrome = filepath.Join(exeDir, "runtime", "chrome", "chrome.exe")
		}
		if os.Getenv("FORMA_CHROME_PATH") == "" && fileExists(chrome) {
			cmd.Env = append(os.Environ(), "FORMA_CHROME_PATH="+chrome)
		}
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		s.fail(fmt.Sprintf("worker stdin pipe: %v", err), true)
		return
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		s.fail(fmt.Sprintf("worker stdout pipe: %v", err), true)
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		s.fail(fmt.Sprintf("worker stderr pipe: %v", err), true)
		return
	}
	if err := cmd.Start(); err != nil {
		s.fail(fmt.Sprintf("spawn worker: %v", err), true)
		return
	}
	s.mu.Lock()
	s.cmd = cmd
	s.waitCh = make(chan struct{})
	s.stdinPipe = stdin
	s.mu.Unlock()
	s.ready.Store(false)
	s.logInfo(fmt.Sprintf("worker started (pid %d)", cmd.Process.Pid))

	go s.readLines(stdout, s.handleLine)
	go s.readLines(stderr, s.handleStderr)
	go s.supervise(cmd)
}

// SetProjectDir changes the project root used for the next worker start. It
// does not restart a running worker; callers pair it with Restart.
func (s *WorkerService) SetProjectDir(dir string) {
	s.mu.Lock()
	s.projectDir = dir
	s.mu.Unlock()
}

// SwitchProject rebinds the worker to a new project root. A ready worker
// switches in place via a workspace.switch command (which emits a fresh
// "rig:ready"); a worker that is still booting is restarted so it comes up
// bound to the new project.
func (s *WorkerService) SwitchProject(dir string) {
	s.SetProjectDir(dir)
	s.mu.Lock()
	cmd := s.cmd
	ready := s.ready.Load()
	s.mu.Unlock()
	switch {
	case cmd == nil:
		s.Start()
	case !ready:
		s.Restart()
	default:
		frame := map[string]any{
			"v":      ipcVersion,
			"type":   "command",
			"id":     "host-switch",
			"name":   "workspace.switch",
			"params": map[string]any{"dir": dir},
		}
		if err := s.writeJSON(frame); err != nil {
			s.logInfo(fmt.Sprintf("workspace switch write failed (worker will rebind on restart): %v", err))
		}
	}
}

// Stop asks the worker to shut down gracefully, then kills it after a grace
// period. Safe to call repeatedly.
func (s *WorkerService) Stop() {
	if s.stopping.Swap(true) {
		return
	}
	s.mu.Lock()
	cmd := s.cmd
	waitCh := s.waitCh
	s.mu.Unlock()
	if cmd == nil {
		s.stopping.Store(false)
		return
	}
	s.ready.Store(false)
	// Graceful: the worker writes its shutdown result and exits 0.
	s.writeLine(`{"v":1,"type":"command","id":"host-shutdown","name":"shutdown"}`)
	if waitCh != nil {
		select {
		case <-waitCh:
		case <-time.After(shutdownTimeout):
			log.Printf("worker did not exit in %v; killing", shutdownTimeout)
			_ = cmd.Process.Kill()
			<-waitCh
		}
	}
	s.mu.Lock()
	s.cmd = nil
	s.waitCh = nil
	s.mu.Unlock()
	s.stopping.Store(false)
	s.logInfo("worker stopped")
}

// Restart stops the running worker (if any) and starts a fresh one.
func (s *WorkerService) Restart() {
	s.Stop()
	s.mu.Lock()
	s.restarts = 0
	s.mu.Unlock()
	s.Start()
}

// supervise restarts a crashed worker with backoff, at most maxRestarts
// times per consecutive crash streak. Ready workers reset the counter.
func (s *WorkerService) supervise(cmd *exec.Cmd) {
	// Wait is owned by supervise; Stop waits on waitCh instead of calling
	// Wait concurrently (which Go rejects).
	s.mu.Lock()
	waitCh := s.waitCh
	s.mu.Unlock()
	if waitCh != nil {
		defer close(waitCh)
	}
	err := cmd.Wait()
	code := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			code = exitErr.ExitCode()
		} else {
			code = -1
		}
	}
	s.mu.Lock()
	stillCurrent := s.cmd == cmd
	s.mu.Unlock()
	if !stillCurrent {
		return // replaced by Stop/Restart
	}
	s.ready.Store(false)

	s.mu.Lock()
	restartable := !s.stopping.Load() && s.restarts < maxRestarts
	s.restarts++
	backoff := time.Duration(s.restarts) * restartBackoff
	s.mu.Unlock()

	s.Emit("rig:worker-exit", map[string]any{
		"code":        code,
		"restartable": restartable,
		"restarts":    s.restarts,
	})
	if !restartable {
		s.logInfo(fmt.Sprintf("worker exited (code %d); restart limit reached", code))
		return
	}
	s.logInfo(fmt.Sprintf("worker exited (code %d); restarting in %v", code, backoff))
	time.Sleep(backoff)

	s.mu.Lock()
	if s.stopping.Load() || s.cmd != cmd {
		s.mu.Unlock()
		return
	}
	s.cmd = nil
	s.mu.Unlock()
	s.Start()
}

/* ------------------------------- worker IPC -------------------------------- */

// SendCommand writes one command frame to the worker. Never blocks on the
// worker; results arrive asynchronously on "rig:result". When the worker is
// not running a failing result is synthesized for the id.
func (s *WorkerService) SendCommand(id, name string, params map[string]any) {
	if !s.ready.Load() {
		s.failCommand(id, "worker is not ready", "worker is not running")
		return
	}
	frame := map[string]any{
		"v":      ipcVersion,
		"type":   "command",
		"id":     id,
		"name":   name,
		"params": params,
	}
	if err := s.writeJSON(frame); err != nil {
		s.failCommand(id, fmt.Sprintf("write command: %v", err), err.Error())
	}
}

func (s *WorkerService) failCommand(id, workerMessage, resultMessage string) {
	s.Emit("rig:worker-error", map[string]any{"message": workerMessage})
	s.Emit("rig:result", map[string]any{
		"id": id,
		"ok": false,
		"error": map[string]any{
			"code":    "RUNTIME_ERROR",
			"message": resultMessage,
		},
	})
}

// NewCommandID allocates the next command id (frontends may use it, though
// they are free to generate their own).
func (s *WorkerService) NewCommandID() string {
	return fmt.Sprintf("c%d", s.cmdSeq.Add(1))
}

func (s *WorkerService) writeJSON(frame any) error {
	line, err := json.Marshal(frame)
	if err != nil {
		return err
	}
	return s.writeLine(string(line))
}

func (s *WorkerService) writeLine(line string) error {
	s.stdin.Lock()
	defer s.stdin.Unlock()
	s.mu.Lock()
	pipe := s.stdinPipe
	s.mu.Unlock()
	if pipe == nil {
		return fmt.Errorf("worker process is not running")
	}
	_, err := pipe.Write([]byte(line + "\n"))
	return err
}

// resolveWorkerEntry finds the worker module. Order:
//  1. explicit override (RIG_WORKER_ENTRY)
//  2. FORMA_WORKER_ENTRY
//  3. bundled worker next to the app binary (packaged release)
//  4. project-owned worker next to the app binary (dev checkout)
//  5. project-owned worker inside the project dir
//  6. stock rig worker
func (s *WorkerService) resolveWorkerEntry(projectDir, override string) string {
	if override != "" {
		if fileExists(override) {
			return override
		}
		log.Printf("RIG_WORKER_ENTRY set but missing: %s", override)
	}
	if env := os.Getenv("FORMA_WORKER_ENTRY"); env != "" {
		if fileExists(env) {
			return env
		}
		log.Printf("FORMA_WORKER_ENTRY set but missing: %s", env)
	}
	exeDir := ""
	if exe, err := os.Executable(); err == nil {
		exeDir = filepath.Dir(exe)
	}
	if exeDir != "" {
		candidates := []string{
			filepath.Join(exeDir, "runtime", "src", "worker", "index.js"),
			filepath.Join(exeDir, "runtime", "src", "worker", "index.ts"),
			filepath.Join(exeDir, "..", "..", "src", "worker", "index.ts"),
			filepath.Join(exeDir, "worker", "index.js"),
			filepath.Join(exeDir, "..", "resources", "worker", "index.js"),
		}
		for _, candidate := range candidates {
			if fileExists(candidate) {
				return candidate
			}
		}
	}
	if projectDir != "" {
		candidate := filepath.Join(projectDir, "src", "worker", "index.ts")
		if fileExists(candidate) {
			return candidate
		}
	}
	if exeDir != "" {
		candidate := filepath.Join(exeDir, "..", "..", "node_modules", "rig", "dist", "worker", "index.js")
		if fileExists(candidate) {
			return candidate
		}
	}
	candidate := filepath.Join(projectDir, "node_modules", "rig", "dist", "worker", "index.js")
	if fileExists(candidate) {
		return candidate
	}
	return ""
}

func (s *WorkerService) readLines(stream interface{ Read([]byte) (int, error) }, handle func([]byte)) {
	reader := bufio.NewReader(stream)
	for {
		line, err := readLimitedLine(reader)
		if len(line) > 0 {
			handle(line)
		}
		if err != nil {
			return
		}
	}
}

func (s *WorkerService) handleLine(line []byte) {
	var msg struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(line, &msg); err != nil || msg.Type == "" {
		s.Emit("rig:worker-error", map[string]any{
			"message": fmt.Sprintf("malformed worker line: %.200s", line),
		})
		return
	}
	switch msg.Type {
	case "hello":
		s.logInfo(fmt.Sprintf("worker hello: %s", truncate(string(line), 200)))
	case "ready":
		s.ready.Store(true)
		var payload map[string]any
		_ = json.Unmarshal(line, &payload)
		s.mu.Lock()
		s.restarts = 0
		s.mu.Unlock()
		s.Emit("rig:ready", payload)
	case "event":
		var payload map[string]any
		if err := json.Unmarshal(line, &payload); err == nil {
			s.Emit("rig:event", payload["event"])
		}
	case "result":
		s.emitPayload(line, "rig:result")
	case "log":
		s.emitPayload(line, "rig:log")
	case "error":
		s.emitPayload(line, "rig:worker-error")
	default:
		s.logInfo(fmt.Sprintf("unknown worker message type: %s", msg.Type))
	}
}

func (s *WorkerService) emitPayload(line []byte, name string) {
	var payload map[string]any
	if err := json.Unmarshal(line, &payload); err == nil {
		s.Emit(name, payload)
	}
}

func (s *WorkerService) handleStderr(line []byte) {
	s.Emit("rig:log", map[string]any{
		"level":   "stderr",
		"message": string(line),
	})
}

/* --------------------------------- helpers -------------------------------- */

func (s *WorkerService) Emit(name string, data any) {
	if s.app != nil {
		s.app.Event.Emit(name, data)
	}
}

func (s *WorkerService) logInfo(message string) {
	log.Printf("[worker] %s", message)
}

func (s *WorkerService) fail(message string, fatal bool) {
	log.Printf("[worker] %s", message)
	s.Emit("rig:worker-error", map[string]any{"message": message, "fatal": fatal})
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

// fileURL converts an absolute path to a file:// URL (spaces and other
// special characters percent-encoded), suitable for node --import.
func fileURL(path string) string {
	slash := filepath.ToSlash(path)
	if !strings.HasPrefix(slash, "/") {
		slash = "/" + slash
	}
	return (&url.URL{Scheme: "file", Path: slash}).String()
}

func truncate(text string, max int) string {
	if len(text) <= max {
		return text
	}
	return text[:max] + "..."
}

// readLimitedLine reads one newline-terminated line with a hard cap so a
// runaway worker cannot exhaust host memory.
func readLimitedLine(reader *bufio.Reader) ([]byte, error) {
	var buffer bytes.Buffer
	for {
		chunk, err := reader.ReadSlice('\n')
		buffer.Write(chunk)
		if err == nil {
			return buffer.Bytes(), nil
		}
		if err == bufio.ErrBufferFull {
			if buffer.Len() > maxLineBytes {
				return nil, fmt.Errorf("worker line exceeds %d bytes; dropping", maxLineBytes)
			}
			continue
		}
		if err != nil {
			return buffer.Bytes(), err
		}
	}
}
