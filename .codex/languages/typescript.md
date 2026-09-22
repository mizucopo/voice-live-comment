# TypeScript guidance

## Chrome Extension

- Target Manifest V3.
- Import runtime TypeScript modules with `.js` extensions so compiled output works in Chrome.
- Treat `dist/` as generated output.
- Run the TypeScript quality gate from the repository root:

```bash
npm run check
```
