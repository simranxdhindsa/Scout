//go:build !windows

package runner

import "os"

// linkDir creates a symlink at link pointing to target.
func linkDir(link, target string) error {
	return os.Symlink(target, link)
}
