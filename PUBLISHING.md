# Publishing Pi Coding Agent Tabs to the VS Code Marketplace

## Decisions to make first

| Decision | Current value | Recommendation |
|---|---|---|
| **Publisher ID** | `peilundai` | Create this exact Marketplace publisher ID, or change `package.json` before publishing. The ID is permanent and appears in `peilundai.pi-agent-launcher`. |
| **Publisher display name** | Not configured yet | Choose **Peilun Dai** or a durable company/brand name. This publisher name—not `author.name`—is normally shown beneath the extension in Marketplace. |
| **Extension ID/name** | `pi-agent-launcher` | Confirm before publishing. Changing it later creates a different listing. Removed extension names remain permanently reserved. |
| **Listing title** | Pi Coding Agent Tabs | Reasonable, but clearly retain “Unofficial” in the description and README. |
| **Ownership** | Presumably personal | Decide whether the publisher belongs to you personally or to an organization. For a team, use a durable organizational identity and add additional publisher members. |
| **Pi name and logo** | Uses Pi’s name and derived official logo | This is the largest nontechnical risk. MIT licensing does not grant trademark rights, as `NOTICE` correctly says. Ideally obtain written permission from Earendil/Pi, or use an original icon and branding that cannot imply endorsement. |
| **Publishing method** | None configured | Manual VSIX upload is simplest initially. For recurring releases choose CLI publishing or secure CI automation. |
| **Marketplace scope** | VS Code and Cursor mentioned | VS Marketplace publishing does not automatically publish to Open VSX. Cursor/Open VSX distribution is a separate decision. |

### What developer name will users see?

With the recommended configuration:

- Extension title: **Pi Coding Agent Tabs**
- Publisher shown beneath it: **Peilun Dai**
- Permanent extension identifier: **`peilundai.pi-agent-launcher`**

The Marketplace publisher’s **Name** controls the displayed publisher name. The `publisher` field in `package.json` is its permanent identifier. The existing `author.name` is supplemental metadata.

## Registration required

1. Have a Microsoft account intended to own the publisher.
2. Sign in to the [Visual Studio Marketplace publisher portal](https://marketplace.visualstudio.com/manage).
3. Create a publisher:
   - **ID:** `peilundai`
   - **Name:** for example, `Peilun Dai`
4. Accept the Marketplace Publisher Agreement.
5. Complete the optional publisher profile details and add backup members if appropriate.

If `peilundai` is unavailable, choose another publisher ID and update:

```json
"publisher": "your-new-publisher-id"
```

### Authentication choices

#### Simplest first release: manual upload

Package the extension, then upload the VSIX through the publisher portal. This avoids setting up release automation immediately.

#### Local CLI publishing

You need an Azure DevOps organization and a Personal Access Token configured with:

- Organization: **All accessible organizations**
- Scope: **Marketplace → Manage**

Then:

```bash
npx vsce login peilundai
npx vsce publish --no-dependencies
```

Microsoft currently recommends Entra ID/workload identity federation for durable automated publishing. Its documentation says global Azure DevOps PATs retire on **December 1, 2026**, so avoid building new long-lived automation around a PAT.

## Project-specific work before publishing

The current project was checked.

### Already in good shape

- `npm run check`: **28 tests passed**
- ESLint and TypeScript compilation pass
- `npm run package` succeeds without warnings
- VSIX is small: approximately **35 KB**
- Marketplace icon is a valid **512×512 PNG**
- License, support, security, notices, changelog, repository metadata, pricing, and workspace trust declarations are present
- No runtime dependencies or production audit vulnerabilities
- Packaged contents look appropriately restricted

### Must address

The declared public URLs currently return **404**:

- `https://github.com/peilundai/pi-tabs`
- The issues URL
- The `v0.2.0` release/tag URL used by `CHANGELOG.md`

Before publishing, either:

1. Create and publish that GitHub repository, issues page, and release/tag; or
2. Change `repository`, `homepage`, `bugs`, and changelog links to real public URLs.

A Marketplace listing with broken source/support links looks unfinished and may trigger user or Marketplace trust concerns.

### Strongly recommended

1. **Resolve trademark/branding**
   - Ask Pi/Earendil for permission to use the Pi-derived icon and product name, or
   - Replace the icon with an original design and make the unofficial relationship especially prominent.

2. **Test the packaged VSIX**, not only Extension Development Host:

   ```bash
   code --install-extension pi-agent-launcher-0.2.0.vsix
   ```

   Test at least:
   - Current stable VS Code
   - macOS/Linux
   - Windows, if continuing to claim Windows support
   - Remote SSH/dev container behavior
   - Missing `pi`
   - Missing Python
   - Multi-root workspaces
   - Upgrade/uninstall behavior

3. **Improve the Marketplace listing**
   - Add one screenshot or short demo showing the editor-tab experience.
   - Put “Requires separately installed Pi CLI” near the beginning.
   - Keep the no-telemetry and unofficial statements visible.
   - Consider whether `^1.85.0` is still the minimum VS Code version to support.

4. **Lock the initial identity**
   - Confirm `peilundai.pi-agent-launcher` before first publication.
   - Confirm version `0.2.0` has never been uploaded; Marketplace versions cannot be reused once published.
   - Avoid removing the listing later unless necessary; removed extension names are permanently reserved.

## Publication TODO checklist

### Source repository — required

- [ ] Create the public `peilundai/pi-tabs` GitHub repository, or update all metadata if a different owner or repository name is chosen.
- [ ] Create the initial commit while leaving this working `PUBLISHING.md` file untracked:

  ```bash
  git commit -m "chore: initialize extension repository"
  ```

- [ ] Add the GitHub remote and push `main`:

  ```bash
  git remote add origin git@github.com:peilundai/pi-tabs.git
  git push -u origin main
  ```

- [ ] Enable GitHub Issues so the `bugs` and support links work.
- [ ] Enable GitHub private vulnerability reporting/security advisories so the process in `SECURITY.md` is available.
- [ ] Confirm the repository, homepage, issues, support, security, and changelog links no longer return 404.
- [ ] Confirm the GitHub Actions checks pass on Linux, macOS, and Windows.
- [ ] Require a green CI run before tagging the release.

### Runtime compatibility — required

- [ ] Decide whether VS Code `^1.85.0` is truly the supported minimum.
- [ ] Test the oldest supported VS Code version as well as current stable VS Code.
- [ ] Align `@types/node` with the Node runtime in the minimum supported VS Code extension host, or raise `engines.vscode`. Using Node 22 types with an older extension host can permit unavailable runtime APIs.
- [ ] Test the final packaged VSIX in local and remote extension hosts on every platform whose behavior is advertised.

CI may continue to use Node 22 for build tooling even if extension runtime types are aligned to an older Node version.

### License and third-party notices — required

- [ ] Verify the exact upstream license and copyright notice for every Pi-derived asset.
- [ ] Include the complete third-party license text required for redistributed or derived assets in `NOTICE` or a dedicated `ThirdPartyNotices.txt`; attribution alone might not satisfy the upstream license.
- [ ] Consider restoring `LICENSE` to the canonical, unmodified MIT text and keeping project-scope and trademark explanations in `NOTICE` so automated license scanners identify it reliably.
- [ ] Resolve the separate trademark and endorsement question for the Pi name and geometric mark.

### Release metadata — required

- [ ] Confirm `CHANGELOG.md` has the actual `0.2.0` release date and accurate release notes.
- [ ] Ensure `Unreleased` is intentionally empty at release time.
- [ ] Build the final VSIX from the exact commit that receives the `v0.2.0` tag.
- [ ] Create and push the annotated tag:

  ```bash
  git tag -a v0.2.0 -m "Release 0.2.0"
  git push origin v0.2.0
  ```

- [ ] Create a matching GitHub release and optionally attach the VSIX.

### Repository hardening — recommended

- [ ] Pin `actions/checkout` and `actions/setup-node` to full commit SHAs for stronger workflow supply-chain security.
- [ ] Configure Dependabot for npm and GitHub Actions updates.
- [ ] Protect `main` and require the CI checks before merging.
- [ ] Add a repository description and relevant topics such as `vscode-extension`, `pi`, and `coding-agent`.
- [ ] Consider adding `CODE_OF_CONDUCT.md`, issue templates, a pull request template, and `CODEOWNERS`.

### Marketplace presentation — recommended

- [ ] Add at least one screenshot or short animation to the README showing the editor-tab workflow.
- [ ] Verify every README image uses HTTPS or is included in the VSIX and not excluded by `.vscodeignore`.
- [ ] Confirm the README renders correctly both on GitHub and as the Marketplace extension page.
- [ ] Keep the separate Pi installation requirement, unofficial status, platform limitations, and no-telemetry statement prominent.

## Suggested release sequence

```bash
npm ci
npm run check
npm run package
code --install-extension pi-agent-launcher-0.2.0.vsix
```

Then:

1. Complete clean-install testing.
2. Publish the GitHub repository.
3. Create and push tag `v0.2.0`.
4. Create publisher `peilundai` with display name `Peilun Dai`.
5. Upload `pi-agent-launcher-0.2.0.vsix` in the publisher portal, or use `vsce publish`.
6. Wait for Marketplace processing/security scanning.
7. Install it from the public Marketplace and run a final smoke test.
8. For every update, increment the SemVer version before publishing.

After the publisher and extension have existed for at least six months, you can apply for a verified publisher badge if you own an eligible domain that is also at least six months old.

## Official references

- [Publishing VS Code extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Extension manifest reference](https://code.visualstudio.com/api/references/extension-manifest)
- [Automated publishing](https://code.visualstudio.com/api/working-with-extensions/continuous-integration)
- [Marketplace publisher portal](https://marketplace.visualstudio.com/manage)
