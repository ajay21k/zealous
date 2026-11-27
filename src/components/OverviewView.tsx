import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  IndianRupee,
  Package,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { formatDateTimeIN, formatINR } from '../domain/formatters';
import { computeFinancialSummary } from '../domain/ledgerEngine';
import { BusinessState, Product } from '../domain/types';
import { SyncStateBadge } from './StatusBadges';

interface OverviewViewProps {
  state: BusinessState;
  onNavigate: (tab: string) => void;
  onQuickRestock: (product: Product, qty: number) => void;
}

export function OverviewView({ state, onNavigate, onQuickRestock }: OverviewViewProps) {
  const summary = computeFinancialSummary(state);

  const lowStockItems = summary.productAnalytics.filter(
    (p) => p.alertStatus === 'LOW_STOCK' || p.alertStatus === 'OUT_OF_STOCK'
  );

  // Aggregate last 7 days revenue for lightweight crisp SVG/CSS chart
  const recentSalesByDay = (() => {
    const map = new Map<string, number>();
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const label = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      map.set(label, 0);
    }
    for (const s of state.sales) {
      if (s.status === 'RETURNED') continue;
      const label = new Date(s.createdAt).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
      });
      if (map.has(label)) {
        map.set(label, (map.get(label) ?? 0) + s.netTotal);
      }
    }
    return Array.from(map.entries()).map(([label, amount]) => ({ label, amount }));
  })();

  const maxDailyRevenue = Math.max(1, ...recentSalesByDay.map((d) => d.amount));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div className="page-header">
        <div>
          <h1>Business Overview</h1>
          <p>
            Unified real-time ledger across voice transactions, stock movements, customer khata and
            P&amp;L.
          </p>
        </div>
        <div className="toolbar-group">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onNavigate('transactions:sales')}
          >
            + New Sale
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onNavigate('transactions:purchases')}
          >
            + Record Purchase
          </button>
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">
            <span>Total Sales Revenue</span>
            <TrendingUp size={16} color="var(--brand-primary)" aria-hidden="true" />
          </div>
          <div className="kpi-value">{formatINR(summary.totalRevenue)}</div>
          <div className="kpi-sub">{state.sales.length} invoices · COGS {formatINR(summary.totalCOGS)}</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">
            <span>Gross Profit</span>
            <IndianRupee size={16} color="var(--success-text)" aria-hidden="true" />
          </div>
          <div className="kpi-value" style={{ color: 'var(--success-text)' }}>
            {formatINR(summary.grossProfit)}
          </div>
          <div className="kpi-sub">Gross Margin: {summary.grossMarginPct}% (Sales − COGS)</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">
            <span>Estimated Net Profit</span>
            <Wallet size={16} color="var(--brand-primary)" aria-hidden="true" />
          </div>
          <div
            className="kpi-value"
            style={{ color: summary.netProfit >= 0 ? 'var(--brand-dark)' : 'var(--danger-text)' }}
          >
            {formatINR(summary.netProfit)}
          </div>
          <div className="kpi-sub">After {formatINR(summary.totalExpenses)} operating expenses</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">
            <span>Receivables (Customer Khata)</span>
            <ArrowDownLeft size={16} color="var(--warn-text)" aria-hidden="true" />
          </div>
          <div className="kpi-value" style={{ color: 'var(--warn-text)' }}>
            {formatINR(summary.totalReceivables)}
          </div>
          <div className="kpi-sub">
            <button
              type="button"
              className="btn btn-sm btn-soft-blue"
              style={{ marginTop: '0.2rem' }}
              onClick={() => onNavigate('khata')}
            >
              Collect Pending Dues
            </button>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">
            <span>Payables (Suppliers)</span>
            <ArrowUpRight size={16} color="var(--ink-muted)" aria-hidden="true" />
          </div>
          <div className="kpi-value">{formatINR(summary.totalPayables)}</div>
          <div className="kpi-sub">Across {formatINR(summary.totalPurchases)} total purchases</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">
            <span>Inventory Valuation</span>
            <Package size={16} color="var(--brand-primary)" aria-hidden="true" />
          </div>
          <div className="kpi-value">{formatINR(summary.inventoryValue)}</div>
          <div className="kpi-sub">
            {summary.lowStockCount > 0 ? (
              <span style={{ color: 'var(--danger-text)', fontWeight: 600 }}>
                {summary.lowStockCount} item(s) below reorder level
              </span>
            ) : (
              'All stock levels healthy'
            )}
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="two-col-grid">
        <section className="card" aria-labelledby="chart-daily-sales-heading">
          <div className="card-header">
            <h2 id="chart-daily-sales-heading" className="card-title">
              7-Day Sales Revenue Trend
            </h2>
            <span className="badge badge-blue">Live Ledger</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {recentSalesByDay.map((day) => (
              <div key={day.label} className="bar-row">
                <span style={{ color: 'var(--ink-secondary)', fontWeight: 500 }}>{day.label}</span>
                <div className="bar-track" aria-hidden="true">
                  <div
                    className="bar-fill"
                    style={{ width: `${Math.round((day.amount / maxDailyRevenue) * 100)}%` }}
                  />
                </div>
                <span className="num" style={{ fontWeight: 600 }}>
                  {formatINR(day.amount)}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="card" aria-labelledby="chart-pl-heading">
          <div className="card-header">
            <h2 id="chart-pl-heading" className="card-title">
              Financial P&amp;L Breakdown
            </h2>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => onNavigate('audit')}>
              Full Reports
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {[
              { label: 'Net Sales Revenue', value: summary.totalRevenue, color: 'var(--brand-primary)' },
              { label: 'Cost of Goods Sold', value: summary.totalCOGS, color: '#64748b' },
              { label: 'Gross Profit', value: summary.grossProfit, color: 'var(--success-text)' },
              { label: 'Operating Expenses', value: summary.totalExpenses, color: 'var(--warn-text)' },
              { label: 'Net Profit', value: summary.netProfit, color: 'var(--brand-dark)' },
            ].map((row) => {
              const base = Math.max(1, summary.totalRevenue);
              const pct = Math.max(0, Math.min(100, Math.round((Math.abs(row.value) / base) * 100)));
              return (
                <div key={row.label} className="bar-row">
                  <span style={{ fontWeight: 500 }}>{row.label}</span>
                  <div className="bar-track" aria-hidden="true">
                    <div className="bar-fill" style={{ width: `${pct}%`, background: row.color }} />
                  </div>
                  <span className="num" style={{ fontWeight: 700, color: row.color }}>
                    {formatINR(row.value)}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Low Stock Alerts & Recent Activity */}
      <div className="two-col-grid">
        <section className="card" aria-labelledby="alerts-heading">
          <div className="card-header">
            <h2 id="alerts-heading" className="card-title">
              Restock &amp; Inventory Alerts
            </h2>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => onNavigate('inventory')}>
              Manage Inventory
            </button>
          </div>
          {lowStockItems.length === 0 ? (
            <div className="alert-banner alert-success">All products are above minimum stock levels.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {lowStockItems.map((item) => (
                <div
                  key={item.product.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    padding: '0.65rem 0.8rem',
                    border: '1px solid var(--warn-border)',
                    background: 'var(--warn-bg)',
                    borderRadius: 'var(--radius-sm)',
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <AlertTriangle size={15} color="var(--warn-text)" aria-hidden="true" />
                      {item.product.name}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--ink-secondary)' }}>
                      Current: <strong>{item.product.currentStock} {item.product.unit}</strong> · Reorder
                      at {item.product.reorderLevel} · Suggested order: +{item.suggestedRestockQty}{' '}
                      {item.product.unit}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => onQuickRestock(item.product, item.suggestedRestockQty)}
                  >
                    Restock +{item.suggestedRestockQty}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card" aria-labelledby="activity-heading">
          <div className="card-header">
            <h2 id="activity-heading" className="card-title">
              Recent Sales &amp; Audit Activity
            </h2>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => onNavigate('audit')}>
              Audit Trail
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            {state.sales.slice(0, 5).map((sale) => (
              <div
                key={sale.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.75rem',
                  paddingBottom: '0.6rem',
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>
                    {sale.invoiceNo} · {sale.customerName}
                  </div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--ink-muted)' }}>
                    {sale.items.map((i) => `${i.quantity} ${i.unit} ${i.productName}`).join(', ')} ·{' '}
                    {formatDateTimeIN(sale.createdAt)}
                  </div>
                </div>
                <div style={{ textAlign: 'end' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{formatINR(sale.netTotal)}</div>
                  <SyncStateBadge state={sale.syncState} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
