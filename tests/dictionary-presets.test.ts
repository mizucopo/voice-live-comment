import { describe, expect, it } from "vitest";
import {
  loadDictionaryPresets,
  saveDictionaryPreset,
  readDictionaryPresets,
  serializeDictionaryPresets,
} from "../src/dictionary-presets.js";

const original = { boostPhrases: ["ハイラル", "リンク"], dictionary: "はいらる→ハイラル" };

describe("dictionary presets", () => {
  it("migrates existing dictionaries to 標準 without aliasing or copying other settings", () => {
    const settings = { ...original, xaiApiKey: "secret", autoPost: true };
    const store = loadDictionaryPresets(undefined, settings);
    expect(store).toEqual({
      version: 1,
      activeName: "標準",
      presets: [{ name: "標準", ...original }],
    });
    expect(store.presets[0]?.boostPhrases).not.toBe(original.boostPhrases);
  });

  it("creates, updates, and reloads Japanese names while retaining the other presets", () => {
    const standard = loadDictionaryPresets(null, original);
    const game = saveDictionaryPreset(
      standard,
      "  スプラトゥーン  ",
      {
        boostPhrases: ["ナイス"],
        dictionary: "ないす→ナイス",
      },
      true,
    );
    const updated = saveDictionaryPreset(game, "標準", { boostPhrases: [], dictionary: "" }, false);
    expect(loadDictionaryPresets(updated, original)).toEqual(updated);
    expect(standard.presets).toEqual([{ name: "標準", ...original }]);
    expect(updated.activeName).toBe("標準");
    expect(updated.presets[0]).toEqual({ name: "標準", boostPhrases: [], dictionary: "" });
    expect(updated.presets[1]).toEqual(game.presets[1]);
  });

  it.each(["", "  ", "a".repeat(81)])("rejects invalid new names %j", (name) => {
    expect(() =>
      saveDictionaryPreset(loadDictionaryPresets(null, original), name, original, true),
    ).toThrow();
  });

  it("rejects duplicate names and unknown updates without changing data", () => {
    const store = loadDictionaryPresets(null, original);
    const before = structuredClone(store);
    expect(() => saveDictionaryPreset(store, " 標準 ", original, true)).toThrow("同じ名前");
    expect(() => saveDictionaryPreset(store, "missing", original, false)).toThrow("見つかりません");
    expect(store).toEqual(before);
  });

  it.each([
    {},
    [],
    { version: 2, activeName: "標準", presets: [{ name: "標準", ...original }] },
    { version: 1, activeName: "missing", presets: [{ name: "標準", ...original }] },
    { version: 1, activeName: "標準", presets: [] },
    {
      version: 1,
      activeName: "標準",
      presets: [{ name: "標準", boostPhrases: [1], dictionary: "" }],
    },
    {
      version: 1,
      activeName: "標準",
      presets: [
        { name: "標準", ...original },
        { name: "標準", ...original },
      ],
    },
  ])("rejects malformed or future data instead of replacing it: %j", (data) => {
    expect(() => loadDictionaryPresets(data, original)).toThrow("上書きせず停止");
  });

  it("never restores unrelated settings from preset data", () => {
    const store = loadDictionaryPresets(
      {
        version: 1,
        activeName: "標準",
        apiKey: "secret",
        presets: [{ name: "標準", ...original, googleApiKey: "secret", autoPost: true }],
      },
      original,
    );
    expect(store).toEqual(loadDictionaryPresets(null, original));
  });
});

describe("dictionary preset storage", () => {
  it("round trips through separate field items", () => {
    const store = saveDictionaryPreset(
      loadDictionaryPresets(null, original),
      "game",
      {
        boostPhrases: [],
        dictionary: "",
      },
      true,
    );
    expect(readDictionaryPresets(serializeDictionaryPresets(store), original)).toEqual(store);
  });

  it("rejects an incomplete stored preset instead of loading an empty dictionary", () => {
    const stored = serializeDictionaryPresets(loadDictionaryPresets(null, original));
    delete stored.dp0d;
    expect(() => readDictionaryPresets(stored, original)).toThrow("上書きせず停止");
  });
});
