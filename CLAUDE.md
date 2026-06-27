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

## Chrome Extension Code Organization Rules

### WHY

Keep extension entrypoints small and testable so browser-specific behavior stays easy to review.

### WHAT

- Target Manifest V3
- Keep runtime JavaScript in `src/`
- Keep generated extension output in `dist/`
- Keep reusable logic in focused modules under `src/`
- Do not edit `dist/` manually

### HOW

- Put Chrome API boundaries in entrypoints such as `background.js`, `content.js`, and `options.js`
- Test reusable logic through Vitest instead of testing generated output

## Chrome Extension Testing Guidelines

### WHAT

- **Framework**: Use Vitest for unit tests
- **Language**: Write test comments and docstrings in Japanese when they clarify intent
- **Strategy**: Test observable behavior, not generated JavaScript or private implementation details
- **Mocking**: Mock Chrome APIs only at entrypoint boundaries

### HOW

- Place tests in `test/` and mirror `src/` structure when practical
- Use `npm run check` before handing off changes

## Chrome Extension Quality Check

### HOW

```bash
npm run check
```
