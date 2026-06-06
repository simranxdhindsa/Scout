//go:build windows

package runner

import (
	"fmt"
	"os/exec"
)

// linkDir creates a Windows directory junction at link pointing to target.
// Junctions work without admin rights or Developer Mode, unlike os.Symlink.
func linkDir(link, target string) error {
	out, err := exec.Command("cmd", "/c", "mklink", "/J", link, target).CombinedOutput()
	if err != nil {
		return fmt.Errorf("mklink /J %q → %q: %w\n%s", link, target, err, string(out))
	}
	return nil
}
