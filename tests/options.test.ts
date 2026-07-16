import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadSettings, resetRecognitionVolumeThreshold, saveSettings } from "../src/options.js";
import { mockStorage, mockTabs } from "./setup.js";

type TestElement = HTMLElement & HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement;
type TestDocument = Omit<Document, "getElementById"> & {
  getElementById: (elementId: string) => TestElement;
};

const document = globalThis.document as TestDocument;
const chrome = { storage: mockStorage, tabs: mockTabs };

describe("options.js", () => {
  let autoPostCheckbox: HTMLInputElement;
  let languageInput: HTMLInputElement;
  let statusElement: HTMLElement;

  beforeEach(() => {
    // DOM構築
    document.body.innerHTML = `
      <select id="sttProvider">
        <option value="browser">ブラウザ音声認識</option>
        <option value="google">Google Cloud STT</option>
        <option value="grok">Grok STT</option>
      </select>
      <input type="password" id="googleApiKey" />
      <input type="password" id="xaiApiKey" />
      <input type="range" id="recognitionVolumeThreshold" min="0" max="0.20" step="0.01" value="0.05" />
      <span id="recognitionVolumeThresholdValue"></span>
      <button id="resetRecognitionVolumeThreshold" type="button">デフォルトに戻す</button>
      <div id="browserSettings">
        <input type="checkbox" id="autoPost" />
        <input type="text" id="language" />
        <input type="checkbox" id="useLocalModel" />
        <textarea id="boostPhrases"></textarea>
        <textarea id="dictionary"></textarea>
      </div>
      <div id="googleSettings" style="display:none"></div>
      <div id="grokSettings" style="display:none"></div>
      <div id="status"></div>
      <button id="save">保存</button>
    `;
    autoPostCheckbox = document.getElementById("autoPost");
    languageInput = document.getElementById("language");
    statusElement = document.getElementById("status");

    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("loadSettings", () => {
    it("デフォルト値で設定を読み込む", async () => {
      chrome.storage.sync.get.mockResolvedValue({
        sttProvider: "browser",
        autoPost: true,
        language: "ja-JP",
        useLocalModel: false,
        recognitionVolumeThreshold: 0.05,
        boostPhrases: [],
        dictionary: "",
        googleApiKey: "",
        xaiApiKey: "",
      });

      await loadSettings();

      expect(document.getElementById("sttProvider").value).toBe("browser");
      expect(autoPostCheckbox.checked).toBe(true);
      expect(languageInput.value).toBe("ja-JP");
      expect(document.getElementById("recognitionVolumeThreshold").value).toBe("0.05");
      expect(document.getElementById("recognitionVolumeThresholdValue").textContent).toBe(
        "現在: 0.05 / デフォルト: 0.05",
      );
    });

    it("保存済み設定を読み込む", async () => {
      chrome.storage.sync.get.mockResolvedValue({
        sttProvider: "browser",
        autoPost: false,
        language: "en-US",
        useLocalModel: true,
        recognitionVolumeThreshold: 0.12,
        boostPhrases: ["配信", "コメント"],
        dictionary: "とーきょー→東京",
        googleApiKey: "",
        xaiApiKey: "",
      });

      await loadSettings();

      expect(autoPostCheckbox.checked).toBe(false);
      expect(languageInput.value).toBe("en-US");
      expect(document.getElementById("useLocalModel").checked).toBe(true);
      expect(document.getElementById("recognitionVolumeThreshold").value).toBe("0.12");
      expect(document.getElementById("boostPhrases").value).toBe("配信\nコメント");
      expect(document.getElementById("dictionary").value).toBe("とーきょー→東京");
    });

    it("認識音量ゲート無効の設定を読み込む", async () => {
      chrome.storage.sync.get.mockResolvedValue({
        sttProvider: "browser",
        autoPost: true,
        language: "ja-JP",
        useLocalModel: false,
        recognitionVolumeThreshold: 0,
        boostPhrases: [],
        dictionary: "",
        googleApiKey: "",
        xaiApiKey: "",
      });

      await loadSettings();

      expect(document.getElementById("recognitionVolumeThreshold").value).toBe("0.00");
      expect(document.getElementById("recognitionVolumeThresholdValue").textContent).toBe(
        "現在: 0.00 / デフォルト: 0.05",
      );
    });
  });

  describe("saveSettings", () => {
    it("設定を保存する", async () => {
      autoPostCheckbox.checked = true;
      languageInput.value = "en-US";
      chrome.tabs.query.mockResolvedValue([]);

      await saveSettings();

      expect(chrome.storage.sync.set).toHaveBeenCalledWith({
        sttProvider: "browser",
        autoPost: true,
        language: "en-US",
        useLocalModel: false,
        recognitionVolumeThreshold: 0.05,
        boostPhrases: [],
        dictionary: "",
        googleApiKey: "",
        xaiApiKey: "",
      });
    });

    it("空の言語はデフォルト値にする", async () => {
      autoPostCheckbox.checked = true;
      languageInput.value = "   ";
      chrome.tabs.query.mockResolvedValue([]);

      await saveSettings();

      expect(chrome.storage.sync.set).toHaveBeenCalledWith({
        sttProvider: "browser",
        autoPost: true,
        language: "ja-JP",
        useLocalModel: false,
        recognitionVolumeThreshold: 0.05,
        boostPhrases: [],
        dictionary: "",
        googleApiKey: "",
        xaiApiKey: "",
      });
    });

    it("保存後にステータスを表示する", async () => {
      autoPostCheckbox.checked = true;
      languageInput.value = "ja-JP";
      chrome.tabs.query.mockResolvedValue([]);

      await saveSettings();

      expect(statusElement.textContent).toBe("保存しました");

      vi.advanceTimersByTime(2000);
      expect(statusElement.textContent).toBe("");
    });

    it("YouTubeタブに設定更新を通知する", async () => {
      autoPostCheckbox.checked = true;
      languageInput.value = "ja-JP";
      chrome.tabs.query.mockResolvedValue([{ id: 1, url: "https://www.youtube.com/watch?v=test" }]);

      await saveSettings();

      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, { type: "SETTINGS_UPDATED" });
    });

    it("新設定を保存する", async () => {
      autoPostCheckbox.checked = true;
      languageInput.value = "ja-JP";
      document.getElementById("useLocalModel").checked = true;
      document.getElementById("boostPhrases").value = "配信\nコメント";
      document.getElementById("dictionary").value = "とーきょー→東京";
      chrome.tabs.query.mockResolvedValue([]);

      await saveSettings();

      expect(chrome.storage.sync.set).toHaveBeenCalledWith({
        sttProvider: "browser",
        autoPost: true,
        language: "ja-JP",
        useLocalModel: true,
        recognitionVolumeThreshold: 0.05,
        boostPhrases: ["配信", "コメント"],
        dictionary: "とーきょー→東京",
        googleApiKey: "",
        xaiApiKey: "",
      });
    });

    it("boostPhrasesの空行を除外して保存する", async () => {
      autoPostCheckbox.checked = true;
      languageInput.value = "ja-JP";
      document.getElementById("boostPhrases").value = "配信\n\nコメント\n";
      chrome.tabs.query.mockResolvedValue([]);

      await saveSettings();

      expect(chrome.storage.sync.set).toHaveBeenCalledWith(
        expect.objectContaining({ boostPhrases: ["配信", "コメント"] }),
      );
    });

    it("認識音量しきい値を保存する", async () => {
      autoPostCheckbox.checked = true;
      languageInput.value = "ja-JP";
      document.getElementById("recognitionVolumeThreshold").value = "0.12";
      chrome.tabs.query.mockResolvedValue([]);

      const result = await saveSettings();

      expect(chrome.storage.sync.set).toHaveBeenCalledWith(
        expect.objectContaining({ recognitionVolumeThreshold: 0.12 }),
      );
      expect(result.recognitionVolumeThreshold).toBe(0.12);
    });

    it("認識音量ゲート無効として0を保存する", async () => {
      autoPostCheckbox.checked = true;
      languageInput.value = "ja-JP";
      document.getElementById("recognitionVolumeThreshold").value = "0";
      chrome.tabs.query.mockResolvedValue([]);

      const result = await saveSettings();

      expect(chrome.storage.sync.set).toHaveBeenCalledWith(
        expect.objectContaining({ recognitionVolumeThreshold: 0 }),
      );
      expect(result.recognitionVolumeThreshold).toBe(0);
      expect(document.getElementById("recognitionVolumeThresholdValue").textContent).toBe(
        "現在: 0.00 / デフォルト: 0.05",
      );
    });

    it("認識音量しきい値をデフォルトに戻す", () => {
      document.getElementById("recognitionVolumeThreshold").value = "0.15";

      const threshold = resetRecognitionVolumeThreshold();

      expect(threshold).toBe(0.05);
      expect(document.getElementById("recognitionVolumeThreshold").value).toBe("0.05");
      expect(document.getElementById("recognitionVolumeThresholdValue").textContent).toBe(
        "現在: 0.05 / デフォルト: 0.05",
      );
    });
  });

  describe("STT Provider設定", () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <select id="sttProvider">
          <option value="browser">ブラウザ音声認識</option>
          <option value="google">Google Cloud STT</option>
          <option value="grok">Grok STT</option>
        </select>
        <input type="password" id="googleApiKey" />
        <input type="password" id="xaiApiKey" />
        <input type="range" id="recognitionVolumeThreshold" min="0" max="0.20" step="0.01" value="0.05" />
        <span id="recognitionVolumeThresholdValue"></span>
        <button id="resetRecognitionVolumeThreshold" type="button">デフォルトに戻す</button>
        <div id="browserSettings">
          <input type="checkbox" id="useLocalModel" />
          <textarea id="boostPhrases"></textarea>
          <textarea id="dictionary"></textarea>
        </div>
        <div id="googleSettings" style="display:none"></div>
        <div id="grokSettings" style="display:none"></div>
        <input type="checkbox" id="autoPost" />
        <input type="text" id="language" value="ja-JP" />
        <div id="status"></div>
        <button id="save">保存</button>
      `;
      vi.clearAllMocks();
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("sttProvider設定を保存・読み込みする", async () => {
      chrome.storage.sync.get.mockResolvedValue({
        sttProvider: "google",
        autoPost: true,
        language: "ja-JP",
        useLocalModel: false,
        boostPhrases: [],
        dictionary: "",
        googleApiKey: "test-key",
        xaiApiKey: "",
      });

      await loadSettings();

      expect(document.getElementById("sttProvider").value).toBe("google");
      expect(document.getElementById("googleApiKey").value).toBe("test-key");
    });

    it("ブラウザ選択時にブラウザ設定が表示される", async () => {
      chrome.storage.sync.get.mockResolvedValue({
        sttProvider: "browser",
        autoPost: true,
        language: "ja-JP",
        useLocalModel: false,
        boostPhrases: [],
        dictionary: "",
        googleApiKey: "",
        xaiApiKey: "",
      });

      await loadSettings();

      expect(document.getElementById("browserSettings").style.display).not.toBe("none");
      expect(document.getElementById("googleSettings").style.display).toBe("none");
    });

    it("Google選択時にGoogle設定が表示される", async () => {
      chrome.storage.sync.get.mockResolvedValue({
        sttProvider: "google",
        autoPost: true,
        language: "ja-JP",
        useLocalModel: false,
        boostPhrases: [],
        dictionary: "",
        googleApiKey: "test-key",
        xaiApiKey: "",
      });

      await loadSettings();

      expect(document.getElementById("browserSettings").style.display).toBe("none");
      expect(document.getElementById("googleSettings").style.display).not.toBe("none");
    });

    it("サポート外プロバイダー設定はブラウザ音声認識として読み込む", async () => {
      chrome.storage.sync.get.mockResolvedValue({
        sttProvider: "speechmatics",
        autoPost: true,
        language: "ja-JP",
        useLocalModel: false,
        boostPhrases: [],
        dictionary: "",
        googleApiKey: "",
        xaiApiKey: "",
      });

      await loadSettings();

      expect(document.getElementById("sttProvider").value).toBe("browser");
      expect(document.getElementById("browserSettings").style.display).not.toBe("none");
      expect(document.getElementById("googleSettings").style.display).toBe("none");
    });

    it("Grok選択時にGrok設定が表示される", async () => {
      chrome.storage.sync.get.mockResolvedValue({
        sttProvider: "grok",
        autoPost: true,
        language: "ja-JP",
        useLocalModel: false,
        boostPhrases: [],
        dictionary: "",
        googleApiKey: "",
        xaiApiKey: "xai-key",
      });

      await loadSettings();

      expect(document.getElementById("sttProvider").value).toBe("grok");
      expect(document.getElementById("xaiApiKey").value).toBe("xai-key");
      expect(document.getElementById("browserSettings").style.display).toBe("none");
      expect(document.getElementById("googleSettings").style.display).toBe("none");
      expect(document.getElementById("grokSettings").style.display).not.toBe("none");
    });

    it("Grok設定を保存する", async () => {
      document.getElementById("sttProvider").value = "grok";
      document.getElementById("xaiApiKey").value = "xai-key";
      document.getElementById("autoPost").checked = true;
      document.getElementById("language").value = "ja-JP";
      chrome.tabs.query.mockResolvedValue([]);

      const result = await saveSettings();

      expect(chrome.storage.sync.set).toHaveBeenCalledWith(
        expect.objectContaining({
          sttProvider: "grok",
          xaiApiKey: "xai-key",
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          sttProvider: "grok",
          xaiApiKey: "xai-key",
        }),
      );
    });
  });
});
