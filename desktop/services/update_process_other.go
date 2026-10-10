//go:build !windows

package services

import "os/exec"

func hideUpdateWindow(command *exec.Cmd) {}
