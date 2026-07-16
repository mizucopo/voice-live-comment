import type {
  IndexableArray,
  MockAudioContext as MockAudioContextClass,
  MockMediaRecorder as MockMediaRecorderClass,
  MockSpeechRecognition as MockSpeechRecognitionClass,
  mockSRConstructor,
} from "./setup.js";

type MockSpeechRecognitionInstance = InstanceType<typeof MockSpeechRecognitionClass>;
type MockSpeechRecognitionStatic = Omit<typeof MockSpeechRecognitionClass, "_instances"> & {
  _instances: IndexableArray<MockSpeechRecognitionInstance>;
};

declare global {
  var MockAudioContext: typeof MockAudioContextClass;
  var MockMediaRecorder: typeof MockMediaRecorderClass;
  var MockSpeechRecognition: MockSpeechRecognitionStatic;
  var SpeechRecognition: typeof mockSRConstructor;
  var webkitAudioContext: typeof MockAudioContextClass;
  var webkitSpeechRecognition: typeof mockSRConstructor;
}

export {};
