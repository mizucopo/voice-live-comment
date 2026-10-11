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
  const { sttProvider = DEFAULT_SETTINGS.sttProvider, ...stored } =
    await chrome.storage.sync.get(DEFAULT_SETTINGS);
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
  const boostPhrases = textAreaElement("boostPhrases")
    .value.split("\n")
    .map((line) => line.trim())
    .filter((line) => line);
  const dictionary = textAreaElement("dictionary").value;
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

  await chrome.storage.sync.set(settings);

  // content scriptへ設定更新を通知
  const tabs = await chrome.tabs.query({
    url: ["*://www.youtube.com/*", "*://studio.youtube.com/*"],
  });
  tabs.forEach((tab) => {
    if (tab.id !== undefined) {
      chrome.tabs.sendMessage(tab.id, { type: "SETTINGS_UPDATED" }).catch(() => undefined);
    }
  });

  const status = element("status");
  status.textContent = "保存しました";
  setTimeout(() => {
    status.textContent = "";
  }, 2000);

  return settings;
}

// 初期化
export function init(): void {
  const showError = (error: unknown): void => {
    element("status").textContent = error instanceof Error ? error.message : String(error);
  };
  document.addEventListener("DOMContentLoaded", () => {
    void loadSettings().catch(showError);
  });
  element("save").addEventListener("click", () => void saveSettings().catch(showError));
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
