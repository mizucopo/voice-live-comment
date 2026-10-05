# Adopt Template Automatic Release Numbering

Status: Accepted

## Context

The current repo-template replaces per-PR version bumps and tag-conflict checks with release classification and automatic numbering after squash merge. Voice Live Comment adopts shared automation from the template under ADR 0002 while preserving extension behavior and distribution assets.

## Decision

- Use the template's `CONTRIBUTING.md`, release declaration, numbering script, classification check, and Chrome Extension distribution workflow.
- Follow `CONTRIBUTING.md` for release intent and classification. Actions updates matching package, manifest, and lockfile versions after squash merge and atomically pushes the numbering commit and raw version tag.
- Publish the numbered commit from the same Actions run. An unlabelled latest merged PR skips publication; its changes remain in main for a later classified release.
- Keep event-based ZIP naming, icons, the options page, Rollup content-script bundling, and the MIT license in the distribution.
- The migration PR itself follows the existing main policy by introducing version `1.6.2`. Subsequent PRs use automatic numbering.

## Consequences

ADR 0002's per-PR version bump and every-merge publication requirements are superseded. Shared setup and recovery instructions live in `docs/release.md`. The repository must allow squash merge and standard `GITHUB_TOKEN` pushes to main and version tags. Existing published tags, Releases, and ZIP names remain unchanged.
