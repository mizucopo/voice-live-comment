import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const releaseWorkflow = readFileSync(".github/workflows/chrome-extension-release.yml", "utf8");
const tagCheckWorkflow = readFileSync(".github/workflows/pr-tag-check.yml", "utf8");
const qualityWorkflow = readFileSync(
  ".github/workflows/chrome-extension-quality-checks.yml",
  "utf8",
);
const assetCopyScript = readFileSync("scripts/copy-extension-assets.mjs", "utf8");
const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

function runReleaseMetadataReader(
  repository: string | undefined,
  options: {
    event?: unknown;
    eventFile?: "unset" | "missing" | "unreadable" | "malformed";
  } = {},
) {
  const script = releaseWorkflow.match(/          node <<'NODE'\n([\s\S]*?)\n          NODE/)?.[1];
  if (!script) throw new Error("Release metadata reader was not found.");

  const directory = mkdtempSync(join(tmpdir(), "voice-live-comment-release-"));
  try {
    mkdirSync(join(directory, "src"));
    copyFileSync("package.json", join(directory, "package.json"));
    copyFileSync("src/manifest.json", join(directory, "src/manifest.json"));
    const outputPath = join(directory, "github-output.txt");
    const eventPath = join(directory, "event.json");
    if (options.eventFile === "unreadable") {
      mkdirSync(eventPath);
    } else if (options.eventFile !== "missing" && options.eventFile !== "unset") {
      writeFileSync(
        eventPath,
        options.eventFile === "malformed"
          ? "{"
          : JSON.stringify(options.event ?? { repository: { full_name: repository } }),
      );
    }
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_OUTPUT: outputPath,
      RUNNER_TEMP: directory,
    };
    if (options.eventFile === "unset") delete env.GITHUB_EVENT_PATH;
    if (repository === undefined) delete env.GITHUB_REPOSITORY;
    else env.GITHUB_REPOSITORY = repository;

    const result = spawnSync(process.execPath, [], {
      input: script.replace(/^ {10}/gm, ""),
      cwd: directory,
      env,
      encoding: "utf8",
    });
    return {
      status: result.status,
      stderr: result.stderr,
      output: existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "",
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("Chrome拡張のGitHub Actions", () => {
  it("mainへのすべてのマージを配布リリース対象にする", () => {
    expect(releaseWorkflow).toMatch(/^ {2}push:/m);
    expect(releaseWorkflow).toMatch(/^ {6}- main$/m);
    expect(releaseWorkflow).toContain("is not associated with a merged pull request into main");
    expect(releaseWorkflow).not.toContain("dependabot[bot]");
  });

  it("リポジトリ改名後の再実行でも元のpushイベントの配布ZIP名を使う", () => {
    const event = { repository: { full_name: "mizucopo/original-extension" } };
    const original = runReleaseMetadataReader("mizucopo/original-extension", { event });
    const renamed = runReleaseMetadataReader("mizucopo/renamed-extension", { event });

    for (const result of [original, renamed]) {
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.output).toContain(`tag=${version}\n`);
      expect(result.output).toContain(`zip_name=original-extension-${version}.zip\n`);
      expect(result.output).not.toContain("renamed-extension");
    }
  });

  it("src/manifest.jsonとpackage.jsonで同じバージョンを使う", () => {
    for (const workflow of [releaseWorkflow, tagCheckWorkflow]) {
      expect(workflow).toContain('"src/manifest.json"');
      expect(workflow).toContain("packageVersion !== manifestVersion");
    }
  });

  it.each([
    ["mizucopo/voice-live-comment", "voice-live-comment"],
    ["another-owner/renamed-extension", "renamed-extension"],
  ])("%sから配布ZIP名を決め、v接頭辞なしのバージョンタグを使う", (repository, name) => {
    const result = runReleaseMetadataReader(repository);

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.output).toContain(`tag=${version}\n`);
    expect(result.output).toContain(`zip_name=${name}-${version}.zip\n`);
    expect(tagCheckWorkflow).toContain('git show-ref --tags --verify --quiet "refs/tags/$VERSION"');
  });

  it.each([undefined, "invalid-repository"])(
    "GITHUB_REPOSITORYが不正な場合は配布情報を出力しない: %s",
    (repository) => {
      const result = runReleaseMetadataReader(repository);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("GITHUB_REPOSITORY must");
      expect(result.output).toBe("");
    },
  );

  it.each([
    {},
    { repository: {} },
    { repository: { full_name: 42 } },
    { repository: { full_name: "invalid-repository" } },
    { repository: { full_name: "owner/" } },
  ])("pushイベントのリポジトリ名が不正なら現在名へ代替しない: %j", (event) => {
    const result = runReleaseMetadataReader("mizucopo/voice-live-comment", { event });

    expect(result.status).toBe(1);
    expect(result.stderr).not.toBe("");
    expect(result.output).toBe("");
  });

  it.each(["unset", "missing", "unreadable", "malformed"] as const)(
    "pushイベントを読み込めない場合は配布情報を出力しない: %s",
    (eventFile) => {
      const result = runReleaseMetadataReader("mizucopo/voice-live-comment", { eventFile });

      expect(result.status).toBe(1);
      expect(result.stderr).not.toBe("");
      expect(result.output).toBe("");
    },
  );

  it("distを品質確認して配布し、MITライセンスを同梱する", () => {
    expect(releaseWorkflow).toContain("run: npm run check");
    expect(releaseWorkflow).toContain("if [ -f dist/manifest.json ]; then");
    expect(releaseWorkflow).toContain(
      "if: steps.release-state.outputs.release_asset_exists != 'true'",
    );
    expect(releaseWorkflow).toContain('gh release create "$TAG" "$ZIP_PATH"');
    expect(releaseWorkflow).toContain("Reject incomplete immutable release");
    expect(releaseWorkflow).not.toContain("gh release upload");
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
