import React, { useId, useState } from 'react';
import { CheckCircle2, Download, Landmark, RotateCcw, ShieldCheck, Upload } from 'lucide-react';
import { formatDateIN, formatDateTimeIN, formatINR } from '../domain/formatters';
import { CommitCustomerPaymentInput, computeFinancialSummary } from '../domain/ledgerEngine';
import { BankTransaction, BusinessState } from '../domain/types';

interface ReconReportsViewProps {
  state: BusinessState;
  onImportBankTxns: (
    entries: Omit<
      BankTransaction,
      'id' | 'matchStatus' | 'matchedSaleId' | 'matchedCustomerId' | 'confidence'
    >[]
  ) => void;
  onReconcileBankTxn: (input: CommitCustomerPaymentInput) => { ok: boolean; message: string };
  onIgnoreBankTxn: (txnId: string) => void;
  onResetDemo: () => void;
}

export function ReconReportsView({
  state,
  onImportBankTxns,
  onReconcileBankTxn,
  onIgnoreBankTxn,
  onResetDemo,
}: ReconReportsViewProps) {
  const [period, setPeriod] = useState<'ALL' | 'TODAY' | '7D' | '30D'>('ALL');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [manualCustomerByTxn, setManualCustomerByTxn] = useState<Record<string, string>>({});

  const bankCaptionId = useId();
  const perfCaptionId = useId();
  const auditCaptionId = useId();

  const cutoffMs =
    period === 'TODAY'
      ? new Date().setHours(0, 0, 0, 0)
      : period === '7D'
      ? Date.now() - 7 * 86400000
      : period === '30D'
      ? Date.now() - 30 * 86400000
      : 0;

  const filteredState: BusinessState =
    period === 'ALL'
      ? state
      : {
          ...state,
          sales: state.sales.filter((s) => new Date(s.createdAt).getTime() >= cutoffMs),
          purchases: state.purchases.filter((p) => new Date(p.createdAt).getTime() >= cutoffMs),
          expenses: state.expenses.filter((e) => new Date(e.createdAt).getTime() >= cutoffMs),
        };

  const summary = computeFinancialSummary(filteredState);

  const handleImportSample = () => {
    onImportBankTxns([
      {
        date: new Date().toISOString(),
        description: 'NEFT CR / PATEL SUPERMART / UTR44810293',
        referenceNo: 'UTR44810293',
        amount: 38700,
        type: 'CREDIT',
        senderHint: 'Patel Supermart',
      },
    ]);
    setStatusMsg('Imported sample bank credit (₹38,700 from Patel Supermart) for owner verification.');
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const rows = String(reader.result ?? '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.toLowerCase().startsWith('date,'));
      const parsed = rows
        .map((row) => {
          const cols = row.split(',').map((c) => c.trim());
          const amount = Number(cols[3] ?? cols[1]);
          if (!Number.isFinite(amount) || amount <= 0) return null;
          return {
            date: cols[0] || new Date().toISOString(),
            description: cols[1] || 'CSV Bank Credit',
            referenceNo: cols[2] || `CSV-${Math.floor(1000 + Math.random() * 9000)}`,
            amount,
            type: 'CREDIT' as const,
            senderHint: cols[4] || cols[1] || 'CSV Import',
          };
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x));

      if (parsed.length > 0) {
        onImportBankTxns(parsed);
        setStatusMsg(`Imported ${parsed.length} bank credit entries from ${file.name}.`);
      } else {
        setStatusMsg('Could not parse rows (expected CSV: date,description,reference,amount,sender).');
      }
    };
    reader.readAsText(file);
  };

  const handleExportJson = () => {
    const blob = new Blob(
      [JSON.stringify({ generatedAt: new Date().toISOString(), period, summary }, null, 2)],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vyapaarai-report-${period.toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div className="page-header">
        <div>
          <h1>Bank Reconciliation, P&amp;L &amp; Audit</h1>
          <p>
            Verify bank credits against open customer invoices, review P&amp;L and product
            performance, and inspect the immutable audit trail.
          </p>
        </div>
        <div className="toolbar-group">
          <div style={{ display: 'flex', gap: '0.35rem' }} role="group" aria-label="Report period">
            {(
              [
                ['TODAY', 'Today'],
                ['7D', '7 Days'],
                ['30D', '30 Days'],
                ['ALL', 'All Time'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`btn btn-sm ${period === key ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setPeriod(key)}
                aria-pressed={period === key}
              >
                {label}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-sm btn-soft-blue" onClick={handleExportJson}>
            <Download size={14} aria-hidden="true" />
            Export JSON
          </button>
          <button type="button" className="btn btn-sm btn-danger-outline" onClick={onResetDemo}>
            <RotateCcw size={14} aria-hidden="true" />
            Reset Demo
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="alert-banner alert-info" role="status">
          <span>{statusMsg}</span>
        </div>
      )}

      {/* P&L KPIs */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Net Sales Revenue</div>
          <div className="kpi-value">{formatINR(summary.totalRevenue)}</div>
          <div className="kpi-sub">COGS: {formatINR(summary.totalCOGS)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Gross Profit</div>
          <div className="kpi-value" style={{ color: 'var(--success-text)' }}>
            {formatINR(summary.grossProfit)}
          </div>
          <div className="kpi-sub">Margin: {summary.grossMarginPct}%</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Operating Expenses</div>
          <div className="kpi-value" style={{ color: 'var(--warn-text)' }}>
            {formatINR(summary.totalExpenses)}
          </div>
          <div className="kpi-sub">Purchases: {formatINR(summary.totalPurchases)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Net Profit</div>
          <div
            className="kpi-value"
            style={{ color: summary.netProfit >= 0 ? 'var(--brand-dark)' : 'var(--danger-text)' }}
          >
            {formatINR(summary.netProfit)}
          </div>
          <div className="kpi-sub">Gross Profit − Operating Expenses</div>
        </div>
      </div>

      {/* Bank Statement Reconciliation */}
      <section className="card" aria-labelledby="recon-h">
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Landmark size={18} color="var(--brand-primary)" aria-hidden="true" />
            <h2 id="recon-h" className="card-title">
              Bank Credit Reconciliation
            </h2>
          </div>
          <div className="toolbar-group">
            <label className="btn btn-sm btn-secondary" style={{ cursor: 'pointer' }}>
              <Upload size={14} aria-hidden="true" />
              Upload CSV
              <input type="file" accept=".csv,.txt" className="visually-hidden" onChange={handleCsvUpload} />
            </label>
            <button type="button" className="btn btn-sm btn-primary" onClick={handleImportSample}>
              Simulate Bank Credit
            </button>
          </div>
        </div>

        <div className="alert-banner alert-info" style={{ marginBottom: '0.85rem' }}>
          <ShieldCheck size={17} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            Imported statements cover historical periods only. VyapaarAI never asks for banking
            passwords, UPI PINs, or OTPs. Matches require owner confirmation before closing an
            invoice.
          </div>
        </div>

        <div tabIndex={0} role="region" aria-labelledby={bankCaptionId} className="table-wrapper">
          <table className="data-table">
            <caption id={bankCaptionId}>Bank Credits</caption>
            <thead>
              <tr>
                <th scope="col">Reference</th>
                <th scope="col">Statement Entry</th>
                <th scope="col" className="num">Amount</th>
                <th scope="col">Matched Invoice / Customer</th>
                <th scope="col">Status</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {state.bankTransactions.map((txn) => {
                const matchedSale = state.sales.find((s) => s.id === txn.matchedSaleId);
                const selectedCustId =
                  manualCustomerByTxn[txn.id] ?? txn.matchedCustomerId ?? state.customers[0]?.id ?? '';
                return (
                  <tr key={txn.id}>
                    <th scope="row">
                      <div>{txn.referenceNo}</div>
                      <div style={{ fontSize: '0.72rem', fontWeight: 400, color: 'var(--ink-muted)' }}>
                        {formatDateIN(txn.date)}
                      </div>
                    </th>
                    <td data-label="Entry">
                      <div>{txn.description}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--ink-muted)' }}>
                        Sender: {txn.senderHint}
                      </div>
                    </td>
                    <td data-label="Amount" className="num"><strong>{formatINR(txn.amount)}</strong></td>
                    <td data-label="Match">
                      {matchedSale ? (
                        <div>
                          <strong>{matchedSale.invoiceNo}</strong> · {matchedSale.customerName}
                          <div style={{ fontSize: '0.72rem', color: 'var(--ink-muted)' }}>
                            Pending: {formatINR(matchedSale.balanceDue)} ·{' '}
                            {Math.round((txn.confidence ?? 0.85) * 100)}% match
                          </div>
                        </div>
                      ) : txn.matchStatus === 'UNMATCHED' ? (
                        <select
                          aria-label={`Select customer for ${txn.referenceNo}`}
                          value={selectedCustId}
                          onChange={(e) =>
                            setManualCustomerByTxn((prev) => ({
                              ...prev,
                              [txn.id]: e.target.value,
                            }))
                          }
                        >
                          {state.customers.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td data-label="Status">
                      {txn.matchStatus === 'RECONCILED' && <span className="badge badge-success">Reconciled</span>}
                      {txn.matchStatus === 'PROPOSED' && <span className="badge badge-blue">Proposed</span>}
                      {txn.matchStatus === 'UNMATCHED' && <span className="badge badge-warn">Review</span>}
                      {txn.matchStatus === 'IGNORED' && <span className="badge badge-neutral">Ignored</span>}
                    </td>
                    <td data-label="Action">
                      {txn.matchStatus === 'RECONCILED' || txn.matchStatus === 'IGNORED' ? (
                        <span style={{ fontSize: '0.78rem', color: 'var(--ink-muted)' }}>Done</span>
                      ) : (
                        <div style={{ display: 'flex', gap: '0.35rem' }}>
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            onClick={() => {
                              const res = onReconcileBankTxn({
                                customerId: selectedCustId,
                                amount: txn.amount,
                                mode: 'BANK_TRANSFER',
                                referenceNo: txn.referenceNo,
                                targetSaleId: txn.matchedSaleId,
                                source: 'BANK_SYNC',
                                bankTxnId: txn.id,
                                note: `Reconciled from ${txn.description}`,
                              });
                              setStatusMsg(res.message);
                            }}
                          >
                            <CheckCircle2 size={13} aria-hidden="true" />
                            Verify
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            onClick={() => onIgnoreBankTxn(txn.id)}
                          >
                            Ignore
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Product Performance Matrix */}
      <div tabIndex={0} role="region" aria-labelledby={perfCaptionId} className="table-wrapper">
        <table className="data-table">
          <caption id={perfCaptionId}>Product Performance &amp; Profitability</caption>
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col" className="num">Sold</th>
              <th scope="col" className="num">Revenue</th>
              <th scope="col" className="num">Realized Profit</th>
              <th scope="col" className="num">Margin</th>
              <th scope="col">Classification</th>
            </tr>
          </thead>
          <tbody>
            {summary.productAnalytics.map((pa) => (
              <tr key={pa.product.id}>
                <th scope="row">{pa.product.name}</th>
                <td data-label="Sold" className="num">{pa.unitsSold} {pa.product.unit}</td>
                <td data-label="Revenue" className="num">{formatINR(pa.revenue)}</td>
                <td data-label="Profit" className="num" style={{ fontWeight: 700, color: 'var(--success-text)' }}>
                  {formatINR(pa.realizedProfit)}
                </td>
                <td data-label="Margin" className="num">{pa.marginPercent}%</td>
                <td data-label="Classification">
                  <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                    {pa.classificationTags.map((tag) => (
                      <span
                        key={tag}
                        className={`badge ${
                          tag.includes('Best') || tag.includes('Most') || tag.includes('Fast')
                            ? 'badge-success'
                            : tag.includes('Slow') || tag.includes('Worst')
                            ? 'badge-warn'
                            : 'badge-neutral'
                        }`}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Immutable Audit Log */}
      <div tabIndex={0} role="region" aria-labelledby={auditCaptionId} className="table-wrapper">
        <table className="data-table">
          <caption id={auditCaptionId}>Immutable Audit Trail</caption>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Actor</th>
              <th scope="col">Action</th>
              <th scope="col">Summary</th>
            </tr>
          </thead>
          <tbody>
            {state.auditLogs.map((log) => (
              <tr key={log.id}>
                <th scope="row">{formatDateTimeIN(log.timestamp)}</th>
                <td data-label="Actor">{log.actor}</td>
                <td data-label="Action"><span className="badge badge-blue">{log.action}</span></td>
                <td data-label="Summary">
                  <div>{log.summary}</div>
                  {log.sourceInput && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--ink-muted)' }}>
                      Source: “{log.sourceInput}”
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
