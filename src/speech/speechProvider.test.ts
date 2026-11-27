import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getCompatibleTtsVoice,
  isEditableVoiceShortcutTarget,
  isPushToTalkKey,
  speakReadback,
  startVoiceCapture,
  stopSpeaking,
} from './speechProvider';
import { languageRegistry, resolveInteractionLanguage } from './languages';

class MockRecognition {
  static instances: MockRecognition[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  startCount = 0;
  stopCount = 0;
  onstart: (() => void) | null = null;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;

  constructor() {
    MockRecognition.instances.push(this);
  }

  start() {
    this.startCount += 1;
  }

  stop() {
    this.stopCount += 1;
    this.onend?.();
  }
}

function installWindowMock() {
  vi.stubGlobal('window', {
    SpeechRecognition: MockRecognition,
    webkitSpeechRecognition: MockRecognition,
    speechSynthesis: {
      cancel: vi.fn(),
      speak: vi.fn(),
      getVoices: vi.fn(() => [
        { lang: 'ta-IN', name: 'Tamil Voice', voiceURI: 'ta', localService: true, default: true },
        { lang: 'en-IN', name: 'Indian English Voice', voiceURI: 'en', localService: true, default: false },
      ]),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
    AudioContext: undefined,
    webkitAudioContext: undefined,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setTimeout,
    clearTimeout,
  });
  vi.stubGlobal('SpeechSynthesisUtterance', class {
    text: string;
    lang = '';
    voice: unknown = null;
    rate = 1;
    pitch = 1;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((event: { error: string }) => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  });
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  MockRecognition.instances = [];
});

describe('browser speech session safeguards', () => {
  it('starts continuous recognition in the selected Tamil locale', () => {
    installWindowMock();
    const session = startVoiceCapture('ta-IN', {
      onInterim: vi.fn(),
      onFinal: vi.fn(),
      onNoiseLevel: vi.fn(),
      onError: vi.fn(),
      onEnd: vi.fn(),
    });

    const recognition = MockRecognition.instances[0];
    expect(recognition.lang).toBe('ta-IN');
    expect(recognition.continuous).toBe(true);
    expect(recognition.interimResults).toBe(true);
    expect(recognition.startCount).toBe(1);
    session.stop();
    expect(recognition.stopCount).toBe(1);
  });

  it('uses the exact configured recognition locale and refuses unconfigured locales', () => {
    installWindowMock();
    for (const language of languageRegistry.list()) {
      const onError = vi.fn();
      const session = startVoiceCapture(language.code, {
        onInterim: vi.fn(),
        onFinal: vi.fn(),
        onNoiseLevel: vi.fn(),
        onError,
        onEnd: vi.fn(),
      });
      const recognition = MockRecognition.instances[MockRecognition.instances.length - 1];
      if (language.browserSttSupported) {
        expect(recognition.lang).toBe(language.code);
        expect(recognition.startCount).toBe(1);
        session.stop();
      } else {
        expect(recognition.startCount).toBe(0);
        expect(onError).toHaveBeenCalledWith(
          expect.stringContaining('live browser recognition is not supported')
        );
      }
    }
  });

  it('preserves final speech through stop and exposes it only for verification', () => {
    installWindowMock();
    const onFinalized = vi.fn();
    const onFinal = vi.fn();
    const session = startVoiceCapture('en-IN', {
      onInterim: vi.fn(),
      onFinal,
      onFinalized,
      onNoiseLevel: vi.fn(),
      onError: vi.fn(),
      onEnd: vi.fn(),
    });
    const recognition = MockRecognition.instances[0];
    recognition.onresult?.({
      resultIndex: 0,
      results: [
        {
          isFinal: true,
          0: { transcript: 'Sold 5 bags of rice', confidence: 0.9 },
          length: 1,
        },
      ],
    });
    session.stop();
    expect(onFinal).toHaveBeenCalledWith('Sold 5 bags of rice', 0.9);
    expect(onFinalized).toHaveBeenCalledWith('Sold 5 bags of rice');
  });

  it('restarts an unexpected recognition end within the bounded recovery window', () => {
    vi.useFakeTimers();
    installWindowMock();
    const onUnexpectedEnd = vi.fn();
    const session = startVoiceCapture('en-IN', {
      onInterim: vi.fn(),
      onFinal: vi.fn(),
      onNoiseLevel: vi.fn(),
      onError: vi.fn(),
      onEnd: vi.fn(),
      onUnexpectedEnd,
    });
    const recognition = MockRecognition.instances[0];
    recognition.onend?.();
    expect(onUnexpectedEnd).toHaveBeenCalled();
    vi.advanceTimersByTime(350);
    expect(recognition.startCount).toBe(2);
    session.stop();
  });

  it('does not silently switch unsupported recognition locales', () => {
    installWindowMock();
    const onError = vi.fn();
    startVoiceCapture('sat-IN', {
      onInterim: vi.fn(),
      onFinal: vi.fn(),
      onNoiseLevel: vi.fn(),
      onError,
      onEnd: vi.fn(),
    });
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('live browser recognition is not supported')
    );
  });

  it('does not finalize or end twice after a fatal recognition error', () => {
    installWindowMock();
    const onFinalized = vi.fn();
    const onEnd = vi.fn();
    const session = startVoiceCapture('en-IN', {
      onInterim: vi.fn(),
      onFinal: vi.fn(),
      onFinalized,
      onNoiseLevel: vi.fn(),
      onError: vi.fn(),
      onEnd,
    });
    const recognition = MockRecognition.instances[0];
    recognition.onerror?.({ error: 'not-allowed' });
    recognition.onend?.();
    session.stop();
    expect(onFinalized).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('finds only compatible Tamil TTS voices', () => {
    installWindowMock();
    expect(getCompatibleTtsVoice('ta-IN')?.lang).toBe('ta-IN');
  });

  it('accepts a bare Tamil locale tag and locale variants', () => {
    installWindowMock();
    vi.mocked(window.speechSynthesis.getVoices).mockReturnValue([
      { lang: 'ta', name: 'Tamil Voice', voiceURI: 'ta', localService: true, default: true },
    ] as SpeechSynthesisVoice[]);
    expect(getCompatibleTtsVoice('ta-IN')?.lang).toBe('ta');
    expect(getCompatibleTtsVoice('ta')?.lang).toBe('ta');
  });

  it('does not claim a TTS voice exists across unrelated locales', () => {
    installWindowMock();
    vi.mocked(window.speechSynthesis.getVoices).mockReturnValue([
      { lang: 'en-IN', name: 'English Voice', voiceURI: 'en', localService: true, default: true },
    ] as SpeechSynthesisVoice[]);
    expect(getCompatibleTtsVoice('ta-IN')).toBeNull();
  });

  it('keeps every advertised TTS locale in the same language family', () => {
    installWindowMock();
    for (const language of languageRegistry.list()) {
      expect(language.ttsLangCode.split('-')[0]).toBe(language.code.split('-')[0]);
    }
    vi.mocked(window.speechSynthesis.getVoices).mockReturnValue([
      { lang: 'hi-IN', name: 'Hindi Voice', voiceURI: 'hi', localService: true, default: true },
    ] as SpeechSynthesisVoice[]);
    expect(getCompatibleTtsVoice('or-IN')).toBeNull();
    expect(getCompatibleTtsVoice('kok-IN')).toBeNull();
  });

  it('uses the explicitly selected locale when auto-detection is disabled for every registry entry', () => {
    for (const language of languageRegistry.list()) {
      const resolved = resolveInteractionLanguage('English-looking sample', language.code, false);
      expect(resolved.code).toBe(language.code);
      expect(resolved.recognitionCode).toBe(
        language.browserSttSupported ? language.code : 'unsupported'
      );
    }
  });

  it('waits through multiple voiceschanged events until a compatible voice loads', () => {
    vi.useFakeTimers();
    installWindowMock();
    vi.mocked(window.speechSynthesis.getVoices).mockReturnValue([]);
    const onUnavailable = vi.fn();
    const onStart = vi.fn();
    speakReadback('தமிழ் பதில்', 'ta-IN', { onUnavailable, onStart });
    const listeners = vi.mocked(window.speechSynthesis.addEventListener).mock.calls
      .filter(([name]) => name === 'voiceschanged')
      .map(([, listener]) => listener);
    const listener = listeners[listeners.length - 1];
    expect(listener).toBeDefined();

    const dispatch = () => {
      if (typeof listener === 'function') listener(new Event('voiceschanged'));
      else listener?.handleEvent(new Event('voiceschanged'));
    };
    dispatch();
    expect(window.speechSynthesis.speak).not.toHaveBeenCalled();

    vi.mocked(window.speechSynthesis.getVoices).mockReturnValue([
      { lang: 'ta-IN', name: 'Tamil Voice', voiceURI: 'ta', localService: true, default: true },
    ] as SpeechSynthesisVoice[]);
    dispatch();
    expect(window.speechSynthesis.speak).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1500);
    expect(onUnavailable).not.toHaveBeenCalled();
    expect(onStart).not.toHaveBeenCalled();
  });

  it('reports playback unavailable after the voice-loading timeout', () => {
    vi.useFakeTimers();
    installWindowMock();
    vi.mocked(window.speechSynthesis.getVoices).mockReturnValue([]);
    const onUnavailable = vi.fn();
    speakReadback('தமிழ் பதில்', 'ta-IN', { onUnavailable });
    vi.advanceTimersByTime(3000);
    expect(onUnavailable).toHaveBeenCalledWith(expect.stringContaining('No compatible'));
  });

  it('does not speak Tanglish in Latin script through a Tamil voice', () => {
    installWindowMock();
    const onUnavailable = vi.fn();
    expect(speakReadback('vanakkam, stock ready', 'ta-IN', { onUnavailable })).toBe(false);
    expect(window.speechSynthesis.speak).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledWith(expect.stringContaining('Tanglish'));
  });

  it('applies the Tanglish safeguard to a bare ta locale as well', () => {
    installWindowMock();
    const onUnavailable = vi.fn();
    expect(speakReadback('vanakkam, stock ready', 'ta', { onUnavailable })).toBe(false);
    expect(window.speechSynthesis.speak).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledWith(expect.stringContaining('Tanglish'));
  });

  it('ignores playback callbacks from speech cancelled by the user', () => {
    installWindowMock();
    const onError = vi.fn();
    speakReadback('English response', 'en-IN', { onError });
    const utterance = vi.mocked(window.speechSynthesis.speak).mock.calls[0][0] as unknown as {
      onerror: ((event: { error: string }) => void) | null;
    };
    stopSpeaking();
    utterance.onerror?.({ error: 'canceled' });
    expect(onError).not.toHaveBeenCalled();
  });

  it('logs development diagnostics without logging readback content', () => {
    installWindowMock();
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    speakReadback('தமிழ் response containing private details', 'ta-IN', {
      selectedApplicationLanguageCode: 'ta-IN',
    });
    const diagnosticText = JSON.stringify(info.mock.calls);
    expect(diagnosticText).toContain('Tamil Voice');
    expect(diagnosticText).toContain('ta-IN');
    expect(diagnosticText).not.toContain('private details');
    info.mockRestore();
  });

  it('cleans up speech synthesis on stop', () => {
    installWindowMock();
    stopSpeaking();
    expect(window.speechSynthesis.cancel).toHaveBeenCalled();
  });

  it('suppresses push-to-talk shortcuts in editable controls', () => {
    expect(isEditableVoiceShortcutTarget('INPUT', false)).toBe(true);
    expect(isEditableVoiceShortcutTarget('TEXTAREA', false)).toBe(true);
    expect(isEditableVoiceShortcutTarget('SELECT', false)).toBe(true);
    expect(isEditableVoiceShortcutTarget('DIV', true)).toBe(true);
    expect(isEditableVoiceShortcutTarget('BUTTON', false)).toBe(false);
  });

  it('recognizes only the bare Q push-to-talk key', () => {
    expect(isPushToTalkKey('q', false, false, false)).toBe(true);
    expect(isPushToTalkKey('Q', false, false, false)).toBe(true);
    expect(isPushToTalkKey('q', true, false, false)).toBe(false);
    expect(isPushToTalkKey(' ', false, false, false)).toBe(false);
  });
});
