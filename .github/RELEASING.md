# Package delivery

The repository has two distinct delivery paths. Keeping them separate makes it
clear whether a pull request is only being tested or will create a stable npm
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

npm releases are stable, normal semver increments:

1. Set `packages/auth/package.json` to the next stable version, such as `0.0.5`.
2. Add the `npm package` label to the pull request.
3. Confirm the **Release readiness** check reports the intended version and
   `latest` dist-tag.
4. Merge the pull request.

The merge creates `v<version>`, publishes with npm provenance under `latest`,
and creates the matching GitHub release. Versions containing a prerelease
suffix, such as `-preview.0` or `-beta.0`, are rejected.

Do not add `npm package` to docs-only or CI-only pull requests. Removing the
label before merge prevents an npm release.
