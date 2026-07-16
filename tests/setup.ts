import { beforeEach, vi } from "vitest";

// Chrome API モック
export const mockStorage = {
  sync: {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined),
  },
};

export const mockTabs = {
  query: vi.fn().mockResolvedValue([]),
  sendMessage: vi.fn().mockResolvedValue({}),
};

export const mockAction = {
  setBadgeText: vi.fn().mockResolvedValue(undefined),
  setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
  onClicked: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
};

export const mockNotifications = {
  create: vi.fn().mockResolvedValue(""),
};

export const mockScripting = {
  executeScript: vi.fn().mockResolvedValue([]),
};

export type RuntimeMessageListener = (
  message: Record<string, unknown>,
  sender: Record<string, unknown>,
  sendResponse: (response: unknown) => void,
) => boolean | undefined;

export const mockRuntime = {
  sendMessage: vi
    .fn<(message: Record<string, unknown>) => Promise<unknown>>()
    .mockResolvedValue(undefined),
  onMessage: {
    addListener: vi.fn<(callback: RuntimeMessageListener) => void>(),
    removeListener: vi.fn<(callback: RuntimeMessageListener) => void>(),
  },
  getURL: vi.fn().mockImplementation((path: string) => `chrome-extension://test-id/${path}`),
};

export const chromeMocks = {
  storage: mockStorage,
  tabs: mockTabs,
  action: mockAction,
  notifications: mockNotifications,
  scripting: mockScripting,
  runtime: mockRuntime,
};

Object.defineProperty(globalThis, "chrome", {
  configurable: true,
  value: chromeMocks,
  writable: true,
});

// SpeechRecognition モック
export type IndexableArray<T> = [T, T, ...T[]];

export const mockInstances = [] as unknown as IndexableArray<MockSpeechRecognition>;

export class MockSpeechRecognition {
  static _instances: typeof mockInstances = mockInstances;
  static _startShouldThrow: Error | null = null;

  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally: boolean | undefined;
  phrases: unknown[];
  onstart: () => void;
  onresult: (event: unknown) => void;
  onerror: (event: unknown) => void;
  onend: () => void;

  constructor() {
    this.lang = "";
    this.continuous = false;
    this.interimResults = false;
    this.maxAlternatives = 1;
    this.processLocally = undefined;
    this.phrases = [];
    this.onstart = () => undefined;
    this.onresult = () => undefined;
    this.onerror = () => undefined;
    this.onend = () => undefined;
    mockInstances.push(this);
  }
  start() {
    if (MockSpeechRecognition._startShouldThrow) {
      const error = MockSpeechRecognition._startShouldThrow;
      MockSpeechRecognition._startShouldThrow = null;
      throw error;
    }
  }
  stop(): void {
    return undefined;
  }
}

Object.defineProperty(globalThis, "MockSpeechRecognition", {
  configurable: true,
  value: MockSpeechRecognition,
  writable: true,
});

export const mockSRConstructor = Object.assign(
  vi.fn(function SpeechRecognitionMock() {
    return new MockSpeechRecognition();
  }),
  {
    available: vi.fn().mockResolvedValue("available"),
    install: vi.fn().mockResolvedValue(undefined),
  },
);
Object.defineProperty(globalThis, "webkitSpeechRecognition", {
  configurable: true,
  value: mockSRConstructor,
  writable: true,
});
Object.defineProperty(globalThis, "SpeechRecognition", {
  configurable: true,
  value: mockSRConstructor,
  writable: true,
});

// MediaRecorder モック
export class MockMediaRecorder {
  stream: MediaStream;
  options: MediaRecorderOptions | undefined;
  state: RecordingState;
  ondataavailable: ((event: { data: Blob; timecode?: number }) => void) | null;
  onstop: (() => void) | null;
  requestData: ReturnType<typeof vi.fn>;
  _timeslice: number | undefined;

  constructor(stream: MediaStream, options?: MediaRecorderOptions) {
    this.stream = stream;
    this.options = options;
    this.state = "inactive";
    this.ondataavailable = null;
    this.onstop = null;
    this.requestData = vi.fn();
  }
  start(timeslice?: number): void {
    this.state = "recording";
    this._timeslice = timeslice;
  }
  stop(): void {
    this.state = "inactive";
  }
  _simulateChunk(data: BlobPart, options: { timecode?: number } = {}): void {
    if (this.ondataavailable) {
      this.ondataavailable({
        data: new Blob([data], { type: "audio/webm;codecs=opus" }),
        ...(options.timecode === undefined ? {} : { timecode: options.timecode }),
      });
    }
  }
}

Object.defineProperty(globalThis, "MockMediaRecorder", {
  configurable: true,
  value: MockMediaRecorder,
  writable: true,
});
Object.defineProperty(globalThis, "MediaRecorder", {
  configurable: true,
  value: MockMediaRecorder,
  writable: true,
});

// AudioContext モック
export class MockAudioContext {
  sampleRate: number;
  state: AudioContextState;

  constructor() {
    this.sampleRate = 48000;
    this.state = "running";
  }
  createMediaStreamSource(_stream: MediaStream): {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  } {
    void _stream;
    return {
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }
  createScriptProcessor(
    bufferSize: number,
    numInput: number,
    numOutput: number,
  ): {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    onaudioprocess: ((event: unknown) => void) | null;
    bufferSize: number;
    numberOfInputs: number;
    numberOfOutputs: number;
  } {
    const processor = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      onaudioprocess: null,
      bufferSize,
      numberOfInputs: numInput,
      numberOfOutputs: numOutput,
    };
    return processor;
  }
  createGain(): {
    gain: { value: number };
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  } {
    return {
      gain: { value: 1 },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }
  close(): void {
    this.state = "closed";
  }
}

Object.defineProperty(globalThis, "AudioContext", {
  configurable: true,
  value: MockAudioContext,
  writable: true,
});
Object.defineProperty(globalThis, "webkitAudioContext", {
  configurable: true,
  value: MockAudioContext,
  writable: true,
});

// navigator.mediaDevices.getUserMedia モック
export const mockStream = {
  getTracks: vi.fn().mockReturnValue([{ stop: vi.fn() }]),
} as unknown as MediaStream;

export const mockGetUserMedia = vi.fn().mockResolvedValue(mockStream);
Object.defineProperty(globalThis.navigator, "mediaDevices", {
  configurable: true,
  value: { getUserMedia: mockGetUserMedia },
});

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
  mockNotifications.create.mockResolvedValue("");
  mockScripting.executeScript.mockResolvedValue([]);
  mockRuntime.sendMessage.mockResolvedValue(undefined);

  // Reset SpeechRecognition constructor tracking
  mockSRConstructor.mockClear();

  // Reset instance tracking
  mockInstances.length = 0;
  MockSpeechRecognition._startShouldThrow = null;
  mockSRConstructor.available.mockResolvedValue("available");
  mockSRConstructor.install.mockResolvedValue(undefined);

  // Reset getUserMedia mock
  mockGetUserMedia.mockResolvedValue(mockStream);
});
