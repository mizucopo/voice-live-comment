import {
  DEFAULT_RECOGNITION_VOLUME_THRESHOLD,
  normalizeRecognitionVolumeThreshold,
} from "./recognition-volume-gate.js";

export type SttProviderName = "browser" | "google" | "grok";

export const DEFAULT_COMMENT_REVIEW_CRITERIA = `YouTube Liveの公開コメントとして投稿してよいかを判定してください。
独り言、短い感想、相づちは許可してください。短さ、独り言であること、配信の文脈が不明なことだけで投稿する意図がないと判断しないでください。
明らかに意味の通らない音声認識結果、誹謗中傷、脅迫、公開すべきでない個人情報を含む内容は投稿しないでください。
音声や配信内容との照合はできないため、本文から明確に判断できる範囲で評価してください。`;

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
  commentReviewEnabled: boolean;
  typesafeApiKey: string;
  commentReviewCriteria: string;
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
  commentReviewEnabled: false,
  typesafeApiKey: "",
  commentReviewCriteria: DEFAULT_COMMENT_REVIEW_CRITERIA,
};

const SUPPORTED_STT_PROVIDERS = new Set<SttProviderName>(["browser", "google", "grok"]);

export function normalizeSttProvider(provider: unknown): SttProviderName {
  return typeof provider === "string" && SUPPORTED_STT_PROVIDERS.has(provider as SttProviderName)
    ? (provider as SttProviderName)
    : DEFAULT_SETTINGS.sttProvider;
}

export function normalizeCommentReviewCriteria(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : DEFAULT_COMMENT_REVIEW_CRITERIA;
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
    commentReviewEnabled: value.commentReviewEnabled === true,
    typesafeApiKey: typeof value.typesafeApiKey === "string" ? value.typesafeApiKey.trim() : "",
    commentReviewCriteria: normalizeCommentReviewCriteria(value.commentReviewCriteria),
  };
}
