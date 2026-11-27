import { formatINR } from '../domain/formatters';
import { computeFinancialSummary } from '../domain/ledgerEngine';
import {
  BusinessState,
  ConversationTurn,
  ExpenseCategory,
  PaymentMode,
  ProposalDraft,
} from '../domain/types';

export type AiBrainMode = 'builtin' | 'gemini' | 'openai-compatible';

export interface AiApiConfig {
  mode: AiBrainMode;
  apiKey: string;
  model: string;
  baseUrl: string;
  useLocalProxy?: boolean;
}

const SESSION_CONFIG_KEY = 'vyapaarai_ai_brain_config_v1';

export function loadAiApiConfig(): AiApiConfig {
  const defaults: AiApiConfig = {
    mode: 'builtin',
    apiKey: '',
    model: 'gemini-3.1-flash-lite',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    useLocalProxy: false,
  };
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = window.sessionStorage.getItem(SESSION_CONFIG_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<AiApiConfig>;
    return {
      mode: parsed.mode ?? 'builtin',
      apiKey: parsed.apiKey ?? '',
      model: parsed.model ?? defaults.model,
      baseUrl: parsed.baseUrl ?? defaults.baseUrl,
      useLocalProxy: parsed.useLocalProxy ?? false,
    };
  } catch {
    return defaults;
  }
}

export function saveAiApiConfig(config: AiApiConfig): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SESSION_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // ignore storage limits
  }
}

export async function checkLocalGeminiProxyStatus(): Promise<{
  configured: boolean;
  defaultModel: string;
}> {
  try {
    const res = await fetch('/api/gemini/status');
    if (!res.ok) return { configured: false, defaultModel: 'gemini-3.1-flash-lite' };
    return (await res.json()) as { configured: boolean; defaultModel: string };
  } catch {
    return { configured: false, defaultModel: 'gemini-3.1-flash-lite' };
  }
}

export interface LlmStructuredTurn {
  intent:
    | 'RECORD_SALE'
    | 'RECORD_PURCHASE'
    | 'RECORD_CUSTOMER_PAYMENT'
    | 'RECORD_EXPENSE'
    | 'QUERY'
    | 'CONFIRM'
    | 'REJECT'
    | 'CLARIFY';
  productId?: string | null;
  productName?: string | null;
  unit?: string | null;
  partyId?: string | null;
  partyName?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  items?: {
    productId?: string | null;
    productName: string;
    unit?: string | null;
    quantity: number;
    unitPrice: number;
  }[];
  amountPaid?: number | null;
  paymentMode?: PaymentMode | null;
  expenseCategory?: ExpenseCategory | null;
  expenseDescription?: string | null;
  missingFields?: string[];
  replyInUserLanguage: string;
  detectedLanguageCode?: string;
}

function buildSystemInstruction(state: BusinessState, preferredLang: string): string {
  const summary = computeFinancialSummary(state);
  const products = state.products.map((p) => ({
    id: p.id,
    name: p.name,
    unit: p.unit,
    stock: p.currentStock,
    reorderLevel: p.reorderLevel,
    sellPrice: p.defaultSellPrice,
    costPrice: p.avgCostPrice,
  }));
  const customers = state.customers.map((c) => {
    const due = state.sales
      .filter((s) => s.customerId === c.id && s.status !== 'RETURNED')
      .reduce((sum, s) => sum + s.balanceDue, 0);
    return { id: c.id, name: c.name, outstandingDue: due };
  });
  const suppliers = state.suppliers.map((s) => ({ id: s.id, name: s.name }));

  const metricsSnapshot = {
    totalRevenue: formatINR(summary.totalRevenue),
    totalCOGS: formatINR(summary.totalCOGS),
    grossProfit: formatINR(summary.grossProfit),
    totalExpenses: formatINR(summary.totalExpenses),
    netProfit: formatINR(summary.netProfit),
    totalReceivables: formatINR(summary.totalReceivables),
    totalPayables: formatINR(summary.totalPayables),
    inventoryValue: formatINR(summary.inventoryValue),
    lowStockItems: summary.productAnalytics
      .filter((p) => p.suggestedRestockQty > 0)
      .map((p) => ({
        name: p.product.name,
        stock: `${p.product.currentStock} ${p.product.unit}`,
        suggestedOrder: `+${p.suggestedRestockQty} ${p.product.unit}`,
      })),
  };

  return `You are VyapaarAI Whisper-Flow, a multilingual Indian business & accounting voice assistant.
Preferred language: ${preferredLang}. Respond naturally in the same language/script the user speaks (or preferred language). Keep replyInUserLanguage concise and suitable for voice TTS readback.

INVENTORY CATALOGUE:
${JSON.stringify(products)}

CUSTOMERS (with current pending Khata balance):
${JSON.stringify(customers)}

SUPPLIERS:
${JSON.stringify(suppliers)}

DETERMINISTIC FINANCIAL SNAPSHOT (use ONLY these exact numbers for queries):
${JSON.stringify(metricsSnapshot)}

RULES:
1. UNRESTRICTED ITEMS, PARTIES, UNITS & CATEGORIES: Do NOT restrict the user to pre-listed products, suppliers, customers, payment modes, or expense categories.
   - If the user mentions a new/unlisted product (e.g. "20 boxes Amul Butter" or "15 crates Tomatoes"), set productId=null, fill productName and unit ("boxes", "crates", "kg", etc.) freely!
   - Only ask to clarify a product if multiple existing inventory SKUs genuinely match an ambiguous term like "rice" or "chawal" (e.g. Basmati Rice vs Sona Masoori Rice).
   - If the user mentions a new customer or supplier not in the list, set partyId=null and set partyName to their exact spoken name.
   - Support multi-item transactions via items[] whenever multiple items are mentioned in one bill.
2. NEVER guess missing quantity or unitPrice. Ask naturally in 1 concise sentence for the missing fields.
3. Merge details across the conversation turns into the full structured fields.
4. For queries (stock, who owes money, profit, restocking), use ONLY the provided snapshot numbers and set intent="QUERY" with a concise spoken answer in replyInUserLanguage.
5. If a complete proposal is pending and user says yes/confirm/haan/pakka, set intent="CONFIRM". If no/cancel/nahi, set intent="REJECT".
6. Output ONLY valid JSON matching this schema:
{
  "intent": "RECORD_SALE" | "RECORD_PURCHASE" | "RECORD_CUSTOMER_PAYMENT" | "RECORD_EXPENSE" | "QUERY" | "CONFIRM" | "REJECT" | "CLARIFY",
  "productId": string | null,
  "productName": string | null,
  "unit": string | null,
  "partyId": string | null,
  "partyName": string | null,
  "quantity": number | null,
  "unitPrice": number | null,
  "items": [{"productId": string | null, "productName": string, "unit": string, "quantity": number, "unitPrice": number}],
  "amountPaid": number | null,
  "paymentMode": string | null,
  "expenseCategory": string | null,
  "expenseDescription": string | null,
  "missingFields": string[],
  "replyInUserLanguage": string,
  "detectedLanguageCode": string
}`;
}

export async function runExternalAiTurn(
  config: AiApiConfig,
  userMessage: string,
  history: ConversationTurn[],
  activeProposal: ProposalDraft | null,
  state: BusinessState
): Promise<LlmStructuredTurn> {
  if (!config.useLocalProxy && !config.apiKey.trim()) {
    throw new Error('No API key configured.');
  }

  const systemPrompt = buildSystemInstruction(state, state.profile.preferredLanguage);
  const contextNote = activeProposal
    ? `\nCurrent pending draft: ${JSON.stringify({
        intent: activeProposal.intent,
        productId: activeProposal.productId,
        partyId: activeProposal.partyId,
        partyName: activeProposal.partyName,
        quantity: activeProposal.quantity,
        unitPrice: activeProposal.unitPrice,
        amountPaid: activeProposal.amountPaid,
        paymentMode: activeProposal.paymentMode,
        missingFields: activeProposal.missingFields,
      })}`
    : '';

  if (config.mode === 'gemini') {
    const model = config.model.trim() || 'gemini-3.1-flash-lite';
    const contents = [
      ...history.slice(-8).map((t) => ({
        role: t.role === 'user' ? 'user' : 'model',
        parts: [{ text: t.text }],
      })),
      {
        role: 'user',
        parts: [{ text: `${userMessage}${contextNote}` }],
      },
    ];
    const payload = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    };

    let res: Response;
    if (config.useLocalProxy && !config.apiKey.trim()) {
      res = await fetch('/api/gemini/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, payload }),
      });
    } else {
      const candidates = Array.from(
        new Set([model, 'gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'gemini-flash-latest'])
      );
      let candidateRes: Response | null = null;
      for (const cand of candidates) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          cand
        )}:generateContent?key=${encodeURIComponent(config.apiKey.trim())}`;
        candidateRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (candidateRes.ok || (candidateRes.status !== 404 && candidateRes.status !== 503)) {
          break;
        }
      }
      res = candidateRes!;
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API error (${res.status}): ${errText.slice(0, 180)}`);
    }

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return JSON.parse(rawJson) as LlmStructuredTurn;
  }

  // OpenAI-compatible (OpenAI, Groq, Together, OpenRouter, local Ollama)
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-8).map((t) => ({
      role: t.role === 'user' ? 'user' : 'assistant',
      content: t.text,
    })),
    { role: 'user', content: `${userMessage}${contextNote}` },
  ];

  const res = await fetch(config.baseUrl.trim(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: config.model.trim() || 'gpt-4o-mini',
      messages,
      temperature: 0.1,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI API error (${res.status}): ${errText.slice(0, 180)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const rawJson = data.choices?.[0]?.message?.content ?? '';
  return JSON.parse(rawJson) as LlmStructuredTurn;
}
