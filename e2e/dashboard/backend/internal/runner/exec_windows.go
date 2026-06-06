//go:build windows

package runner

import (
	"bufio"
	"io"
	"os/exec"
	"strings"
)

// startAndStream starts cmd without a PTY (Windows doesn't support creack/pty),
// merges stdout+stderr, and calls onLine for every line of output.
func startAndStream(cmd *exec.Cmd, onLine func(string)) error {
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = cmd.Stdout

	if err := cmd.Start(); err != nil {
		return err
	}

	scanner := bufio.NewScanner(io.Reader(stdout))
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
