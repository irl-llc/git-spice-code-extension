# Playwright snapshot tests — how to update baselines correctly

Baselines (`*.spec.ts-snapshots/*-linux.png`) are **Linux-rendered in Docker**
so dev and CI compare the same bytes. Read this before regenerating them — the
procedure has sharp edges that produce *plausible-but-wrong* baselines.

## Regenerate ONLY this way

```
npm ci                                       # in THIS worktree — see trap #2
npm run compile && npm run compile-tests     # build dist/ — see trap #1
npm run test:e2e:playwright:docker:update    # backgrounded — see trap #3
```

Then **inspect every generated PNG** (`open …-snapshots/*.png`). Playwright
proves a snapshot is *reproducible*, not that it depicts the *correct* UI.

Never route regeneration through CI. The submitter owns the baseline; a CI job
that regenerates-and-blesses its own renders can't catch a regression it just
produced.

## The three traps (all hit on 2026-06-14 — issue #105)

The docker `:update` only runs `npm ci` + `gs:fetch` + `playwright` **in the
container**; it does not build the extension. It loads the host-built `dist/`
via the `.:/work` mount. So:

1. **Empty `dist/` → every spec fails identically with**
   `Git Spice webview frame did not appear within 60000ms`. That is NOT a
   snapshot diff — `main` is `./dist/extension.js` and the extension can't
   activate. Build first. **Do not retry the identical run** — read the error.

2. **A worktree with no `npm ci` has an empty `node_modules`**, so webpack
   silently resolves deps from the **parent repo's `../../../node_modules`**
   (a different branch). The bundle "compiles successfully" against the wrong
   versions and produces baselines that look fine but are subtly wrong. Symptom:
   existing baselines "drift" with no UI change. This is **not emulation** —
   emulated amd64 keeps *identical dimensions*; differing element heights (e.g.
   a card 226→203px) mean a real build/content diff. Before trusting any
   baseline, confirm `npm ls --depth=0` is clean and `dist/` was built from
   this worktree's deps.

3. **The run exceeds the Bash tool's 10-minute foreground cap** (600000 ms).
   Launch it in the **background** and poll. This is a tool limit, not a
   status-pipe tick limit (a tick runs up to `timeoutMinutes`, default 45).

## Authoring new snapshot specs

- Prefer the full-pane mode; copy [fullPaneCards.spec.ts](fullPaneCards.spec.ts).
- Cover the happy path **and** the failure/edge state — capture a separate,
  descriptively-named screenshot per meaningful state.
- Remote/forge-dependent specs MUST be driven by the **shamhub** fake forge
  ([fixtures/shamhub.ts](fixtures/shamhub.ts)), never mocks. See
  [commentCounts.spec.ts](commentCounts.spec.ts) for the canonical pattern.
