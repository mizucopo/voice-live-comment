import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

const workflow = readFileSync('.github/workflows/release.yml', 'utf8');

describe('release workflow', () => {
  test('runs from a write-capable pull request target event', () => {
    expect(workflow).toMatch(/^  pull_request_target:/m);
    expect(workflow).not.toMatch(/^  pull_request:/m);
  });

  test('allows reruns when the release tag already points at the merge commit', () => {
    expect(workflow).toContain('existing_tag_commit="$(git rev-list -n 1 "${release_tag}")"');
    expect(workflow).toContain('if [[ "$existing_tag_commit" != "$MERGE_COMMIT_SHA" ]]; then');
    expect(workflow).toContain('TAG_ALREADY_EXISTS=${tag_already_exists}');
    expect(workflow).toContain('if [[ "$TAG_ALREADY_EXISTS" == "true" ]]; then');
  });

  test('reuses an existing GitHub Release on rerun', () => {
    expect(workflow).toContain('gh release view "$RELEASE_TAG"');
    expect(workflow).toContain('gh release upload "$RELEASE_TAG" "$ZIP_NAME" --clobber');
  });
});
