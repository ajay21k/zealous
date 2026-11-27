import { languageRegistry } from './languages';

export type SpeechProviderId = 'web-speech' | 'sarvam-adapter' | 'bhashini-adapter' | 'whisper-adapter';

export interface SpeechProviderInfo {
  id: SpeechProviderId;
  name: string;
  mode: 'LIVE_BROWSER' | 'CONFIGURABLE_ADAPTER';
  description: string;
  supportsNoiseMonitor: boolean;
}

export const SPEECH_PROVIDERS: SpeechProviderInfo[] = [
  {
    id: 'web-speech',
    name: 'Browser Web Speech API (Live Prototype)',
    mode: 'LIVE_BROWSER',
    description:
      'Uses your browser’s native SpeechRecognition & SpeechSynthesis engines plus Web Audio RMS noise monitoring.',
    supportsNoiseMonitor: true,
  },
  {
    id: 'sarvam-adapter',
    name: 'Sarvam AI (Saaras STT + Bulbul TTS Adapter)',
    mode: 'CONFIGURABLE_ADAPTER',
    description:
      'Architectural adapter slot for Sarvam AI Indian multilingual STT/TTS. Requires backend API key in production.',
    supportsNoiseMonitor: true,
  },
  {
    id: 'bhashini-adapter',
    name: 'BHASHINI ULCA (22 Scheduled Languages Adapter)',
    mode: 'CONFIGURABLE_ADAPTER',
    description:
      'Architectural adapter slot for MeitY BHASHINI ASR/TTS endpoints covering all 22 scheduled Indian languages.',
    supportsNoiseMonitor: true,
  },
  {
    id: 'whisper-adapter',
    name: 'OpenAI Whisper + Indic TTS (Adapter)',
    mode: 'CONFIGURABLE_ADAPTER',
    description:
      'Architectural adapter slot for self-hosted Whisper large-v3 multilingual ASR + regional TTS.',
    supportsNoiseMonitor: true,
  },
];

export interface BrowserSpeechCapabilities {
  sttAvailable: boolean;
  ttsAvailable: boolean;
  audioMonitorAvailable: boolean;
}

export function isEditableVoiceShortcutTarget(
  tagName: string,
  isContentEditable: boolean
): boolean {
  const tag = tagName.toUpperCase();
  return (
    isContentEditable ||
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT'
  );
}

export function isPushToTalkKey(
  key: string,
  ctrlKey: boolean,
  altKey: boolean,
  metaKey: boolean
): boolean {
  return (
    key.toLowerCase() === 'q' &&
    !ctrlKey &&
    !altKey &&
    !metaKey
  );
}

interface WebSpeechRecognitionEvent {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [altIndex: number]: {
        transcript: string;
        confidence: number;
      };
    };
  };
}

interface WebSpeechRecognitionErrorEvent {
  error: string;
}

interface WebSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((ev: WebSpeechRecognitionEvent) => void) | null;
  onerror: ((ev: WebSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function getSpeechRecognitionCtor(): (new () => WebSpeechRecognition) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as
    | (new () => WebSpeechRecognition)
    | null;
}

export function getBrowserSpeechCapabilities(): BrowserSpeechCapabilities {
  const hasWindow = typeof window !== 'undefined';
  return {
    sttAvailable: Boolean(getSpeechRecognitionCtor()),
    ttsAvailable: hasWindow && 'speechSynthesis' in window,
    audioMonitorAvailable:
      hasWindow && typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia),
  };
}

export interface RecognitionSessionCallbacks {
  onInterim: (text: string) => void;
  onFinal: (text: string, confidence: number) => void;
  onStart?: () => void;
  onFinalized?: (text: string) => void;
  onAborted?: (message: string) => void;
  onNoiseLevel: (rms: number, isNoisy: boolean) => void;
  onError: (message: string) => void;
  onEnd: () => void;
  onUnexpectedEnd?: (message: string) => void;
  onMaxDuration?: (message: string) => void;
}

export interface ActiveRecognitionSession {
  stop: () => void;
}

export function startVoiceCapture(
  langCode: string,
  callbacks: RecognitionSessionCallbacks
): ActiveRecognitionSession {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    callbacks.onError(
      'Live browser SpeechRecognition is unavailable in this browser. Use the quick voice presets or type/paste speech below.'
    );
    callbacks.onEnd();
    return { stop: () => undefined };
  }

  let stopped = false;
  let audioStream: MediaStream | null = null;
  let audioCtx: AudioContext | null = null;
  let rafId = 0;
  let intentionalStop = false;
  let active = true;
  let restartTimer: number | undefined;
  let restartCount = 0;
  let finalBuffer = '';
  let latestInterim = '';
  let stopFinalized = false;
  const maxDurationMs = 30 * 60 * 1000;
  const maxRestarts = 8;
  const startedAt = Date.now();

  const recognition = new Ctor();
  const langConfig = languageRegistry.getByCode(langCode);
  if (!langConfig?.browserSttSupported) {
    callbacks.onError(
      `${langConfig?.name ?? langCode} live browser recognition is not supported by this browser. Written input remains available.`
    );
    callbacks.onEnd();
    return { stop: () => undefined };
  }
  recognition.lang = langCode;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  const cleanupAudio = () => {
    if (rafId) cancelAnimationFrame(rafId);
    if (audioStream) {
      audioStream.getTracks().forEach((t) => t.stop());
      audioStream = null;
    }
    if (audioCtx) {
      audioCtx.close().catch(() => undefined);
      audioCtx = null;
    }
  };

  recognition.onstart = () => {
    if (!stopped) callbacks.onStart?.();
  };

  recognition.onresult = (event) => {
    if (stopped) return;
    let interim = '';
    let finalTranscript = '';
    let confidence = 0.88;
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const alt = result[0];
      if (result.isFinal) {
        finalTranscript += alt.transcript;
        confidence = alt.confidence > 0 ? alt.confidence : 0.88;
      } else {
        interim += alt.transcript;
      }
    }
    latestInterim = interim.trim();
    if (interim) callbacks.onInterim(interim);
    if (finalTranscript.trim()) {
      finalBuffer = `${finalBuffer} ${finalTranscript.trim()}`.trim();
      latestInterim = '';
      callbacks.onFinal(finalTranscript.trim(), confidence);
    }
  };

  recognition.onerror = (event) => {
    if (stopped) return;
    if (event.error === 'aborted') {
      if (intentionalStop) return;
      callbacks.onAborted?.('Recognition was aborted by the browser. Listening stopped safely; restart it to try again.');
      intentionalStop = true;
      active = false;
      stopped = true;
      stopFinalized = true;
      cleanupAudio();
      callbacks.onEnd();
    } else if (event.error === 'no-speech') {
      callbacks.onError('Listening, but no clear speech was detected. Stay close to the microphone or continue speaking.');
    } else if (event.error === 'not-allowed') {
      intentionalStop = true;
      active = false;
      stopped = true;
      stopFinalized = true;
      cleanupAudio();
      callbacks.onError('Microphone permission denied. You can still type or test regional voice samples.');
      callbacks.onEnd();
    } else if (event.error === 'audio-capture') {
      intentionalStop = true;
      active = false;
      stopped = true;
      stopFinalized = true;
      cleanupAudio();
      callbacks.onError('No usable microphone was found. Check the input device and try again.');
      callbacks.onEnd();
    } else if (event.error === 'language-not-supported') {
      intentionalStop = true;
      active = false;
      stopped = true;
      stopFinalized = true;
      cleanupAudio();
      callbacks.onError('The selected recognition language is not supported by this browser. Choose a supported language or use written input.');
      callbacks.onEnd();
    } else if (event.error === 'network') {
      callbacks.onError('Speech recognition network failed. Listening stopped safely; check the connection and restart it.');
      intentionalStop = true;
      active = false;
      stopped = true;
      stopFinalized = true;
      cleanupAudio();
      callbacks.onEnd();
    } else {
      callbacks.onError(`Recognition reported "${event.error}". Listening was stopped safely; you can restart it.`);
      intentionalStop = true;
      active = false;
      stopped = true;
      stopFinalized = true;
      cleanupAudio();
      callbacks.onEnd();
    }
  };

  recognition.onend = () => {
    if (intentionalStop || stopped) {
      if (!stopFinalized) {
        stopFinalized = true;
        cleanupAudio();
        const completeText =
          `${finalBuffer}${latestInterim ? ` ${latestInterim}` : ''}`.trim();
        callbacks.onFinalized?.(completeText);
        callbacks.onEnd();
      }
      return;
    }
    if (Date.now() - startedAt >= maxDurationMs) {
      intentionalStop = true;
      active = false;
      stopped = true;
      stopFinalized = true;
      cleanupAudio();
      callbacks.onMaxDuration?.('The 30-minute listening limit was reached. Tap the microphone to start a new session.');
      callbacks.onEnd();
      return;
    }
    if (restartCount >= maxRestarts) {
      intentionalStop = true;
      active = false;
      stopped = true;
      stopFinalized = true;
      cleanupAudio();
      callbacks.onUnexpectedEnd?.('Recognition ended repeatedly. Listening stopped safely; restart the microphone.');
      callbacks.onEnd();
      return;
    }
    restartCount += 1;
    callbacks.onUnexpectedEnd?.('Recognition paused and is restarting automatically. Listening remains active.');
    if (restartTimer !== undefined) window.clearTimeout(restartTimer);
    restartTimer = window.setTimeout(() => {
      if (!active || intentionalStop || stopped) return;
      try {
        recognition.start();
      } catch {
        callbacks.onUnexpectedEnd?.('Recognition could not restart. Please stop and start it again.');
        intentionalStop = true;
        active = false;
        stopped = true;
        stopFinalized = true;
        cleanupAudio();
        callbacks.onEnd();
      }
    }, 350);
  };

  // Optional live RMS audio level & background noise monitor
  if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
    navigator.mediaDevices
      .getUserMedia({ audio: { noiseSuppression: true, echoCancellation: true } })
      .then((stream) => {
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        audioStream = stream;
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        audioCtx = new AudioCtx();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const sample = () => {
          if (stopped) return;
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.min(1, Math.sqrt(sum / data.length) * 3.2);
          callbacks.onNoiseLevel(rms, rms > 0.65);
          rafId = requestAnimationFrame(sample);
        };
        rafId = requestAnimationFrame(sample);
      })
      .catch(() => {
        // Noise monitor is optional; recognition still proceeds
      });
  }

  try {
    recognition.start();
  } catch (err) {
    intentionalStop = true;
    active = false;
    stopped = true;
    stopFinalized = true;
    if (restartTimer !== undefined) window.clearTimeout(restartTimer);
    cleanupAudio();
    callbacks.onError(err instanceof Error ? err.message : 'Unable to start microphone.');
    callbacks.onEnd();
  }

  return {
    stop: () => {
      if (stopped) return;
      intentionalStop = true;
      stopped = true;
      if (restartTimer !== undefined) window.clearTimeout(restartTimer);
      try {
        recognition.stop();
      } catch {
        stopFinalized = true;
        cleanupAudio();
        const completeText =
          `${finalBuffer}${latestInterim ? ` ${latestInterim}` : ''}`.trim();
        callbacks.onFinalized?.(completeText);
        callbacks.onEnd();
      }
    },
  };
}

export interface TtsReadbackCallbacks {
  selectedApplicationLanguageCode?: string;
  onStart?: () => void;
  onEnd?: () => void;
  onUnavailable?: (message: string) => void;
  onError?: (message: string) => void;
}

let playbackRequestId = 0;
let pendingVoiceListener: (() => void) | null = null;
let pendingVoiceTimeout: number | undefined;
let voiceChangeObserverInstalled = false;
let voicesChangedEventCount = 0;

const TTS_VOICE_DISCOVERY_TIMEOUT_MS = 3000;

function observeVoiceChanges(): void {
  if (
    !import.meta.env.DEV ||
    voiceChangeObserverInstalled ||
    typeof window === 'undefined' ||
    !('speechSynthesis' in window)
  ) {
    return;
  }
  window.speechSynthesis.addEventListener('voiceschanged', () => {
    voicesChangedEventCount += 1;
  });
  voiceChangeObserverInstalled = true;
}

function logTtsDiagnostics(
  event: string,
  selectedApplicationLanguageCode: string,
  interactionLanguageCode: string,
  requestedLocale: string,
  voices: SpeechSynthesisVoice[],
  selectedVoice?: SpeechSynthesisVoice | null,
  utteranceLanguage?: string,
  errorCode?: string
): void {
  if (!import.meta.env.DEV) return;
  console.info('[VyapaarAI TTS diagnostic]', {
    event,
    selectedApplicationLanguage: selectedApplicationLanguageCode,
    interactionLanguage: interactionLanguageCode,
    requestedTtsLocale: requestedLocale,
    voiceListStatus:
      voicesChangedEventCount > 0
        ? `voiceschanged observed ${voicesChangedEventCount} time(s); API exposes no completion flag`
        : voices.length > 0
        ? 'populated; API exposes no completion flag'
        : 'empty; waiting for SpeechSynthesis voiceschanged',
    voices: voices.map((voice) => ({
      name: voice.name,
      locale: voice.lang,
      localService: voice.localService,
      default: voice.default,
    })),
    tamilCandidates: voices
      .filter((voice) => voice.lang.trim().toLowerCase().split(/[-_]/)[0] === 'ta')
      .map((voice) => ({ name: voice.name, locale: voice.lang })),
    selectedVoice: selectedVoice
      ? { name: selectedVoice.name, locale: selectedVoice.lang }
      : null,
    utteranceLanguage,
    errorCode,
  });
}

function clearPendingVoiceWait(): void {
  if (pendingVoiceListener && typeof window !== 'undefined') {
    window.speechSynthesis.removeEventListener('voiceschanged', pendingVoiceListener);
  }
  pendingVoiceListener = null;
  if (pendingVoiceTimeout !== undefined && typeof window !== 'undefined') {
    window.clearTimeout(pendingVoiceTimeout);
  }
  pendingVoiceTimeout = undefined;
}

export function getCompatibleTtsVoice(langCode: string): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const config = languageRegistry.getByCode(langCode);
  const locale = config?.ttsLangCode ?? langCode;
  const normalizedLocale = locale.trim().toLowerCase().replace(/_/g, '-');
  const base = normalizedLocale.split('-')[0];
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((voice) => voice.lang.trim().toLowerCase().replace(/_/g, '-') === normalizedLocale) ??
    voices.find((voice) => voice.lang.trim().toLowerCase().replace(/_/g, '-').split('-')[0] === base) ??
    null
  );
}

export function speakReadback(
  text: string,
  langCode: string,
  callbacks: TtsReadbackCallbacks = {}
): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    logTtsDiagnostics(
      'speech-synthesis-unavailable',
      callbacks.selectedApplicationLanguageCode ?? langCode,
      langCode,
      languageRegistry.getByCode(langCode)?.ttsLangCode ?? langCode,
      []
    );
    callbacks.onUnavailable?.('Spoken playback is unavailable because this browser does not support speech synthesis. The written response is preserved.');
    return false;
  }

  observeVoiceChanges();
  const config = languageRegistry.getByCode(langCode);
  const locale = config?.ttsLangCode ?? langCode;
  const selectedApplicationLanguageCode =
    callbacks.selectedApplicationLanguageCode ?? langCode;
  let voices = window.speechSynthesis.getVoices();
  let voice = getCompatibleTtsVoice(langCode);
  logTtsDiagnostics(
    'playback-request',
    selectedApplicationLanguageCode,
    langCode,
    locale,
    voices,
    voice,
    locale
  );
  const requestId = ++playbackRequestId;
  clearPendingVoiceWait();
  try {
    window.speechSynthesis.cancel();
  } catch {
    callbacks.onError?.('Existing spoken playback could not be interrupted. The written response remains available.');
    return false;
  }

  const isTamil = langCode.trim().toLowerCase().split(/[-_]/)[0] === 'ta';
  if (isTamil && /[a-z]/i.test(text) && !/[\u0B80-\u0BFF]/.test(text)) {
    logTtsDiagnostics(
      'tanglish-transliteration-unavailable',
      selectedApplicationLanguageCode,
      langCode,
      locale,
      voices,
      voice,
      locale
    );
    callbacks.onUnavailable?.('Tanglish written in Latin script cannot be reliably spoken by the installed Tamil voice. The written response remains available.');
    return false;
  }

  const startPlayback = (voice: SpeechSynthesisVoice) => {
    if (requestId !== playbackRequestId) return;
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = locale;
      utterance.voice = voice;
      utterance.rate = 0.98;
      utterance.pitch = 1;
      utterance.onstart = () => {
        if (requestId !== playbackRequestId) return;
        logTtsDiagnostics(
          'utterance-start',
          selectedApplicationLanguageCode,
          langCode,
          locale,
          window.speechSynthesis.getVoices(),
          voice,
          utterance.lang
        );
        callbacks.onStart?.();
      };
      utterance.onend = () => {
        if (requestId !== playbackRequestId) return;
        logTtsDiagnostics(
          'utterance-end',
          selectedApplicationLanguageCode,
          langCode,
          locale,
          window.speechSynthesis.getVoices(),
          voice,
          utterance.lang
        );
        callbacks.onEnd?.();
      };
      utterance.onerror = (event) => {
        if (requestId === playbackRequestId) {
          logTtsDiagnostics(
            'utterance-error',
            selectedApplicationLanguageCode,
            langCode,
            locale,
            window.speechSynthesis.getVoices(),
            voice,
            utterance.lang,
            event.error
          );
          callbacks.onError?.(`Spoken playback failed (${event.error}). The written response remains available.`);
        }
      };
      logTtsDiagnostics(
        'utterance-queued',
        selectedApplicationLanguageCode,
        langCode,
        locale,
        window.speechSynthesis.getVoices(),
        voice,
        utterance.lang
      );
      window.speechSynthesis.speak(utterance);
    } catch {
      if (requestId === playbackRequestId) {
        callbacks.onError?.('Spoken playback could not start. The written response remains available.');
      }
    }
  };

  if (!voice) {
    const unavailable = () => {
      if (requestId !== playbackRequestId) return;
      clearPendingVoiceWait();
      voices = window.speechSynthesis.getVoices();
      logTtsDiagnostics(
        'no-compatible-voice',
        selectedApplicationLanguageCode,
        langCode,
        locale,
        voices
      );
      callbacks.onUnavailable?.(`No compatible ${config?.name ?? locale} voice is installed. Spoken playback is unavailable; the written response remains available.`);
    };
    pendingVoiceListener = () => {
      if (requestId !== playbackRequestId) return;
      voices = window.speechSynthesis.getVoices();
      const laterVoice = getCompatibleTtsVoice(langCode);
      logTtsDiagnostics(
        'voiceschanged',
        selectedApplicationLanguageCode,
        langCode,
        locale,
        voices,
        laterVoice,
        locale
      );
      if (!laterVoice) return;
      clearPendingVoiceWait();
      startPlayback(laterVoice);
    };
    window.speechSynthesis.addEventListener('voiceschanged', pendingVoiceListener);
    pendingVoiceTimeout = window.setTimeout(unavailable, TTS_VOICE_DISCOVERY_TIMEOUT_MS);
    return false;
  }

  startPlayback(voice);
  return true;
}

export function stopSpeaking(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  playbackRequestId += 1;
  clearPendingVoiceWait();
  try {
    window.speechSynthesis.cancel();
  } catch {
    // ignore
  }
}
