import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMMENT_REVIEW_CRITERIA,
  DEFAULT_SETTINGS,
  normalizeSettings,
} from "../src/settings.js";

describe("settings", () => {
  it("旧設定には無効の投稿前レビュー設定を補い、既存設定を維持する", () => {
    const legacySettings = {
      sttProvider: "grok" as const,
      autoPost: false,
      language: "en-US",
      useLocalModel: true,
      recognitionVolumeThreshold: 0.12,
      boostPhrases: ["配信"],
      dictionary: "とーきょー→東京",
      googleApiKey: "google-key",
      xaiApiKey: "xai-key",
    };

    expect(normalizeSettings(legacySettings)).toEqual({
      ...legacySettings,
      commentReviewEnabled: false,
      typesafeApiKey: "",
      commentReviewCriteria: DEFAULT_COMMENT_REVIEW_CRITERIA,
    });
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
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
