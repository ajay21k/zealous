# VyapaarAI — Whisper-Flow Voice-First Business Operating Platform

**VyapaarAI** is a streamlined, voice-first AI business management and financial auditing platform for India's neighbourhood retailers, kirana stores, wholesalers, and distributors.

## Core Focus: Whisper-Flow Voice Agent

The **Whisper-Flow Voice Agent Studio** sits prominently at the top of the workspace (with a persistent floating quick-mic button) and guides every voice/text command through a transparent 4-step pipeline:

1. **Speak / Type**: Tap the mic (or type/select a multilingual preset) in English, Hindi/Hinglish, Tamil/Tanglish, Telugu/Tenglish, Kannada/Kanglish, Malayalam, Bengali, Marathi, Gujarati, Punjabi, or Urdu.
2. **Transcribe & Match**: Detects language/code-switching, matches products (including regional aliases like *chawal*, *arisi*, *biyyam*, *cheeni*, *nei*), customers, and prices.
3. **Readback & Verify**: Speaks and displays the exact interpretation before any database write. Supports inline editing, voice corrections (`"make it 40 bags"`), and hands-free `"confirm"` / `"haan"` or `"cancel"` / `"nahi"`.
4. **Commit Ledger**: Deterministically updates inventory, customer khata, P&L, and the immutable audit trail.

## Voice language capability matrix

The registry is a product-language menu, not a certification of browser or device support. Browser Web Speech recognition is attempted only for locales marked eligible below, and the browser can still reject the locale at runtime. TTS requires an installed voice in the same language family; no different-language voice is substituted. Tanglish written only in Latin script is retained as text because browser Tamil voices do not reliably pronounce it. No cloud speech adapter is configured by default.

| Language / locale | Browser STT registry eligibility | Built-in business parser | TTS |
| --- | --- | --- | --- |
| English (`en-IN`) | Eligible; runtime/device dependent | Limited prototype | Matching installed voice required |
| Hindi / Hinglish (`hi-IN`) | Eligible; runtime/device dependent | Limited prototype | Matching installed voice required |
| Tamil / Tanglish (`ta-IN`) | Eligible; runtime/device dependent | Limited prototype | Tamil-script readback only; Latin-only Tanglish remains text |
| Telugu / Tenglish (`te-IN`) | Eligible; runtime/device dependent | Limited prototype | Matching installed voice required |
| Kannada / Kanglish (`kn-IN`) | Eligible; runtime/device dependent | Limited prototype | Matching installed voice required |
| Malayalam / Manglish (`ml-IN`) | Eligible; runtime/device dependent | Limited prototype | Matching installed voice required |
| Bengali / Banglish (`bn-IN`) | Eligible; runtime/device dependent | Limited prototype | Matching installed voice required |
| Marathi (`mr-IN`) | Eligible; runtime/device dependent | Limited prototype | Matching installed voice required |
| Gujarati (`gu-IN`) | Eligible; runtime/device dependent | Limited prototype | Matching installed voice required |
| Punjabi (`pa-IN`) | Eligible; runtime/device dependent | Limited prototype | Matching installed voice required |
| Urdu (`ur-IN`) | Eligible; runtime/device dependent | Limited prototype | Matching installed voice required |
| Odia (`or-IN`) | Not configured for browser STT | Limited typed-input prototype | Matching installed voice required |
| Assamese (`as-IN`) | Not configured for browser STT | Limited typed-input prototype | Matching installed voice required |
| Konkani (`kok-IN`) | Adapter required | Adapter required | Matching installed voice required |
| Kashmiri (`ks-IN`) | Adapter required | Adapter required | Matching installed voice required |
| Sanskrit (`sa-IN`) | Adapter required | Adapter required | Matching installed voice required |
| Manipuri / Meitei (`mni-IN`) | Adapter required | Adapter required | Matching installed voice required |
| Bodo (`brx-IN`) | Adapter required | Adapter required | Matching installed voice required |
| Dogri (`doi-IN`) | Adapter required | Adapter required | Matching installed voice required |
| Maithili (`mai-IN`) | Adapter required | Adapter required | Matching installed voice required |
| Santali (`sat-IN`) | Adapter required | Adapter required | Matching installed voice required |

“Limited prototype” means some deterministic command and query patterns exist; it does not mean broad or equivalent understanding of that language. Auto-detection is transcript-level heuristic detection after recognition, not multilingual acoustic recognition. Recognition uses the selected browser locale and reports unavailable if that locale is unsupported; it never silently changes to English. Product stock and ambiguity readbacks are localized for the 11 locales listed as eligible above, using the same deterministic records. Other business-query intents still return English text and are not yet language-consistent; Odia and Assamese are not localized. Test browser/device voices and recognition locales separately before advertising those capabilities as verified.

### Tamil TTS diagnosis and cloud-provider evaluation

Development builds log `[VyapaarAI TTS diagnostic]` events in the browser console. They include the selected application language, requested locale, voice names/locales, Tamil candidates, discovery-event status, selected voice, utterance locale and browser error code. They deliberately exclude utterance text and business data. `voiceschanged` is observed on `speechSynthesis`; the Web Speech API does not expose a definitive “voice list finished loading” flag.

In the integrated VS Code/Electron runtime checked during the audit, `getVoices()` returned Microsoft David, Mark and Zira, all `en-US`; it returned no Tamil voice, and no `voiceschanged` event was observed during the probe. Native Tamil playback cannot work in that runtime until a Tamil voice is installed. No English/Hindi voice is substituted. The application also accepts bare `ta` and regional `ta-*`/`ta_*` tags when a device does provide a Tamil voice.

**Optional provider evaluated, not integrated or enabled:** Sarvam Bulbul v4 Flash documents `ta-IN` support and Tamil personas including `aravind_ta_ads`, `gokul_ta_narration`, and `vijay_ta_narration`. Its REST API accepts text and returns base64 audio. Current published pay-as-you-go pricing is ₹2 per 1,000 characters for v4 Flash or ₹3 per 1,000 characters for v3, excluding GST; prices can change. A future integration must use a server-side endpoint and a server-only `SARVAM_API_KEY` (never a `VITE_` variable), explicitly opt in before sending response text, and handle provider errors without switching language. Sending readbacks may disclose product/customer names and amounts. Sarvam’s documentation says Model API retention can be set to “No retention”; workspace data is retained indefinitely until an owner sets a retention policy. Review current terms, data policy and commercial licensing before enabling it.

Tanglish remains text-only when written in Latin script. No transliteration was added: transliteration could corrupt names, SKUs, numbers or financial terms, and there is no verified safe transliteration path in this app. Sarvam documents native-script text as the preferred input for its multilingual speech models. A Tamil voice installation or a separately implemented, explicitly configured server-side TTS provider is required for audible Tamil playback.

## Workspace Modules (5 Focused Views)

- **Overview & P&L** (`src/components/OverviewView.tsx`) — Revenue, Gross Profit, Net Profit, Receivables, Payables, Inventory Valuation, 7-day sales trend, and 1-click restock alerts.
- **Inventory** (`src/components/InventoryView.tsx`) — Product catalogue with multilingual aliases, Add Product, Stock Adjustments, and Stock Movement log.
- **Sales, Purchases & Expenses** (`src/components/TransactionsView.tsx`) — Sales billing, traceable returns with refund tracking, supplier stock intake, and operating expenses.
- **Customer Khata & Suppliers** (`src/components/KhataView.tsx`) — Add Customer, invoice-level wholesale ledgers, FIFO/specific payment allocation, repeat-customer deal closure, and supplier payables.
- **Bank Recon & Reports** (`src/components/ReconReportsView.tsx`) — Bank credit matching (CSV/simulated, never asking for passwords/PINs/OTPs), P&L summary, 6-category Product Performance matrix, Immutable Audit Log, JSON Export, and Reset Demo.

## Running & Verifying

```sh
npm install
npm test
npm run typecheck
npm run build
npm run dev
```
