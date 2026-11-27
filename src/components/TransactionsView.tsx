import React, { useEffect, useId, useState } from 'react';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { formatDateTimeIN, formatINR } from '../domain/formatters';
import {
  CommitExpenseInput,
  CommitPurchaseInput,
  CommitSaleInput,
} from '../domain/ledgerEngine';
import { BusinessState, ExpenseCategory, PaymentMode, Sale } from '../domain/types';
import { ModalDialog } from './ModalDialog';
import { PaymentStatusBadge } from './StatusBadges';

interface TransactionsViewProps {
  state: BusinessState;
  initialSubTab?: 'sales' | 'purchases' | 'expenses';
  prefillRestock?: { productId: string; quantity: number } | null;
  onClearPrefill: () => void;
  onCommitSale: (input: CommitSaleInput) => { ok: boolean; message: string };
  onReturnSale: (
    saleId: string,
    productId: string,
    returnQty: number,
    reason: string
  ) => { ok: boolean; message: string };
  onCommitPurchase: (input: CommitPurchaseInput) => { ok: boolean; message: string };
  onCommitExpense: (input: CommitExpenseInput) => { ok: boolean; message: string };
}

interface DraftLine {
  productName: string;
  unit: string;
  quantity: number;
  price: number;
}

const EXPENSE_SUGGESTIONS = [
  'Rent',
  'Salaries',
  'Transport',
  'Electricity',
  'Maintenance',
  'Packaging',
  'Staff Tea & Snacks',
  'GST / Tax',
  'Other',
];

const UNIT_SUGGESTIONS = [
  'bags',
  'kg',
  'g',
  'boxes',
  'packets',
  'litres',
  'tins',
  'pieces',
  'dozens',
  'crates',
];

const PAYMENT_SUGGESTIONS = ['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'CREDIT', 'Card'];

export function TransactionsView({
  state,
  initialSubTab = 'sales',
  prefillRestock,
  onClearPrefill,
  onCommitSale,
  onReturnSale,
  onCommitPurchase,
  onCommitExpense,
}: TransactionsViewProps) {
  const [subTab, setSubTab] = useState<'sales' | 'purchases' | 'expenses'>(initialSubTab);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | Sale['status']>('ALL');

  // Sale Modal (unrestricted + multi-item)
  const [saleOpen, setSaleOpen] = useState(false);
  const [saleCustomerName, setSaleCustomerName] = useState(state.customers[0]?.name ?? '');
  const [saleLines, setSaleLines] = useState<DraftLine[]>([
    {
      productName: state.products[0]?.name ?? '',
      unit: state.products[0]?.unit ?? 'bags',
      quantity: 10,
      price: state.products[0]?.defaultSellPrice ?? 100,
    },
  ]);
  const [saleDiscount, setSaleDiscount] = useState('0');
  const [salePaid, setSalePaid] = useState('');
  const [saleMode, setSaleMode] = useState<PaymentMode>('UPI');

  // Return Modal
  const [returnTarget, setReturnTarget] = useState<Sale | null>(null);
  const [returnProductId, setReturnProductId] = useState('');
  const [returnQty, setReturnQty] = useState('1');
  const [returnReason, setReturnReason] = useState('Damaged or returned stock');

  // Purchase Modal (unrestricted + multi-item)
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [purSupplierName, setPurSupplierName] = useState(state.suppliers[0]?.name ?? '');
  const [purLines, setPurLines] = useState<DraftLine[]>([
    {
      productName: state.products[0]?.name ?? '',
      unit: state.products[0]?.unit ?? 'bags',
      quantity: 50,
      price: state.products[0]?.avgCostPrice ?? 100,
    },
  ]);
  const [purPaid, setPurPaid] = useState('');
  const [purMode, setPurMode] = useState<PaymentMode>('BANK_TRANSFER');

  // Expense Modal (unrestricted category & mode)
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expCategory, setExpCategory] = useState<ExpenseCategory>('Transport');
  const [expDesc, setExpDesc] = useState('');
  const [expAmt, setExpAmt] = useState('');
  const [expMode, setExpMode] = useState<PaymentMode>('CASH');

  const [formError, setFormError] = useState<string | null>(null);

  const searchId = useId();
  const statusId = useId();
  const salesCaptionId = useId();
  const purCaptionId = useId();
  const expCaptionId = useId();

  useEffect(() => {
    if (prefillRestock) {
      const p = state.products.find((x) => x.id === prefillRestock.productId);
      setSubTab('purchases');
      if (p) {
        setPurLines([
          {
            productName: p.name,
            unit: p.unit,
            quantity: prefillRestock.quantity,
            price: p.avgCostPrice,
          },
        ]);
      }
      setFormError(null);
      setPurchaseOpen(true);
      onClearPrefill();
    }
  }, [prefillRestock, state.products, onClearPrefill]);

  const saleSubtotal = saleLines.reduce(
    (sum, l) => sum + Math.max(0, (l.quantity || 0) * (l.price || 0)),
    0
  );
  const saleNet = Math.max(0, saleSubtotal - (Number(saleDiscount) || 0));
  const purTotal = purLines.reduce(
    (sum, l) => sum + Math.max(0, (l.quantity || 0) * (l.price || 0)),
    0
  );

  const filteredSales = state.sales.filter((s) => {
    const q = search.trim().toLowerCase();
    const match =
      !q ||
      s.invoiceNo.toLowerCase().includes(q) ||
      s.customerName.toLowerCase().includes(q) ||
      s.items.some((i) => i.productName.toLowerCase().includes(q));
    if (!match) return false;
    if (statusFilter !== 'ALL' && s.status !== statusFilter) return false;
    return true;
  });

  const handleCreateSale = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const matchedCust = state.customers.find(
      (c) => c.name.toLowerCase() === saleCustomerName.trim().toLowerCase()
    );
    const paid = salePaid === '' ? saleNet : Number(salePaid);
    const res = onCommitSale({
      customerId: matchedCust?.id,
      customerName: saleCustomerName,
      items: saleLines.map((l) => {
        const matchedProd = state.products.find(
          (p) => p.name.toLowerCase() === l.productName.trim().toLowerCase()
        );
        return {
          productId: matchedProd?.id,
          productName: l.productName,
          unit: l.unit,
          quantity: Number(l.quantity),
          unitPrice: Number(l.price),
        };
      }),
      discount: Number(saleDiscount) || 0,
      amountPaid: paid,
      paymentMode: saleMode,
      source: 'DASHBOARD',
    });
    if (!res.ok) {
      setFormError(res.message);
      return;
    }
    setSaleOpen(false);
    setSalePaid('');
    setSaleDiscount('0');
  };

  const handleReturnSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnTarget) return;
    setFormError(null);
    const res = onReturnSale(returnTarget.id, returnProductId, Number(returnQty), returnReason);
    if (!res.ok) {
      setFormError(res.message);
      return;
    }
    setReturnTarget(null);
  };

  const handleCreatePurchase = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const matchedSup = state.suppliers.find(
      (s) => s.name.toLowerCase() === purSupplierName.trim().toLowerCase()
    );
    const paid = purPaid === '' ? purTotal : Number(purPaid);
    const res = onCommitPurchase({
      supplierId: matchedSup?.id,
      supplierName: purSupplierName,
      items: purLines.map((l) => {
        const matchedProd = state.products.find(
          (p) => p.name.toLowerCase() === l.productName.trim().toLowerCase()
        );
        return {
          productId: matchedProd?.id,
          productName: l.productName,
          unit: l.unit,
          quantity: Number(l.quantity),
          unitCost: Number(l.price),
        };
      }),
      amountPaid: paid,
      paymentMode: purMode,
      source: 'DASHBOARD',
    });
    if (!res.ok) {
      setFormError(res.message);
      return;
    }
    setPurchaseOpen(false);
    setPurPaid('');
  };

  const handleCreateExpense = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const res = onCommitExpense({
      category: expCategory.trim() || 'Other',
      description: expDesc,
      amount: Number(expAmt),
      paymentMode: expMode.trim() || 'CASH',
      source: 'DASHBOARD',
    });
    if (!res.ok) {
      setFormError(res.message);
      return;
    }
    setExpenseOpen(false);
    setExpDesc('');
    setExpAmt('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
      <div className="page-header">
        <div>
          <h1>Transactions Ledger</h1>
          <p>
            Unrestricted sales, purchases, and expenses — type any existing or brand-new item,
            unit, customer, supplier, or category.
          </p>
        </div>
        <div className="toolbar-group">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setFormError(null);
              setSaleOpen(true);
            }}
          >
            <Plus size={16} aria-hidden="true" />
            New Sale
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setFormError(null);
              setPurchaseOpen(true);
            }}
          >
            + Purchase
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setFormError(null);
              setExpenseOpen(true);
            }}
          >
            + Expense
          </button>
        </div>
      </div>

      {/* Shared Datalists for Unrestricted Autocomplete */}
      <datalist id="tx-products-datalist">
        {state.products.map((p) => (
          <option key={p.id} value={p.name}>
            Stock: {p.currentStock} {p.unit}
          </option>
        ))}
      </datalist>
      <datalist id="tx-customers-datalist">
        {state.customers.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>
      <datalist id="tx-suppliers-datalist">
        {state.suppliers.map((s) => (
          <option key={s.id} value={s.name} />
        ))}
      </datalist>
      <datalist id="tx-units-datalist">
        {UNIT_SUGGESTIONS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
      <datalist id="tx-payment-datalist">
        {PAYMENT_SUGGESTIONS.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <datalist id="tx-expense-cat-datalist">
        {EXPENSE_SUGGESTIONS.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      {/* Sub-tabs */}
      <div className="subtab-row" role="tablist" aria-label="Transaction type">
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'sales'}
          className={`btn btn-sm ${subTab === 'sales' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setSubTab('sales')}
        >
          Sales &amp; Returns ({state.sales.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'purchases'}
          className={`btn btn-sm ${subTab === 'purchases' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setSubTab('purchases')}
        >
          Purchases &amp; Stock Intake ({state.purchases.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'expenses'}
          className={`btn btn-sm ${subTab === 'expenses' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setSubTab('expenses')}
        >
          Operating Expenses ({state.expenses.length})
        </button>
      </div>

      {/* SALES TAB */}
      {subTab === 'sales' && (
        <>
          <search className="card">
            <form onSubmit={(e) => e.preventDefault()} className="toolbar" aria-label="Filter sales">
              <div className="field" style={{ flex: '1 1 240px' }}>
                <label htmlFor={searchId}>Search Invoice, Customer, or Product</label>
                <input
                  id={searchId}
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="e.g. INV-2026, Kumar Traders, Rice..."
                />
              </div>
              <div className="field" style={{ minWidth: '170px' }}>
                <label htmlFor={statusId}>Status</label>
                <select
                  id={statusId}
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as 'ALL' | Sale['status'])}
                >
                  <option value="ALL">All ({state.sales.length})</option>
                  <option value="PAID">Paid</option>
                  <option value="PARTIAL">Partial</option>
                  <option value="PENDING">Pending</option>
                  <option value="RETURNED">Returned</option>
                </select>
              </div>
            </form>
          </search>

          <div tabIndex={0} role="region" aria-labelledby={salesCaptionId} className="table-wrapper">
            <table className="data-table">
              <caption id={salesCaptionId}>Sales Invoices</caption>
              <thead>
                <tr>
                  <th scope="col">Invoice</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Items</th>
                  <th scope="col" className="num">Net Total</th>
                  <th scope="col" className="num">Paid</th>
                  <th scope="col" className="num">Due</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSales.map((sale) => (
                  <tr key={sale.id}>
                    <th scope="row">
                      <div>{sale.invoiceNo}</div>
                      <div style={{ fontSize: '0.72rem', fontWeight: 400, color: 'var(--ink-muted)' }}>
                        {formatDateTimeIN(sale.createdAt)} · {sale.source}
                      </div>
                    </th>
                    <td data-label="Customer">{sale.customerName}</td>
                    <td data-label="Items">
                      {sale.items.map((i) => (
                        <div key={`${i.productId}-${i.productName}`}>
                          {i.quantity} {i.unit} {i.productName}
                          {i.returnedQty ? ` (-${i.returnedQty} returned)` : ''}
                        </div>
                      ))}
                      {sale.refundedAmount ? (
                        <div style={{ fontSize: '0.73rem', color: 'var(--warn-text)', fontWeight: 600 }}>
                          Refund due/issued: {formatINR(sale.refundedAmount)}
                        </div>
                      ) : null}
                    </td>
                    <td data-label="Net Total" className="num">
                      <strong>{formatINR(sale.netTotal)}</strong>
                    </td>
                    <td data-label="Paid" className="num">
                      {formatINR(sale.amountPaid)}
                      <div style={{ fontSize: '0.71rem', color: 'var(--ink-muted)' }}>{sale.paymentMode}</div>
                    </td>
                    <td
                      data-label="Due"
                      className="num"
                      style={{
                        fontWeight: 700,
                        color: sale.balanceDue > 0 ? 'var(--warn-text)' : 'var(--success-text)',
                      }}
                    >
                      {formatINR(sale.balanceDue)}
                    </td>
                    <td data-label="Status">
                      <PaymentStatusBadge status={sale.status} />
                    </td>
                    <td data-label="Actions">
                      {sale.status !== 'RETURNED' && (
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          onClick={() => {
                            setFormError(null);
                            setReturnTarget(sale);
                            setReturnProductId(sale.items[0]?.productId ?? '');
                            setReturnQty('1');
                          }}
                        >
                          <RotateCcw size={13} aria-hidden="true" />
                          Return
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* PURCHASES TAB */}
      {subTab === 'purchases' && (
        <div tabIndex={0} role="region" aria-labelledby={purCaptionId} className="table-wrapper">
          <table className="data-table">
            <caption id={purCaptionId}>Supplier Purchases</caption>
            <thead>
              <tr>
                <th scope="col">Bill No</th>
                <th scope="col">Supplier</th>
                <th scope="col">Items Procured</th>
                <th scope="col" className="num">Total Cost</th>
                <th scope="col" className="num">Paid</th>
                <th scope="col" className="num">Payable</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {state.purchases.map((pur) => (
                <tr key={pur.id}>
                  <th scope="row">
                    <div>{pur.billNo}</div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 400, color: 'var(--ink-muted)' }}>
                      {formatDateTimeIN(pur.createdAt)} · {pur.source}
                    </div>
                  </th>
                  <td data-label="Supplier">{pur.supplierName}</td>
                  <td data-label="Items">
                    {pur.items.map((i) => (
                      <div key={`${i.productId}-${i.productName}`}>
                        +{i.quantity} {i.unit} {i.productName} @ {formatINR(i.unitCost)}
                      </div>
                    ))}
                  </td>
                  <td data-label="Total Cost" className="num">
                    <strong>{formatINR(pur.totalAmount)}</strong>
                  </td>
                  <td data-label="Paid" className="num">{formatINR(pur.amountPaid)}</td>
                  <td
                    data-label="Payable"
                    className="num"
                    style={{
                      fontWeight: 700,
                      color: pur.balanceDue > 0 ? 'var(--warn-text)' : 'var(--success-text)',
                    }}
                  >
                    {formatINR(pur.balanceDue)}
                  </td>
                  <td data-label="Status">
                    <PaymentStatusBadge status={pur.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* EXPENSES TAB */}
      {subTab === 'expenses' && (
        <div tabIndex={0} role="region" aria-labelledby={expCaptionId} className="table-wrapper">
          <table className="data-table">
            <caption id={expCaptionId}>Operating Expenses</caption>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">Description</th>
                <th scope="col">Mode</th>
                <th scope="col" className="num">Amount</th>
                <th scope="col">Recorded At</th>
              </tr>
            </thead>
            <tbody>
              {state.expenses.map((exp) => (
                <tr key={exp.id}>
                  <th scope="row">
                    <span className="badge badge-blue">{exp.category}</span>
                  </th>
                  <td data-label="Description">{exp.description}</td>
                  <td data-label="Mode">{exp.paymentMode}</td>
                  <td data-label="Amount" className="num">
                    <strong>{formatINR(exp.amount)}</strong>
                  </td>
                  <td data-label="Recorded At">{formatDateTimeIN(exp.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* New Sale Modal (Unrestricted + Multi-item) */}
      <ModalDialog open={saleOpen} onClose={() => setSaleOpen(false)} title="Record Sale (Any Item or Customer)" wide>
        <form onSubmit={handleCreateSale} className="form-grid">
          {formError && <div className="alert-banner alert-danger">{formError}</div>}
          <div className="form-row-2">
            <div className="field">
              <label htmlFor="tx-sale-cust">Customer (Pick or Type New)</label>
              <input
                id="tx-sale-cust"
                type="text"
                list="tx-customers-datalist"
                autoFocus
                value={saleCustomerName}
                onChange={(e) => setSaleCustomerName(e.target.value)}
                placeholder="Type any customer name..."
              />
            </div>
            <div className="field">
              <label htmlFor="tx-sale-mode">Payment Mode (Any)</label>
              <input
                id="tx-sale-mode"
                type="text"
                list="tx-payment-datalist"
                value={saleMode}
                onChange={(e) => setSaleMode(e.target.value)}
                placeholder="Cash, UPI, Card, Credit..."
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: '0.88rem' }}>Items</strong>
              <button
                type="button"
                className="btn btn-sm btn-soft-blue"
                onClick={() =>
                  setSaleLines((prev) => [
                    ...prev,
                    { productName: '', unit: 'units', quantity: 1, price: 0 },
                  ])
                }
              >
                + Add Item Row
              </button>
            </div>
            {saleLines.map((line, idx) => (
              <div
                key={idx}
                className="tx-line-grid"
              >
                <div className="field">
                  <label htmlFor={`sl-prod-${idx}`}>Product (Any)</label>
                  <input
                    id={`sl-prod-${idx}`}
                    type="text"
                    required
                    list="tx-products-datalist"
                    value={line.productName}
                    onChange={(e) => {
                      const val = e.target.value;
                      const matched = state.products.find(
                        (p) => p.name.toLowerCase() === val.trim().toLowerCase()
                      );
                      setSaleLines((prev) =>
                        prev.map((row, i) =>
                          i === idx
                            ? {
                                ...row,
                                productName: val,
                                unit: matched?.unit ?? row.unit,
                                price: matched ? matched.defaultSellPrice : row.price,
                              }
                            : row
                        )
                      );
                    }}
                    placeholder="Type any item..."
                  />
                </div>
                <div className="field">
                  <label htmlFor={`sl-unit-${idx}`}>Unit</label>
                  <input
                    id={`sl-unit-${idx}`}
                    type="text"
                    list="tx-units-datalist"
                    value={line.unit}
                    onChange={(e) =>
                      setSaleLines((prev) =>
                        prev.map((row, i) => (i === idx ? { ...row, unit: e.target.value } : row))
                      )
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor={`sl-qty-${idx}`}>Qty</label>
                  <input
                    id={`sl-qty-${idx}`}
                    type="number"
                    min={1}
                    required
                    value={line.quantity}
                    onChange={(e) =>
                      setSaleLines((prev) =>
                        prev.map((row, i) =>
                          i === idx ? { ...row, quantity: Number(e.target.value) } : row
                        )
                      )
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor={`sl-price-${idx}`}>Price (₹)</label>
                  <input
                    id={`sl-price-${idx}`}
                    type="number"
                    min={0}
                    required
                    value={line.price}
                    onChange={(e) =>
                      setSaleLines((prev) =>
                        prev.map((row, i) =>
                          i === idx ? { ...row, price: Number(e.target.value) } : row
                        )
                      )
                    }
                  />
                </div>
                {saleLines.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-sm btn-danger-outline"
                    aria-label="Remove item row"
                    onClick={() => setSaleLines((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="form-row-2">
            <div className="field">
              <label htmlFor="tx-sale-disc">Discount (₹)</label>
              <input
                id="tx-sale-disc"
                type="number"
                min={0}
                value={saleDiscount}
                onChange={(e) => setSaleDiscount(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="tx-sale-paid">Amount Received (₹)</label>
              <input
                id="tx-sale-paid"
                type="number"
                min={0}
                max={saleNet}
                value={salePaid}
                onChange={(e) => setSalePaid(e.target.value)}
                placeholder={`Default: ${saleNet}`}
              />
            </div>
          </div>
          <div className="alert-banner alert-info">Net Total: <strong>{formatINR(saleNet)}</strong></div>
          <div className="dialog-footer" style={{ padding: '0.75rem 0 0', background: 'transparent' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setSaleOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">Confirm Sale</button>
          </div>
        </form>
      </ModalDialog>

      {/* Return Modal */}
      <ModalDialog
        open={Boolean(returnTarget)}
        onClose={() => setReturnTarget(null)}
        title={`Sales Return: ${returnTarget?.invoiceNo ?? ''}`}
      >
        <form onSubmit={handleReturnSubmit} className="form-grid">
          {formError && <div className="alert-banner alert-danger">{formError}</div>}
          <div className="field">
            <label htmlFor="tx-ret-item">Returned Item</label>
            <select
              id="tx-ret-item"
              value={returnProductId}
              onChange={(e) => setReturnProductId(e.target.value)}
            >
              {returnTarget?.items.map((it) => (
                <option key={it.productId} value={it.productId}>
                  {it.productName} (Max returnable: {it.quantity - (it.returnedQty ?? 0)})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="tx-ret-qty">Return Quantity</label>
            <input
              id="tx-ret-qty"
              type="number"
              min={1}
              required
              autoFocus
              value={returnQty}
              onChange={(e) => setReturnQty(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="tx-ret-reason">Reason</label>
            <input
              id="tx-ret-reason"
              type="text"
              required
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
            />
          </div>
          <div className="dialog-footer" style={{ padding: '0.75rem 0 0', background: 'transparent' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setReturnTarget(null)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">Record Return</button>
          </div>
        </form>
      </ModalDialog>

      {/* Purchase Modal (Unrestricted + Multi-item) */}
      <ModalDialog open={purchaseOpen} onClose={() => setPurchaseOpen(false)} title="Record Purchase (Any Item or Supplier)" wide>
        <form onSubmit={handleCreatePurchase} className="form-grid">
          {formError && <div className="alert-banner alert-danger">{formError}</div>}
          <div className="form-row-2">
            <div className="field">
              <label htmlFor="tx-pur-sup">Supplier (Pick or Type New)</label>
              <input
                id="tx-pur-sup"
                type="text"
                list="tx-suppliers-datalist"
                autoFocus
                value={purSupplierName}
                onChange={(e) => setPurSupplierName(e.target.value)}
                placeholder="Type any supplier name..."
              />
            </div>
            <div className="field">
              <label htmlFor="tx-pur-mode">Payment Mode (Any)</label>
              <input
                id="tx-pur-mode"
                type="text"
                list="tx-payment-datalist"
                value={purMode}
                onChange={(e) => setPurMode(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: '0.88rem' }}>Items Procured</strong>
              <button
                type="button"
                className="btn btn-sm btn-soft-blue"
                onClick={() =>
                  setPurLines((prev) => [
                    ...prev,
                    { productName: '', unit: 'units', quantity: 10, price: 0 },
                  ])
                }
              >
                + Add Item Row
              </button>
            </div>
            {purLines.map((line, idx) => (
              <div
                key={idx}
                className="tx-line-grid"
              >
                <div className="field">
                  <label htmlFor={`pl-prod-${idx}`}>Product (Any)</label>
                  <input
                    id={`pl-prod-${idx}`}
                    type="text"
                    required
                    list="tx-products-datalist"
                    value={line.productName}
                    onChange={(e) => {
                      const val = e.target.value;
                      const matched = state.products.find(
                        (p) => p.name.toLowerCase() === val.trim().toLowerCase()
                      );
                      setPurLines((prev) =>
                        prev.map((row, i) =>
                          i === idx
                            ? {
                                ...row,
                                productName: val,
                                unit: matched?.unit ?? row.unit,
                                price: matched ? matched.avgCostPrice : row.price,
                              }
                            : row
                        )
                      );
                    }}
                    placeholder="Type any new or existing item..."
                  />
                </div>
                <div className="field">
                  <label htmlFor={`pl-unit-${idx}`}>Unit</label>
                  <input
                    id={`pl-unit-${idx}`}
                    type="text"
                    list="tx-units-datalist"
                    value={line.unit}
                    onChange={(e) =>
                      setPurLines((prev) =>
                        prev.map((row, i) => (i === idx ? { ...row, unit: e.target.value } : row))
                      )
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor={`pl-qty-${idx}`}>Qty</label>
                  <input
                    id={`pl-qty-${idx}`}
                    type="number"
                    min={1}
                    required
                    value={line.quantity}
                    onChange={(e) =>
                      setPurLines((prev) =>
                        prev.map((row, i) =>
                          i === idx ? { ...row, quantity: Number(e.target.value) } : row
                        )
                      )
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor={`pl-cost-${idx}`}>Unit Cost (₹)</label>
                  <input
                    id={`pl-cost-${idx}`}
                    type="number"
                    min={1}
                    required
                    value={line.price}
                    onChange={(e) =>
                      setPurLines((prev) =>
                        prev.map((row, i) =>
                          i === idx ? { ...row, price: Number(e.target.value) } : row
                        )
                      )
                    }
                  />
                </div>
                {purLines.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-sm btn-danger-outline"
                    aria-label="Remove item row"
                    onClick={() => setPurLines((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="field">
            <label htmlFor="tx-pur-paid">Amount Paid (₹)</label>
            <input
              id="tx-pur-paid"
              type="number"
              min={0}
              max={purTotal}
              value={purPaid}
              onChange={(e) => setPurPaid(e.target.value)}
              placeholder={`Default: ${purTotal}`}
            />
          </div>
          <div className="alert-banner alert-info">Total Purchase Cost: <strong>{formatINR(purTotal)}</strong></div>
          <div className="dialog-footer" style={{ padding: '0.75rem 0 0', background: 'transparent' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setPurchaseOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">Confirm Purchase</button>
          </div>
        </form>
      </ModalDialog>

      {/* Expense Modal (Unrestricted Category & Mode) */}
      <ModalDialog open={expenseOpen} onClose={() => setExpenseOpen(false)} title="Record Operating Expense">
        <form onSubmit={handleCreateExpense} className="form-grid">
          {formError && <div className="alert-banner alert-danger">{formError}</div>}
          <div className="form-row-2">
            <div className="field">
              <label htmlFor="tx-exp-cat">Category (Pick or Type Any)</label>
              <input
                id="tx-exp-cat"
                type="text"
                required
                autoFocus
                list="tx-expense-cat-datalist"
                value={expCategory}
                onChange={(e) => setExpCategory(e.target.value)}
                placeholder="Rent, Diesel, Staff Tea, Tax..."
              />
            </div>
            <div className="field">
              <label htmlFor="tx-exp-amt">Amount (₹)</label>
              <input
                id="tx-exp-amt"
                type="number"
                min={1}
                required
                value={expAmt}
                onChange={(e) => setExpAmt(e.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="tx-exp-desc">Description</label>
            <input
              id="tx-exp-desc"
              type="text"
              required
              value={expDesc}
              onChange={(e) => setExpDesc(e.target.value)}
              placeholder="e.g. Tempo freight & loading"
            />
          </div>
          <div className="field">
            <label htmlFor="tx-exp-mode">Payment Mode (Any)</label>
            <input
              id="tx-exp-mode"
              type="text"
              list="tx-payment-datalist"
              value={expMode}
              onChange={(e) => setExpMode(e.target.value)}
            />
          </div>
          <div className="dialog-footer" style={{ padding: '0.75rem 0 0', background: 'transparent' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setExpenseOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">Save Expense</button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
