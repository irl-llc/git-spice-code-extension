# Publishing to VS Code Marketplace

## Prerequisites

1. **Create a Publisher Account**
   - Go to https://marketplace.visualstudio.com/manage
   - Sign in with Microsoft account
   - Create a new publisher (or use existing)
   - Update `publisher` field in package.json to match your publisher ID

2. **Generate Personal Access Token (PAT)**
   - Go to https://dev.azure.com
   - Create a PAT with `Marketplace (Manage)` scope
   - Store it as a GitHub secret named `VSCE_PAT`

3. **Install vsce CLI**
   ```bash
   npm install -g @vscode/vsce
   ```

## Publishing Process

### Option 1: Manual Publishing

```bash
# 1. Update version in package.json
npm version patch  # or minor, or major

# 2. Run all checks
npm run lint
npm run format:check
npm run compile
npm run test:unit

# 3. Package the extension
npm run package

# 4. Publish to marketplace
vsce publish -p <YOUR_PAT>
```

### Option 2: GitHub Actions Workflow

The repository includes a GitHub Actions workflow for automated publishing:

1. Go to Actions tab in GitHub
2. Select "Publish to Marketplace" workflow
3. Click "Run workflow"
4. Enter the version number (e.g., 0.1.0)
5. The workflow will:
   - Run all tests and checks
   - Update package.json version
   - Build the extension
   - Publish to marketplace
   - Create a GitHub release

### Option 3: Tag-based Publishing (Recommended for Production)

Uncomment the trigger in `.github/workflows/publish.yml`:

```yaml
on:
  push:
    tags:
      - 'v*'
```

Then publish by creating a tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

## Pre-publishing Checklist

- [ ] README.md has clear description and screenshots
- [ ] CHANGELOG.md is up to date
- [ ] All tests pass
- [ ] Extension icon is set (optional but recommended)
- [ ] Categories and keywords are appropriate
- [ ] License file exists
- [ ] Repository URL is correct in package.json

## After Publishing

- The extension will appear at: `https://marketplace.visualstudio.com/items?itemName=<publisher>.<name>`
- Users can install it with: `ext install <publisher>.<name>`
- Monitor reviews and issues on the marketplace page

## Resources

- [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Marketplace Publisher Management](https://marketplace.visualstudio.com/manage)
- [vsce CLI Documentation](https://github.com/microsoft/vscode-vsce)
