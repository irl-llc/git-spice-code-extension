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
//	stdin commands (one per line); each prints "OK" or "ERR <msg>":
//	    comment <change#> <resolved|unresolved> <body...>
//	        -> seeds a resolvable PR comment
//	    merge <change#>   -> marks the change merged (its CR status becomes "merged")
//	    close <change#>   -> rejects the change without merging (status "closed")
//	    quit              -> closes the server and exits
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

// handle dispatches one seed command to its handler and returns the reply line.
func handle(sh *shamhub.ShamHub, line string) string {
	fields := strings.SplitN(line, " ", 4)
	switch fields[0] {
	case "comment":
		return handleComment(sh, fields)
	case "merge":
		return handleMerge(sh, fields)
	case "close":
		return handleClose(sh, fields)
	default:
		return "ERR unknown command: " + fields[0]
	}
}

// handleComment seeds a resolvable PR comment. The body (fields[3]) is optional.
func handleComment(sh *shamhub.ShamHub, fields []string) string {
	if len(fields) < 3 {
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

// changeNumber parses the change number from a "<cmd> <change#>" command,
// returning the number or an "ERR ..." reply (with the second value non-empty).
func changeNumber(fields []string, usage string) (int, string) {
	if len(fields) < 2 {
		return 0, "ERR usage: " + usage
	}
	n, err := strconv.Atoi(fields[1])
	if err != nil {
		return 0, "ERR invalid change number: " + fields[1]
	}
	return n, ""
}

// handleMerge marks a change merged (its CR status becomes "merged").
func handleMerge(sh *shamhub.ShamHub, fields []string) string {
	n, errMsg := changeNumber(fields, "merge <change#>")
	if errMsg != "" {
		return errMsg
	}
	if err := sh.MergeChange(shamhub.MergeChangeRequest{Owner: owner, Repo: repo, Number: n}); err != nil {
		return "ERR " + err.Error()
	}
	return "OK"
}

// handleClose rejects a change without merging (its CR status becomes "closed").
func handleClose(sh *shamhub.ShamHub, fields []string) string {
	n, errMsg := changeNumber(fields, "close <change#>")
	if errMsg != "" {
		return errMsg
	}
	if err := sh.RejectChange(shamhub.RejectChangeRequest{Owner: owner, Repo: repo, Number: n}); err != nil {
		return "ERR " + err.Error()
	}
	return "OK"
}

func die(what string, err error) {
	fmt.Fprintf(os.Stderr, "shamhub-server: %s: %v\n", what, err)
	os.Exit(1)
}
