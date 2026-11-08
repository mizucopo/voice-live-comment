import {
  copyDictionaryValues,
  dictionaryValuesEqual,
  readDictionaryPresets,
  serializeDictionaryPresets,
  dictionaryStorageSnapshot,
  saveDictionaryPreset,
  type DictionaryPresets,
  type DictionaryValues,
} from "./dictionary-presets.js";
import {
  DEFAULT_RECOGNITION_VOLUME_THRESHOLD,
  MAX_RECOGNITION_VOLUME_THRESHOLD,
  MIN_RECOGNITION_VOLUME_THRESHOLD,
  RECOGNITION_VOLUME_THRESHOLD_STEP,
  formatRecognitionVolumeThreshold,
  normalizeRecognitionVolumeThreshold,
} from "./recognition-volume-gate.js";
import {
  DEFAULT_SETTINGS,
  normalizeCommentReviewCriteria,
  normalizeSettings,
  normalizeSttProvider,
  type ExtensionSettings,
} from "./settings.js";

function element(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Required element was not found: ${id}`);
  return value;
}

function inputElement(id: string): HTMLInputElement {
  const value = element(id);
  if (!(value instanceof HTMLInputElement)) throw new Error(`Required input was not found: ${id}`);
  return value;
}

function selectElement(id: string): HTMLSelectElement {
  const value = element(id);
  if (!(value instanceof HTMLSelectElement)) {
    throw new Error(`Required select was not found: ${id}`);
  }
  return value;
}

function textAreaElement(id: string): HTMLTextAreaElement {
  const value = element(id);
  if (!(value instanceof HTMLTextAreaElement)) {
    throw new Error(`Required textarea was not found: ${id}`);
  }
  return value;
}

type PresetEditor = {
  store: DictionaryPresets;
  selectedName: string;
  baseline: DictionaryValues;
  saving: boolean;
  storageSnapshot: string;
};

const editors = new WeakMap<HTMLSelectElement, PresetEditor>();
const statusTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

function showStatus(message: string, temporary = false): void {
  const status = element("status");
  clearTimeout(statusTimers.get(status));
  status.textContent = message;
  if (temporary) {
    statusTimers.set(
      status,
      setTimeout(() => (status.textContent = ""), 2000),
    );
  }
}

function presetEditor(): PresetEditor {
  const editor = editors.get(selectElement("dictionaryPreset"));
  if (!editor) throw new Error("設定の読み込みが完了していません。画面を開き直してください");
  return editor;
}

function readDictionaryValues(): DictionaryValues {
  return {
    boostPhrases: textAreaElement("boostPhrases")
      .value.split("\n")
      .map((line) => line.trim())
      .filter((line) => line),
    dictionary: textAreaElement("dictionary").value,
  };
}

function showDictionaryValues(values: DictionaryValues): void {
  textAreaElement("boostPhrases").value = values.boostPhrases.join("\n");
  textAreaElement("dictionary").value = values.dictionary;
}

function renderPresets(editor: PresetEditor): void {
  const select = selectElement("dictionaryPreset");
  select.replaceChildren();
  for (const preset of editor.store.presets) {
    const option = document.createElement("option");
    option.value = preset.name;
    option.textContent = preset.name;
    select.append(option);
  }
  select.value = editor.selectedName;
}

export function selectDictionaryPreset(): void {
  const editor = presetEditor();
  const select = selectElement("dictionaryPreset");
  const next = editor.store.presets.find((preset) => preset.name === select.value);
  select.value = editor.selectedName;
  if (editor.saving || next?.name === editor.selectedName) return;
  if (!dictionaryValuesEqual(readDictionaryValues(), editor.baseline)) {
    throw new Error(
      "辞書に未保存の編集があります。「保存」または「別名で保存」してから切り替えてください",
    );
  }
  if (!next) throw new Error("選択したプリセットが見つかりません");
  editor.selectedName = next.name;
  editor.baseline = copyDictionaryValues(next);
  showDictionaryValues(next);
  select.value = next.name;
  showStatus("選択した辞書は「保存」で適用されます");
}

async function notifySettingsUpdated(): Promise<void> {
  // Notification failure must not turn a successful storage write into a save failure.
  try {
    const tabs = await chrome.tabs.query({
      url: ["*://www.youtube.com/*", "*://studio.youtube.com/*"],
    });
    await Promise.all(
      tabs.map((tab) =>
        tab.id === undefined
          ? undefined
          : chrome.tabs.sendMessage(tab.id, { type: "SETTINGS_UPDATED" }).catch(() => undefined),
      ),
    );
  } catch {
    showStatus("保存しました。反映されない場合はYouTubeのページを再読み込みしてください");
  }
}

async function persistSettings(
  settings: DictionaryValues | ExtensionSettings,
  name: string,
  create: boolean,
): Promise<void> {
  const editor = presetEditor();
  if (editor.saving) throw new Error("保存中です。完了までお待ちください");
  const nextStore = saveDictionaryPreset(editor.store, name, settings, create);
  const controls = Array.from(
    document.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement
    >("input, select, textarea, button"),
  );
  const disabled = controls.map((control) => control.disabled);
  editor.saving = true;
  controls.forEach((control) => (control.disabled = true));
  try {
    // One write keeps the active dictionaries and saved presets together on quota/write failure.
    const write = async () => {
      const latest = await chrome.storage.sync.get(null);
      if (dictionaryStorageSnapshot(latest) !== editor.storageSnapshot) {
        throw new Error(
          "別の画面または端末で辞書が変更されました。入力を控え、画面を開き直してください",
        );
      }
      const items = { ...settings, ...serializeDictionaryPresets(nextStore) };
      await chrome.storage.sync.set(items);
      editor.storageSnapshot = dictionaryStorageSnapshot({ ...latest, ...items });
    };
    // Serialize options pages in this browser. The snapshot also detects received sync updates.
    if (navigator.locks) await navigator.locks.request("voice-live-comment-settings", write);
    else await write();
    editor.store = nextStore;
    editor.selectedName = name;
    editor.baseline = copyDictionaryValues(settings);
    renderPresets(editor);
    showDictionaryValues(settings);
    if (create) inputElement("dictionaryPresetName").value = "";
    showStatus("保存しました", true);
  } catch (error) {
    throw new Error(
      `保存できませんでした。入力内容は保持されています。${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  } finally {
    editor.saving = false;
    controls.forEach((control, index) => (control.disabled = disabled[index] ?? false));
  }
  void notifySettingsUpdated();
}

export async function saveDictionaryPresetAs(): Promise<void> {
  await persistSettings(
    readDictionaryValues(),
    inputElement("dictionaryPresetName").value.trim(),
    true,
  );
}

// Provider別の設定UI表示切り替え
function updateProviderUI(): void {
  const provider = selectElement("sttProvider").value;
  element("browserSettings").style.display = provider === "browser" ? "" : "none";
  element("googleSettings").style.display = provider === "google" ? "" : "none";
  element("grokSettings").style.display = provider === "grok" ? "" : "none";
}

function setRecognitionVolumeThreshold(value: unknown): number {
  const threshold = normalizeRecognitionVolumeThreshold(value);
  const input = inputElement("recognitionVolumeThreshold");
  const valueLabel = element("recognitionVolumeThresholdValue");

  input.min = String(MIN_RECOGNITION_VOLUME_THRESHOLD);
  input.max = String(MAX_RECOGNITION_VOLUME_THRESHOLD);
  input.step = String(RECOGNITION_VOLUME_THRESHOLD_STEP);
  input.value = formatRecognitionVolumeThreshold(threshold);
  valueLabel.textContent = `現在: ${formatRecognitionVolumeThreshold(threshold)} / デフォルト: ${formatRecognitionVolumeThreshold(DEFAULT_RECOGNITION_VOLUME_THRESHOLD)}`;

  return threshold;
}

export function resetRecognitionVolumeThreshold(): number {
  return setRecognitionVolumeThreshold(DEFAULT_RECOGNITION_VOLUME_THRESHOLD);
}

// 設定を読み込んでフォームに反映
export async function loadSettings(): Promise<ExtensionSettings> {
  const select = selectElement("dictionaryPreset");
  editors.delete(select);
  const items = await chrome.storage.sync.get(null);
  const { sttProvider = DEFAULT_SETTINGS.sttProvider, ...stored } = Object.fromEntries(
    Object.keys(DEFAULT_SETTINGS)
      .filter((key) => key in items)
      .map((key) => [key, items[key]]),
  );
  // STTの検証前に他の設定を表示し、プロバイダーだけ修正できるようにする。
  const result = normalizeSettings(stored);
  result.recognitionVolumeThreshold = setRecognitionVolumeThreshold(
    result.recognitionVolumeThreshold,
  );
  selectElement("sttProvider").value = typeof sttProvider === "string" ? sttProvider : "";
  inputElement("autoPost").checked = result.autoPost;
  inputElement("language").value = result.language;
  inputElement("useLocalModel").checked = result.useLocalModel;
  textAreaElement("boostPhrases").value = result.boostPhrases.join("\n");
  textAreaElement("dictionary").value = result.dictionary;
  inputElement("googleApiKey").value = result.googleApiKey;
  inputElement("xaiApiKey").value = result.xaiApiKey;
  inputElement("commentReviewEnabled").checked = result.commentReviewEnabled;
  inputElement("typesafeApiKey").value = result.typesafeApiKey;
  textAreaElement("commentReviewCriteria").value = result.commentReviewCriteria;
  updateProviderUI();
  const store = readDictionaryPresets(items, result);
  const editor = {
    store,
    selectedName: store.activeName,
    baseline: copyDictionaryValues(result),
    saving: false,
    storageSnapshot: dictionaryStorageSnapshot(items),
  };
  editors.set(select, editor);
  renderPresets(editor);
  return { ...result, sttProvider: normalizeSttProvider(sttProvider) };
}

// 設定を保存
export async function saveSettings(): Promise<ExtensionSettings> {
  const sttProvider = normalizeSttProvider(selectElement("sttProvider").value);
  const autoPost = inputElement("autoPost").checked;
  const language = inputElement("language").value.trim() || "ja-JP";
  const useLocalModel = inputElement("useLocalModel").checked;
  const recognitionVolumeThreshold = setRecognitionVolumeThreshold(
    inputElement("recognitionVolumeThreshold").value,
  );
  const { boostPhrases, dictionary } = readDictionaryValues();
  const googleApiKey = inputElement("googleApiKey").value.trim();
  const xaiApiKey = inputElement("xaiApiKey").value.trim();
  const commentReviewEnabled = inputElement("commentReviewEnabled").checked;
  const typesafeApiKey = inputElement("typesafeApiKey").value.trim();
  const commentReviewCriteria = normalizeCommentReviewCriteria(
    textAreaElement("commentReviewCriteria").value,
  );
  inputElement("typesafeApiKey").value = typesafeApiKey;
  textAreaElement("commentReviewCriteria").value = commentReviewCriteria;

  const settings: ExtensionSettings = {
    sttProvider,
    autoPost,
    language,
    useLocalModel,
    recognitionVolumeThreshold,
    boostPhrases,
    dictionary,
    googleApiKey,
    xaiApiKey,
    commentReviewEnabled,
    typesafeApiKey,
    commentReviewCriteria,
  };

  await persistSettings(settings, presetEditor().selectedName, false);

  return settings;
}

// 初期化
export function init(): void {
  const showError = (error: unknown): void => {
    showStatus(error instanceof Error ? error.message : String(error));
  };
  document.addEventListener("DOMContentLoaded", () => {
    void loadSettings().catch(showError);
  });
  element("save").addEventListener("click", () => void saveSettings().catch(showError));
  element("saveDictionaryPresetAs").addEventListener(
    "click",
    () => void saveDictionaryPresetAs().catch(showError),
  );
  selectElement("dictionaryPreset").addEventListener("change", () => {
    try {
      selectDictionaryPreset();
    } catch (error) {
      showError(error);
    }
  });
  inputElement("recognitionVolumeThreshold").addEventListener("input", (event) => {
    setRecognitionVolumeThreshold((event.currentTarget as HTMLInputElement).value);
  });
  document.getElementById("resetRecognitionVolumeThreshold")?.addEventListener("click", () => {
    resetRecognitionVolumeThreshold();
  });
  selectElement("sttProvider").addEventListener("change", updateProviderUI);
}

// 自動初期化
if (typeof window !== "undefined" && document.getElementById("save")) {
  init();
}
