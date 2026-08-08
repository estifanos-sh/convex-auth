# Package delivery

The repository has two distinct delivery paths. Keeping them separate makes it
clear whether a pull request is only being tested or will create an npm
release.

## Pull request package previews

Pull requests that touch `packages/auth` or its build and test inputs
automatically publish an ephemeral package through
[pkg.pr.new](https://pkg.pr.new). This does not write to npm, create a Git tag,
or create a GitHub release.

The workflow updates one pull request comment with the install URL for the
current commit. Docs-only pull requests skip this workflow. A preview can also
be created manually from the **Package Preview** workflow by supplying a Git
ref. These previews replace npm prerelease versions.

## npm releases

The public package is `@estifanos-sh/convex-auth`. Every npm release uses the
repository's `npm` GitHub environment, creates or verifies a matching
`v<version>` tag, and creates a GitHub release.

Stable releases use normal semver versions such as `0.0.2`:

1. Set `packages/auth/package.json` to the next stable version.
2. Add the `npm package` label to the pull request.
3. Confirm **Release readiness** reports the `latest` dist-tag.
4. Merge the pull request. The reviewed merge dispatches the stable release.

Prereleases are explicit workflow dispatches. In **npm Release**, select
`prerelease`, provide a main-reachable ref, and provide the matching tag, such
as `v0.0.1-preview.0`. Prerelease versions must contain a semver prerelease
suffix and publish under npm's `preview` dist-tag. Their GitHub releases are
marked as prereleases. Stable workflow dispatches remain available for a
recovery release and require a stable package version.

## First package bootstrap

`@estifanos-sh/convex-auth` is a new npm package. npm cannot bind trusted
publishing until the package exists, so the first version
(`0.0.1-preview.0`) must be published directly by an authenticated maintainer.
Do this only after the release workflow has validated the exact main-reachable
source and created or verified `v0.0.1-preview.0`. Use a clean checkout of that
tag, install the locked dependencies, and run the same package gates as the
workflow before publishing:

```sh
git fetch origin tag v0.0.1-preview.0
git switch --detach v0.0.1-preview.0
vp install --frozen-lockfile
vp run '@estifanos-sh/convex-auth#build'
vp run '@estifanos-sh/convex-auth#typecheck:consumer'
vp run '@estifanos-sh/convex-auth#typecheck:consumer:dist'
vp run '@estifanos-sh/convex-auth#check:packaging'
cd packages/auth
npm publish --access public --tag preview
```

Use an interactive npm login and any required one-time password; do not add an
npm access token to GitHub, repository secrets, or this workflow. Immediately
after the direct publish, configure npm trusted publishing for
`@estifanos-sh/convex-auth` with repository `estifanos-sh/convex-auth`, workflow
`release.yml`, and the `npm` environment. Re-dispatching the
same prerelease is idempotent: it verifies the published version and creates
the GitHub prerelease without publishing it again.

Do not add `npm package` to docs-only or CI-only pull requests. Removing the
label before merge prevents a stable npm release.
