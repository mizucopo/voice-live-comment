import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/release.yml', 'utf8');

const rerunTagChecks = [
  'existing_tag_commit="$(git rev-list -n 1 "${release_tag}")"',
  'if [[ "$existing_tag_commit" != "$MERGE_COMMIT_SHA" ]]; then',
  'TAG_ALREADY_EXISTS=${tag_already_exists}',
  'if [[ "$TAG_ALREADY_EXISTS" == "true" ]]; then'
];

const rerunReleaseChecks = [
  'gh release view "$RELEASE_TAG"',
  'gh release upload "$RELEASE_TAG" "$ZIP_NAME" --clobber'
];

const packagedLicenseChecks = [
  'cp manifest.json options.html LICENSE "$package_dir/"',
  'test -f "$package_dir/LICENSE"'
];

describe('release workflow', () => {
  it('write可能なpull_request_targetイベントで実行される', () => {
    expect(workflow).toMatch(/^  pull_request_target:/m);
    expect(workflow).not.toMatch(/^  pull_request:/m);
  });

  it('リリースタグがマージコミットを指す場合は再実行できる', () => {
    for (const check of rerunTagChecks) {
      expect(workflow).toContain(check);
    }
  });

  it('再実行時は既存のGitHub Releaseを再利用する', () => {
    for (const check of rerunReleaseChecks) {
      expect(workflow).toContain(check);
    }
  });

  it('配布版にMITライセンスを同梱する', () => {
    for (const check of packagedLicenseChecks) {
      expect(workflow).toContain(check);
    }
  });
});
