//go:build !windows

package acc

import "context"

// ACC's shared memory exists only on Windows; elsewhere only broadcasting is read.
func readPages(ctx context.Context, _ func(kind byte, page []byte), _ *Stats) {
	<-ctx.Done()
}
