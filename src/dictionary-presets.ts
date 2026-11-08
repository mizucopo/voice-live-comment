export type DictionaryValues = {
  boostPhrases: string[];
  dictionary: string;
};

export type DictionaryPreset = DictionaryValues & { name: string };

export type DictionaryPresets = {
  version: 1;
  activeName: string;
  presets: DictionaryPreset[];
};

export const DEFAULT_DICTIONARY_PRESET_NAME = "標準";

// Explicitly copy the two dictionary fields. Never copy unrelated settings into a preset.
export function copyDictionaryValues(values: DictionaryValues): DictionaryValues {
  return { boostPhrases: [...values.boostPhrases], dictionary: values.dictionary };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizePresetName(value: string): string {
  const name = value.trim();
  if (!name) throw new Error("プリセット名を入力してください");
  if (name.length > 80) throw new Error("プリセット名は80文字以内で入力してください");
  return name;
}

export function loadDictionaryPresets(
  value: unknown,
  current: DictionaryValues,
): DictionaryPresets {
  // Migrate only in memory. The first successful save persists this with the active values.
  if (value === undefined || value === null) {
    return {
      version: 1,
      activeName: DEFAULT_DICTIONARY_PRESET_NAME,
      presets: [{ name: DEFAULT_DICTIONARY_PRESET_NAME, ...copyDictionaryValues(current) }],
    };
  }
  const invalid = () =>
    new Error("辞書プリセットの保存データを読み込めません。上書きせず停止しました");
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.activeName !== "string" ||
    !Array.isArray(value.presets) ||
    value.presets.length === 0
  ) {
    throw invalid();
  }
  const names = new Set<string>();
  const presets = value.presets.map((preset: unknown): DictionaryPreset => {
    if (
      !isRecord(preset) ||
      typeof preset.name !== "string" ||
      !preset.name.trim() ||
      preset.name !== preset.name.trim() ||
      names.has(preset.name) ||
      !Array.isArray(preset.boostPhrases) ||
      !preset.boostPhrases.every((phrase: unknown) => typeof phrase === "string") ||
      typeof preset.dictionary !== "string"
    ) {
      throw invalid();
    }
    names.add(preset.name);
    return {
      name: preset.name,
      boostPhrases: [...preset.boostPhrases] as string[],
      dictionary: preset.dictionary,
    };
  });
  if (!names.has(value.activeName)) throw invalid();
  return { version: 1, activeName: value.activeName, presets };
}

export function saveDictionaryPreset(
  store: DictionaryPresets,
  name: string,
  values: DictionaryValues,
  create: boolean,
): DictionaryPresets {
  name = normalizePresetName(name);
  const exists = store.presets.some((preset) => preset.name === name);
  if (create && exists)
    throw new Error("同じ名前のプリセットがあります。別の名前を入力してください");
  if (!create && !exists) throw new Error("選択したプリセットが見つかりません");
  const preset = { name, ...copyDictionaryValues(values) };
  return {
    version: 1,
    activeName: name,
    presets: create
      ? [...store.presets, preset]
      : store.presets.map((saved) => (saved.name === name ? preset : saved)),
  };
}

export function dictionaryValuesEqual(left: DictionaryValues, right: DictionaryValues): boolean {
  return (
    left.dictionary === right.dictionary &&
    left.boostPhrases.length === right.boostPhrases.length &&
    left.boostPhrases.every((phrase, index) => phrase === right.boostPhrases[index])
  );
}

// Keep each dictionary field in its own sync item, just like the legacy fields.
// Short keys preserve the per-item capacity available before presets were added.
export function serializeDictionaryPresets(store: DictionaryPresets): Record<string, unknown> {
  const items: Record<string, unknown> = {
    dictionaryPresets: {
      version: 1,
      activeName: store.activeName,
      names: store.presets.map((preset) => preset.name),
    },
  };
  store.presets.forEach((preset, index) => {
    items[`dp${index}b`] = [...preset.boostPhrases];
    items[`dp${index}d`] = preset.dictionary;
  });
  return items;
}

export function readDictionaryPresets(
  items: Record<string, unknown>,
  current: DictionaryValues,
): DictionaryPresets {
  const catalog = items.dictionaryPresets;
  if (catalog === undefined || catalog === null) return loadDictionaryPresets(null, current);
  if (!isRecord(catalog) || !Array.isArray(catalog.names)) {
    throw new Error("辞書プリセットの保存データを読み込めません。上書きせず停止しました");
  }
  return loadDictionaryPresets(
    {
      version: catalog.version,
      activeName: catalog.activeName,
      presets: catalog.names.map((name: unknown, index: number) => ({
        name,
        boostPhrases: items[`dp${index}b`],
        dictionary: items[`dp${index}d`],
      })),
    },
    current,
  );
}

export function dictionaryStorageSnapshot(items: Record<string, unknown>): string {
  return JSON.stringify({
    boostPhrases: items.boostPhrases ?? [],
    dictionary: items.dictionary ?? "",
    dictionaryPresets: items.dictionaryPresets ?? null,
    fields: Object.keys(items)
      .filter((key) => /^dp\d+[bd]$/.test(key))
      .sort()
      .map((key) => [key, items[key]]),
  });
}
