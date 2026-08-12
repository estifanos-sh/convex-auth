# Package delivery

The repository has two distinct delivery paths. Keeping them separate makes it
clear whether a pull request is only being tested or will create an npm
release.

## Pull request package previews

Add the `preview` label to a pull request that touches `packages/auth` or its
build and test inputs to publish an ephemeral package through
[pkg.pr.new](https://pkg.pr.new). New commits update the preview while the label
remains. This does not write to npm, create a Git tag, or create a GitHub
release.

The workflow updates one pull request comment with the install URL for the
current commit. Docs-only pull requests skip this workflow. A preview can also
be created manually from the **Package Preview** workflow by supplying a Git
ref. These previews replace npm prerelease versions.

## npm releases

The public package is `@estifanos-sh/convex-auth`. Every npm release uses the
repository's `npm` GitHub environment, creates or verifies a matching
`v<version>` tag, and creates a GitHub release.

All npm releases use stable semver versions such as `0.0.2`:

1. Set `packages/auth/package.json` to the next stable version.
2. Add the `npm package` label to the pull request.
3. Confirm **Release readiness** reports the `latest` dist-tag.
4. Merge the pull request. The reviewed merge dispatches the stable release.

The release workflow rejects prerelease versions. It always publishes to npm's
`latest` dist-tag, verifies that the registry points `latest` to the released
version, and creates a matching stable GitHub release. Use **Package Preview**
for manual test builds; it publishes through `pkg.pr.new`, not npm.

For recovery, dispatch **npm Release** with a stable version's main-reachable
commit and matching `v<version>` tag. Re-dispatching a published release is
safe: the workflow skips publication and verifies the existing `latest` tag.

Do not add `npm package` to docs-only or CI-only pull requests. Removing the
label before merge prevents a stable npm release.

## GitHub labels

GitHub is the release control plane:

| Label         | Effect                                                       |
| ------------- | ------------------------------------------------------------ |
| `preview`     | Publish or update the PR's ephemeral `pkg.pr.new` package.   |
| `npm package` | Validate a stable version and publish it to npm after merge. |

The labels select the delivery path. The checked-in package version remains the
release's reproducible identity.
