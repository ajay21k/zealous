import { useEffect, useId, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  KeyRound,
  Loader2,
  Mic,
  MicOff,
  RotateCcw,
  Send,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  AiApiConfig,
  AiBrainMode,
  checkLocalGeminiProxyStatus,
  loadAiApiConfig,
  LlmStructuredTurn,
  runExternalAiTurn,
  saveAiApiConfig,
} from '../agents/llmProvider';
import {
  buildLocalizedReadback,
  detectVoiceConfirmationDecision,
  processVoiceOrTextCommand,
} from '../agents/voiceAgent';
import { formatINR } from '../domain/formatters';
import { answerBusinessQuery } from '../domain/businessQuery';
import {
  BusinessState,
  ConversationTurn,
  ExpenseCategory,
  PaymentMode,
  ProposalDraft,
} from '../domain/types';
import { languageRegistry, resolveInteractionLanguage } from '../speech/languages';
import {
  ActiveRecognitionSession,
  getBrowserSpeechCapabilities,
  isEditableVoiceShortcutTarget,
  isPushToTalkKey,
  speakReadback,
  startVoiceCapture,
  stopSpeaking,
} from '../speech/speechProvider';
import { ModalDialog } from './ModalDialog';

type VoiceSessionState =
  | 'idle'
  | 'requesting_permission'
  | 'starting'
  | 'listening'
  | 'stopping'
  | 'finalizing_transcript'
  | 'awaiting_verification'
  | 'submitting'
  | 'processing'
  | 'speaking'
  | 'awaiting_confirmation'
  | 'error';

interface WhisperFlowAgentProps {
  state: BusinessState;
  ttsEnabled: boolean;
  onToggleTts: () => void;
  onChangeLanguage: (langCode: string) => void;
  onToggleAutoDetect: () => void;
  onConfirmProposal: (proposal: ProposalDraft) => { ok: boolean; message: string };
}

const QUICK_FLOW_PROMPTS = [
  {
    label: 'Conversational: "5 bags rice"',
    lang: 'en-IN',
    text: '5 bags of rice',
  },
  {
    label: 'Basmati Sale w/ Credit (EN)',
    lang: 'en-IN',
    text: 'Today I sold 50 bags of Basmati rice to Kumar Traders at ₹1,200 per bag. They paid ₹40,000 by bank transfer.',
  },
  {
    label: 'Hinglish Sale',
    lang: 'hi-IN',
    text: 'Aaj Sharma Kirana ko 10 bags cheeni 1850 ke bhav se becha, 10000 cash mila',
  },
  {
    label: 'Tanglish UPI Sale',
    lang: 'ta-IN',
    text: '5 packs nei 640 rupees ku sell panninen UPI payment',
  },
  {
    label: 'Ask Khata Dues',
    lang: 'en-IN',
    text: 'Who owes me money?',
  },
  {
    label: 'Ask Restock Advice',
    lang: 'en-IN',
    text: 'Which products need restocking?',
  },
];

function turnId(): string {
  return `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
}

export function WhisperFlowAgent({
  state,
  ttsEnabled,
  onToggleTts,
  onChangeLanguage,
  onToggleAutoDetect,
  onConfirmProposal,
}: WhisperFlowAgentProps) {
  const [voiceSessionState, setVoiceSessionState] = useState<VoiceSessionState>('idle');
  const [interimText, setInterimText] = useState('');
  const [inputText, setInputText] = useState('');
  const [reviewTranscript, setReviewTranscript] = useState('');
  const [reviewStatus, setReviewStatus] = useState<'NONE' | 'AWAITING_VERIFICATION' | 'EMPTY'>('NONE');
  const [noiseRms, setNoiseRms] = useState(0);
  const [isNoisy, setIsNoisy] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ProposalDraft | null>(null);
  const [history, setHistory] = useState<ConversationTurn[]>([]);
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Optional BYOK AI API config
  const [aiConfig, setAiConfig] = useState<AiApiConfig>(() => loadAiApiConfig());
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [draftAiConfig, setDraftAiConfig] = useState<AiApiConfig>(aiConfig);

  const sessionRef = useRef<ActiveRecognitionSession | null>(null);
  const studioRef = useRef<HTMLElement | null>(null);
  const pttActiveRef = useRef(false);
  const capturedTranscriptRef = useRef('');
  const captureSessionIdRef = useRef(0);
  const submitLockRef = useRef(false);
  const noiseUpdateRef = useRef(0);
  const activeQueryProductIdRef = useRef<string | undefined>(undefined);
  const langSelectId = useId();
  const cmdInputId = useId();

  const capabilities = getBrowserSpeechCapabilities();
  const languages = languageRegistry.list();
  const currentLang = languageRegistry.getByCode(state.profile.preferredLanguage);
  const listening =
    voiceSessionState === 'listening' ||
    voiceSessionState === 'starting' ||
    voiceSessionState === 'requesting_permission';

  useEffect(() => {
    let active = true;
    checkLocalGeminiProxyStatus().then((status) => {
      if (!active || !status.configured) return;
      setAiConfig((prev) => {
        if (prev.mode !== 'builtin' || prev.apiKey.trim()) return prev;
        const next: AiApiConfig = {
          ...prev,
          mode: 'gemini',
          model: status.defaultModel || 'gemini-3.1-flash-lite',
          useLocalProxy: true,
        };
        saveAiApiConfig(next);
        return next;
      });
    });
    return () => {
      active = false;
      sessionRef.current?.stop();
      stopSpeaking();
    };
  }, []);

  const appendTurn = (role: 'user' | 'assistant', text: string) => {
    setHistory((prev) => [
      ...prev.slice(-11),
      { id: turnId(), role, text, timestamp: new Date().toISOString() },
    ]);
  };

  const commitActiveProposal = (target: ProposalDraft) => {
    const res = onConfirmProposal(target);
    if (res.ok) {
      setFeedbackBanner({ type: 'success', text: res.message });
      appendTurn('assistant', res.message);
      if (ttsEnabled) {
        setVoiceSessionState('speaking');
        speakReadback(res.message, target.detectedLanguage, {
          selectedApplicationLanguageCode: state.profile.preferredLanguage,
          onEnd: () => setVoiceSessionState('idle'),
          onError: (message) => {
            setVoiceSessionState('idle');
            setVoiceError(message);
          },
          onUnavailable: (message) => {
            setVoiceSessionState('idle');
            setVoiceError(message);
          },
        });
      } else {
        setVoiceSessionState('idle');
      }
      setProposal(null);
      setInputText('');
    } else {
      setFeedbackBanner({ type: 'error', text: res.message });
    }
  };

  const rejectActiveProposal = () => {
    stopSpeaking();
    setProposal(null);
    setFeedbackBanner({
      type: 'error',
      text: 'Proposal discarded. No business records were modified.',
    });
    appendTurn('assistant', 'Cancelled. Tell me whenever you want to start a new entry.');
  };

  const convertLlmTurnToProposal = (
    llm: LlmStructuredTurn,
    userText: string
  ): ProposalDraft | null => {
    const langCode = llm.detectedLanguageCode || state.profile.preferredLanguage;
    const langName = languageRegistry.getByCode(langCode)?.name ?? langCode;
    const propId = `prop-${Date.now().toString(36)}`;

    if (llm.intent === 'QUERY' || llm.intent === 'CLARIFY') {
      return {
        proposalId: propId,
        intent: llm.intent === 'QUERY' ? 'QUERY_PROFIT_REPORT' : 'CLARIFICATION_NEEDED',
        routedAgents: ['Supervisor Agent', 'AI Conversation Agent', 'Voice Response Agent'],
        confidence: 0.92,
        detectedLanguage: langCode,
        languageName: langName,
        codeSwitched: false,
        originalTranscript: userText,
        source: 'VOICE',
        missingFields: llm.missingFields ?? [],
        warnings: [],
        readbackText: llm.replyInUserLanguage,
        answerText: llm.replyInUserLanguage,
        status: 'ANSWERED',
        createdAt: new Date().toISOString(),
      };
    }

    const matchedProd = llm.productId
      ? state.products.find((p) => p.id === llm.productId)
      : llm.productName
      ? state.products.find(
          (p) => p.name.toLowerCase() === llm.productName!.trim().toLowerCase()
        )
      : undefined;

    const firstExtra = llm.items && llm.items.length > 0 ? llm.items[0] : undefined;
    const resolvedProdName =
      matchedProd?.name ?? llm.productName ?? firstExtra?.productName ?? proposal?.productName;
    const resolvedUnit =
      matchedProd?.unit ?? llm.unit ?? firstExtra?.unit ?? proposal?.unit ?? 'units';
    const qty = llm.quantity ?? firstExtra?.quantity ?? proposal?.quantity;
    const unitPrice = llm.unitPrice ?? firstExtra?.unitPrice ?? proposal?.unitPrice;
    const extraItems =
      llm.items && llm.items.length > 1
        ? llm.items.map((it) => ({
            productId: it.productId ?? undefined,
            productName: it.productName,
            unit: it.unit ?? 'units',
            quantity: it.quantity,
            unitPrice: it.unitPrice,
          }))
        : undefined;

    const totalAmount = extraItems
      ? extraItems.reduce((sum, it) => sum + Math.round(it.quantity * it.unitPrice), 0)
      : qty && unitPrice
      ? Math.round(qty * unitPrice)
      : undefined;
    const amountPaid =
      llm.amountPaid !== undefined && llm.amountPaid !== null
        ? llm.amountPaid
        : proposal?.amountPaid ?? totalAmount;
    const pendingAmount =
      totalAmount !== undefined && amountPaid !== undefined
        ? Math.max(0, totalAmount - amountPaid)
        : undefined;

    const missingFields: string[] = [];
    if (llm.intent === 'RECORD_SALE' || llm.intent === 'RECORD_PURCHASE') {
      if (!resolvedProdName) missingFields.push('Product');
      if (!qty || qty <= 0) missingFields.push('Quantity');
      if (!unitPrice || unitPrice <= 0) missingFields.push('Unit Price');
    } else if (llm.intent === 'RECORD_EXPENSE' || llm.intent === 'RECORD_CUSTOMER_PAYMENT') {
      if (!llm.amountPaid && !llm.unitPrice) missingFields.push('Amount');
    }

    const warnings: string[] = [];
    if (llm.intent === 'RECORD_SALE' && matchedProd && qty && qty > matchedProd.currentStock) {
      warnings.push(
        `Requested ${qty} ${matchedProd.unit} exceeds available stock (${matchedProd.currentStock} ${matchedProd.unit}).`
      );
    }

    const party = llm.partyId
      ? llm.intent === 'RECORD_PURCHASE'
        ? state.suppliers.find((s) => s.id === llm.partyId)
        : state.customers.find((c) => c.id === llm.partyId)
      : undefined;

    return {
      proposalId: propId,
      intent: llm.intent as ProposalDraft['intent'],
      routedAgents: ['Supervisor Agent', 'AI Conversation Agent', 'Audit Agent', 'Voice Response Agent'],
      confidence: 0.94,
      detectedLanguage: langCode,
      languageName: langName,
      codeSwitched: false,
      originalTranscript: userText,
      source: 'VOICE',
      partyId: party?.id,
      partyName:
        party?.name ??
        llm.partyName ??
        (llm.intent === 'RECORD_PURCHASE' ? state.suppliers[0]?.name ?? 'General Supplier' : 'Walk-in Cash Customer'),
      productId: matchedProd?.id,
      productName: resolvedProdName,
      unit: resolvedUnit,
      quantity: qty ?? undefined,
      unitPrice: unitPrice ?? undefined,
      extraItems,
      totalAmount:
        totalAmount ??
        (llm.intent === 'RECORD_EXPENSE' || llm.intent === 'RECORD_CUSTOMER_PAYMENT'
          ? llm.amountPaid ?? undefined
          : undefined),
      amountPaid: amountPaid ?? undefined,
      pendingAmount,
      paymentMode: llm.paymentMode ?? proposal?.paymentMode ?? 'CASH',
      expenseCategory: llm.expenseCategory ?? undefined,
      expenseDescription: llm.expenseDescription ?? userText,
      missingFields,
      warnings,
      readbackText: llm.replyInUserLanguage,
      status: 'PENDING_CONFIRMATION',
      createdAt: new Date().toISOString(),
    };
  };

  const runCommand = async (text: string, overrideLang?: string) => {
    const clean = text.trim();
    if (!clean) return;
    const selectedCode = overrideLang ?? state.profile.preferredLanguage;
    const resolvedLanguage = resolveInteractionLanguage(
      clean,
      selectedCode,
      state.profile.autoDetectLanguage
    );
    setVoiceError(null);
    setFeedbackBanner(null);
    appendTurn('user', clean);
    setInputText('');

    // Fast path: hands-free confirmation / cancellation
    if (proposal && proposal.status === 'PENDING_CONFIRMATION') {
      const decision = detectVoiceConfirmationDecision(clean);
      if (decision === 'CONFIRM') {
        if (proposal.missingFields.length === 0) {
          commitActiveProposal(proposal);
        } else {
          const msg = `Still need ${proposal.missingFields.join(', ')} before confirming.`;
          setFeedbackBanner({ type: 'error', text: msg });
          appendTurn('assistant', msg);
        }
        return;
      }
      if (decision === 'REJECT') {
        rejectActiveProposal();
        return;
      }
    }

    const deterministicQuery = answerBusinessQuery(clean, state, {
      activeProductId: activeQueryProductIdRef.current,
      languageCode: resolvedLanguage.code,
    });
    if (deterministicQuery) {
      activeQueryProductIdRef.current =
        deterministicQuery.productId ?? deterministicQuery.products[0]?.id;
      const queryIntent =
        deterministicQuery.intent === 'LOW_STOCK' ||
        deterministicQuery.intent === 'OUT_OF_STOCK'
          ? 'RESTOCK_ADVICE'
          : deterministicQuery.intent === 'CUSTOMER_OUTSTANDING'
          ? 'QUERY_RECEIVABLES'
          : deterministicQuery.intent === 'INVENTORY_VALUE' ||
            deterministicQuery.intent === 'INVENTORY_OVERVIEW' ||
            deterministicQuery.intent === 'PRODUCT_COUNT'
          ? 'QUERY_PROFIT_REPORT'
          : 'QUERY_STOCK';
      const localizedProp: ProposalDraft = {
        proposalId: `prop-${Date.now().toString(36)}`,
        intent: queryIntent,
        routedAgents: ['Supervisor Agent', 'Inventory Agent', 'Voice Response Agent'],
        confidence: 0.99,
        detectedLanguage: resolvedLanguage.code,
        languageName: resolvedLanguage.name,
        codeSwitched: resolvedLanguage.codeSwitched,
        originalTranscript: clean,
        source: 'VOICE',
        productId: deterministicQuery.productId,
        productName: deterministicQuery.products[0]?.name,
        missingFields: [],
        warnings: [],
        readbackText: deterministicQuery.answer,
        answerText: deterministicQuery.answer,
        status: 'ANSWERED',
        createdAt: new Date().toISOString(),
      };
      setProposal(localizedProp);
      setVoiceSessionState('idle');
      appendTurn('assistant', localizedProp.readbackText);
      if (ttsEnabled) {
        setVoiceSessionState('speaking');
        speakReadback(localizedProp.readbackText, resolvedLanguage.code, {
          selectedApplicationLanguageCode: state.profile.preferredLanguage,
          onEnd: () => setVoiceSessionState('idle'),
          onUnavailable: (message) => {
            setVoiceSessionState('idle');
            setVoiceError(message);
          },
          onError: (message) => {
            setVoiceSessionState('idle');
            setVoiceError(message);
          },
        });
      }
      return;
    }

    // Optional external AI API mode (Gemini local proxy / BYOK or OpenAI-compatible)
    if (aiConfig.mode !== 'builtin' && (aiConfig.useLocalProxy || aiConfig.apiKey.trim())) {
      setVoiceSessionState('processing');
      try {
        const llmTurn = await runExternalAiTurn(
          aiConfig,
          clean,
          history,
          proposal,
          state,
          { code: resolvedLanguage.code, autoDetect: state.profile.autoDetectLanguage }
        );
        if (llmTurn.intent === 'CONFIRM' && proposal?.status === 'PENDING_CONFIRMATION') {
          if (proposal.missingFields.length === 0) {
            commitActiveProposal(proposal);
          } else {
            appendTurn('assistant', llmTurn.replyInUserLanguage);
            setVoiceSessionState('awaiting_confirmation');
          }
          return;
        }
        if (llmTurn.intent === 'REJECT' && proposal?.status === 'PENDING_CONFIRMATION') {
          rejectActiveProposal();
          return;
        }
        const nextProp = convertLlmTurnToProposal(llmTurn, clean);
        if (nextProp) {
          const localizedProp = {
            ...nextProp,
            detectedLanguage: resolvedLanguage.code,
            languageName: resolvedLanguage.name,
            codeSwitched:
              resolvedLanguage.codeSwitched || nextProp.codeSwitched,
          };
          setProposal(localizedProp);
          if (localizedProp.status === 'PENDING_CONFIRMATION') {
            setVoiceSessionState('awaiting_confirmation');
          }
          appendTurn('assistant', localizedProp.readbackText);
          if (ttsEnabled) {
            setVoiceSessionState('speaking');
            speakReadback(localizedProp.readbackText, resolvedLanguage.code, {
              selectedApplicationLanguageCode: state.profile.preferredLanguage,
              onEnd: () => setVoiceSessionState(localizedProp.status === 'PENDING_CONFIRMATION' ? 'awaiting_confirmation' : 'idle'),
              onError: (message) => {
                setVoiceSessionState(localizedProp.status === 'PENDING_CONFIRMATION' ? 'awaiting_confirmation' : 'idle');
                setVoiceError(message);
              },
              onUnavailable: (message) => {
                setVoiceSessionState(localizedProp.status === 'PENDING_CONFIRMATION' ? 'awaiting_confirmation' : 'idle');
                setVoiceError(message);
              },
            });
          }
        }
        return;
      } catch (err) {
        setVoiceSessionState('error');
        setVoiceError(
          `${err instanceof Error ? err.message : 'AI API failed'} — falling back to built-in Whisper-Flow parser.`
        );
      }
    }

    // Built-in deterministic multi-turn conversational parser
    const nextProposal = processVoiceOrTextCommand(clean, state, {
      preferredLangCode: resolvedLanguage.code,
      autoDetectLanguage: false,
      activeProposal: proposal,
      activeQueryProductId: activeQueryProductIdRef.current,
    });
    const localizedProposal = {
      ...nextProposal,
      detectedLanguage: resolvedLanguage.code,
      languageName: resolvedLanguage.name,
      codeSwitched: resolvedLanguage.codeSwitched || nextProposal.codeSwitched,
    };
    setProposal(localizedProposal);
    if (localizedProposal.status === 'PENDING_CONFIRMATION') {
      setVoiceSessionState('awaiting_confirmation');
    } else {
      setVoiceSessionState('idle');
    }
    appendTurn('assistant', localizedProposal.readbackText);
    if (ttsEnabled) {
      setVoiceSessionState('speaking');
      speakReadback(localizedProposal.readbackText, resolvedLanguage.code, {
        selectedApplicationLanguageCode: state.profile.preferredLanguage,
        onEnd: () => setVoiceSessionState(localizedProposal.status === 'PENDING_CONFIRMATION' ? 'awaiting_confirmation' : 'idle'),
        onError: (message) => {
          setVoiceSessionState(localizedProposal.status === 'PENDING_CONFIRMATION' ? 'awaiting_confirmation' : 'idle');
          setVoiceError(message);
        },
        onUnavailable: (message) => {
          setVoiceSessionState(localizedProposal.status === 'PENDING_CONFIRMATION' ? 'awaiting_confirmation' : 'idle');
          setVoiceError(message);
        },
      });
    }
  };

  const finalizeCapture = () => {
    if (
      voiceSessionState !== 'listening' &&
      voiceSessionState !== 'starting' &&
      voiceSessionState !== 'requesting_permission'
    ) {
      return;
    }
    setVoiceSessionState('stopping');
    setInterimText('');
    sessionRef.current?.stop();
  };

  const submitVerifiedTranscript = async () => {
    const verified = reviewTranscript.trim();
    if (!verified || submitLockRef.current) return;
    submitLockRef.current = true;
    setVoiceSessionState('submitting');
    try {
      await runCommand(verified);
    } finally {
      submitLockRef.current = false;
      setReviewStatus('NONE');
      setReviewTranscript('');
    }
  };

  const submitTypedText = async () => {
    const text = inputText.trim();
    if (!text || submitLockRef.current) return;
    submitLockRef.current = true;
    setVoiceSessionState('submitting');
    try {
      await runCommand(text);
    } finally {
      submitLockRef.current = false;
      setInputText('');
    }
  };

  const toggleMicrophone = () => {
    if (listening) {
      finalizeCapture();
      return;
    }
    if (sessionRef.current) return;

    const resolvedLanguage = resolveInteractionLanguage(
      '',
      state.profile.preferredLanguage,
      state.profile.autoDetectLanguage
    );
    if (!resolvedLanguage.browserRecognitionSupported) {
      setVoiceSessionState('error');
      setVoiceError(
        `${resolvedLanguage.name} live browser recognition is not supported by this browser. Written input remains available.`
      );
      return;
    }

    setVoiceError(null);
    setInterimText('');
    setVoiceSessionState('requesting_permission');
    capturedTranscriptRef.current = '';
    const sessionId = ++captureSessionIdRef.current;

    const recognitionCode = resolvedLanguage.recognitionCode;
    sessionRef.current = startVoiceCapture(recognitionCode, {
      onInterim: (text) => setInterimText(text),
      onStart: () => {
        if (captureSessionIdRef.current !== sessionId) return;
        setVoiceSessionState('starting');
      },
      onFinal: (text, _confidence) => {
        if (captureSessionIdRef.current !== sessionId) return;
        setInterimText('');
        capturedTranscriptRef.current =
          `${capturedTranscriptRef.current} ${text}`.trim();
      },
      onNoiseLevel: (rms, noisy) => {
        const now = Date.now();
        if (now - noiseUpdateRef.current < 120) return;
        noiseUpdateRef.current = now;
        setNoiseRms((current) =>
          Math.abs(current - rms) < 0.03 ? current : rms
        );
        setIsNoisy(noisy);
      },
      onAborted: (message) => {
        if (captureSessionIdRef.current !== sessionId) return;
        setVoiceSessionState('error');
        setVoiceError(message);
      },
      onFinalized: (text) => {
        if (captureSessionIdRef.current !== sessionId) return;
        const complete =
          text.trim() || capturedTranscriptRef.current.trim();
        setInterimText('');
        setNoiseRms(0);
        setIsNoisy(false);
        if (complete) {
          setReviewTranscript(complete);
          setReviewStatus('AWAITING_VERIFICATION');
        } else {
          setReviewTranscript('');
          setReviewStatus('EMPTY');
        }
        setVoiceSessionState('awaiting_verification');
        sessionRef.current = null;
      },
      onError: (msg) => {
        setVoiceSessionState('error');
        setVoiceError(msg);
      },
      onEnd: () => {
        if (captureSessionIdRef.current !== sessionId) return;
        setNoiseRms(0);
        setIsNoisy(false);
        sessionRef.current = null;
      },
      onUnexpectedEnd: (message) => {
        setVoiceError(message);
        setVoiceSessionState('listening');
      },
      onMaxDuration: (message) => {
        setVoiceSessionState('idle');
        setVoiceError(message);
      },
    });
    setVoiceSessionState('listening');
  };

  useEffect(() => {
    const isEditable = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      isEditableVoiceShortcutTarget(target.tagName, target.isContentEditable);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !isPushToTalkKey(event.key, event.ctrlKey, event.altKey, event.metaKey) ||
        isEditable(event.target) ||
        event.repeat
      ) {
        return;
      }
      event.preventDefault();
      if (!pttActiveRef.current && !sessionRef.current) {
        pttActiveRef.current = true;
        toggleMicrophone();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'q') return;
      if (!pttActiveRef.current) return;
      event.preventDefault();
      pttActiveRef.current = false;
      finalizeCapture();
    };

    const handleBlur = () => {
      if (!pttActiveRef.current) return;
      pttActiveRef.current = false;
      finalizeCapture();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [listening]);

  const updateProposalField = (patch: Partial<ProposalDraft>) => {
    if (!proposal) return;
    const updated: ProposalDraft = { ...proposal, ...patch };

    if (updated.intent === 'RECORD_SALE' || updated.intent === 'RECORD_PURCHASE') {
      const qty = updated.quantity ?? 0;
      const price = updated.unitPrice ?? 0;
      if (qty > 0 && price > 0) {
        updated.totalAmount = Math.round(qty * price);
        const paid = Math.min(updated.totalAmount, Math.max(0, updated.amountPaid ?? 0));
        updated.amountPaid = paid;
        updated.pendingAmount = Math.max(0, updated.totalAmount - paid);
      }
      updated.missingFields = [];
      if (!updated.productId && !(updated.productName ?? '').trim()) {
        updated.missingFields.push('Product');
      }
      if (!updated.quantity || updated.quantity <= 0) updated.missingFields.push('Quantity');
      if (!updated.unitPrice || updated.unitPrice <= 0) updated.missingFields.push('Unit Price');

      updated.warnings = [];
      if (updated.intent === 'RECORD_SALE' && updated.productId && updated.quantity) {
        const prod = state.products.find((p) => p.id === updated.productId);
        if (prod && updated.quantity > prod.currentStock) {
          updated.warnings.push(
            `Requested ${updated.quantity} ${prod.unit} exceeds available stock (${prod.currentStock} ${prod.unit}).`
          );
        }
      }
    }

    if (updated.intent === 'RECORD_EXPENSE' || updated.intent === 'RECORD_CUSTOMER_PAYMENT') {
      updated.missingFields = [];
      if (!updated.totalAmount || updated.totalAmount <= 0) {
        updated.missingFields.push('Amount');
      }
    }

    updated.readbackText = buildLocalizedReadback(updated);
    setProposal(updated);
  };

  const flowStep = listening
    ? 2
    : proposal?.status === 'PENDING_CONFIRMATION'
    ? 3
    : feedbackBanner?.type === 'success'
    ? 4
    : 1;

  const waveHeights = [0.4, 0.75, 1, 0.65, 0.9, 0.55, 0.7].map((mult) =>
    listening ? Math.max(5, Math.round(6 + noiseRms * 18 * mult)) : 6
  );

  const brainLabel =
    aiConfig.mode === 'gemini' && (aiConfig.useLocalProxy || aiConfig.apiKey)
      ? `Reasoning: Gemini (${aiConfig.model})`
      : aiConfig.mode === 'openai-compatible' && aiConfig.apiKey
      ? 'Reasoning: Custom LLM API'
      : 'Reasoning: Built-in (Offline)';

  return (
    <>
      <section
        ref={studioRef}
        className="whisper-studio"
        aria-label="Whisper-Flow Voice Business Agent"
      >
        <div className="whisper-top-row">
          <div className="whisper-brand">
            <div className={`whisper-orb ${listening ? 'is-listening' : ''}`} aria-hidden="true">
              {listening ? <MicOff size={20} /> : <Mic size={20} />}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '1.02rem', color: 'var(--ink-primary)' }}>
                  Whisper-Flow Voice Agent
                </strong>
                <span className="badge badge-blue">
                  <Sparkles size={11} aria-hidden="true" />
                  {capabilities.sttAvailable
                    ? 'Whisper-Flow STT & TTS + Gemini Reasoning'
                    : 'Whisper-Flow TTS + Multi-Turn Reasoning'}
                </span>
              </div>
              <div className="whisper-flow-steps" style={{ marginTop: '0.25rem' }}>
                <span className={`whisper-step ${flowStep === 1 ? 'is-active' : 'is-done'}`}>
                  1. Speak / Type
                </span>
                <span aria-hidden="true">→</span>
                <span className={`whisper-step ${flowStep === 2 ? 'is-active' : flowStep > 2 ? 'is-done' : ''}`}>
                  2. Clarify Slots
                </span>
                <span aria-hidden="true">→</span>
                <span className={`whisper-step ${flowStep === 3 ? 'is-active' : flowStep > 3 ? 'is-done' : ''}`}>
                  3. Readback &amp; Verify
                </span>
                <span aria-hidden="true">→</span>
                <span className={`whisper-step ${flowStep === 4 ? 'is-done' : ''}`}>
                  4. Commit Ledger
                </span>
              </div>
            </div>
          </div>

          <div className="toolbar-group">
            <div className="whisper-wave" aria-hidden="true" title="Voice activity level">
              {waveHeights.map((h, i) => (
                <span
                  key={i}
                  style={{
                    height: `${h}px`,
                    background: isNoisy && listening ? 'var(--danger-text)' : 'var(--brand-primary)',
                  }}
                />
              ))}
            </div>

            <button
              type="button"
              className={`btn btn-sm ${
                aiConfig.mode !== 'builtin' && (aiConfig.useLocalProxy || aiConfig.apiKey)
                  ? 'btn-soft-blue'
                  : 'btn-secondary'
              }`}
              onClick={() => {
                setDraftAiConfig(aiConfig);
                setAiModalOpen(true);
              }}
            >
              <KeyRound size={14} aria-hidden="true" />
              {brainLabel}
            </button>

            <label htmlFor={langSelectId} className="visually-hidden">
              Preferred Speech Language
            </label>
            <select
              id={langSelectId}
              value={state.profile.preferredLanguage}
              onChange={(e) => {
                if (listening) finalizeCapture();
                onChangeLanguage(e.target.value);
              }}
              style={{ width: 'auto', minWidth: '170px', minBlockSize: '40px' }}
            >
              {languages.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name} ({l.nativeName}){!l.nluPrototypeSupported ? ' [Adapter required]' : ''}
                  {!l.browserSttSupported ? ' [No browser STT configured]' : ''}
                </option>
              ))}
            </select>

            <button
              type="button"
              className={`btn btn-sm ${state.profile.autoDetectLanguage ? 'btn-soft-blue' : 'btn-secondary'}`}
              onClick={onToggleAutoDetect}
              aria-pressed={state.profile.autoDetectLanguage}
            >
              Auto-Detect: {state.profile.autoDetectLanguage ? 'ON' : 'OFF'}
            </button>

            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={onToggleTts}
              aria-pressed={ttsEnabled}
              aria-label={ttsEnabled ? 'Mute spoken readback' : 'Enable spoken readback'}
            >
              {ttsEnabled ? <Volume2 size={15} aria-hidden="true" /> : <VolumeX size={15} aria-hidden="true" />}
              {ttsEnabled ? 'Readback ON' : 'Muted'}
            </button>
          </div>
        </div>

        <p className="text-muted" role="note">
          Browser speech recognition and installed playback voices vary by device. Language entries indicate prototype eligibility only; each capability is checked when used.
        </p>

        {currentLang && !currentLang.nluPrototypeSupported && aiConfig.mode === 'builtin' && !aiConfig.useLocalProxy && (
          <div className="alert-banner alert-warn" role="status">
            <AlertCircle size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong>{currentLang.name}</strong> is not active in the offline built-in parser.
              Connect a Gemini/OpenAI API key above or switch to Hindi, Tamil, Telugu, Kannada,
              Malayalam, Bengali, Marathi, Gujarati, Punjabi, or English.
            </div>
          </div>
        )}

        {/* Active Conversation Thread */}
        {history.length > 0 && (
          <div className="wf-chat-log" aria-label="Whisper-Flow conversation history">
            {history.map((turn) => (
              <div
                key={turn.id}
                className={`wf-bubble ${turn.role === 'user' ? 'is-user' : 'is-assistant'}`}
              >
                {turn.text}
              </div>
            ))}
            {voiceSessionState === 'processing' && (
              <div className="wf-bubble is-assistant" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                <Loader2 size={14} aria-hidden="true" />
                <span>Thinking…</span>
              </div>
            )}
          </div>
        )}

        {/* Speak + Input Row */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitTypedText();
          }}
          style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}
        >
          <button
            type="button"
            className={`btn ${listening ? 'btn-danger-outline' : 'btn-primary'}`}
            onClick={toggleMicrophone}
            style={{ minBlockSize: '46px', paddingInline: '1.1rem' }}
            title="Click to toggle listening. Desktop shortcut: hold Q."
          >
            {listening ? <MicOff size={18} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
            {listening ? 'Stop Mic' : 'Tap to Speak'}
          </button>

          <label htmlFor={cmdInputId} className="visually-hidden">
            Voice transcript or reply
          </label>
          <input
            id={cmdInputId}
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
            }}
            placeholder={
              proposal?.status === 'PENDING_CONFIRMATION' && proposal.missingFields.length > 0
                ? `Reply with missing ${proposal.missingFields.join(' / ')} (e.g. "Basmati at 1200")...`
                : proposal?.status === 'PENDING_CONFIRMATION'
                ? 'Say "confirm" / "haan", "cancel", or a correction like "make it 40 bags"...'
                : 'Try "5 bags of rice" to test multi-turn follow-up, or speak a full sale...'
            }
            style={{ flex: '1 1 280px', minBlockSize: '46px' }}
          />

          <button
            type="submit"
            disabled={
              voiceSessionState === 'processing' ||
              voiceSessionState === 'submitting' ||
              submitLockRef.current
            }
            className="btn btn-soft-blue"
            style={{ minBlockSize: '46px' }}
          >
            <Send size={16} aria-hidden="true" />
            Send
          </button>

          {history.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                stopSpeaking();
                setHistory([]);
                setProposal(null);
                setFeedbackBanner(null);
                setVoiceSessionState(listening ? 'listening' : 'idle');
              }}
            >
              Clear Chat
            </button>
          )}
        </form>

        {listening && interimText && (
          <div className="interim-transcript" aria-live="polite">
            <span>Recognizing:</span> {interimText}
          </div>
        )}

        <div className="voice-state-row" role="status" aria-live="polite">
          <span className={`voice-state-dot is-${voiceSessionState}`} aria-hidden="true" />
          <span>
            {voiceSessionState === 'idle' && 'Idle'}
            {voiceSessionState === 'requesting_permission' && 'Requesting microphone permission'}
            {voiceSessionState === 'starting' && 'Starting microphone'}
            {voiceSessionState === 'listening' && 'Listening — pauses do not end the session'}
            {voiceSessionState === 'stopping' && 'Stopping capture'}
            {voiceSessionState === 'finalizing_transcript' && 'Finalizing transcript'}
            {voiceSessionState === 'awaiting_verification' && 'Awaiting transcript verification'}
            {voiceSessionState === 'submitting' && 'Submitting verified transcript'}
            {voiceSessionState === 'processing' && 'Processing transcript'}
            {voiceSessionState === 'speaking' && 'Speaking response'}
            {voiceSessionState === 'awaiting_confirmation' && 'Awaiting confirmation'}
            {voiceSessionState === 'error' && 'Voice session needs attention'}
          </span>
          {voiceSessionState === 'speaking' && (
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => {
                stopSpeaking();
                setVoiceSessionState(proposal?.status === 'PENDING_CONFIRMATION' ? 'awaiting_confirmation' : 'idle');
              }}
            >
              <VolumeX size={14} aria-hidden="true" />
              Stop speech
            </button>
          )}
          <span className="shortcut-hint">Desktop: hold Q to talk</span>
        </div>

        {reviewStatus !== 'NONE' && (
          <section
            className="transcript-review"
            aria-labelledby="transcript-review-title"
          >
            <div className="transcript-review-header">
              <div>
                <strong id="transcript-review-title">Transcript verification</strong>
                <div className="field-hint">
                  {reviewStatus === 'EMPTY'
                    ? 'No usable speech was recognized.'
                    : 'Awaiting verification'}
                </div>
              </div>
              {reviewStatus === 'AWAITING_VERIFICATION' && (
                <span className="badge badge-warn">Not sent to AI</span>
              )}
            </div>
            {reviewStatus === 'AWAITING_VERIFICATION' ? (
              <textarea
                aria-label="Recognized transcript to review"
                value={reviewTranscript}
                onChange={(e) => setReviewTranscript(e.target.value)}
                rows={3}
              />
            ) : (
              <div className="alert-banner alert-warn">
                <AlertCircle size={16} aria-hidden="true" />
                <span>No usable transcript was captured. Speak again or type a message below.</span>
              </div>
            )}
            <div className="transcript-review-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setReviewStatus('NONE');
                  setReviewTranscript('');
                  setVoiceSessionState('idle');
                }}
              >
                Discard
              </button>
              {reviewStatus === 'AWAITING_VERIFICATION' && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={
                    !reviewTranscript.trim() ||
                    submitLockRef.current ||
                    voiceSessionState === 'submitting'
                  }
                  onClick={() => void submitVerifiedTranscript()}
                >
                  <Send size={16} aria-hidden="true" />
                  Send
                </button>
              )}
            </div>
          </section>
        )}

        {/* Quick Flow Presets */}
        <div className="chip-row" aria-label="Sample multilingual voice commands">
          {QUICK_FLOW_PROMPTS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="chip-btn"
              onClick={() => {
                onChangeLanguage(preset.lang);
                setProposal(null);
                void runCommand(preset.text, preset.lang);
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {isNoisy && listening && (
          <div className="alert-banner alert-warn" role="status">
            <AlertCircle size={16} aria-hidden="true" />
            <span>High background noise detected — please speak clearly or verify extracted fields.</span>
          </div>
        )}

        {voiceError && (
          <div className="alert-banner alert-warn" role="alert">
            <AlertCircle size={16} aria-hidden="true" />
            <span>{voiceError}</span>
          </div>
        )}

        {feedbackBanner && (
          <div
            className={`alert-banner ${
              feedbackBanner.type === 'success' ? 'alert-success' : 'alert-danger'
            }`}
            role="status"
          >
            <span>{feedbackBanner.text}</span>
          </div>
        )}

        {/* Structured Proposal Review & Brand Disambiguation Card */}
        {proposal && (
          <div className="proposal-box" aria-live="polite">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                <span className="badge badge-blue">{proposal.intent.replace(/_/g, ' ')}</span>
                <span className="badge badge-neutral">{proposal.languageName}</span>
                {proposal.codeSwitched && <span className="badge badge-warn">Code-switched</span>}
              </div>
              <span style={{ fontSize: '0.73rem', color: 'var(--ink-muted)' }}>
                Agents: {proposal.routedAgents.join(' → ')}
              </span>
            </div>

            <div className="readback-quote">
              <div>{proposal.readbackText}</div>
              {capabilities.ttsAvailable && (
                <button
                  type="button"
                  className="btn btn-sm btn-soft-blue"
                  style={{ marginTop: '0.45rem' }}
                  onClick={() => {
                    setVoiceSessionState('speaking');
                    speakReadback(proposal.readbackText, proposal.detectedLanguage, {
                      selectedApplicationLanguageCode: state.profile.preferredLanguage,
                      onEnd: () => setVoiceSessionState(proposal.status === 'PENDING_CONFIRMATION' ? 'awaiting_confirmation' : 'idle'),
                      onError: (message) => {
                        setVoiceSessionState(proposal.status === 'PENDING_CONFIRMATION' ? 'awaiting_confirmation' : 'idle');
                        setVoiceError(message);
                      },
                      onUnavailable: (message) => {
                        setVoiceSessionState(proposal.status === 'PENDING_CONFIRMATION' ? 'awaiting_confirmation' : 'idle');
                        setVoiceError(message);
                      },
                    });
                  }}
                >
                  <Volume2 size={14} aria-hidden="true" />
                  Replay Readback
                </button>
              )}
            </div>

            {/* 1-Tap Brand/Variety Disambiguation Chips */}
            {proposal.ambiguousProducts && proposal.ambiguousProducts.length > 1 && !proposal.productId && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--brand-dark)' }}>
                  Tap a matching brand/variety (or say its name):
                </span>
                <div className="chip-row">
                  {proposal.ambiguousProducts.map((cand) => (
                    <button
                      key={cand.id}
                      type="button"
                      className="btn btn-sm btn-soft-blue"
                      onClick={() => {
                        appendTurn('user', cand.name);
                        const next = {
                          ...proposal,
                          productId: cand.id,
                          productName: cand.name,
                          unit: cand.unit,
                          ambiguousProducts: undefined,
                        };
                        const missing = next.missingFields.filter((f) => !f.includes('Product'));
                        next.missingFields = missing;
                        next.readbackText = buildLocalizedReadback(next);
                        setProposal(next);
                        appendTurn('assistant', next.readbackText);
                        if (ttsEnabled) {
                          setVoiceSessionState('speaking');
                          speakReadback(next.readbackText, next.detectedLanguage, {
                            selectedApplicationLanguageCode: state.profile.preferredLanguage,
                            onEnd: () => setVoiceSessionState('awaiting_confirmation'),
                            onUnavailable: (message) => {
                              setVoiceSessionState('awaiting_confirmation');
                              setVoiceError(message);
                            },
                            onError: (message) => {
                              setVoiceSessionState('awaiting_confirmation');
                              setVoiceError(message);
                            },
                          });
                        }
                      }}
                    >
                      {cand.name} (Stock: {cand.currentStock} {cand.unit} · Ref ₹{cand.defaultSellPrice})
                    </button>
                  ))}
                </div>
              </div>
            )}

            {proposal.warnings.length > 0 && (
              <div className="alert-banner alert-danger">
                <AlertCircle size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
                <span>{proposal.warnings.join(' ')}</span>
              </div>
            )}

            {proposal.missingFields.length > 0 && proposal.intent !== 'CLARIFICATION_NEEDED' && (
              <div className="alert-banner alert-warn">
                <AlertCircle size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
                <span>
                  <strong>Waiting for details:</strong> {proposal.missingFields.join(', ')}. Reply
                  by voice/text above or edit the fields below.
                </span>
              </div>
            )}

            {(proposal.intent === 'RECORD_SALE' || proposal.intent === 'RECORD_PURCHASE') && (
              <div className="form-grid" style={{ gap: '0.55rem' }}>
                <div className="three-col-grid" style={{ gap: '0.55rem' }}>
                  <div className="field">
                    <label htmlFor="wf-product">
                      Product (Any Item){' '}
                      {!proposal.productId && proposal.productName ? (
                        <span className="badge badge-blue">New Item</span>
                      ) : null}
                    </label>
                    <input
                      id="wf-product"
                      type="text"
                      list="wf-product-list"
                      value={proposal.productName ?? ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        const prod = state.products.find(
                          (p) => p.name.toLowerCase() === val.trim().toLowerCase()
                        );
                        updateProposalField({
                          productId: prod?.id,
                          productName: prod?.name ?? val,
                          unit: prod?.unit ?? proposal.unit ?? 'units',
                          ambiguousProducts: undefined,
                        });
                      }}
                      placeholder="Type any product name..."
                    />
                    <datalist id="wf-product-list">
                      {state.products.map((p) => (
                        <option key={p.id} value={p.name}>
                          Stock: {p.currentStock} {p.unit}
                        </option>
                      ))}
                    </datalist>
                  </div>

                  <div className="field">
                    <label htmlFor="wf-party">
                      {proposal.intent === 'RECORD_SALE' ? 'Customer (Any Name)' : 'Supplier (Any Name)'}
                    </label>
                    <input
                      id="wf-party"
                      type="text"
                      list="wf-party-list"
                      value={proposal.partyName ?? ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        const list =
                          proposal.intent === 'RECORD_SALE' ? state.customers : state.suppliers;
                        const found = list.find(
                          (x) => x.name.toLowerCase() === val.trim().toLowerCase()
                        );
                        updateProposalField({ partyId: found?.id, partyName: found?.name ?? val });
                      }}
                      placeholder="Type any customer or supplier..."
                    />
                    <datalist id="wf-party-list">
                      {(proposal.intent === 'RECORD_SALE' ? state.customers : state.suppliers).map(
                        (party) => (
                          <option key={party.id} value={party.name} />
                        )
                      )}
                    </datalist>
                  </div>

                  <div className="field">
                    <label htmlFor="wf-mode">Payment Mode (Any)</label>
                    <input
                      id="wf-mode"
                      type="text"
                      list="wf-mode-list"
                      value={proposal.paymentMode ?? 'CASH'}
                      onChange={(e) =>
                        updateProposalField({ paymentMode: e.target.value as PaymentMode })
                      }
                      placeholder="Cash, UPI, Paytm, Card, Credit..."
                    />
                    <datalist id="wf-mode-list">
                      <option value="CASH" />
                      <option value="UPI" />
                      <option value="BANK_TRANSFER" />
                      <option value="CHEQUE" />
                      <option value="CREDIT" />
                      <option value="Card" />
                      <option value="Split Cash + UPI" />
                    </datalist>
                  </div>
                </div>

                <div className="three-col-grid" style={{ gap: '0.55rem' }}>
                  <div className="field">
                    <label htmlFor="wf-qty">Quantity</label>
                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                      <input
                        id="wf-qty"
                        type="number"
                        min={1}
                        value={proposal.quantity ?? ''}
                        onChange={(e) =>
                          updateProposalField({ quantity: Number(e.target.value) || 0 })
                        }
                      />
                      <input
                        aria-label="Unit"
                        type="text"
                        list="wf-unit-list"
                        value={proposal.unit ?? 'units'}
                        onChange={(e) => updateProposalField({ unit: e.target.value })}
                        style={{ maxWidth: '105px' }}
                        placeholder="unit"
                      />
                      <datalist id="wf-unit-list">
                        <option value="bags" />
                        <option value="kg" />
                        <option value="g" />
                        <option value="boxes" />
                        <option value="packets" />
                        <option value="litres" />
                        <option value="tins" />
                        <option value="pieces" />
                        <option value="dozens" />
                        <option value="crates" />
                      </datalist>
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor="wf-price">Unit Price (₹)</label>
                    <input
                      id="wf-price"
                      type="number"
                      min={0}
                      value={proposal.unitPrice ?? ''}
                      onChange={(e) =>
                        updateProposalField({ unitPrice: Number(e.target.value) || 0 })
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="wf-paid">Amount Paid (₹)</label>
                    <input
                      id="wf-paid"
                      type="number"
                      min={0}
                      max={proposal.totalAmount ?? undefined}
                      value={proposal.amountPaid ?? 0}
                      onChange={(e) =>
                        updateProposalField({ amountPaid: Number(e.target.value) || 0 })
                      }
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', fontWeight: 700 }}>
                  <span>Total: {formatINR(proposal.totalAmount ?? 0)}</span>
                  <span style={{ color: 'var(--warn-text)' }}>
                    Pending Balance: {formatINR(proposal.pendingAmount ?? 0)}
                  </span>
                </div>
              </div>
            )}

            {proposal.intent === 'RECORD_EXPENSE' && (
              <div className="form-row-2" style={{ gap: '0.55rem' }}>
                <div className="field">
                  <label htmlFor="wf-exp-cat">Expense Category (Any)</label>
                  <input
                    id="wf-exp-cat"
                    type="text"
                    list="wf-exp-cat-list"
                    value={proposal.expenseCategory ?? 'Other'}
                    onChange={(e) =>
                      updateProposalField({ expenseCategory: e.target.value as ExpenseCategory })
                    }
                    placeholder="Type any category..."
                  />
                  <datalist id="wf-exp-cat-list">
                    <option value="Rent" />
                    <option value="Salaries" />
                    <option value="Transport" />
                    <option value="Electricity" />
                    <option value="Maintenance" />
                    <option value="Packaging" />
                    <option value="Staff Tea & Snacks" />
                    <option value="GST / Tax" />
                    <option value="Other" />
                  </datalist>
                </div>
                <div className="field">
                  <label htmlFor="wf-exp-amt">Amount (₹)</label>
                  <input
                    id="wf-exp-amt"
                    type="number"
                    min={1}
                    value={proposal.totalAmount ?? ''}
                    onChange={(e) =>
                      updateProposalField({ totalAmount: Number(e.target.value) || 0 })
                    }
                  />
                </div>
              </div>
            )}

            {proposal.intent === 'RECORD_CUSTOMER_PAYMENT' && (
              <div className="form-row-2" style={{ gap: '0.55rem' }}>
                <div className="field">
                  <label htmlFor="wf-pay-cust">Customer</label>
                  <input
                    id="wf-pay-cust"
                    type="text"
                    list="wf-pay-cust-list"
                    value={proposal.partyName ?? ''}
                    onChange={(e) => {
                      const c = state.customers.find(
                        (x) => x.name.toLowerCase() === e.target.value.trim().toLowerCase()
                      );
                      updateProposalField({ partyId: c?.id, partyName: c?.name ?? e.target.value });
                    }}
                  />
                  <datalist id="wf-pay-cust-list">
                    {state.customers.map((c) => (
                      <option key={c.id} value={c.name} />
                    ))}
                  </datalist>
                </div>
                <div className="field">
                  <label htmlFor="wf-pay-amt">Amount Received (₹)</label>
                  <input
                    id="wf-pay-amt"
                    type="number"
                    min={1}
                    value={proposal.totalAmount ?? ''}
                    onChange={(e) =>
                      updateProposalField({
                        totalAmount: Number(e.target.value) || 0,
                        amountPaid: Number(e.target.value) || 0,
                      })
                    }
                  />
                </div>
              </div>
            )}

            {proposal.status === 'PENDING_CONFIRMATION' ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
                  {proposal.missingFields.length > 0
                    ? 'Reply naturally above to fill missing details.'
                    : 'Click Confirm or say "confirm" / "haan" / "cancel".'}
                </span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={rejectActiveProposal}>
                    <RotateCcw size={14} aria-hidden="true" />
                    Reject
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={proposal.missingFields.length > 0 || proposal.warnings.length > 0}
                    onClick={() => commitActiveProposal(proposal)}
                  >
                    <Check size={14} aria-hidden="true" />
                    Confirm &amp; Commit
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setProposal(null)}>
                  Dismiss
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Optional AI API Connector Modal (BYOK) */}
      <ModalDialog
        open={aiModalOpen}
        onClose={() => setAiModalOpen(false)}
        title="Whisper-Flow Conversational AI Brain"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setAiConfig(draftAiConfig);
            saveAiApiConfig(draftAiConfig);
            setAiModalOpen(false);
          }}
          className="form-grid"
        >
          <div className="alert-banner alert-info">
            <div>
              <strong>Bring Your Own Key (Optional):</strong> Your API key is saved only in this
              browser tab&apos;s <code>sessionStorage</code> and cleared when the tab closes. All
              financial calculations and commits still pass through the deterministic ledger engine.
            </div>
          </div>

          <div className="field">
            <label htmlFor="ai-mode">Conversation Engine</label>
            <select
              id="ai-mode"
              autoFocus
              value={draftAiConfig.mode}
              onChange={(e) => {
                const mode = e.target.value as AiBrainMode;
                setDraftAiConfig({
                  ...draftAiConfig,
                  mode,
                  model:
                    mode === 'gemini'
                      ? 'gemini-3.1-flash-lite'
                      : mode === 'openai-compatible'
                      ? 'gpt-4o-mini'
                      : draftAiConfig.model,
                });
              }}
            >
              <option value="builtin">Built-in Multilingual Agent (Offline, No Key)</option>
              <option value="gemini">Google Gemini API (Multi-turn LLM)</option>
              <option value="openai-compatible">OpenAI / Groq Compatible API</option>
            </select>
          </div>

          {draftAiConfig.mode !== 'builtin' && (
            <>
              <div className="field">
                <label htmlFor="ai-key">
                  API Key {draftAiConfig.useLocalProxy && draftAiConfig.mode === 'gemini' ? '(Optional — Local .env.local proxy active)' : ''}
                </label>
                <input
                  id="ai-key"
                  type="text"
                  required={!(draftAiConfig.useLocalProxy && draftAiConfig.mode === 'gemini')}
                  autoComplete="off"
                  value={draftAiConfig.apiKey}
                  onChange={(e) => setDraftAiConfig({ ...draftAiConfig, apiKey: e.target.value })}
                  placeholder={
                    draftAiConfig.useLocalProxy && draftAiConfig.mode === 'gemini'
                      ? 'Using GEMINI_API_KEY from .env.local proxy'
                      : draftAiConfig.mode === 'gemini'
                      ? 'AIza... or AQ...'
                      : 'sk-... or gsk_...'
                  }
                />
              </div>

              <div className="field">
                <label htmlFor="ai-model">Model</label>
                <input
                  id="ai-model"
                  type="text"
                  required
                  value={draftAiConfig.model}
                  onChange={(e) => setDraftAiConfig({ ...draftAiConfig, model: e.target.value })}
                />
              </div>

              {draftAiConfig.mode === 'openai-compatible' && (
                <div className="field">
                  <label htmlFor="ai-url">Chat Completions Endpoint URL</label>
                  <input
                    id="ai-url"
                    type="text"
                    required
                    value={draftAiConfig.baseUrl}
                    onChange={(e) =>
                      setDraftAiConfig({ ...draftAiConfig, baseUrl: e.target.value })
                    }
                  />
                  <span className="field-hint">
                    OpenAI: https://api.openai.com/v1/chat/completions · Groq:
                    https://api.groq.com/openai/v1/chat/completions
                  </span>
                </div>
              )}
            </>
          )}

          <div className="dialog-footer" style={{ padding: '0.75rem 0 0', background: 'transparent' }}>
            {draftAiConfig.apiKey && (
              <button
                type="button"
                className="btn btn-danger-outline"
                onClick={() => {
                  const cleared: AiApiConfig = { ...draftAiConfig, mode: 'builtin', apiKey: '' };
                  setDraftAiConfig(cleared);
                  setAiConfig(cleared);
                  saveAiApiConfig(cleared);
                  setAiModalOpen(false);
                }}
              >
                Disconnect Key
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={() => setAiModalOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save AI Settings
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Persistent Floating Quick-Mic Button */}
      <div className="voice-fab-wrap">
        <button
          type="button"
          className={`voice-fab ${listening ? 'is-listening' : ''}`}
          onClick={() => {
            studioRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            toggleMicrophone();
          }}
          aria-label={listening ? 'Stop Whisper-Flow microphone' : 'Activate Whisper-Flow microphone'}
        >
          {listening ? <MicOff size={20} aria-hidden="true" /> : <Mic size={20} aria-hidden="true" />}
          <span>{listening ? 'Listening… Tap to Stop' : 'Whisper-Flow Mic'}</span>
        </button>
      </div>
    </>
  );
}
