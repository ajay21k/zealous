import { describe, expect, it } from 'vitest';
import {
  commitCustomerPayment,
  commitExpense,
  commitPurchase,
  commitSale,
  commitSaleReturn,
  commitSupplierPayment,
  computeFinancialSummary,
  importBankTransactions,
} from './ledgerEngine';
import { createInitialBusinessState } from './seedData';

describe('ledgerEngine deterministic accounting & inventory', () => {
  it('commits a partial sale, deducts stock, calculates COGS and pending balance', () => {
    const initial = createInitialBusinessState();
    const riceBefore = initial.products.find((p) => p.id === 'prod-rice')!.currentStock;

    const res = commitSale(initial, {
      customerId: 'cust-kumar',
      productId: 'prod-rice',
      quantity: 50,
      unitPrice: 1200,
      amountPaid: 40000,
      paymentMode: 'BANK_TRANSFER',
      source: 'VOICE',
      originalTranscript: 'Sold 50 bags of rice to Kumar Traders at 1200 per bag, paid 40000',
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const riceAfter = res.state.products.find((p) => p.id === 'prod-rice')!.currentStock;
    expect(riceAfter).toBe(riceBefore - 50);

    const newSale = res.state.sales[0];
    expect(newSale.netTotal).toBe(60000);
    expect(newSale.amountPaid).toBe(40000);
    expect(newSale.balanceDue).toBe(20000);
    expect(newSale.status).toBe('PARTIAL');
    expect(newSale.cogsTotal).toBe(50 * 900);
    expect(res.state.auditLogs[0].approvedByOwner).toBe(true);
  });

  it('prevents selling more stock than available', () => {
    const initial = createInitialBusinessState();
    const res = commitSale(initial, {
      customerId: 'cust-kumar',
      productId: 'prod-ghee',
      quantity: 500,
      unitPrice: 640,
      amountPaid: 0,
      paymentMode: 'CREDIT',
      source: 'DASHBOARD',
    });
    expect(res.ok).toBe(false);
  });

  it('supports repeat-customer FIFO payment allocation and closes old invoice without losing history', () => {
    let state = createInitialBusinessState();
    // Kumar Traders currently has INV-2026-1001 with ₹40,000 pending.
    // Add a second partial sale of ₹60,000 (₹20,000 paid, ₹40,000 pending).
    const saleRes = commitSale(state, {
      customerId: 'cust-kumar',
      productId: 'prod-rice',
      quantity: 50,
      unitPrice: 1200,
      amountPaid: 20000,
      paymentMode: 'UPI',
      source: 'VOICE',
    });
    expect(saleRes.ok).toBe(true);
    if (!saleRes.ok) return;
    state = saleRes.state;

    // Now Kumar Traders pays ₹50,000: should close INV-2026-1001 (₹40,000) and apply ₹10,000 to the new invoice.
    const payRes = commitCustomerPayment(state, {
      customerId: 'cust-kumar',
      amount: 50000,
      mode: 'BANK_TRANSFER',
      referenceNo: 'UTR-TEST-99',
      source: 'DASHBOARD',
    });
    expect(payRes.ok).toBe(true);
    if (!payRes.ok) return;

    const oldInv = payRes.state.sales.find((s) => s.invoiceNo === 'INV-2026-1001')!;
    const newInv = payRes.state.sales[0];
    expect(oldInv.balanceDue).toBe(0);
    expect(oldInv.status).toBe('PAID');
    expect(newInv.balanceDue).toBe(30000);
    expect(newInv.status).toBe('PARTIAL');
  });

  it('handles purchases, weighted average cost, returns, and P&L math deterministically', () => {
    let state = createInitialBusinessState();
    const purRes = commitPurchase(state, {
      supplierId: 'sup-kaveri',
      productId: 'prod-rice',
      quantity: 100,
      unitCost: 960,
      amountPaid: 96000,
      paymentMode: 'BANK_TRANSFER',
      source: 'VOICE',
    });
    expect(purRes.ok).toBe(true);
    if (!purRes.ok) return;
    state = purRes.state;
    expect(state.products.find((p) => p.id === 'prod-rice')!.currentStock).toBe(285);

    const retRes = commitSaleReturn(state, 'sale-1002', 'prod-wheat', 5, 'Damaged bags');
    expect(retRes.ok).toBe(true);
    if (!retRes.ok) return;
    state = retRes.state;
    // sale-1002 was fully paid (42750); returning 5 bags @ 950 = 4750 refund due
    const retSale = state.sales.find((s) => s.id === 'sale-1002')!;
    expect(retSale.netTotal).toBe(38000);
    expect(retSale.amountPaid).toBe(38000);
    expect(retSale.balanceDue).toBe(0);
    expect(retSale.refundedAmount).toBe(4750);

    const expRes = commitExpense(state, {
      category: 'Transport',
      description: 'Unload coolie',
      amount: 500,
      paymentMode: 'CASH',
      source: 'VOICE',
    });
    expect(expRes.ok).toBe(true);
    if (!expRes.ok) return;
    state = expRes.state;

    const summary = computeFinancialSummary(state);
    expect(summary.grossProfit).toBe(summary.totalRevenue - summary.totalCOGS);
    expect(summary.netProfit).toBe(summary.grossProfit - summary.totalExpenses);
  });

  it('matches imported bank transactions as proposals without auto-committing', () => {
    const state = createInitialBusinessState();
    const updated = importBankTransactions(state, [
      {
        date: new Date().toISOString(),
        description: 'NEFT CR PATEL SUPERMART REF9911',
        referenceNo: 'REF9911',
        amount: 38700,
        type: 'CREDIT',
        senderHint: 'Patel Supermart',
      },
    ]);
    const imported = updated.bankTransactions[0];
    expect(imported.matchStatus).toBe('PROPOSED');
    expect(imported.matchedSaleId).toBe('sale-1004');
    // Authoritative sale balance must remain untouched until owner confirms!
    expect(updated.sales.find((s) => s.id === 'sale-1004')!.balanceDue).toBe(38700);
  });

  it('allows unrestricted new items, units, suppliers, customers, multi-item bills, and custom modes', () => {
    let state = createInitialBusinessState();

    // Purchase brand-new product from brand-new supplier
    const purRes = commitPurchase(state, {
      supplierName: 'Dairy Wholesale Co',
      productName: 'Amul Butter 500g',
      unit: 'boxes',
      quantity: 20,
      unitCost: 450,
      amountPaid: 9000,
      paymentMode: 'Split Cash + UPI',
      source: 'VOICE',
    });
    expect(purRes.ok).toBe(true);
    if (!purRes.ok) return;
    state = purRes.state;
    expect(state.suppliers.some((s) => s.name === 'Dairy Wholesale Co')).toBe(true);
    expect(state.products.some((p) => p.name === 'Amul Butter 500g' && p.currentStock === 20)).toBe(true);

    // Multi-item sale with existing items to a new customer
    const saleRes = commitSale(state, {
      customerName: 'Ravi Fruit Mart',
      items: [
        { productId: 'prod-rice', quantity: 5, unitPrice: 1200 },
        { productId: 'prod-ghee', quantity: 10, unitPrice: 640 },
      ],
      amountPaid: 10000,
      paymentMode: 'Card',
      source: 'DASHBOARD',
    });
    expect(saleRes.ok).toBe(true);
    if (!saleRes.ok) return;
    state = saleRes.state;
    expect(state.customers.some((c) => c.name === 'Ravi Fruit Mart')).toBe(true);
    expect(state.sales[0].items.length).toBe(2);
    expect(state.sales[0].netTotal).toBe(12400);
    expect(state.sales[0].balanceDue).toBe(2400);

    // Custom expense category
    const expRes = commitExpense(state, {
      category: 'Staff Tea & Snacks',
      description: 'Evening chai for loaders',
      amount: 180,
      paymentMode: 'Petty Cash',
      source: 'DASHBOARD',
    });
    expect(expRes.ok).toBe(true);
  });

  it('blocks unregistered products and supplier payments when no payable balance exists', () => {
    const initial = createInitialBusinessState();
    const unknownSale = commitSale(initial, {
      customerName: 'Ravi Fruit Mart',
      productName: 'Alphonso Mangoes',
      unit: 'crates',
      quantity: 10,
      unitPrice: 800,
      amountPaid: 8000,
      paymentMode: 'CASH',
      source: 'DASHBOARD',
    });
    expect(unknownSale.ok).toBe(false);

    const noPayable = commitSupplierPayment(
      initial,
      'sup-deccan',
      100,
      'CASH',
      'TEST-REF'
    );
    expect(noPayable.ok).toBe(false);
  });
});
