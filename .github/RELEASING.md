# Package delivery

The repository has three distinct delivery paths. Keeping them separate makes
it clear whether a pull request is only being tested or will change npm.

## Pull request package previews

Pull requests that touch `packages/auth` or its build and test inputs
automatically publish an ephemeral package through
[pkg.pr.new](https://pkg.pr.new). This does not write to npm, create a Git tag,
or create a GitHub release.

The workflow updates one pull request comment with the install URL for the
current commit. Docs-only pull requests skip this workflow. A preview can also
be created manually from the **Package Preview** workflow by supplying a Git
ref.

## npm preview releases

Use an npm preview when consumers need a durable prerelease:

1. Set `packages/auth/package.json` to the next prerelease version, such as
   `0.0.5-preview.0`.
2. Add the `npm package` label to the pull request.
3. Confirm the **Release readiness** check reports the intended version and
   `preview` dist-tag.
4. Merge the pull request.

The merge creates `v<version>`, publishes with npm provenance, moves the
`preview` dist-tag, and creates the matching GitHub release.

## Stable npm releases

Use the same process with a version that has no prerelease suffix, such as
`0.0.5`. The **Release readiness** check reports the `latest` dist-tag before
merge. Merging the labeled pull request publishes the stable package and moves
`latest`.

The package version is the source of truth for the release channel:

| Version shape     | npm dist-tag |
| ----------------- | ------------ |
| `x.y.z-preview.n` | `preview`    |
| `x.y.z-beta.n`    | `beta`       |
| `x.y.z`           | `latest`     |

Do not add `npm package` to docs-only or CI-only pull requests. Removing the
label before merge prevents an npm release.
