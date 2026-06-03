# Publishing to VS Code Marketplace and Open VSX

## Automated Publishing with GitHub Actions

This repository is configured for **automatic publishing** to both the VS Code Marketplace and Open VSX when you create a GitHub release.

### How It Works

1. **CI runs on every push/PR** - Validates code quality, runs tests
2. **Publishing happens automatically on release** - When you create a GitHub release, `ci.yml` calls the reusable [`publish.yml`](workflows/publish.yml) workflow (after the build job passes) to publish to both registries. The scheduled auto-release job publishes through that same reusable workflow from within its own run (see issue #29 note below).

### Default path: scheduled auto-release (Changie)

**This is the default release mechanism.** A daily scheduled workflow
([`.github/workflows/auto-release.yml`](workflows/auto-release.yml)) batches any
pending [Changie](https://changie.dev) change fragments under
`.changes/unreleased/` into a new release. You do not normally create releases
by hand — you add a change fragment to your PR (see
[CONTRIBUTING.md](../CONTRIBUTING.md)) and the scheduled job ships it.

- **When it runs:** daily at 05:00 UTC (≈ midnight US Eastern). It also has a
  manual `workflow_dispatch` trigger (with an optional `dry_run` that prints the
  plan without tagging/publishing).
- **Version derivation (pre-1.0, stay on `0.x`):** the bump is derived from the
  pending fragments' kinds — a feature or breaking change (`Added`/`Changed`/
  `Removed`/`Deprecated`) bumps the **minor** (`0.x.0`); a bug fix
  (`Fixed`/`Security`) bumps the **patch** (`0.0.x`). We never bump major while
  on `0.x`. The highest pending bump wins.
- **No-op on quiet days:** with zero pending fragments the job exits silently and
  makes no release, avoiding release noise for users.
- **What it does:** runs `changie batch <level>` + `changie merge` to fold
  fragments into `CHANGELOG.md`, bumps `package.json`, commits, tags
  `v<version>`, and creates a GitHub Release. It then **publishes within the
  same workflow run** by calling the shared reusable workflow
  ([`.github/workflows/publish.yml`](workflows/publish.yml)).

> **Why the auto-release job publishes itself (issue #29):** GitHub deliberately
> does **not** trigger new workflow runs from events (tag push / Release)
> created with the default `GITHUB_TOKEN`. The scheduled job creates its Release
> with that token, so the `on: release` publish path in `ci.yml` never fired for
> auto releases — this is why `v0.1.0` was tagged but never reached the
> Marketplace/Open VSX. The fix chains a `publish` job in the auto-release run
> (gated on the `released` output of `scripts/auto-release.mjs`) that checks out
> the freshly created tag. No new repo secret is required; it reuses the
> existing `VSCE_PAT`/`OVSX_PAT` secrets.

Both the scheduled job and a human-created GitHub Release publish through the
**same reusable workflow** ([`publish.yml`](workflows/publish.yml)), so the
publish logic lives in exactly one place.

The manual options below remain available for one-off or emergency releases.

### Publishing a New Version (manual)

There are **two ways** to publish manually:

#### Option 1: GitHub Release (Recommended for Production)

**Best for:** Stable releases with detailed release notes

**Step 1:** Update version locally

```bash
npm version patch -m "Release v%s"  # or minor/major
# This creates a commit and git tag (e.g., v0.0.2)
```

**Step 2:** Push changes and tag

```bash
git push origin main
git push origin v0.0.2  # Push the tag
```

**Step 3:** Create GitHub Release

1. Go to your repository on GitHub
2. Click "Releases" → "Create a new release"
3. Select the tag you just pushed (e.g., `v0.0.2`)
4. Add release notes describing changes
5. Click "Publish release"

**Result:** GitHub Actions automatically runs tests and publishes to both registries

#### Option 2: Auto-Increment via Workflow Dispatch (Quick Publishing)

**Best for:** Quick patches, automated version bumping

**Step 1:** Push your changes to main

```bash
git add .
git commit -m "Fix: description of changes"
git push origin main
```

**Step 2:** Trigger workflow manually

1. Go to Actions tab in GitHub
2. Select "CI" workflow
3. Click "Run workflow"
4. Choose version increment type: `patch`, `minor`, or `major`
5. Click "Run workflow"

**Result:** The workflow will:

- ✅ Run all tests
- ✅ Auto-increment version in package.json (using `vsce publish patch/minor/major`)
- ✅ Create version commit and git tag automatically
- ✅ Publish to VS Code Marketplace
- ✅ Publish to Open VSX

**Comparison:**

| Feature         | GitHub Release       | Auto-Increment     |
| --------------- | -------------------- | ------------------ |
| Version control | Manual (you choose)  | Automatic (semver) |
| Release notes   | Required/recommended | Optional           |
| Git tag         | You create           | vsce creates       |
| Best for        | Stable releases      | Quick patches      |

Both methods run the same tests and publish to both registries automatically.

### Monitoring the Deployment

- Watch the "Actions" tab in GitHub to see the CI workflow progress
- The publish steps only run when:
  - All tests pass
  - The trigger is a tag (release)
  - Running on Node.js 22.x (single publish, no duplicates)

### Manual Publishing (Alternative)

If you need to publish manually without GitHub Actions:

**Option A: Publish current version** (no version change)

```bash
# Run all checks
npm run lint
npm run format:check
npm run compile
npm run test:unit
npm run package

# Publish current version to VS Code Marketplace
VSCE_PAT=<your-token> npm run deploy

# Publish current version to Open VSX
OVSX_PAT=<your-token> npm run deploy:openvsx
```

**Option B: Auto-increment and publish** (vsce handles version bump)

```bash
# Run all checks
npm run lint
npm run format:check
npm run compile
npm run test:unit
npm run package

# Publish with auto-increment (choose one)
VSCE_PAT=<your-token> npm run deploy:patch  # 0.0.1 → 0.0.2
VSCE_PAT=<your-token> npm run deploy:minor  # 0.0.1 → 0.1.0
VSCE_PAT=<your-token> npm run deploy:major  # 0.0.1 → 1.0.0
```

The auto-increment commands will:

1. Update version in package.json
2. Create a git commit with the version change
3. Create a git tag (e.g., `v0.0.2`)
4. Publish to marketplace

Reference: https://code.visualstudio.com/api/working-with-extensions/publishing-extension#autoincrement-the-extension-version

## Prerequisites (One-time Setup)

### 1. VS Code Marketplace Publisher Account

- Go to https://marketplace.visualstudio.com/manage
- Sign in with Microsoft account
- Create a publisher (already done: `IRLAILLC`)

### 2. Open VSX Namespace

The publisher namespace must exist on Open VSX **before** the first publish, or
the release job's Open VSX step fails with `npm error 404 Not Found - PUT ... -
Unknown namespace: IRLAILLC` (this was the cause of the v0.0.4 release failure).

- Go to https://open-vsx.org, sign in, and create (or confirm) a namespace for
  your publisher, **or** create it from the CLI once you have an `OVSX_PAT`:

  ```bash
  npx ovsx create-namespace IRLAILLC -p "$OVSX_PAT"
  ```

- This is a one-time action; the namespace persists across releases.
- Ensure the extension namespace/name maps correctly (`IRLAILLC.git-spice`).

### 3. VS Code Marketplace Personal Access Token (PAT)

**Initial Setup** (already done ✅):

- Go to https://dev.azure.com
- Select your organization
- Click your profile → "Personal access tokens"
- Click "New Token"
- Configure:
  - **Name**: Any descriptive name (e.g., "VS Code Marketplace - git-spice")
  - **Organization**: **"All accessible organizations"** (critical - don't select specific org)
  - **Expiration**: Set an expiration date (recommended: 90 days for security)
  - **Scopes**: "Custom defined" → "Show all scopes" → **Marketplace: Manage**
- Click "Create" and copy the token
- Add it as a GitHub secret named `VSCE_PAT`

### 4. Open VSX Personal Access Token

- Go to https://open-vsx.org/user-settings/tokens
- Create a token with publish permissions for your namespace
- Add it as a GitHub secret named `OVSX_PAT`

**PAT Rotation** (recommended every 90 days):

When your PAT expires or you want to rotate it for security:

1. **Create New PAT**:
   - Follow the same steps above to create a new PAT
   - Use the same scopes: "All accessible organizations" + "Marketplace (Manage)"
   - Copy the new token

2. **Update GitHub Secret**:
   - Go to your GitHub repository
   - Navigate to Settings → Secrets and variables → Actions
   - Find `VSCE_PAT` in the list
   - Click "Update" and paste the new token
   - Click "Update secret"

3. **Revoke Old PAT** (optional but recommended):
   - Go back to https://dev.azure.com
   - Find the old token in your Personal Access Tokens list
   - Click "Revoke" to invalidate it

**Setting Expiration Reminders**:

- Add a calendar reminder 1 week before PAT expiration
- Azure DevOps will also email you before expiration
- The CI workflow will fail with authentication error if PAT expires

Reference: https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token

## Pre-publishing Checklist

Before creating a release, ensure:

- [ ] All tests pass (`npm run test:unit`)
- [ ] Linting passes (`npm run lint`)
- [ ] Format check passes (`npm run format:check`)
- [ ] Version bumped in package.json
- [ ] CHANGELOG.md updated with release notes
- [ ] README.md is up to date
- [ ] Extension tested manually in VS Code

## After Publishing

- Extension appears at: `https://marketplace.visualstudio.com/items?itemName=IRLAILLC.git-spice`
- Users can install: `ext install IRLAILLC.git-spice`
- Extension appears at: `https://open-vsx.org/extension/IRLAILLC/git-spice`
- Open VSX users can install via their editor (e.g. VSCodium, Cursor): `codium --install-extension IRLAILLC.git-spice`, or search "git-spice" in the in-app Extensions view
- Monitor the marketplace page for reviews and ratings

## Version Numbering

Follow semantic versioning (semver):

- **Patch** (0.0.x): Bug fixes, small tweaks
- **Minor** (0.x.0): New features, backward compatible
- **Major** (x.0.0): Breaking changes

**Manual versioning** (npm):

```bash
npm version patch  # 0.0.1 → 0.0.2 (creates commit + tag)
npm version minor  # 0.0.2 → 0.1.0
npm version major  # 0.1.0 → 1.0.0
```

**Auto-increment** (vsce):

```bash
npm run deploy:patch  # Auto-increments patch version and publishes
npm run deploy:minor  # Auto-increments minor version and publishes
npm run deploy:major  # Auto-increments major version and publishes
```

Both approaches create git commits and tags automatically. The vsce method also publishes immediately, while npm version requires a separate publish step.

## Troubleshooting

**Publishing fails with authentication error:**

- **PAT Expired**: Check https://dev.azure.com for token expiration date
  - If expired, create a new PAT and update the `VSCE_PAT` GitHub secret
- **Wrong Organization Scope**: PAT must use "All accessible organizations" (not a specific org)
- **Insufficient Scopes**: Verify PAT has "Marketplace (Manage)" scope
- **Secret Not Set**: Ensure `VSCE_PAT` secret exists in GitHub Settings → Secrets

**CI passes but the publish job is skipped:**

- Ensure you created a **GitHub release** (not just pushed code/a tag). The
  `publish` job in `ci.yml` is gated on `github.event_name == 'release'`.
- For a hand-created Release, the `publish` job runs only after the `build` job
  succeeds — check the build job for failures.
- For a scheduled/manual auto-release, the publish job is gated on the
  `released` output of `scripts/auto-release.mjs` — if there were no pending
  change fragments (or it was a `dry_run`), nothing is released and publish is
  correctly skipped.
- **A tag/Release alone never re-triggers publish.** GitHub does not start
  workflow runs from events created with the default `GITHUB_TOKEN`, which is
  why the auto-release job chains its own publish job rather than relying on
  `on: release` (issue #29).

**Version conflict error:**

- The version in package.json must be **higher** than the currently published version
- Check marketplace: https://marketplace.visualstudio.com/items?itemName=IRLAILLC.git-spice
- Run `npm version patch` (or `minor`/`major`) to increment

**PAT will expire soon:**

- Rotate the PAT before it expires (see "PAT Rotation" section above)
- Azure DevOps sends reminder emails before expiration
- Set a calendar reminder 1 week before expiration date

## Resources

- [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Continuous Integration](https://code.visualstudio.com/api/working-with-extensions/continuous-integration)
- [Marketplace Publisher Management](https://marketplace.visualstudio.com/manage)
- [Open VSX](https://open-vsx.org/)
- [vsce CLI Documentation](https://github.com/microsoft/vscode-vsce)
