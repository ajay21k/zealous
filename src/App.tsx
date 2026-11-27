import { useEffect, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  LayoutDashboard,
  Menu,
  Mic,
  Package,
  Receipt,
  Wifi,
  X,
} from 'lucide-react';
import { InventoryView } from './components/InventoryView';
import { KhataView } from './components/KhataView';
import { ModalDialog } from './components/ModalDialog';
import { OverviewView } from './components/OverviewView';
import { ReconReportsView } from './components/ReconReportsView';
import { TransactionsView } from './components/TransactionsView';
import { WhisperFlowAgent } from './components/WhisperFlowAgent';
import {
  addCustomer,
  AddCustomerInput,
  addProduct,
  AddProductInput,
  addSupplier,
  AddSupplierInput,
  commitCustomerPayment,
  CommitCustomerPaymentInput,
  commitExpense,
  CommitExpenseInput,
  commitPurchase,
  CommitPurchaseInput,
  commitSale,
  CommitSaleInput,
  commitSaleReturn,
  commitStockAdjustment,
  commitSupplierPayment,
  computeFinancialSummary,
  EngineResult,
  importBankTransactions,
  updateBusinessProfile,
} from './domain/ledgerEngine';
import { BankTransaction, BusinessState, PaymentMode, Product, ProposalDraft } from './domain/types';
import { loadBusinessState, resetBusinessState, saveBusinessState } from './persistence/storage';
import { languageRegistry } from './speech/languages';

type TabId = 'overview' | 'inventory' | 'transactions' | 'khata' | 'audit';

const NAV_ITEMS: { id: TabId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview & P&L', icon: LayoutDashboard },
  { id: 'inventory', label: 'Inventory', icon: Package },
  { id: 'transactions', label: 'Sales, Purchases & Expenses', icon: Receipt },
  { id: 'khata', label: 'Customer Khata & Suppliers', icon: BookOpen },
  { id: 'audit', label: 'Bank Recon & Reports', icon: BarChart3 },
];

export function App() {
  const [state, setState] = useState<BusinessState>(() => loadBusinessState());
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [txSubTab, setTxSubTab] = useState<'sales' | 'purchases' | 'expenses'>('sales');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [liveAnnouncement, setLiveAnnouncement] = useState('');
  const [prefillRestock, setPrefillRestock] = useState<{
    productId: string;
    quantity: number;
  } | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileDraft, setProfileDraft] = useState(state.profile);

  useEffect(() => {
    if (!saveBusinessState(state)) {
      setLiveAnnouncement('Changes could not be saved locally. Storage may be full or unavailable.');
    }
  }, [state]);

  useEffect(() => {
    const activeItem = NAV_ITEMS.find((i) => i.id === activeTab);
    document.title = `${activeItem?.label ?? 'Dashboard'} | VyapaarAI Whisper-Flow`;
  }, [activeTab]);

  useEffect(() => {
    if (!mobileNavOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpen(false);
    };
    const desktopQuery = window.matchMedia('(min-width: 961px)');
    const handleDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setMobileNavOpen(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    desktopQuery.addEventListener('change', handleDesktop);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      desktopQuery.removeEventListener('change', handleDesktop);
    };
  }, [mobileNavOpen]);

  const summary = computeFinancialSummary(state);
  const currentLang = languageRegistry.getByCode(state.profile.preferredLanguage);

  const applyEngineResult = (res: EngineResult): { ok: boolean; message: string } => {
    if (!res.ok) {
      setLiveAnnouncement(res.error);
      return { ok: false, message: res.error };
    }
    setState(res.state);
    setLiveAnnouncement(res.message);
    return { ok: true, message: res.message };
  };

  const handleConfirmProposal = (proposal: ProposalDraft): { ok: boolean; message: string } => {
    if (proposal.intent === 'RECORD_SALE') {
      const hasMulti = Boolean(proposal.extraItems && proposal.extraItems.length > 0);
      if (!hasMulti && ((!proposal.productId && !proposal.productName) || !proposal.quantity || !proposal.unitPrice)) {
        return { ok: false, message: 'Missing product, quantity, or price.' };
      }
      return applyEngineResult(
        commitSale(state, {
          customerId: proposal.partyId,
          customerName: proposal.partyName,
          productId: proposal.productId,
          productName: proposal.productName,
          unit: proposal.unit,
          quantity: proposal.quantity,
          unitPrice: proposal.unitPrice,
          items: proposal.extraItems,
          amountPaid: proposal.amountPaid ?? 0,
          paymentMode: proposal.paymentMode ?? 'CASH',
          source: proposal.source,
          languageCode: proposal.detectedLanguage,
          originalTranscript: proposal.originalTranscript,
          idempotencyKey: proposal.proposalId,
        })
      );
    }

    if (proposal.intent === 'RECORD_PURCHASE') {
      const hasMulti = Boolean(proposal.extraItems && proposal.extraItems.length > 0);
      if (!hasMulti && ((!proposal.productId && !proposal.productName) || !proposal.quantity || !proposal.unitPrice)) {
        return { ok: false, message: 'Missing product, quantity, or purchase cost.' };
      }
      return applyEngineResult(
        commitPurchase(state, {
          supplierId: proposal.partyId,
          supplierName: proposal.partyName,
          productId: proposal.productId,
          productName: proposal.productName,
          unit: proposal.unit,
          quantity: proposal.quantity,
          unitCost: proposal.unitPrice,
          items: proposal.extraItems?.map((it) => ({
            productId: it.productId,
            productName: it.productName,
            unit: it.unit,
            quantity: it.quantity,
            unitCost: it.unitPrice,
          })),
          amountPaid: proposal.amountPaid ?? 0,
          paymentMode: proposal.paymentMode ?? 'BANK_TRANSFER',
          source: proposal.source,
          languageCode: proposal.detectedLanguage,
          originalTranscript: proposal.originalTranscript,
          idempotencyKey: proposal.proposalId,
        })
      );
    }

    if (proposal.intent === 'RECORD_CUSTOMER_PAYMENT') {
      if (!proposal.partyId || !proposal.totalAmount) {
        return { ok: false, message: 'Missing customer or payment amount.' };
      }
      return applyEngineResult(
        commitCustomerPayment(state, {
          customerId: proposal.partyId,
          amount: proposal.totalAmount,
          mode: proposal.paymentMode ?? 'CASH',
          source: proposal.source,
          note: `Voice payment: ${proposal.originalTranscript}`,
          idempotencyKey: proposal.proposalId,
        })
      );
    }

    if (proposal.intent === 'RECORD_EXPENSE') {
      if (!proposal.totalAmount) {
        return { ok: false, message: 'Missing expense amount.' };
      }
      return applyEngineResult(
        commitExpense(state, {
          category: proposal.expenseCategory ?? 'Other',
          description: proposal.expenseDescription ?? proposal.originalTranscript,
          amount: proposal.totalAmount,
          paymentMode: proposal.paymentMode ?? 'CASH',
          source: proposal.source,
          languageCode: proposal.detectedLanguage,
          originalTranscript: proposal.originalTranscript,
          idempotencyKey: proposal.proposalId,
        })
      );
    }

    return { ok: false, message: 'Unsupported confirmation intent.' };
  };

  const handleQuickRestock = (product: Product, qty: number) => {
    setPrefillRestock({ productId: product.id, quantity: qty });
    setTxSubTab('purchases');
    setActiveTab('transactions');
  };

  const handleNavigate = (target: string) => {
    if (target.startsWith('transactions:')) {
      const sub = target.split(':')[1] as 'sales' | 'purchases' | 'expenses';
      setTxSubTab(sub);
      setActiveTab('transactions');
    } else {
      setActiveTab(target as TabId);
    }
    setMobileNavOpen(false);
  };

  const pendingBankCount = state.bankTransactions.filter(
    (b) => b.matchStatus === 'PROPOSED' || b.matchStatus === 'UNMATCHED'
  ).length;

  return (
    <>
      <a href="#main-content" className="skip-link visually-hidden">
        Skip to main content
      </a>

      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </div>

      <div className="app-shell">
        {mobileNavOpen && (
          <button
            type="button"
            className="sidebar-overlay"
            aria-label="Close navigation menu"
            onClick={() => setMobileNavOpen(false)}
          />
        )}
        <aside className={`sidebar ${mobileNavOpen ? 'is-open' : ''}`}>
          <div className="brand-block">
            <div className="brand-mark" aria-hidden="true">
              <Mic size={20} />
            </div>
            <div>
              <p className="brand-title">VyapaarAI</p>
              <p className="brand-subtitle">Whisper-Flow Business OS</p>
            </div>
            <button
              type="button"
              className="sidebar-close"
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close navigation menu"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <nav aria-label="Primary">
            <div className="nav-section-label">Workspace</div>
            <ul className="nav-list">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="nav-button"
                      aria-current={activeTab === item.id ? 'page' : undefined}
                      onClick={() => handleNavigate(item.id)}
                    >
                      <span className="nav-button-left">
                        <Icon size={17} aria-hidden="true" />
                        <span>{item.label}</span>
                      </span>
                      {item.id === 'inventory' && summary.lowStockCount > 0 && (
                        <span className="nav-badge">{summary.lowStockCount}</span>
                      )}
                      {item.id === 'audit' && pendingBankCount > 0 && (
                        <span className="nav-badge">{pendingBankCount}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="sidebar-footer">
            <div style={{ fontSize: '0.76rem', color: 'var(--ink-secondary)' }}>
              <strong>Speech:</strong> {currentLang?.name ?? state.profile.preferredLanguage}
            </div>
            <div style={{ fontSize: '0.73rem', color: 'var(--ink-muted)' }}>
              Whisper-Flow AI proposes transactions; owner confirmation commits to the ledger.
            </div>
          </div>
        </aside>

        <div className="main-column">
          <header className="top-header">
            <div className="header-left">
              <button
                type="button"
                className="mobile-menu-btn"
                onClick={() => setMobileNavOpen((prev) => !prev)}
                aria-expanded={mobileNavOpen}
                aria-label="Toggle navigation menu"
              >
                <Menu size={20} aria-hidden="true" />
              </button>
              <div className="shop-meta">
                <h2>{state.profile.name}</h2>
                <p>
                  {state.profile.location} · {state.profile.businessType}
                </p>
              </div>
            </div>

            <div className="header-actions">
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => {
                  setProfileDraft(state.profile);
                  setProfileOpen(true);
                }}
              >
                Edit Shop
              </button>
              <span className="badge badge-blue">
                Language: {currentLang?.nativeName ?? state.profile.preferredLanguage}
              </span>
              <span className="badge badge-success">
                <Wifi size={12} aria-hidden="true" />
                Local Ledger Active
              </span>
            </div>
          </header>

          <main id="main-content" tabIndex={-1} className="main-content">
            {/* Highlighted Whisper-Flow Voice Agent Studio */}
            <WhisperFlowAgent
              state={state}
              ttsEnabled={ttsEnabled}
              onToggleTts={() => setTtsEnabled((v) => !v)}
              onChangeLanguage={(langCode) =>
                setState((prev) => ({
                  ...prev,
                  profile: { ...prev.profile, preferredLanguage: langCode },
                }))
              }
              onToggleAutoDetect={() =>
                setState((prev) => ({
                  ...prev,
                  profile: {
                    ...prev.profile,
                    autoDetectLanguage: !prev.profile.autoDetectLanguage,
                  },
                }))
              }
              onConfirmProposal={handleConfirmProposal}
            />

            {activeTab === 'overview' && (
              <OverviewView
                state={state}
                onNavigate={handleNavigate}
                onQuickRestock={handleQuickRestock}
              />
            )}

            {activeTab === 'inventory' && (
              <InventoryView
                state={state}
                onAddProduct={(input: AddProductInput) => applyEngineResult(addProduct(state, input))}
                onAdjustStock={(productId, delta, reason) =>
                  applyEngineResult(commitStockAdjustment(state, productId, delta, reason))
                }
              />
            )}

            {activeTab === 'transactions' && (
              <TransactionsView
                state={state}
                initialSubTab={txSubTab}
                prefillRestock={prefillRestock}
                onClearPrefill={() => setPrefillRestock(null)}
                onCommitSale={(input: CommitSaleInput) => applyEngineResult(commitSale(state, input))}
                onReturnSale={(saleId, productId, qty, reason) =>
                  applyEngineResult(commitSaleReturn(state, saleId, productId, qty, reason))
                }
                onCommitPurchase={(input: CommitPurchaseInput) =>
                  applyEngineResult(commitPurchase(state, input))
                }
                onCommitExpense={(input: CommitExpenseInput) =>
                  applyEngineResult(commitExpense(state, input))
                }
              />
            )}

            {activeTab === 'khata' && (
              <KhataView
                state={state}
                onAddCustomer={(input: AddCustomerInput) =>
                  applyEngineResult(addCustomer(state, input))
                }
                onAddSupplier={(input: AddSupplierInput) =>
                  applyEngineResult(addSupplier(state, input))
                }
                onRecordPayment={(input: CommitCustomerPaymentInput) =>
                  applyEngineResult(commitCustomerPayment(state, input))
                }
                onPaySupplier={(supId: string, amt: number, mode: PaymentMode, ref?: string) =>
                  applyEngineResult(commitSupplierPayment(state, supId, amt, mode, ref))
                }
              />
            )}

            {activeTab === 'audit' && (
              <ReconReportsView
                state={state}
                onImportBankTxns={(
                  entries: Omit<
                    BankTransaction,
                    'id' | 'matchStatus' | 'matchedSaleId' | 'matchedCustomerId' | 'confidence'
                  >[]
                ) => setState((prev) => importBankTransactions(prev, entries))}
                onReconcileBankTxn={(input: CommitCustomerPaymentInput) =>
                  applyEngineResult(commitCustomerPayment(state, input))
                }
                onIgnoreBankTxn={(txnId: string) =>
                  setState((prev) => ({
                    ...prev,
                    bankTransactions: prev.bankTransactions.map((t) =>
                      t.id === txnId ? { ...t, matchStatus: 'IGNORED' } : t
                    ),
                  }))
                }
                onResetDemo={() => {
                  const fresh = resetBusinessState();
                  setState(fresh);
                  setLiveAnnouncement('Demo data reset to initial sample business records.');
                }}
              />
            )}
          </main>
        </div>
      </div>

      <ModalDialog open={profileOpen} onClose={() => setProfileOpen(false)} title="Edit Business Profile">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setState((prev) => updateBusinessProfile(prev, profileDraft));
            setProfileOpen(false);
            setLiveAnnouncement('Business profile updated.');
          }}
          className="form-grid"
        >
          <div className="field">
            <label htmlFor="bp-name">Shop / Business Name</label>
            <input
              id="bp-name"
              type="text"
              required
              autoFocus
              value={profileDraft.name}
              onChange={(e) => setProfileDraft({ ...profileDraft, name: e.target.value })}
            />
          </div>
          <div className="form-row-2">
            <div className="field">
              <label htmlFor="bp-owner">Owner Name</label>
              <input
                id="bp-owner"
                type="text"
                value={profileDraft.ownerName}
                onChange={(e) => setProfileDraft({ ...profileDraft, ownerName: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="bp-loc">Location / City</label>
              <input
                id="bp-loc"
                type="text"
                value={profileDraft.location}
                onChange={(e) => setProfileDraft({ ...profileDraft, location: e.target.value })}
              />
            </div>
          </div>
          <div className="form-row-2">
            <div className="field">
              <label htmlFor="bp-type">Business Type</label>
              <input
                id="bp-type"
                type="text"
                value={profileDraft.businessType}
                onChange={(e) => setProfileDraft({ ...profileDraft, businessType: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="bp-gst">GSTIN (Optional)</label>
              <input
                id="bp-gst"
                type="text"
                value={profileDraft.gstin ?? ''}
                onChange={(e) => setProfileDraft({ ...profileDraft, gstin: e.target.value })}
              />
            </div>
          </div>
          <div className="dialog-footer" style={{ padding: '0.75rem 0 0', background: 'transparent' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setProfileOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">Save Profile</button>
          </div>
        </form>
      </ModalDialog>
    </>
  );
}

export default App;
