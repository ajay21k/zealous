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
  onNoiseLevel: (rms: number, isNoisy: boolean) => void;
  onError: (message: string) => void;
  onEnd: () => void;
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

  const recognition = new Ctor();
  const langConfig = languageRegistry.getByCode(langCode);
  recognition.lang = langConfig?.browserSttSupported ? langCode : 'en-IN';
  recognition.continuous = false;
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

  recognition.onresult = (event) => {
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
    if (interim) callbacks.onInterim(interim);
    if (finalTranscript.trim()) {
      callbacks.onFinal(finalTranscript.trim(), confidence);
    }
  };

  recognition.onerror = (event) => {
    if (stopped) return;
    if (event.error === 'no-speech') {
      callbacks.onError('No clear speech detected. Please speak closer to the mic or tap again.');
    } else if (event.error === 'not-allowed') {
      callbacks.onError('Microphone permission denied. You can still type or test regional voice samples.');
    } else {
      callbacks.onError(`Speech recognition stopped (${event.error}). You can type or retry.`);
    }
  };

  recognition.onend = () => {
    cleanupAudio();
    if (!stopped) {
      stopped = true;
      callbacks.onEnd();
    }
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
    cleanupAudio();
    callbacks.onError(err instanceof Error ? err.message : 'Unable to start microphone.');
    callbacks.onEnd();
  }

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      cleanupAudio();
      try {
        recognition.stop();
      } catch {
        // ignore
      }
      callbacks.onEnd();
    },
  };
}

export function speakReadback(text: string, langCode: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const config = languageRegistry.getByCode(langCode);
    utterance.lang = config?.ttsLangCode ?? 'en-IN';
    utterance.rate = 0.98;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  } catch {
    // Graceful silent fallback when browser TTS is blocked
  }
}

export function stopSpeaking(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // ignore
  }
}
