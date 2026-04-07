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
const mockInstances = [];

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
    mockInstances.push(this);
  }
  start() {
    if (MockSpeechRecognition._startShouldThrow) {
      const error = MockSpeechRecognition._startShouldThrow;
      MockSpeechRecognition._startShouldThrow = null;
      throw error;
    }
  }
  stop() {}
}

MockSpeechRecognition._instances = mockInstances;
MockSpeechRecognition._startShouldThrow = null;

global.MockSpeechRecognition = MockSpeechRecognition;
const mockSRConstructor = vi.fn().mockImplementation(() => new MockSpeechRecognition());
mockSRConstructor.available = vi.fn().mockResolvedValue('available');
mockSRConstructor.install = vi.fn().mockResolvedValue(undefined);
global.webkitSpeechRecognition = mockSRConstructor;
global.SpeechRecognition = global.webkitSpeechRecognition;

// MediaRecorder モック
class MockMediaRecorder {
  constructor(stream, options) {
    this.stream = stream;
    this.options = options;
    this.state = 'inactive';
    this.ondataavailable = null;
    this.onstop = null;
  }
  start(timeslice) {
    this.state = 'recording';
    this._timeslice = timeslice;
  }
  stop() {
    this.state = 'inactive';
  }
  _simulateChunk(data) {
    if (this.ondataavailable) {
      this.ondataavailable({ data: new Blob([data], { type: 'audio/webm;codecs=opus' }) });
    }
  }
}

global.MockMediaRecorder = MockMediaRecorder;
global.MediaRecorder = MockMediaRecorder;

// AudioContext モック
class MockAudioContext {
  constructor() {
    this.sampleRate = 48000;
    this.state = 'running';
  }
  createMediaStreamSource(stream) {
    return {
      connect: vi.fn(),
      disconnect: vi.fn()
    };
  }
  createScriptProcessor(bufferSize, numInput, numOutput) {
    const processor = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      onaudioprocess: null,
      bufferSize,
      numberOfInputs: numInput,
      numberOfOutputs: numOutput
    };
    return processor;
  }
  close() {
    this.state = 'closed';
  }
}

global.AudioContext = MockAudioContext;
global.webkitAudioContext = MockAudioContext;

// navigator.mediaDevices.getUserMedia モック
const mockStream = {
  getTracks: vi.fn().mockReturnValue([{ stop: vi.fn() }])
};

if (!global.navigator) global.navigator = {};
if (!global.navigator.mediaDevices) global.navigator.mediaDevices = {};
global.navigator.mediaDevices.getUserMedia = vi.fn().mockResolvedValue(mockStream);

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

  // Reset instance tracking
  mockInstances.length = 0;
  MockSpeechRecognition._startShouldThrow = null;
  global.webkitSpeechRecognition.available.mockResolvedValue('available');
  global.webkitSpeechRecognition.install.mockResolvedValue(undefined);

  // Reset getUserMedia mock
  global.navigator.mediaDevices.getUserMedia.mockResolvedValue(mockStream);
});
