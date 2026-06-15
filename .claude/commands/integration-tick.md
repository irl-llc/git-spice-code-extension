---
description: Status-pipe tick + git-spice integration-branch maintenance — runs one orchestration pass, then rebuilds and force-pushes the integration branch (the merged tips of every open stack) from the primary checkout.
argument-hint: "[--max-concurrent N] [--dry-run]"
---

**INTEGRATION TICK — one status-pipe pass, then rebuild the integration branch**

Two phases, in order. Phase 2 is skipped under `--dry-run`.

## Phase 1 — status-pipe tick

Run the standard orchestration pass by invoking the `status-pipe:tick` command
with these arguments verbatim: `$ARGUMENTS`. Let it run to completion — it
dispatches workers, waits for all of them, and writes `orchestrator.json`. Its
report is part of your output.

Workers register/advance their own integration tips during their submit phase
(see CLAUDE.md → "Integration branch (status-pipe workers)"), so by the time
the tick wraps, this wave's tips are already recorded in `refs/spice/data`.

## Phase 2 — rebuild the integration branch (primary checkout only)

Skip this phase entirely if `$ARGUMENTS` contains `--dry-run`.

First confirm you are NOT in a linked worktree (the integration state and the
push belong to the primary checkout, exactly like the tick's own preflight):

```bash
[ "$(git rev-parse --git-dir)" = "$(git rev-parse --git-common-dir)" ] \
  && echo PRIMARY || echo WORKTREE
```

If that prints `WORKTREE`, stop Phase 2 and say so in your report. Otherwise,
from the repo root:

```bash
# Bootstrap once: configure the singleton integration branch if absent.
# 'integration show' exits 0 even when unconfigured (the notice is a stderr
# log, stdout is empty), so test for the configured header on stdout, not $?.
gs integration show 2>/dev/null | grep -q "^Integration branch:" \
  || gs integration create integration

# Catch up to trunk and prune tips of merged branches — repo sync's
# OnBranchRemoved hook removes a merged branch from the tip list automatically.
# --no-prompt: cleanly-merged branches are deleted without prompting (so their
# tips get pruned); ambiguous ones are skipped rather than hanging the loop.
gs repo sync --no-prompt

# Reset to trunk, merge every configured tip (rerere replays recorded
# resolutions; accept-incoming — on by default — settles any remainder so the
# rebuild never blocks), then force-with-lease push.
gs integration rebuild --push
```

`gs integration rebuild` never opens a PR for the integration branch; it is a
throwaway artifact. The downstack of each tip IS submitted, so constituent
branches stay pushed/up to date.

If the rebuild ever stops on an unresolved conflict (should not happen while
accept-incoming is on), do NOT hand-resolve inside the loop: report the
conflicting tips and leave the branch as-is for the operator. Never merge,
approve, or delete anything.

(Once a conflict resolver script is configured via
`spice.integration.autoResolve`, switch the rebuild line to
`gs integration rebuild --auto-resolve --push`.)

Report: the integration branch name, the tips it included, and whether the push
updated the remote or was a no-op.
