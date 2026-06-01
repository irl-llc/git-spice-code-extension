// This file is copied into the cloned git-spice module root by
// scripts/fetch-gs.mjs (as zz_shamhub_register.go) before building `gs`, so the
// test `gs` binary can talk to a shamhub fake forge. It registers the shamhub
// forge into git-spice's `_extraForges` hook — but only when SHAMHUB_URL /
// SHAMHUB_API_URL are set, so a normally-invoked `gs` is unaffected. The built
// .gs/bin/gs is test-only and never shipped.
package main

import (
	"os"

	"go.abhg.dev/gs/internal/forge/shamhub"
	"go.abhg.dev/gs/internal/silog"
)

func init() {
	url, apiURL := os.Getenv("SHAMHUB_URL"), os.Getenv("SHAMHUB_API_URL")
	if url == "" || apiURL == "" {
		return
	}
	_extraForges = append(_extraForges, &shamhub.Forge{
		Options: shamhub.Options{URL: url, APIURL: apiURL},
		Log:     silog.Nop(),
	})
}
