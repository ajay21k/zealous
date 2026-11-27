import React, { useId, useState } from 'react';
import { IndianRupee, UserPlus } from 'lucide-react';
import { formatDateIN, formatINR } from '../domain/formatters';
import { AddCustomerInput, AddSupplierInput, CommitCustomerPaymentInput } from '../domain/ledgerEngine';
import { BusinessState, Customer, PaymentMode, Supplier } from '../domain/types';
import { ModalDialog } from './ModalDialog';
import { PaymentStatusBadge } from './StatusBadges';

interface KhataViewProps {
  state: BusinessState;
  onAddCustomer: (input: AddCustomerInput) => { ok: boolean; message: string };
  onAddSupplier: (input: AddSupplierInput) => { ok: boolean; message: string };
  onRecordPayment: (input: CommitCustomerPaymentInput) => { ok: boolean; message: string };
  onPaySupplier: (
    supplierId: string,
    amount: number,
    mode: PaymentMode,
    referenceNo?: string
  ) => { ok: boolean; message: string };
}

export function KhataView({
  state,
  onAddCustomer,
  onAddSupplier,
  onRecordPayment,
  onPaySupplier,
}: KhataViewProps) {
  const [subTab, setSubTab] = useState<'customers' | 'suppliers'>('customers');
  const [selectedCustomerId, setSelectedCustomerId] = useState(state.customers[0]?.id ?? '');

  // Add Customer Modal
  const [addOpen, setAddOpen] = useState(false);
  const [newCust, setNewCust] = useState<AddCustomerInput>({
    name: '',
    phone: '',
    city: '',
    segment: 'Wholesale',
    creditLimit: 150000,
  });

  // Add Supplier Modal
  const [addSupOpen, setAddSupOpen] = useState(false);
  const [newSup, setNewSup] = useState<AddSupplierInput>({
    name: '',
    phone: '',
    city: '',
    category: 'General',
  });

  // Collect Customer Payment Modal
  const [payModalCustomer, setPayModalCustomer] = useState<Customer | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMode, setPayMode] = useState<PaymentMode>('BANK_TRANSFER');
  const [payRef, setPayRef] = useState('');
  const [targetSaleId, setTargetSaleId] = useState('');

  // Pay Supplier Modal
  const [targetSupplier, setTargetSupplier] = useState<Supplier | null>(null);
  const [supAmt, setSupAmt] = useState('');
  const [supMode, setSupMode] = useState<PaymentMode>('BANK_TRANSFER');
  const [supRef, setSupRef] = useState('');

  const [error, setError] = useState<string | null>(null);

  const custCaptionId = useId();
  const detailCaptionId = useId();
  const supCaptionId = useId();

  const customerSummaries = state.customers.map((c) => {
    const custSales = state.sales.filter((s) => s.customerId === c.id && s.status !== 'RETURNED');
    const totalPurchases = custSales.reduce((sum, s) => sum + s.netTotal, 0);
    const totalPaid = custSales.reduce((sum, s) => sum + s.amountPaid, 0);
    const outstanding = custSales.reduce((sum, s) => sum + s.balanceDue, 0);
    const activeDeals = custSales.filter((s) => s.balanceDue > 0).length;
    return { customer: c, totalPurchases, totalPaid, outstanding, activeDeals, sales: custSales };
  });

  const activeSummary =
    customerSummaries.find((cs) => cs.customer.id === selectedCustomerId) ?? customerSummaries[0];

  const supplierRows = state.suppliers.map((sup) => {
    const pur = state.purchases.filter((p) => p.supplierId === sup.id);
    const totalPurchased = pur.reduce((s, p) => s + p.totalAmount, 0);
    const totalPaid = pur.reduce((s, p) => s + p.amountPaid, 0);
    const payable = pur.reduce((s, p) => s + p.balanceDue, 0);
    return { sup, billCount: pur.length, totalPurchased, totalPaid, payable };
  });

  const handleAddCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const res = onAddCustomer(newCust);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setAddOpen(false);
    setNewCust({ name: '', phone: '', city: '', segment: 'Wholesale', creditLimit: 150000 });
  };

  const handleAddSupplier = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const res = onAddSupplier(newSup);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setAddSupOpen(false);
    setNewSup({ name: '', phone: '', city: '', category: 'General' });
  };

  const handleCollectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!payModalCustomer) return;
    setError(null);
    const res = onRecordPayment({
      customerId: payModalCustomer.id,
      amount: Number(payAmount),
      mode: payMode,
      referenceNo: payRef,
      targetSaleId: targetSaleId || undefined,
      source: 'DASHBOARD',
    });
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setPayModalCustomer(null);
  };

  const handleSupPaySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetSupplier) return;
    setError(null);
    const res = onPaySupplier(targetSupplier.id, Number(supAmt), supMode, supRef);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setTargetSupplier(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
      <div className="page-header">
        <div>
          <h1>Customer Khata &amp; Suppliers</h1>
          <p>
            Invoice-level credit balances, partial payment allocation, repeat-customer closure, and
            supplier payables.
          </p>
        </div>
        <div className="toolbar-group">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setError(null);
              setAddOpen(true);
            }}
          >
            <UserPlus size={16} aria-hidden="true" />
            Add Customer
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setError(null);
              setAddSupOpen(true);
            }}
          >
            + Add Supplier
          </button>
        </div>
      </div>

      <div className="subtab-row" role="tablist" aria-label="Khata view">
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'customers'}
          className={`btn btn-sm ${subTab === 'customers' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setSubTab('customers')}
        >
          Customer Khata ({state.customers.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'suppliers'}
          className={`btn btn-sm ${subTab === 'suppliers' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setSubTab('suppliers')}
        >
          Suppliers &amp; Payables ({state.suppliers.length})
        </button>
      </div>

      {subTab === 'customers' ? (
        <>
          <div tabIndex={0} role="region" aria-labelledby={custCaptionId} className="table-wrapper">
            <table className="data-table">
              <caption id={custCaptionId}>Customer Credit Accounts</caption>
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  <th scope="col">Segment</th>
                  <th scope="col" className="num">Total Purchases</th>
                  <th scope="col" className="num">Credited</th>
                  <th scope="col" className="num">Outstanding</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {customerSummaries.map((cs) => (
                  <tr
                    key={cs.customer.id}
                    style={{
                      background:
                        cs.customer.id === activeSummary?.customer.id
                          ? 'var(--bg-blue-tint)'
                          : undefined,
                    }}
                  >
                    <th scope="row">
                      <button
                        type="button"
                        onClick={() => setSelectedCustomerId(cs.customer.id)}
                        style={{
                          background: 'none',
                          border: 0,
                          padding: 0,
                          font: 'inherit',
                          fontWeight: 700,
                          color: 'var(--brand-dark)',
                          cursor: 'pointer',
                          textAlign: 'start',
                        }}
                      >
                        {cs.customer.name}
                      </button>
                      <div style={{ fontSize: '0.72rem', fontWeight: 400, color: 'var(--ink-muted)' }}>
                        {cs.customer.city} · {cs.customer.phone}
                      </div>
                    </th>
                    <td data-label="Segment">
                      <span className="badge badge-neutral">{cs.customer.segment}</span>
                    </td>
                    <td data-label="Purchases" className="num">{formatINR(cs.totalPurchases)}</td>
                    <td data-label="Credited" className="num" style={{ color: 'var(--success-text)' }}>
                      {formatINR(cs.totalPaid)}
                    </td>
                    <td
                      data-label="Outstanding"
                      className="num"
                      style={{
                        fontWeight: 700,
                        color: cs.outstanding > 0 ? 'var(--warn-text)' : 'var(--success-text)',
                      }}
                    >
                      {formatINR(cs.outstanding)}
                    </td>
                    <td data-label="Actions">
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          onClick={() => setSelectedCustomerId(cs.customer.id)}
                        >
                          Ledger
                        </button>
                        {cs.outstanding > 0 && (
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            onClick={() => {
                              setPayModalCustomer(cs.customer);
                              setPayAmount(String(cs.outstanding));
                              setPayRef('');
                              setTargetSaleId('');
                              setError(null);
                            }}
                          >
                            <IndianRupee size={13} aria-hidden="true" />
                            Collect
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {activeSummary && (
            <section className="card" aria-labelledby="khata-detail-h">
              <div className="card-header">
                <div>
                  <h2 id="khata-detail-h" className="card-title">
                    Invoice History: {activeSummary.customer.name}
                  </h2>
                  <div style={{ fontSize: '0.8rem', color: 'var(--ink-muted)' }}>
                    Active deals: {activeSummary.activeDeals} · Outstanding:{' '}
                    <strong>{formatINR(activeSummary.outstanding)}</strong>
                  </div>
                </div>
              </div>
              <div tabIndex={0} role="region" aria-labelledby={detailCaptionId} className="table-wrapper">
                <table className="data-table">
                  <caption id={detailCaptionId}>Invoices for {activeSummary.customer.name}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Invoice</th>
                      <th scope="col">Date</th>
                      <th scope="col">Items</th>
                      <th scope="col" className="num">Amount</th>
                      <th scope="col" className="num">Paid</th>
                      <th scope="col" className="num">Pending</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeSummary.sales.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', color: 'var(--ink-muted)' }}>
                          No invoices yet.
                        </td>
                      </tr>
                    ) : (
                      activeSummary.sales.map((s) => (
                        <tr key={s.id}>
                          <th scope="row">{s.invoiceNo}</th>
                          <td data-label="Date">{formatDateIN(s.createdAt)}</td>
                          <td data-label="Items">
                            {s.items.map((i) => `${i.quantity} ${i.unit} ${i.productName}`).join(', ')}
                          </td>
                          <td data-label="Amount" className="num">{formatINR(s.netTotal)}</td>
                          <td data-label="Paid" className="num">{formatINR(s.amountPaid)}</td>
                          <td
                            data-label="Pending"
                            className="num"
                            style={{
                              fontWeight: 700,
                              color: s.balanceDue > 0 ? 'var(--warn-text)' : 'var(--success-text)',
                            }}
                          >
                            {formatINR(s.balanceDue)}
                          </td>
                          <td data-label="Status">
                            <PaymentStatusBadge status={s.status} />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      ) : (
        <div tabIndex={0} role="region" aria-labelledby={supCaptionId} className="table-wrapper">
          <table className="data-table">
            <caption id={supCaptionId}>Suppliers &amp; Payables</caption>
            <thead>
              <tr>
                <th scope="col">Supplier</th>
                <th scope="col">Category</th>
                <th scope="col" className="num">Bills</th>
                <th scope="col" className="num">Total Purchased</th>
                <th scope="col" className="num">Paid</th>
                <th scope="col" className="num">Pending Payable</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {supplierRows.map(({ sup, billCount, totalPurchased, totalPaid, payable }) => (
                <tr key={sup.id}>
                  <th scope="row">
                    <div>{sup.name}</div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 400, color: 'var(--ink-muted)' }}>
                      {sup.city} · {sup.phone}
                    </div>
                  </th>
                  <td data-label="Category">{sup.category}</td>
                  <td data-label="Bills" className="num">{billCount}</td>
                  <td data-label="Purchased" className="num">{formatINR(totalPurchased)}</td>
                  <td data-label="Paid" className="num">{formatINR(totalPaid)}</td>
                  <td
                    data-label="Payable"
                    className="num"
                    style={{
                      fontWeight: 700,
                      color: payable > 0 ? 'var(--warn-text)' : 'var(--success-text)',
                    }}
                  >
                    {formatINR(payable)}
                  </td>
                  <td data-label="Actions">
                    {payable > 0 ? (
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => {
                          setTargetSupplier(sup);
                          setSupAmt(String(payable));
                          setSupRef('');
                          setError(null);
                        }}
                      >
                        Settle Payable
                      </button>
                    ) : (
                      <span className="badge badge-success">Settled</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Customer Modal */}
      <ModalDialog open={addOpen} onClose={() => setAddOpen(false)} title="Add Customer to Khata">
        <form onSubmit={handleAddCustomer} className="form-grid">
          {error && <div className="alert-banner alert-danger">{error}</div>}
          <div className="form-row-2">
            <div className="field">
              <label htmlFor="nc-name">Business / Customer Name *</label>
              <input
                id="nc-name"
                type="text"
                required
                autoFocus
                value={newCust.name}
                onChange={(e) => setNewCust({ ...newCust, name: e.target.value })}
                placeholder="e.g. Balaji Provision Store"
              />
            </div>
            <div className="field">
              <label htmlFor="nc-phone">Phone</label>
              <input
                id="nc-phone"
                type="tel"
                value={newCust.phone}
                onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })}
                placeholder="+91 98..."
              />
            </div>
          </div>
          <div className="form-row-2">
            <div className="field">
              <label htmlFor="nc-city">Area / City</label>
              <input
                id="nc-city"
                type="text"
                value={newCust.city}
                onChange={(e) => setNewCust({ ...newCust, city: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="nc-seg">Segment</label>
              <select
                id="nc-seg"
                value={newCust.segment}
                onChange={(e) =>
                  setNewCust({ ...newCust, segment: e.target.value as 'Wholesale' | 'Retail' })
                }
              >
                <option value="Wholesale">Wholesale</option>
                <option value="Retail">Retail</option>
              </select>
            </div>
          </div>
          <div className="dialog-footer" style={{ padding: '0.75rem 0 0', background: 'transparent' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setAddOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">Save Customer</button>
          </div>
        </form>
      </ModalDialog>

      {/* Add Supplier Modal */}
      <ModalDialog open={addSupOpen} onClose={() => setAddSupOpen(false)} title="Add New Supplier">
        <form onSubmit={handleAddSupplier} className="form-grid">
          {error && <div className="alert-banner alert-danger">{error}</div>}
          <div className="form-row-2">
            <div className="field">
              <label htmlFor="ns-name">Supplier Name *</label>
              <input
                id="ns-name"
                type="text"
                required
                autoFocus
                value={newSup.name}
                onChange={(e) => setNewSup({ ...newSup, name: e.target.value })}
                placeholder="e.g. Metro Wholesale Mart"
              />
            </div>
            <div className="field">
              <label htmlFor="ns-phone">Phone</label>
              <input
                id="ns-phone"
                type="tel"
                value={newSup.phone}
                onChange={(e) => setNewSup({ ...newSup, phone: e.target.value })}
              />
            </div>
          </div>
          <div className="form-row-2">
            <div className="field">
              <label htmlFor="ns-city">City / Mandi</label>
              <input
                id="ns-city"
                type="text"
                value={newSup.city}
                onChange={(e) => setNewSup({ ...newSup, city: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="ns-cat">Category</label>
              <input
                id="ns-cat"
                type="text"
                value={newSup.category}
                onChange={(e) => setNewSup({ ...newSup, category: e.target.value })}
              />
            </div>
          </div>
          <div className="dialog-footer" style={{ padding: '0.75rem 0 0', background: 'transparent' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setAddSupOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">Save Supplier</button>
          </div>
        </form>
      </ModalDialog>

      {/* Collect Customer Payment Modal */}
      <ModalDialog
        open={Boolean(payModalCustomer)}
        onClose={() => setPayModalCustomer(null)}
        title={`Collect Payment: ${payModalCustomer?.name ?? ''}`}
      >
        <form onSubmit={handleCollectSubmit} className="form-grid">
          {error && <div className="alert-banner alert-danger">{error}</div>}
          <div className="field">
            <label htmlFor="kh-inv">Allocate To Invoice</label>
            <select id="kh-inv" value={targetSaleId} onChange={(e) => setTargetSaleId(e.target.value)}>
              <option value="">Oldest unpaid invoice first (FIFO)</option>
              {payModalCustomer &&
                state.sales
                  .filter((s) => s.customerId === payModalCustomer.id && s.balanceDue > 0)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.invoiceNo} — Due {formatINR(s.balanceDue)}
                    </option>
                  ))}
            </select>
          </div>
          <div className="form-row-2">
            <div className="field">
              <label htmlFor="kh-amt">Amount Received (₹) *</label>
              <input
                id="kh-amt"
                type="number"
                min={1}
                required
                autoFocus
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="kh-mode">Mode (Any)</label>
              <input
                id="kh-mode"
                type="text"
                list="khata-mode-datalist"
                value={payMode}
                onChange={(e) => setPayMode(e.target.value)}
              />
            </div>
          </div>
          <datalist id="khata-mode-datalist">
            <option value="BANK_TRANSFER" />
            <option value="UPI" />
            <option value="CASH" />
            <option value="CHEQUE" />
            <option value="Card" />
          </datalist>
          <div className="field">
            <label htmlFor="kh-ref">UTR / Reference</label>
            <input
              id="kh-ref"
              type="text"
              value={payRef}
              onChange={(e) => setPayRef(e.target.value)}
            />
          </div>
          <div className="dialog-footer" style={{ padding: '0.75rem 0 0', background: 'transparent' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setPayModalCustomer(null)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">Confirm Payment</button>
          </div>
        </form>
      </ModalDialog>

      {/* Pay Supplier Modal */}
      <ModalDialog
        open={Boolean(targetSupplier)}
        onClose={() => setTargetSupplier(null)}
        title={`Pay Supplier: ${targetSupplier?.name ?? ''}`}
      >
        <form onSubmit={handleSupPaySubmit} className="form-grid">
          {error && <div className="alert-banner alert-danger">{error}</div>}
          <div className="form-row-2">
            <div className="field">
              <label htmlFor="sp-amt">Amount (₹)</label>
              <input
                id="sp-amt"
                type="number"
                min={1}
                required
                autoFocus
                value={supAmt}
                onChange={(e) => setSupAmt(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="sp-mode">Mode (Any)</label>
              <input
                id="sp-mode"
                type="text"
                list="khata-mode-datalist"
                value={supMode}
                onChange={(e) => setSupMode(e.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="sp-ref">Reference / UTR</label>
            <input id="sp-ref" type="text" value={supRef} onChange={(e) => setSupRef(e.target.value)} />
          </div>
          <div className="dialog-footer" style={{ padding: '0.75rem 0 0', background: 'transparent' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setTargetSupplier(null)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">Confirm Payment</button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
