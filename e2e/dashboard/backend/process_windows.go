//go:build windows

package main

import "os/exec"

func setProcGroup(cmd *exec.Cmd) {}

func killProcGroup(cmd *exec.Cmd) error {
	return cmd.Process.Kill()
}
