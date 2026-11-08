import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  init,
  loadSettings,
  saveDictionaryPresetAs,
  saveSettings,
  selectDictionaryPreset,
} from "../src/options.js";
import { serializeDictionaryPresets, type DictionaryPresets } from "../src/dictionary-presets.js";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import { mockStorage, mockTabs } from "./setup.js";

type FormElement = HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement;
const field = (id: string) => document.getElementById(id) as FormElement;
const original = { boostPhrases: ["リンク"], dictionary: "はいらる→ハイラル" };
const game = { boostPhrases: ["ナイス"], dictionary: "ないす→ナイス" };
const presets: DictionaryPresets = {
  version: 1,
  activeName: "標準",
  presets: [
    { name: "標準", ...original },
    { name: "スプラトゥーン", ...game },
  ],
};
const page = readFileSync("src/popup.html", "utf8");

function choose(name: string) {
  field("dictionaryPreset").value = name;
  selectDictionaryPreset();
}

function enter(values: { boostPhrases: string[]; dictionary: string }) {
  field("boostPhrases").value = values.boostPhrases.join("\n");
  field("dictionary").value = values.dictionary;
}

let stored: Record<string, unknown>;

beforeEach(() => {
  document.body.innerHTML = new DOMParser().parseFromString(page, "text/html").body.innerHTML;
  stored = { ...DEFAULT_SETTINGS, ...original };
  mockStorage.sync.get.mockImplementation(async () => structuredClone(stored));
  mockStorage.sync.set.mockImplementation(async (values: Record<string, unknown>) => {
    stored = { ...stored, ...structuredClone(values) };
  });
});

afterEach(() => vi.restoreAllMocks());

describe("dictionary preset settings UI", () => {
  it("migrates legacy dictionaries only when a save succeeds and retains 標準 on first save-as", async () => {
    await loadSettings();
    expect(mockStorage.sync.set).not.toHaveBeenCalled();
    expect(field("dictionaryPreset").value).toBe("標準");
    expect(field("boostPhrases").value).toBe("リンク");
    enter(game);
    field("dictionaryPresetName").value = " スプラトゥーン ";
    await saveDictionaryPresetAs();
    expect(mockStorage.sync.set).toHaveBeenCalledExactlyOnceWith({
      ...game,
      ...serializeDictionaryPresets({ ...presets, activeName: "スプラトゥーン" }),
    });
    await loadSettings();
    expect(field("dictionaryPreset").value).toBe("スプラトゥーン");
    choose("標準");
    expect(field("dictionary").value).toBe(original.dictionary);
    // Preview does not change the active persisted dictionary.
    expect(stored.dictionary).toBe(game.dictionary);
    await saveSettings();
    expect(stored.dictionary).toBe(original.dictionary);
    expect(mockTabs.sendMessage).not.toHaveBeenCalled();
  });

  it("switches only dictionary fields, supports cancelling a preview, and notifies after saving", async () => {
    Object.assign(stored, serializeDictionaryPresets(presets));
    stored.autoPost = false;
    stored.xaiApiKey = "key";
    await loadSettings();
    field("language").value = "en-US";
    field("typesafeApiKey").value = "pending-secret";
    choose("スプラトゥーン");
    expect(field("dictionary").value).toBe(game.dictionary);
    expect(field("autoPost").checked).toBe(false);
    expect(field("xaiApiKey").value).toBe("key");
    expect(field("language").value).toBe("en-US");
    expect(field("typesafeApiKey").value).toBe("pending-secret");
    expect(mockStorage.sync.set).not.toHaveBeenCalled();
    choose("標準");
    expect(field("dictionary").value).toBe(original.dictionary);
    choose("スプラトゥーン");
    mockTabs.query.mockResolvedValue([{ id: 7 }]);
    await saveSettings();
    expect(stored).toMatchObject(
      serializeDictionaryPresets({ ...presets, activeName: "スプラトゥーン" }),
    );
    expect(stored.autoPost).toBe(false);
    expect(stored.typesafeApiKey).toBe("pending-secret");
    expect(mockTabs.sendMessage).toHaveBeenCalledWith(7, { type: "SETTINGS_UPDATED" });
  });

  it("save-as does not store unrelated unsaved fields or secrets in a preset", async () => {
    await loadSettings();
    field("autoPost").checked = false;
    field("typesafeApiKey").value = "pending-secret";
    field("commentReviewEnabled").checked = true;
    field("dictionaryPresetName").value = "ゲーム";
    await saveDictionaryPresetAs();
    expect(mockStorage.sync.set).toHaveBeenCalledExactlyOnceWith({
      ...original,
      ...serializeDictionaryPresets({
        version: 1,
        activeName: "ゲーム",
        presets: [
          { name: "標準", ...original },
          { name: "ゲーム", ...original },
        ],
      }),
    });
    expect(stored.autoPost).toBe(true);
    expect(stored.typesafeApiKey).toBe("");
    expect(field("autoPost").checked).toBe(false);
    expect(field("typesafeApiKey").value).toBe("pending-secret");
  });

  it("blocks switching with unsaved edits, preserving input and the selected name", async () => {
    Object.assign(stored, serializeDictionaryPresets(presets));
    await loadSettings();
    field("dictionary").value = "未保存→保持";
    expect(() => choose("スプラトゥーン")).toThrow("未保存の編集");
    expect(field("dictionaryPreset").value).toBe("標準");
    expect(field("dictionary").value).toBe("未保存→保持");
    expect(mockStorage.sync.set).not.toHaveBeenCalled();
    await saveSettings();
    choose("スプラトゥーン");
    choose("標準");
    expect(field("dictionary").value).toBe("未保存→保持");
  });

  it.each(["", "   ", " 標準 "])(
    "rejects blank or duplicate names without dropping input: %j",
    async (name) => {
      await loadSettings();
      enter(game);
      field("dictionaryPresetName").value = name;
      await expect(saveDictionaryPresetAs()).rejects.toThrow();
      expect(mockStorage.sync.set).not.toHaveBeenCalled();
      expect(field("dictionary").value).toBe(game.dictionary);
      expect(field("dictionaryPresetName").value).toBe(name);
    },
  );

  it.each(["save", "save-as"])(
    "retains all data and permits retry after quota failure in %s",
    async (mode) => {
      await loadSettings();
      const before = structuredClone(stored);
      enter(game);
      field("dictionaryPresetName").value = "ゲーム";
      mockStorage.sync.set.mockRejectedValueOnce(new Error("QUOTA_BYTES_PER_ITEM quota exceeded"));
      const save = mode === "save" ? saveSettings : saveDictionaryPresetAs;
      await expect(save()).rejects.toThrow("入力内容は保持");
      expect(stored).toEqual(before);
      expect(field("dictionaryPreset").value).toBe("標準");
      expect(field("dictionary").value).toBe(game.dictionary);
      expect(field("dictionaryPresetName").value).toBe("ゲーム");
      expect(field("save").disabled).toBe(false);
      expect(mockTabs.query).not.toHaveBeenCalled();
      await save();
      expect(stored.dictionary).toBe(game.dictionary);
      expect(mockStorage.sync.set).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps the existing active dictionary when applying another preset fails", async () => {
    Object.assign(stored, serializeDictionaryPresets(presets));
    await loadSettings();
    choose("スプラトゥーン");
    mockStorage.sync.set.mockRejectedValueOnce(new Error("offline"));
    await expect(saveSettings()).rejects.toThrow("保存できませんでした");
    expect(stored.dictionary).toBe(original.dictionary);
    expect(stored).toMatchObject(serializeDictionaryPresets(presets));
    expect(field("dictionaryPreset").value).toBe("スプラトゥーン");
    await saveSettings();
    expect(stored.dictionary).toBe(game.dictionary);
  });

  it("disables controls during saving and prevents duplicate submissions", async () => {
    await loadSettings();
    field("dictionaryPresetName").value = "ゲーム";
    let finish = () => {};
    mockStorage.sync.set.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const saving = saveDictionaryPresetAs();
    await Promise.resolve();
    expect(field("save").disabled).toBe(true);
    expect(field("saveDictionaryPresetAs").disabled).toBe(true);
    expect(field("dictionaryPreset").disabled).toBe(true);
    expect(field("dictionary").disabled).toBe(true);
    await expect(saveDictionaryPresetAs()).rejects.toThrow("保存中");
    expect(mockStorage.sync.set).toHaveBeenCalledTimes(1);
    finish();
    await saving;
    expect(field("save").disabled).toBe(false);
    expect(field("dictionaryPreset").value).toBe("ゲーム");
  });

  it("does not overwrite storage after a failed or invalid load", async () => {
    mockStorage.sync.get.mockRejectedValueOnce(new Error("offline"));
    await expect(loadSettings()).rejects.toThrow("offline");
    await expect(saveSettings()).rejects.toThrow("読み込みが完了していません");
    stored.dictionaryPresets = { version: 999 };
    await expect(loadSettings()).rejects.toThrow("上書きせず停止");
    await expect(saveDictionaryPresetAs()).rejects.toThrow("読み込みが完了していません");
    expect(mockStorage.sync.set).not.toHaveBeenCalled();
  });

  it("rejects stale-page saves without deleting presets saved by another page", async () => {
    await loadSettings();
    enter(game);
    Object.assign(
      stored,
      serializeDictionaryPresets({
        ...presets,
        activeName: "スプラトゥーン",
      }),
      game,
    );
    const latest = structuredClone(stored);
    await expect(saveSettings()).rejects.toThrow("別の画面または端末");
    expect(mockStorage.sync.set).not.toHaveBeenCalled();
    expect(stored).toEqual(latest);
    expect(field("dictionary").value).toBe(game.dictionary);
    expect(field("save").disabled).toBe(false);
  });

  it("preserves the separate per-item capacity of large legacy dictionaries", async () => {
    const large = { boostPhrases: ["a".repeat(8100)], dictionary: "b".repeat(8100) };
    Object.assign(stored, large);
    await loadSettings();
    mockStorage.sync.set.mockImplementation(async (values: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(values)) {
        const bytes = new TextEncoder().encode(key + JSON.stringify(value)).byteLength;
        if (bytes > 8192) throw new Error("QUOTA_BYTES_PER_ITEM");
      }
      stored = { ...stored, ...structuredClone(values) };
    });
    await saveSettings();
    expect(stored.dp0b).toEqual(large.boostPhrases);
    expect(stored.dp0d).toBe(large.dictionary);
    await loadSettings();
    expect(field("dictionary").value).toBe(large.dictionary);
  });

  it("performs storage validation and writing under the cross-page lock when available", async () => {
    await loadSettings();
    const request = vi.fn(async (_name: string, callback: () => Promise<void>) => callback());
    Object.defineProperty(navigator, "locks", { configurable: true, value: { request } });
    try {
      await saveSettings();
      expect(request).toHaveBeenCalledExactlyOnceWith(
        "voice-live-comment-settings",
        expect.any(Function),
      );
      expect(mockStorage.sync.set).toHaveBeenCalledTimes(1);
    } finally {
      Reflect.deleteProperty(navigator, "locks");
    }
  });

  it("shows save and switch errors through actual UI controls", async () => {
    Object.assign(stored, serializeDictionaryPresets(presets));
    await loadSettings();
    init();
    enter(game);
    field("dictionaryPreset").value = "スプラトゥーン";
    field("dictionaryPreset").dispatchEvent(new Event("change"));
    expect(field("status").textContent).toContain("未保存の編集");
    field("dictionaryPresetName").value = "ゲーム";
    mockStorage.sync.set.mockRejectedValueOnce(new Error("quota"));
    field("saveDictionaryPresetAs").click();
    await vi.waitFor(() => expect(field("status").textContent).toContain("入力内容は保持"));
    expect(field("dictionary").value).toBe(game.dictionary);
    field("saveDictionaryPresetAs").click();
    await vi.waitFor(() => expect(field("dictionaryPreset").value).toBe("ゲーム"));
  });

  it("treats notification failure as saved and keeps a readable warning", async () => {
    await loadSettings();
    mockTabs.query.mockRejectedValueOnce(new Error("tabs unavailable"));
    await saveSettings();
    await vi.waitFor(() => expect(field("status").textContent).toContain("保存しました。"));
    expect(stored.dictionaryPresets).toBeDefined();
  });
});
