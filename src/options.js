import {
  DEFAULT_RECOGNITION_VOLUME_THRESHOLD,
  MAX_RECOGNITION_VOLUME_THRESHOLD,
  MIN_RECOGNITION_VOLUME_THRESHOLD,
  RECOGNITION_VOLUME_THRESHOLD_STEP,
  formatRecognitionVolumeThreshold,
  normalizeRecognitionVolumeThreshold
} from './recognition-volume-gate.js';

// デフォルト設定
const DEFAULT_SETTINGS = {
  sttProvider: 'browser',
  autoPost: true,
  language: 'ja-JP',
  useLocalModel: false,
  recognitionVolumeThreshold: DEFAULT_RECOGNITION_VOLUME_THRESHOLD,
  boostPhrases: [],
  dictionary: '',
  googleApiKey: '',
  xaiApiKey: ''
};

const SUPPORTED_STT_PROVIDERS = new Set(['browser', 'google', 'grok']);

function normalizeSttProvider(provider) {
  return SUPPORTED_STT_PROVIDERS.has(provider) ? provider : DEFAULT_SETTINGS.sttProvider;
}

// Provider別の設定UI表示切り替え
function updateProviderUI(provider) {
  const browserSettings = document.getElementById('browserSettings');
  const googleSettings = document.getElementById('googleSettings');
  const grokSettings = document.getElementById('grokSettings');

  browserSettings.style.display = 'none';
  googleSettings.style.display = 'none';
  grokSettings.style.display = 'none';

  if (provider === 'browser') {
    browserSettings.style.display = '';
  } else if (provider === 'google') {
    googleSettings.style.display = '';
  } else if (provider === 'grok') {
    grokSettings.style.display = '';
  }
}

function setRecognitionVolumeThreshold(value) {
  const threshold = normalizeRecognitionVolumeThreshold(value);
  const input = document.getElementById('recognitionVolumeThreshold');
  const valueLabel = document.getElementById('recognitionVolumeThresholdValue');

  input.min = String(MIN_RECOGNITION_VOLUME_THRESHOLD);
  input.max = String(MAX_RECOGNITION_VOLUME_THRESHOLD);
  input.step = String(RECOGNITION_VOLUME_THRESHOLD_STEP);
  input.value = formatRecognitionVolumeThreshold(threshold);
  valueLabel.textContent =
    `現在: ${formatRecognitionVolumeThreshold(threshold)} / デフォルト: ${formatRecognitionVolumeThreshold(DEFAULT_RECOGNITION_VOLUME_THRESHOLD)}`;

  return threshold;
}

export function resetRecognitionVolumeThreshold() {
  return setRecognitionVolumeThreshold(DEFAULT_RECOGNITION_VOLUME_THRESHOLD);
}

// 設定を読み込んでフォームに反映
export async function loadSettings() {
  const result = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const sttProvider = normalizeSttProvider(result.sttProvider);
  const recognitionVolumeThreshold = setRecognitionVolumeThreshold(result.recognitionVolumeThreshold);
  document.getElementById('sttProvider').value = sttProvider;
  document.getElementById('autoPost').checked = result.autoPost;
  document.getElementById('language').value = result.language;
  document.getElementById('useLocalModel').checked = result.useLocalModel;
  document.getElementById('boostPhrases').value = result.boostPhrases.join('\n');
  document.getElementById('dictionary').value = result.dictionary;
  document.getElementById('googleApiKey').value = result.googleApiKey;
  document.getElementById('xaiApiKey').value = result.xaiApiKey;
  updateProviderUI(sttProvider);
  return { ...result, sttProvider, recognitionVolumeThreshold };
}

// 設定を保存
export async function saveSettings() {
  const sttProvider = document.getElementById('sttProvider').value;
  const autoPost = document.getElementById('autoPost').checked;
  const language = document.getElementById('language').value.trim() || 'ja-JP';
  const useLocalModel = document.getElementById('useLocalModel').checked;
  const recognitionVolumeThreshold = setRecognitionVolumeThreshold(
    document.getElementById('recognitionVolumeThreshold').value
  );
  const boostPhrases = document.getElementById('boostPhrases').value
    .split('\n')
    .map(line => line.trim())
    .filter(line => line);
  const dictionary = document.getElementById('dictionary').value;
  const googleApiKey = document.getElementById('googleApiKey').value.trim();
  const xaiApiKey = document.getElementById('xaiApiKey').value.trim();

  await chrome.storage.sync.set({
    sttProvider,
    autoPost,
    language,
    useLocalModel,
    recognitionVolumeThreshold,
    boostPhrases,
    dictionary,
    googleApiKey,
    xaiApiKey
  });

  // content scriptへ設定更新を通知
  const tabs = await chrome.tabs.query({ url: ['*://www.youtube.com/*', '*://studio.youtube.com/*'] });
  tabs.forEach(tab => {
    chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED' }).catch(() => {});
  });

  const status = document.getElementById('status');
  status.textContent = '保存しました';
  setTimeout(() => {
    status.textContent = '';
  }, 2000);

  return {
    sttProvider,
    autoPost,
    language,
    useLocalModel,
    recognitionVolumeThreshold,
    boostPhrases,
    dictionary,
    googleApiKey,
    xaiApiKey
  };
}

// 初期化
export function init() {
  document.addEventListener('DOMContentLoaded', loadSettings);
  document.getElementById('save').addEventListener('click', saveSettings);
  document.getElementById('recognitionVolumeThreshold').addEventListener('input', (event) => {
    setRecognitionVolumeThreshold(event.target.value);
  });
  document
    .getElementById('resetRecognitionVolumeThreshold')
    .addEventListener('click', resetRecognitionVolumeThreshold);
  document.getElementById('sttProvider').addEventListener('change', (e) => {
    updateProviderUI(e.target.value);
  });
}

// 自動初期化
if (typeof window !== 'undefined' && document.getElementById('save')) {
  init();
}
