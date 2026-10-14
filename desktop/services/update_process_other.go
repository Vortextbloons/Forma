//go:build !windows

package services

import "os/exec"

func hideConsoleWindow(command *exec.Cmd) {}
