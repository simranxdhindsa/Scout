//go:build !windows

package runner

import (
	"bufio"
	"os/exec"
	"strings"

	"github.com/creack/pty"
)

// startAndStream starts cmd via a pseudo-TTY (Unix) and calls onLine for every
// line of output. Returns the exit error from cmd.Wait.
func startAndStream(cmd *exec.Cmd, onLine func(string)) error {
	ptyF, err := pty.Start(cmd)
	if err != nil {
		return err
	}
	defer ptyF.Close()

	scanner := bufio.NewScanner(ptyF)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	scanner.Split(splitOnCRorLF)
	for scanner.Scan() {
		line := strings.TrimRight(scanner.Text(), "\r\n")
		if line != "" {
			onLine(line)
		}
	}
	return cmd.Wait()
}
