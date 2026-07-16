## Issue-First Branch Workflow

### WHAT

- Never make changes directly on `main`.
- Before starting work, create a GitHub Issue that describes the work.
- Perform the work on a non-`main` branch associated with that Issue.

## Documentation

### HOW

- Update related documentation when code changes affect users
- Document usage for new features in README
- Update relevant docs when interfaces change
- Split large docs into separate files in `docs/` folder
- Add links to split docs in README

## File Operations

### HOW

```bash
# File operations
git mv <old-path> <new-path>  # Move files
git rm <path>                  # Delete files
```

## Template-First Chrome Extension Rules

### WHY

Keep repository structure, quality gates, and release automation aligned with `mizucopo/repo-template` while preserving Voice Live Comment's product behavior.

### WHAT

- Treat the current `repo-template` Chrome Extension output as the default source for shared configuration, workflows, and repository layout
- Keep product-specific behavior, dependencies, and observable tests while adapting them to template changes
- Keep TypeScript source, `manifest.json`, the options page, styles, and icons under `src/`
- Use `dist/` as the built Chrome extension root
- Keep `package.json` and `src/manifest.json` versions equal
- Every Pull Request targeting `main`, including Dependabot Pull Requests, must use a new extension version
- A merge to `main` creates a distribution release using the raw `X.Y.Z` tag
- Do not edit `dist/` manually

### HOW

- Prefer accepting rendered template files unchanged; keep a project-specific difference only when Voice Live Comment requires it
- Put Chrome API boundaries in entrypoints such as `background.ts`, `content.ts`, and `options.ts`
- Test observable behavior through Vitest instead of generated JavaScript or private implementation details
- Mock Chrome APIs only at entrypoint boundaries
- Place tests in `tests/` and mirror `src/` structure when practical
- Run `npm run check` before handing off changes
