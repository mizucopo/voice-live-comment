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

## Existing Chrome Extension Adoption Rules

### WHY

Keep shared template metadata while the existing JavaScript Manifest V3 extension remains the source of truth.

### WHAT

- Preserve existing `package.json`, `src/`, `test/`, `tests/`, and release workflows unless the task explicitly asks to change them
- Do not introduce the template starter TypeScript extension files during template updates
- Keep runtime JavaScript in `src/`, generated extension output in `dist/`, and reusable logic in focused modules under `src/`
- Do not edit `dist/` manually

### HOW

- Put Chrome API boundaries in entrypoints such as `background.js`, `content.js`, and `options.js`
- Test observable behavior through Vitest instead of generated JavaScript or private implementation details
- Mock Chrome APIs only at entrypoint boundaries
- Place tests in `test/` and mirror `src/` structure when practical
- Run `npm run check` before handing off changes
