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
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const releaseWorkflow = readFileSync(".github/workflows/chrome-extension-release.yml", "utf8");
const qualityWorkflow = readFileSync(
  ".github/workflows/chrome-extension-quality-checks.yml",
  "utf8",
);
const assetCopyScript = readFileSync("scripts/copy-extension-assets.mjs", "utf8");
const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
const releaseControlPath = resolve(".github/scripts/release.py");
const releasePolicyPath = resolve(".github/release.json");

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
      VERSION: version,
      NOTES_TEMPLATE: "Chrome Extension distribution package for {version}.",
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

function runReleaseControl(action: "version" | "classification", input: unknown) {
  const result = spawnSync(
    "python3",
    [
      "-I",
      "-B",
      "-c",
      `
import importlib.util
import json
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("release_control", sys.argv[1])
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)
policy = json.loads(Path(sys.argv[2]).read_text())
payload = json.load(sys.stdin)

if sys.argv[3] == "version":
    class SourceTree:
        def blob(self, tree, path, allow_missing=False):
            value = payload.get(path)
            return None if value is None else json.dumps(value).encode()

    version = control.read_version(SourceTree(), "test-tree", policy)
    result = {"version": version, "tag": control.publication(policy, version)["release_tag"]}
else:
    result = control.classification(payload)

print(json.dumps(result))
`,
      releaseControlPath,
      releasePolicyPath,
      action,
    ],
    { input: JSON.stringify(input), encoding: "utf8" },
  );
  return { status: result.status, stderr: result.stderr, output: result.stdout.trim() };
}

describe("Chrome拡張のGitHub Actions", () => {
  it("mainで採番し、そのcommitを配布リリース対象にする", () => {
    expect(releaseWorkflow).toMatch(/^ {2}push:/m);
    expect(releaseWorkflow).toContain("branches: [main]");
    expect(releaseWorkflow).toContain("python3 -I .github/scripts/release.py prepare");
    expect(releaseWorkflow).toContain("if: needs.prepare.outputs.publish == 'true'");
    expect(releaseWorkflow).toContain("ref: ${{ needs.prepare.outputs.release_sha }}");
    expect(releaseWorkflow).toContain("python3 -I .github/scripts/release.py plan");
  });

  it("リポジトリ改名後の再実行でも元のpushイベントの配布ZIP名を使う", () => {
    const event = { repository: { full_name: "mizucopo/original-extension" } };
    const original = runReleaseMetadataReader("mizucopo/original-extension", { event });
    const renamed = runReleaseMetadataReader("mizucopo/renamed-extension", { event });

    for (const result of [original, renamed]) {
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.output).toContain(`zip_name=original-extension-${version}.zip\n`);
      expect(result.output).not.toContain("renamed-extension");
    }
  });

  it("src/manifest.jsonとpackage.jsonで同じバージョンを使う", () => {
    const result = runReleaseControl("version", {
      "package.json": JSON.parse(readFileSync("package.json", "utf8")),
      "src/manifest.json": JSON.parse(readFileSync("src/manifest.json", "utf8")),
    });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.output)).toEqual({ version, tag: version });
  });

  it("バージョンソースが不一致なら配布タグを出力しない", () => {
    const result = runReleaseControl("version", {
      "package.json": { version },
      "src/manifest.json": { version: "65535.0.0" },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Declared version sources disagree");
    expect(result.output).toBe("");
  });

  it.each([
    ["mizucopo/voice-live-comment", "voice-live-comment"],
    ["another-owner/renamed-extension", "renamed-extension"],
  ])("%sから配布ZIP名を決める", (repository, name) => {
    const result = runReleaseMetadataReader(repository);

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.output).toContain(`zip_name=${name}-${version}.zip\n`);
  });

  it.each([undefined, "invalid-repository"])(
    "現在のGITHUB_REPOSITORYに依存せず元のイベント名を使う: %s",
    (repository) => {
      const result = runReleaseMetadataReader(repository, {
        event: { repository: { full_name: "mizucopo/original-extension" } },
      });

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.output).toContain(`zip_name=original-extension-${version}.zip\n`);
    },
  );

  it.each([
    {},
    { repository: {} },
    { repository: { full_name: 42 } },
    { repository: { full_name: "invalid-repository" } },
    { repository: { full_name: "owner/" } },
    { repository: { full_name: " mizucopo/voice-live-comment " } },
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

  it.each(["patch", "minor", "major"])("単一のrelease:%sと分類理由を受け付ける", (level) => {
    const result = runReleaseControl("classification", {
      number: 92,
      labels: [{ name: "dependencies" }, { name: `release:${level}` }],
      body: "配布手順を更新するため。",
    });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.output)).toBe(level);
  });

  it("releaseラベルなしなら公開分類を省略する", () => {
    const result = runReleaseControl("classification", {
      number: 92,
      labels: [{ name: "documentation" }],
      body: "",
    });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.output)).toBeNull();
  });

  it.each([
    { labels: ["release:none"], body: "非公開にする" },
    { labels: ["release:patch", "release:minor"], body: "分類が重複" },
    { labels: ["release:patch"], body: "" },
    { labels: ["release:patch"], body: "<!-- 分類理由のテンプレート -->" },
  ])("無効な分類または空の理由では公開分類を返さない: %j", ({ labels, body }) => {
    const result = runReleaseControl("classification", {
      number: 92,
      labels: labels.map((name) => ({ name })),
      body,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("PR #92 needs");
    expect(result.output).toBe("");
  });

  it("distを品質確認して配布し、MITライセンスを同梱する", () => {
    expect(releaseWorkflow).toContain("          npm run check");
    expect(releaseWorkflow).toContain('fs.readFileSync("dist/manifest.json", "utf8")');
    expect(releaseWorkflow).toContain("manifest.version !== process.env.VERSION");
    expect(releaseWorkflow).toContain(
      "if: steps.release-state.outputs.release_asset_exists != 'true'",
    );
    expect(releaseWorkflow).toContain('gh release create "$TAG" --verify-tag --draft');
    expect(releaseWorkflow).toContain("Reject incomplete public release");
    expect(releaseWorkflow).toContain("steps.release-state.outputs.release_is_draft != 'true'");
    expect(releaseWorkflow).toContain('test "$release_asset_exists" = true');
    expect(releaseWorkflow).toContain('gh release edit "$TAG" --draft=false --latest=false');
    expect(assetCopyScript).toContain(
      'cp(new URL("LICENSE", projectRoot), new URL("LICENSE", distRoot))',
    );
  });

  it("Pull Requestでテンプレート標準の品質ゲートを実行する", () => {
    expect(qualityWorkflow).toContain("run: npm run check");
    expect(qualityWorkflow).toContain("timeout-minutes: 15");
  });
});
