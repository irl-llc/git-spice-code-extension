// Command shamhub-server runs git-spice's in-process "shamhub" fake forge as a
// standalone process so that Node/Playwright integration tests can drive the
// real `gs` binary against it (submit, comment counts, etc.).
//
// shamhub lives in an `internal/` package, so this file cannot live in the
// extension repo's module — `scripts/fetch-gs.mjs` copies it into the cloned
// git-spice source tree (`.gs/src/cmd/shamhub-server/`) and builds it there,
// where the internal import resolves.
//
// Protocol (line-based, so the Node harness controls timing):
//
//	stdout, once ready:
//	    SHAMHUB_API_URL=<url>
//	    SHAMHUB_URL=<url>
//	    REPO_URL=<git remote url for alice/example>
//	    READY
//	stdin commands (one per line):
//	    comment <change#> <resolved|unresolved> <body...>
//	        -> seeds a resolvable PR comment; prints "OK" or "ERR <msg>"
//	    quit  -> closes the server and exits
//
// A fixed user ("alice") and repo ("alice/example") are provisioned on start.
package main

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"

	"go.abhg.dev/gs/internal/forge/shamhub"
)

const (
	owner = "alice"
	repo  = "example"
)

func main() {
	sh, err := shamhub.New(shamhub.Config{})
	if err != nil {
		die("start shamhub", err)
	}
	defer func() { _ = sh.Close() }()

	if err := sh.RegisterUser(owner); err != nil {
		die("register user", err)
	}
	repoURL, err := sh.NewRepository(owner, repo)
	if err != nil {
		die("create repository", err)
	}

	fmt.Printf("SHAMHUB_API_URL=%s\n", sh.APIURL())
	fmt.Printf("SHAMHUB_URL=%s\n", sh.GitURL())
	fmt.Printf("REPO_URL=%s\n", repoURL)
	fmt.Println("READY")

	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		if line == "quit" {
			return
		}
		fmt.Println(handle(sh, line))
	}
}

// handle executes one seed command and returns the reply line. The body is
// optional (anything after the state), so a trailing space is not required.
func handle(sh *shamhub.ShamHub, line string) string {
	fields := strings.SplitN(line, " ", 4)
	if len(fields) < 3 || fields[0] != "comment" {
		return "ERR usage: comment <change#> <resolved|unresolved> [body]"
	}
	change, err := strconv.Atoi(fields[1])
	if err != nil {
		return "ERR invalid change number: " + fields[1]
	}
	body := ""
	if len(fields) > 3 {
		body = fields[3]
	}
	if _, err := sh.PostComment(shamhub.PostCommentRequest{
		Owner:      owner,
		Repo:       repo,
		Change:     change,
		Body:       body,
		Resolvable: true,
		Resolved:   fields[2] == "resolved",
	}); err != nil {
		return "ERR " + err.Error()
	}
	return "OK"
}

func die(what string, err error) {
	fmt.Fprintf(os.Stderr, "shamhub-server: %s: %v\n", what, err)
	os.Exit(1)
}
