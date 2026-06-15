//go:build windows

package runner

import (
	"bufio"
	"io"
	"os/exec"
	"strings"
	"sync"
)

// startAndStream starts cmd without a PTY (Windows doesn't support creack/pty).
// Stdout and stderr are each read by a dedicated goroutine; every line is
// forwarded to onLine. Both pipes are drained before cmd.Wait returns.
func startAndStream(cmd *exec.Cmd, onLine func(string)) error {
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}

	if err := cmd.Start(); err != nil {
		return err
	}

	var wg sync.WaitGroup
	drain := func(r io.Reader) {
		defer wg.Done()
		scanner := bufio.NewScanner(r)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		scanner.Split(splitOnCRorLF)
		for scanner.Scan() {
			line := strings.TrimRight(scanner.Text(), "\r\n")
			if line != "" {
				onLine(line)
			}
		}
	}

	wg.Add(2)
	go drain(stdout)
	go drain(stderr)
	wg.Wait()

	return cmd.Wait()
}
