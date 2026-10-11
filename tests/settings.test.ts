import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMMENT_REVIEW_CRITERIA,
  DEFAULT_SETTINGS,
  normalizeSettings,
} from "../src/settings.js";

describe("settings", () => {
  it("未保存の設定には初期値を使う", () => {
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it.each(["browser", "google", "grok"] as const)("%s の現行設定を保持する", (sttProvider) => {
    const settings = {
      ...DEFAULT_SETTINGS,
      sttProvider,
      autoPost: false,
      language: "en-US",
      useLocalModel: true,
      recognitionVolumeThreshold: 0.12,
      boostPhrases: ["配信"],
      dictionary: "とーきょー→東京",
      googleApiKey: "google-key",
      xaiApiKey: "xai-key",
      commentReviewEnabled: true,
      typesafeApiKey: "typesafe-key",
      commentReviewCriteria: "脅迫を除外する。",
    };

    expect(normalizeSettings(settings)).toEqual(settings);
  });

  it("レビュー設定を正規化して明示的な有効化を保持する", () => {
    expect(
      normalizeSettings({
        commentReviewEnabled: true,
        typesafeApiKey: "  typesafe-key  ",
        commentReviewCriteria: "  独り言を許可する。\n脅迫を除外する。  ",
      }),
    ).toEqual({
      ...DEFAULT_SETTINGS,
      commentReviewEnabled: true,
      typesafeApiKey: "typesafe-key",
      commentReviewCriteria: "独り言を許可する。\n脅迫を除外する。",
    });
  });

  it.each([undefined, null, false, 0, 1, {}, []])(
    "不正な保存値 %j ではレビューを有効化せずキーと基準を初期値にする",
    (value) => {
      const stored: Record<string, unknown> = {
        commentReviewEnabled: value,
        typesafeApiKey: value,
        commentReviewCriteria: value,
      };

      expect(normalizeSettings(stored)).toEqual(DEFAULT_SETTINGS);
    },
  );

  it("文字列のtrueではレビューを有効化しない", () => {
    const stored: Record<string, unknown> = { commentReviewEnabled: "true" };

    expect(normalizeSettings(stored).commentReviewEnabled).toBe(false);
  });

  it.each(["", "  ", "\n\t"])("空白の基準 %j は標準に戻す", (commentReviewCriteria) => {
    expect(normalizeSettings({ commentReviewCriteria }).commentReviewCriteria).toBe(
      DEFAULT_COMMENT_REVIEW_CRITERIA,
    );
  });
});
