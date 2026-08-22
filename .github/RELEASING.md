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
ref. Use these for ordinary PR testing; reserve npm prereleases for fixes that
must be exercised against real consumer deployments.

## npm releases

The public package is `@estifanos-sh/convex-auth`. Every npm release uses the
repository's `npm` GitHub environment, creates or verifies a matching
`v<version>` tag, and creates a GitHub release.

Npm releases use stable semver such as `0.0.2` or an approved prerelease channel
such as `0.0.5-alpha.0`:

1. Set `packages/auth/package.json` to the next version.
2. Add the `npm package` label to the pull request.
3. Confirm **Release readiness** reports `latest` for a stable version or the
   matching `alpha`, `beta`, or `rc` dist-tag for a prerelease.
4. Merge the pull request. The reviewed merge dispatches the release.

The release workflow publishes prereleases to their named channel without
moving `latest`, verifies the selected registry tag, and marks the matching
GitHub release as a prerelease. Unsupported prerelease channels are rejected.

For recovery, dispatch **npm Release** with a release's main-reachable commit
and matching `v<version>` tag. Re-dispatching a published release is safe: the
workflow skips publication and verifies the existing selected dist-tag.

Do not add `npm package` to docs-only or CI-only pull requests. Removing the
label before merge prevents an npm release.

## GitHub labels

GitHub is the release control plane:

| Label         | Effect                                                                     |
| ------------- | -------------------------------------------------------------------------- |
| `preview`     | Publish or update the PR's ephemeral `pkg.pr.new` package.                 |
| `npm package` | Validate a stable or prerelease version and publish it to npm after merge. |

The labels select the delivery path. The checked-in package version remains the
release's reproducible identity.
