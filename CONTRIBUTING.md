# Contributing

## Changelog fragments (Changie)

This project tracks user-facing changes with [Changie](https://changie.dev).
Instead of editing `CHANGELOG.md` directly, every pull request that changes
user-facing behavior adds a small "change fragment" file under
`.changes/unreleased/`. A scheduled job batches these fragments into a release
(see [`.github/PUBLISHING.md`](.github/PUBLISHING.md)).

### Adding a fragment

Install Changie (e.g. `brew install changie` on macOS/Linux,
`go install github.com/miniscruff/changie@latest`, or see the
[install docs](https://changie.dev/guide/installation/)) and run:

```bash
changie new
```

This prompts for a **kind** and a **body**, then writes a YAML fragment to
`.changes/unreleased/`. Commit that file with your change.

You can also write the fragment by hand — create
`.changes/unreleased/<descriptive-name>.yaml`:

```yaml
kind: Fixed
body: Stack view no longer flickers when refreshing comment counts.
```

### Kinds and version bumps

The extension is pre-1.0, so it stays on `0.x`. Per semver for `0.x`, both
features and breaking changes bump the **minor** component (we never bump major
while on `0.x`); bug fixes bump the **patch** component. The auto-release
derives the bump from the pending fragment kinds:

| Kind         | Use for                                    | Bump  |
| ------------ | ------------------------------------------ | ----- |
| `Added`      | New user-facing feature                    | minor |
| `Changed`    | Change to existing behavior (incl. breaking) | minor |
| `Deprecated` | Soon-to-be-removed behavior                | minor |
| `Removed`    | Removed behavior                           | minor |
| `Fixed`      | Bug fix                                     | patch |
| `Security`   | Security fix                               | patch |

When multiple fragments are pending, the highest bump wins (any
`Added`/`Changed`/`Deprecated`/`Removed` => minor; otherwise patch).

### When a fragment is NOT required

Docs-only, CI-only, and other non-user-facing changes do not warrant a release
and do not need a fragment. CI recognizes these automatically by the paths a PR
touches; if it cannot, add the `skip-changelog` label to the PR to bypass the
gate. Docs-only changes never trigger a release.
