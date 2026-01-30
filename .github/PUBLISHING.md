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
- Go to https://dev.azure.com
- Create a PAT with `Marketplace (Manage)` scope
- Add it as a GitHub secret named `VSCE_PAT` (already done ✅)

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
- Verify `VSCE_PAT` secret is set correctly in GitHub
- Ensure PAT has `Marketplace (Manage)` scope
- Check PAT hasn't expired

**CI passes but publish step is skipped:**
- Ensure you created a release (not just pushed code)
- Verify the tag starts with `v` (e.g., `v0.0.2`)
- Check the Actions log for the conditional check

**Version conflict error:**
- The version in package.json must be higher than the published version
- Run `npm version patch` to increment

## Resources

- [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Continuous Integration](https://code.visualstudio.com/api/working-with-extensions/continuous-integration)
- [Marketplace Publisher Management](https://marketplace.visualstudio.com/manage)
- [vsce CLI Documentation](https://github.com/microsoft/vscode-vsce)
