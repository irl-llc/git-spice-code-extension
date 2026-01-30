# Publishing to VS Code Marketplace

## Automated Publishing with GitHub Actions

This repository is configured for **automatic publishing** to the VS Code Marketplace when you create a GitHub release.

### How It Works

1. **CI runs on every push/PR** - Validates code quality, runs tests
2. **Publishing happens automatically on release** - When you create a GitHub release with a tag, the extension is published

### Publishing a New Version

#### Step 1: Update Version

```bash
# Update version in package.json (use patch, minor, or major)
npm version patch -m "Release v%s"

# This creates a commit and git tag (e.g., v0.0.2)
```

#### Step 2: Push Changes and Tag

```bash
git push origin main
git push origin v0.0.2  # Push the tag
```

#### Step 3: Create GitHub Release

1. Go to your repository on GitHub
2. Click "Releases" → "Create a new release"
3. Select the tag you just pushed (e.g., `v0.0.2`)
4. Add release notes describing changes
5. Click "Publish release"

**That's it!** The GitHub Actions workflow will automatically:
- ✅ Run all tests and quality checks
- ✅ Build the production bundle
- ✅ Publish to VS Code Marketplace
- ✅ Use your `VSCE_PAT` secret for authentication

### Monitoring the Deployment

- Watch the "Actions" tab in GitHub to see the CI workflow progress
- The publish step only runs when:
  - All tests pass
  - The trigger is a tag (release)
  - Running on Node.js 20.x (single publish, no duplicates)

### Manual Publishing (Alternative)

If you need to publish manually without GitHub Actions:

```bash
# Install vsce globally (if not already installed)
npm install -g @vscode/vsce

# Run all checks
npm run lint
npm run format:check
npm run compile
npm run test:unit

# Package the extension
npm run package

# Publish (requires VSCE_PAT environment variable)
npm run deploy
# or: vsce publish --no-dependencies -p <YOUR_PAT>
```

## Prerequisites (One-time Setup)

### 1. Publisher Account
- Go to https://marketplace.visualstudio.com/manage
- Sign in with Microsoft account
- Create a publisher (already done: `IRLAILLC`)

### 2. Personal Access Token (PAT)

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
- Monitor the marketplace page for reviews and ratings

## Version Numbering

Follow semantic versioning (semver):
- **Patch** (0.0.x): Bug fixes, small tweaks
- **Minor** (0.x.0): New features, backward compatible
- **Major** (x.0.0): Breaking changes

```bash
npm version patch  # 0.0.1 → 0.0.2
npm version minor  # 0.0.2 → 0.1.0
npm version major  # 0.1.0 → 1.0.0
```

## Troubleshooting

**Publishing fails with authentication error:**
- **PAT Expired**: Check https://dev.azure.com for token expiration date
  - If expired, create a new PAT and update the `VSCE_PAT` GitHub secret
- **Wrong Organization Scope**: PAT must use "All accessible organizations" (not a specific org)
- **Insufficient Scopes**: Verify PAT has "Marketplace (Manage)" scope
- **Secret Not Set**: Ensure `VSCE_PAT` secret exists in GitHub Settings → Secrets

**CI passes but publish step is skipped:**
- Ensure you created a **GitHub release** (not just pushed code)
- Verify the tag starts with `v` (e.g., `v0.0.2`)
- Check the Actions log to see which condition failed:
  - `success()` - Did all tests pass?
  - `startsWith(github.ref, 'refs/tags/')` - Is this a tag push?
  - `matrix.node-version == '20.x'` - Running on correct Node version?

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
- [vsce CLI Documentation](https://github.com/microsoft/vscode-vsce)
