# VyapaarAI — Whisper-Flow Voice-First Business Operating Platform

**VyapaarAI** is a streamlined, voice-first AI business management and financial auditing platform for India's neighbourhood retailers, kirana stores, wholesalers, and distributors.

## Core Focus: Whisper-Flow Voice Agent

The **Whisper-Flow Voice Agent Studio** sits prominently at the top of the workspace (with a persistent floating quick-mic button) and guides every voice/text command through a transparent 4-step pipeline:

1. **Speak / Type**: Tap the mic (or type/select a multilingual preset) in English, Hindi/Hinglish, Tamil/Tanglish, Telugu/Tenglish, Kannada/Kanglish, Malayalam, Bengali, Marathi, Gujarati, Punjabi, or Urdu.
2. **Transcribe & Match**: Detects language/code-switching, matches products (including regional aliases like *chawal*, *arisi*, *biyyam*, *cheeni*, *nei*), customers, and prices.
3. **Readback & Verify**: Speaks and displays the exact interpretation before any database write. Supports inline editing, voice corrections (`"make it 40 bags"`), and hands-free `"confirm"` / `"haan"` or `"cancel"` / `"nahi"`.
4. **Commit Ledger**: Deterministically updates inventory, customer khata, P&L, and the immutable audit trail.

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
