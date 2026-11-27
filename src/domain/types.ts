export type SyncState = 'LOCAL_SAVED' | 'SYNCING' | 'COMMITTED' | 'FAILED';

export type TransactionSource = 'VOICE' | 'DASHBOARD' | 'DOCUMENT' | 'BANK_SYNC';

export type PaymentMode = string;

export interface BusinessProfile {
  name: string;
  ownerName: string;
  location: string;
  businessType: string;
  gstin?: string;
  preferredLanguage: string;
  autoDetectLanguage: boolean;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  currentStock: number;
  reorderLevel: number;
  maxStock: number;
  avgCostPrice: number;
  defaultSellPrice: number;
  aliases: string[];
  lastSoldAt?: string;
}

export type StockMovementType = 'PURCHASE' | 'SALE' | 'RETURN' | 'ADJUSTMENT';

export interface StockMovement {
  id: string;
  productId: string;
  productName: string;
  type: StockMovementType;
  deltaQty: number;
  balanceAfter: number;
  referenceId: string;
  note: string;
  createdAt: string;
  syncState: SyncState;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  city: string;
  segment: 'Wholesale' | 'Retail';
  creditLimit: number;
  aliases: string[];
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  city: string;
  category: string;
  aliases: string[];
}

export interface SaleItem {
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  costPriceSnapshot: number;
  lineTotal: number;
  returnedQty?: number;
}

export interface Sale {
  id: string;
  invoiceNo: string;
  customerId: string;
  customerName: string;
  items: SaleItem[];
  subtotal: number;
  discount: number;
  netTotal: number;
  cogsTotal: number;
  amountPaid: number;
  balanceDue: number;
  refundedAmount?: number;
  paymentMode: PaymentMode;
  status: 'PAID' | 'PARTIAL' | 'PENDING' | 'RETURNED';
  createdAt: string;
  source: TransactionSource;
  syncState: SyncState;
  languageCode?: string;
  originalTranscript?: string;
  idempotencyKey?: string;
}

export interface PurchaseItem {
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  unitCost: number;
  lineTotal: number;
}

export interface Purchase {
  id: string;
  billNo: string;
  supplierId: string;
  supplierName: string;
  items: PurchaseItem[];
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
  refundedAmount?: number;
  paymentMode: PaymentMode;
  status: 'PAID' | 'PARTIAL' | 'PENDING';
  createdAt: string;
  source: TransactionSource;
  syncState: SyncState;
  languageCode?: string;
  originalTranscript?: string;
  idempotencyKey?: string;
}

export interface PaymentAllocation {
  invoiceOrBillId: string;
  invoiceOrBillNo: string;
  allocatedAmount: number;
}

export interface Payment {
  id: string;
  partyType: 'CUSTOMER' | 'SUPPLIER';
  partyId: string;
  partyName: string;
  amount: number;
  mode: PaymentMode;
  referenceNo: string;
  allocations: PaymentAllocation[];
  createdAt: string;
  source: TransactionSource;
  syncState: SyncState;
  note?: string;
  idempotencyKey?: string;
}

export interface BankTransaction {
  id: string;
  date: string;
  description: string;
  referenceNo: string;
  amount: number;
  type: 'CREDIT' | 'DEBIT';
  senderHint: string;
  matchStatus: 'UNMATCHED' | 'PROPOSED' | 'RECONCILED' | 'IGNORED';
  matchedSaleId?: string;
  matchedCustomerId?: string;
  confidence?: number;
}

export type ExpenseCategory = string;

export interface Expense {
  id: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  paymentMode: PaymentMode;
  createdAt: string;
  source: TransactionSource;
  syncState: SyncState;
  languageCode?: string;
  originalTranscript?: string;
  idempotencyKey?: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  entityType: 'SALE' | 'PURCHASE' | 'PAYMENT' | 'EXPENSE' | 'INVENTORY' | 'BANK_RECON' | 'SYSTEM';
  entityId: string;
  summary: string;
  sourceInput?: string;
  approvedByOwner: boolean;
}

export interface BusinessState {
  version: number;
  profile: BusinessProfile;
  products: Product[];
  stockMovements: StockMovement[];
  customers: Customer[];
  suppliers: Supplier[];
  sales: Sale[];
  purchases: Purchase[];
  payments: Payment[];
  bankTransactions: BankTransaction[];
  expenses: Expense[];
  auditLogs: AuditLog[];
  offlineModeSimulated: boolean;
}

export type AgentIntent =
  | 'RECORD_SALE'
  | 'RECORD_PURCHASE'
  | 'RECORD_CUSTOMER_PAYMENT'
  | 'RECORD_EXPENSE'
  | 'QUERY_STOCK'
  | 'QUERY_RECEIVABLES'
  | 'QUERY_PROFIT_REPORT'
  | 'RESTOCK_ADVICE'
  | 'CLARIFICATION_NEEDED'
  | 'UNSUPPORTED_LANGUAGE';

export type AgentName =
  | 'Supervisor Agent'
  | 'AI Conversation Agent'
  | 'Audit Agent'
  | 'Inventory Agent'
  | 'Customer Ledger Agent'
  | 'Reconciliation Agent'
  | 'Finance Agent'
  | 'Reporting Agent'
  | 'Voice Response Agent';

export interface ProposalDraft {
  proposalId: string;
  intent: AgentIntent;
  routedAgents: AgentName[];
  confidence: number;
  detectedLanguage: string;
  languageName: string;
  dialectNote?: string;
  codeSwitched: boolean;
  originalTranscript: string;
  source: TransactionSource;
  // Structured fields for mutation intents
  partyName?: string;
  partyId?: string;
  productId?: string;
  productName?: string;
  unit?: string;
  quantity?: number;
  unitPrice?: number;
  extraItems?: {
    productId?: string;
    productName: string;
    unit?: string;
    quantity: number;
    unitPrice: number;
  }[];
  totalAmount?: number;
  amountPaid?: number;
  pendingAmount?: number;
  paymentMode?: PaymentMode;
  expenseCategory?: ExpenseCategory;
  expenseDescription?: string;
  // Validation & Clarification
  missingFields: string[];
  ambiguousProducts?: { id: string; name: string; defaultSellPrice: number; currentStock: number; unit: string }[];
  warnings: string[];
  readbackText: string;
  answerText?: string;
  status: 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'REJECTED' | 'ANSWERED';
  createdAt: string;
}

export interface ConversationTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}
