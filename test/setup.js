import { vi } from 'vitest';

// Chrome API モック
const mockStorage = {
  sync: {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined)
  }
};

const mockTabs = {
  query: vi.fn().mockResolvedValue([]),
  sendMessage: vi.fn().mockResolvedValue({})
};

const mockAction = {
  setBadgeText: vi.fn().mockResolvedValue(undefined),
  setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
  onClicked: {
    addListener: vi.fn(),
    removeListener: vi.fn()
  }
};

const mockNotifications = {
  create: vi.fn().mockResolvedValue('')
};

const mockScripting = {
  executeScript: vi.fn().mockResolvedValue([])
};

const mockRuntime = {
  sendMessage: vi.fn().mockResolvedValue(undefined),
  onMessage: {
    addListener: vi.fn(),
    removeListener: vi.fn()
  }
};

global.chrome = {
  storage: mockStorage,
  tabs: mockTabs,
  action: mockAction,
  notifications: mockNotifications,
  scripting: mockScripting,
  runtime: mockRuntime
};

// SpeechRecognition モック
class MockSpeechRecognition {
  constructor() {
    this.lang = '';
    this.continuous = false;
    this.interimResults = false;
    this.maxAlternatives = 1;
    this.processLocally = undefined;
    this.phrases = [];
    this.onstart = null;
    this.onresult = null;
    this.onerror = null;
    this.onend = null;
  }
  start() {}
  stop() {}
}

global.webkitSpeechRecognition = vi.fn().mockImplementation(() => new MockSpeechRecognition());
global.SpeechRecognition = global.webkitSpeechRecognition;

// テスト間でモックをリセット
beforeEach(() => {
  vi.clearAllMocks();

  // Reset all Chrome API mocks with default return values
  mockStorage.sync.get.mockResolvedValue({});
  mockStorage.sync.set.mockResolvedValue(undefined);
  mockTabs.query.mockResolvedValue([]);
  mockTabs.sendMessage.mockResolvedValue({});
  mockAction.setBadgeText.mockResolvedValue(undefined);
  mockAction.setBadgeBackgroundColor.mockResolvedValue(undefined);
  mockNotifications.create.mockResolvedValue('');
  mockScripting.executeScript.mockResolvedValue([]);
  mockRuntime.sendMessage.mockResolvedValue(undefined);

  // Reset SpeechRecognition constructor tracking
  global.webkitSpeechRecognition.mockClear();
});
