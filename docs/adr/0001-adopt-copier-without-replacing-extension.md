# Adopt Copier Without Replacing the Extension

Voice Live Comment is registered as a child of `mizucopo/repo-template`. The template no longer exposes the former `chrome_extension_mode=adopt_existing` and `chrome_extension_manifest_path=manifest.json` answers. `.copier-answers.yml` therefore records the template's standard Chrome Extension metadata instead of an adoption mode.

The existing JavaScript Manifest V3 implementation, root `manifest.json`, package metadata, tests, Rollup build, and release workflow remain the source of truth. During `copier update`, the Existing Chrome Extension Adoption Rules in `AGENTS.md` and `CLAUDE.md` require template starter TypeScript files and incompatible build changes to be discarded while shared metadata such as the Node version, agent guidance, license, Dependabot configuration, and Copier update state is retained.
