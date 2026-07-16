import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const releaseWorkflow = readFileSync(".github/workflows/chrome-extension-release.yml", "utf8");
const tagCheckWorkflow = readFileSync(".github/workflows/pr-tag-check.yml", "utf8");
const qualityWorkflow = readFileSync(
  ".github/workflows/chrome-extension-quality-checks.yml",
  "utf8",
);
const assetCopyScript = readFileSync("scripts/copy-extension-assets.mjs", "utf8");

describe("Chrome拡張のGitHub Actions", () => {
  it("mainへのすべてのマージを配布リリース対象にする", () => {
    expect(releaseWorkflow).toMatch(/^ {2}push:/m);
    expect(releaseWorkflow).toMatch(/^ {6}- main$/m);
    expect(releaseWorkflow).toContain("is not associated with a merged pull request into main");
    expect(releaseWorkflow).not.toContain("dependabot[bot]");
  });

  it("src/manifest.jsonとpackage.jsonで同じバージョンを使う", () => {
    for (const workflow of [releaseWorkflow, tagCheckWorkflow]) {
      expect(workflow).toContain('"src/manifest.json"');
      expect(workflow).toContain("packageVersion !== manifestVersion");
    }
  });

  it("v接頭辞なしのバージョンタグと標準ZIP名を使う", () => {
    expect(releaseWorkflow).toContain('setOutput("tag", packageVersion)');
    expect(releaseWorkflow).toContain('const zipNameTemplate = "chrome-extension-{version}.zip"');
    expect(tagCheckWorkflow).toContain('git rev-parse "${{ steps.version.outputs.version }}"');
  });

  it("distを品質確認して配布し、MITライセンスを同梱する", () => {
    expect(releaseWorkflow).toContain("run: npm run check");
    expect(releaseWorkflow).toContain("if [ -f dist/manifest.json ]; then");
    expect(releaseWorkflow).toContain('gh release upload "$TAG" "$ZIP_PATH" --clobber');
    expect(assetCopyScript).toContain(
      'cp(new URL("LICENSE", projectRoot), new URL("LICENSE", distRoot))',
    );
  });

  it("Pull Requestでテンプレート標準の品質ゲートを実行する", () => {
    for (const command of [
      "npm run lint",
      "npm run format:check",
      "npm run typecheck --if-present",
      "npm run test:run",
      "npm run build",
    ]) {
      expect(qualityWorkflow).toContain(command);
    }
    expect(qualityWorkflow).toContain("Enforce quality gate result");
  });
});
