import {
  DEFAULT_RECOGNITION_VOLUME_THRESHOLD,
  normalizeRecognitionVolumeThreshold,
} from "./recognition-volume-gate.js";

export type SttProviderName = "browser" | "google" | "grok";

export type ExtensionSettings = {
  sttProvider: SttProviderName;
  autoPost: boolean;
  language: string;
  useLocalModel: boolean;
  recognitionVolumeThreshold: number;
  boostPhrases: string[];
  dictionary: string;
  googleApiKey: string;
  xaiApiKey: string;
};

export const DEFAULT_SETTINGS: ExtensionSettings = {
  sttProvider: "browser",
  autoPost: true,
  language: "ja-JP",
  useLocalModel: false,
  recognitionVolumeThreshold: DEFAULT_RECOGNITION_VOLUME_THRESHOLD,
  boostPhrases: [],
  dictionary: "",
  googleApiKey: "",
  xaiApiKey: "",
};

const SUPPORTED_STT_PROVIDERS = new Set<SttProviderName>(["browser", "google", "grok"]);

export function normalizeSttProvider(provider: unknown): SttProviderName {
  return typeof provider === "string" && SUPPORTED_STT_PROVIDERS.has(provider as SttProviderName)
    ? (provider as SttProviderName)
    : DEFAULT_SETTINGS.sttProvider;
}

export function normalizeSettings(value: Partial<ExtensionSettings>): ExtensionSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...value,
    sttProvider: normalizeSttProvider(value.sttProvider),
    recognitionVolumeThreshold: normalizeRecognitionVolumeThreshold(
      value.recognitionVolumeThreshold,
    ),
    boostPhrases: Array.isArray(value.boostPhrases)
      ? value.boostPhrases.filter((phrase): phrase is string => typeof phrase === "string")
      : [],
  };
}
