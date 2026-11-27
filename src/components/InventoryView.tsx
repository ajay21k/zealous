import React, { useId, useState } from 'react';
import { PackagePlus, SlidersHorizontal } from 'lucide-react';
import { formatDateTimeIN, formatINR } from '../domain/formatters';
import { AddProductInput, computeFinancialSummary } from '../domain/ledgerEngine';
import { BusinessState, Product } from '../domain/types';
import { ModalDialog } from './ModalDialog';
import { SyncStateBadge } from './StatusBadges';

interface InventoryViewProps {
  state: BusinessState;
  onAddProduct: (input: AddProductInput) => { ok: boolean; message: string };
  onAdjustStock: (productId: string, deltaQty: number, reason: string) => { ok: boolean; message: string };
}

export function InventoryView({ state, onAddProduct, onAdjustStock }: InventoryViewProps) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'LOW' | 'OVERSTOCK'>('ALL');
  const [addOpen, setAddOpen] = useState(false);
  const [adjustProduct, setAdjustProduct] = useState<Product | null>(null);
  const [adjustDelta, setAdjustDelta] = useState('10');
  const [adjustReason, setAdjustReason] = useState('Physical stock verification');
  const [formError, setFormError] = useState<string | null>(null);

  const [newProd, setNewProd] = useState<AddProductInput>({
    name: '',
    sku: '',
    category: 'Grains & Staples',
    unit: 'bags',
    currentStock: 50,
    reorderLevel: 20,
    maxStock: 200,
    avgCostPrice: 500,
    defaultSellPrice: 650,
    aliases: [],
  });
  const [aliasText, setAliasText] = useState('');

  const searchId = useId();
  const filterId = useId();
  const invCaptionId = useId();
  const movCaptionId = useId();

  const summary = computeFinancialSummary(state);

  const filtered = summary.productAnalytics.filter((pa) => {
    const q = query.trim().toLowerCase();
    const matchesSearch =
      !q ||
      pa.product.name.toLowerCase().includes(q) ||
      pa.product.sku.toLowerCase().includes(q) ||
      pa.product.aliases.some((a) => a.toLowerCase().includes(q));

    if (!matchesSearch) return false;
    if (statusFilter === 'LOW') {
      return pa.alertStatus === 'LOW_STOCK' || pa.alertStatus === 'OUT_OF_STOCK';
    }
    if (statusFilter === 'OVERSTOCK') {
      return pa.alertStatus === 'OVERSTOCK';
    }
    return true;
  });

  const handleCreateProduct = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const aliases = aliasText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const res = onAddProduct({ ...newProd, aliases });
    if (!res.ok) {
      setFormError(res.message);
      return;
    }
    setAddOpen(false);
    setNewProd({
      name: '',
      sku: '',
      category: 'Grains & Staples',
      unit: 'bags',
      currentStock: 50,
      reorderLevel: 20,
      maxStock: 200,
      avgCostPrice: 500,
      defaultSellPrice: 650,
      aliases: [],
    });
    setAliasText('');
  };

  const handleSubmitAdjustment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustProduct) return;
    setFormError(null);
    const res = onAdjustStock(adjustProduct.id, Number(adjustDelta), adjustReason);
    if (!res.ok) {
      setFormError(res.message);
      return;
    }
    setAdjustProduct(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div className="page-header">
        <div>
          <h1>Inventory &amp; Stock Control</h1>
          <p>
            Catalogue with multilingual voice aliases, automated reorder alerts, and immutable stock
            movements.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>
          <PackagePlus size={16} aria-hidden="true" />
          Add Product
        </button>
      </div>

      {/* Search & Filter */}
      <search className="card">
        <form
          onSubmit={(e) => e.preventDefault()}
          className="toolbar"
          aria-label="Filter inventory"
        >
          <div className="field" style={{ flex: '1 1 260px' }}>
            <label htmlFor={searchId}>Search Products or Regional Aliases (e.g. chawal, arisi)</label>
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by product name, SKU, or local name..."
            />
          </div>
          <div className="field" style={{ minWidth: '190px' }}>
            <label htmlFor={filterId}>Stock Status</label>
            <select
              id={filterId}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'LOW' | 'OVERSTOCK')}
            >
              <option value="ALL">All Products ({summary.productAnalytics.length})</option>
              <option value="LOW">Low / Out of Stock ({summary.lowStockCount})</option>
              <option value="OVERSTOCK">Overstock / Slow-moving</option>
            </select>
          </div>
        </form>
      </search>

      {/* Product Catalogue Table */}
      <div tabIndex={0} role="region" aria-labelledby={invCaptionId} className="table-wrapper">
        <table className="data-table">
          <caption id={invCaptionId}>Product Inventory Catalogue</caption>
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">Category</th>
              <th scope="col" className="num">Available Stock</th>
              <th scope="col" className="num">Avg Cost</th>
              <th scope="col" className="num">Sell Price</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--ink-muted)' }}>
                  No products match your search criteria.
                </td>
              </tr>
            ) : (
              filtered.map(({ product, alertStatus, suggestedRestockQty }) => (
                <tr key={product.id}>
                  <th scope="row">
                    <div>{product.name}</div>
                    <div style={{ fontSize: '0.74rem', fontWeight: 400, color: 'var(--ink-muted)' }}>
                      {product.sku} · Aliases: {product.aliases.slice(0, 4).join(', ')}
                    </div>
                  </th>
                  <td data-label="Category">{product.category}</td>
                  <td data-label="Available Stock" className="num">
                    <strong>{product.currentStock}</strong> {product.unit}
                    <div style={{ fontSize: '0.72rem', color: 'var(--ink-muted)' }}>
                      Min {product.reorderLevel}
                    </div>
                  </td>
                  <td data-label="Avg Cost" className="num">{formatINR(product.avgCostPrice)}</td>
                  <td data-label="Sell Price" className="num">{formatINR(product.defaultSellPrice)}</td>
                  <td data-label="Status">
                    {alertStatus === 'OUT_OF_STOCK' && <span className="badge badge-danger">Out of Stock</span>}
                    {alertStatus === 'LOW_STOCK' && (
                      <span className="badge badge-warn">Low · Order +{suggestedRestockQty}</span>
                    )}
                    {alertStatus === 'OVERSTOCK' && <span className="badge badge-blue">Overstock</span>}
                    {alertStatus === 'HEALTHY' && <span className="badge badge-success">Healthy</span>}
                  </td>
                  <td data-label="Actions">
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      onClick={() => {
                        setAdjustProduct(product);
                        setAdjustDelta('0');
                        setFormError(null);
                      }}
                    >
                      <SlidersHorizontal size={14} aria-hidden="true" />
                      Adjust
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Stock Movement Log */}
      <div tabIndex={0} role="region" aria-labelledby={movCaptionId} className="table-wrapper">
        <table className="data-table">
          <caption id={movCaptionId}>Traceable Stock Movements Ledger</caption>
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">Type</th>
              <th scope="col" className="num">Qty Change</th>
              <th scope="col" className="num">Balance After</th>
              <th scope="col">Reference</th>
              <th scope="col">Time</th>
              <th scope="col">Sync</th>
            </tr>
          </thead>
          <tbody>
            {state.stockMovements.slice(0, 20).map((mov) => (
              <tr key={mov.id}>
                <th scope="row">{mov.productName}</th>
                <td data-label="Type">
                  <span
                    className={`badge ${
                      mov.type === 'PURCHASE' || mov.type === 'RETURN'
                        ? 'badge-success'
                        : mov.type === 'SALE'
                        ? 'badge-blue'
                        : 'badge-warn'
                    }`}
                  >
                    {mov.type}
                  </span>
                </td>
                <td
                  data-label="Qty Change"
                  className="num"
                  style={{
                    fontWeight: 700,
                    color: mov.deltaQty >= 0 ? 'var(--success-text)' : 'var(--danger-text)',
                  }}
                >
                  {mov.deltaQty > 0 ? `+${mov.deltaQty}` : mov.deltaQty}
                </td>
                <td data-label="Balance After" className="num">{mov.balanceAfter}</td>
                <td data-label="Reference">
                  <div>{mov.referenceId}</div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--ink-muted)' }}>{mov.note}</div>
                </td>
                <td data-label="Time">{formatDateTimeIN(mov.createdAt)}</td>
                <td data-label="Sync">
                  <SyncStateBadge state={mov.syncState} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Product Modal */}
      <ModalDialog open={addOpen} onClose={() => setAddOpen(false)} title="Add New Inventory Product">
        <form onSubmit={handleCreateProduct} className="form-grid">
          {formError && <div className="alert-banner alert-danger">{formError}</div>}
          <div className="form-row-2">
            <div className="field">
              <label htmlFor="np-name">Product Name *</label>
              <input
                id="np-name"
                type="text"
                required
                autoFocus
                value={newProd.name}
                onChange={(e) => setNewProd({ ...newProd, name: e.target.value })}
                placeholder="e.g. Sunflower Oil (15L Tin)"
              />
            </div>
            <div className="field">
              <label htmlFor="np-sku">SKU Code</label>
              <input
                id="np-sku"
                type="text"
                value={newProd.sku}
                onChange={(e) => setNewProd({ ...newProd, sku: e.target.value })}
                placeholder="e.g. OIL-402"
              />
            </div>
          </div>

          <div className="form-row-2">
            <div className="field">
              <label htmlFor="np-cat">Category</label>
              <input
                id="np-cat"
                type="text"
                required
                value={newProd.category}
                onChange={(e) => setNewProd({ ...newProd, category: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="np-unit">Unit</label>
              <input
                id="np-unit"
                type="text"
                required
                value={newProd.unit}
                onChange={(e) => setNewProd({ ...newProd, unit: e.target.value })}
                placeholder="bags, kg, packets, tins"
              />
            </div>
          </div>

          <div className="form-row-2">
            <div className="field">
              <label htmlFor="np-stock">Opening Stock</label>
              <input
                id="np-stock"
                type="number"
                min={0}
                required
                value={newProd.currentStock}
                onChange={(e) => setNewProd({ ...newProd, currentStock: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label htmlFor="np-reorder">Reorder Alert Level</label>
              <input
                id="np-reorder"
                type="number"
                min={0}
                required
                value={newProd.reorderLevel}
                onChange={(e) => setNewProd({ ...newProd, reorderLevel: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="form-row-2">
            <div className="field">
              <label htmlFor="np-cost">Purchase Cost / Unit (₹)</label>
              <input
                id="np-cost"
                type="number"
                min={0}
                required
                value={newProd.avgCostPrice}
                onChange={(e) => setNewProd({ ...newProd, avgCostPrice: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label htmlFor="np-sell">Default Selling Price (₹)</label>
              <input
                id="np-sell"
                type="number"
                min={0}
                required
                value={newProd.defaultSellPrice}
                onChange={(e) =>
                  setNewProd({ ...newProd, defaultSellPrice: Number(e.target.value) })
                }
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="np-aliases">Regional / Voice Aliases (comma separated)</label>
            <input
              id="np-aliases"
              type="text"
              value={aliasText}
              onChange={(e) => setAliasText(e.target.value)}
              placeholder="e.g. tel, sunflower, surajmukhi tel"
            />
          </div>

          <div className="dialog-footer" style={{ padding: '0.75rem 0 0', background: 'transparent' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setAddOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save Product
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Stock Adjustment Modal */}
      <ModalDialog
        open={Boolean(adjustProduct)}
        onClose={() => setAdjustProduct(null)}
        title={`Stock Adjustment: ${adjustProduct?.name ?? ''}`}
      >
        <form onSubmit={handleSubmitAdjustment} className="form-grid">
          {formError && <div className="alert-banner alert-danger">{formError}</div>}
          <div className="alert-banner alert-info">
            Current stock: <strong>{adjustProduct?.currentStock} {adjustProduct?.unit}</strong>.
            All adjustments create an immutable audit log entry.
          </div>
          <div className="field">
            <label htmlFor="adj-delta">Quantity Adjustment (use negative for damage/shrinkage)</label>
            <input
              id="adj-delta"
              type="number"
              required
              autoFocus
              value={adjustDelta}
              onChange={(e) => setAdjustDelta(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="adj-reason">Reason</label>
            <input
              id="adj-reason"
              type="text"
              required
              value={adjustReason}
              onChange={(e) => setAdjustReason(e.target.value)}
            />
          </div>
          <div className="dialog-footer" style={{ padding: '0.75rem 0 0', background: 'transparent' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setAdjustProduct(null)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Commit Adjustment
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
