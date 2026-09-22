# Voice Live Comment project guidance

## Work boundaries

- Create a GitHub Issue before starting implementation and use a non-`main` branch associated with that Issue.
- Use `git mv` to move tracked files and `git rm` to delete them.

## Voice Live Comment requirements

- Preserve the YouTube comment behavior, STT providers, audio pipeline, options, icons, and observable tests when applying template updates. Follow `docs/adr/0002-adopt-template-first-chrome-extension-layout.md` for the template-first layout and repository-specific build requirements.
- Keep TypeScript source, `manifest.json`, the options page, styles, and icons under `src/`; build the loadable extension into `dist/`.
- Keep `package.json` and `src/manifest.json` versions equal. Every Pull Request targeting `main`, including Dependabot, must introduce a new extension version; merging creates a distribution release with the raw `X.Y.Z` tag.
- Put Chrome API boundaries in entrypoints such as `background.ts`, `content.ts`, and `options.ts`, and mock Chrome APIs only at those boundaries.
- Test observable behavior with Vitest and place tests in `tests/`, mirroring `src/` where practical.
- Update related documentation when behavior or interfaces change, and document new feature usage in README. Split large documentation into `docs/` and link it from README.
