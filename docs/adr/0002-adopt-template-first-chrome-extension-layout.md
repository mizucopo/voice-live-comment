# Adopt the Template-First Chrome Extension Layout

Status: Accepted; release numbering and publication rules superseded by [ADR 0003](0003-adopt-automatic-release-numbering.md).

## Context

Voice Live Comment was registered as a child of `mizucopo/repo-template` while retaining a root manifest, JavaScript source, project-specific quality configuration, and a custom release workflow. That adoption model made later Copier updates preserve deleted template files and required repeated decisions about whether the template or the existing repository was authoritative.

Voice Live Comment still needs its existing YouTube comment behavior, STT providers, audio pipeline, options, and observable tests. Shared project structure and automation do not need to remain custom.

## Decision

Use the current `repo-template` Chrome Extension output as the default for shared layout, TypeScript and lint configuration, Node version, quality workflow, version-tag check, and distribution release workflow.

- Keep TypeScript application source and source assets under `src/`, including `src/manifest.json`.
- Build the loadable extension into `dist/`; never edit `dist/` manually.
- Keep Voice Live Comment behavior, dependencies, Rollup content-script bundling, options assets, icons, and tests as project-specific additions.
- Keep `package.json` and `src/manifest.json` versions equal.
- Require every Pull Request targeting `main`, including Dependabot Pull Requests, to introduce a version whose raw `X.Y.Z` tag is available.
- Treat every merge to `main` as a distribution release.

## Consequences

Copier updates should normally accept rendered template files and adapt product code around them. A project-specific deviation must identify the Voice Live Comment requirement that makes it necessary.

Local development and Chrome loading use `dist/` after `npm run build`. New releases use `{repository-name}-{version}.zip` (`voice-live-comment-{version}.zip` for this repository), the title `Chrome Extension {version}`, and the raw version as the Git tag. The repository name comes from the original push event so reruns preserve the published asset name after a repository rename. Previously published `chrome-extension-{version}.zip` assets are not renamed or republished.

The release workflow previously differed from the template to read the original push event's `repository.full_name` from `GITHUB_EVENT_PATH`, while API requests continued to use the current `GITHUB_REPOSITORY`. The current template now supplies this behavior; the temporary exception tracked in [repo-template #93](https://github.com/mizucopo/repo-template/issues/93) is removed after applying and verifying its replacement. Distribution ZIP names remain stable when the original event is rerun after a repository rename.
