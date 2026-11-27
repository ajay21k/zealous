import { daysSince } from './formatters';
import {
  AuditLog,
  BankTransaction,
  BusinessState,
  Customer,
  Expense,
  ExpenseCategory,
  Payment,
  PaymentAllocation,
  PaymentMode,
  Product,
  Purchase,
  Sale,
  StockMovement,
  Supplier,
  SyncState,
  TransactionSource,
} from './types';

export type EngineResult<T = string> =
  | { ok: true; state: BusinessState; message: string; entityId: T; syncState: SyncState }
  | { ok: false; error: string };

function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function getSyncState(state: BusinessState): SyncState {
  return state.offlineModeSimulated ? 'LOCAL_SAVED' : 'COMMITTED';
}

function appendAudit(
  logs: AuditLog[],
  entry: Omit<AuditLog, 'id' | 'timestamp'>
): AuditLog[] {
  return [
    {
      id: nextId('aud'),
      timestamp: new Date().toISOString(),
      ...entry,
    },
    ...logs,
  ];
}

export interface SaleLineInput {
  productId?: string;
  productName?: string;
  unit?: string;
  quantity: number;
  unitPrice: number;
}

export interface CommitSaleInput {
  customerId?: string;
  customerName?: string;
  productId?: string;
  productName?: string;
  unit?: string;
  quantity?: number;
  unitPrice?: number;
  items?: SaleLineInput[];
  discount?: number;
  amountPaid: number;
  paymentMode: PaymentMode;
  source: TransactionSource;
  languageCode?: string;
  originalTranscript?: string;
  idempotencyKey?: string;
}

export function commitSale(state: BusinessState, input: CommitSaleInput): EngineResult {
  if (input.idempotencyKey && state.sales.some((s) => s.idempotencyKey === input.idempotencyKey)) {
    return { ok: false, error: 'Duplicate transaction blocked (idempotency check).' };
  }

  const rawLines: SaleLineInput[] =
    input.items && input.items.length > 0
      ? input.items
      : [
          {
            productId: input.productId,
            productName: input.productName,
            unit: input.unit,
            quantity: input.quantity ?? 0,
            unitPrice: input.unitPrice ?? 0,
          },
        ];

  if (rawLines.length === 0) {
    return { ok: false, error: 'At least one item is required.' };
  }

  let products = [...state.products];
  const resolvedItems: Sale['items'] = [];
  const pendingMovements: Omit<StockMovement, 'referenceId' | 'createdAt' | 'syncState'>[] = [];

  for (const line of rawLines) {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      return { ok: false, error: 'Quantity must be greater than zero.' };
    }
    if (!Number.isFinite(line.unitPrice) || line.unitPrice < 0) {
      return { ok: false, error: 'Unit price cannot be negative.' };
    }

    let product = line.productId
      ? products.find((p) => p.id === line.productId)
      : products.find(
          (p) =>
            line.productName &&
            (p.name.toLowerCase() === line.productName.trim().toLowerCase() ||
              p.aliases.some((a) => a.toLowerCase() === line.productName!.trim().toLowerCase()))
        );

    if (!product) {
      const cleanProdName = (line.productName ?? '').trim();
      if (!cleanProdName) {
        return { ok: false, error: 'Selected product does not exist in inventory.' };
      }
      return {
        ok: false,
        error: `Product "${cleanProdName}" is not in inventory. Record a purchase or add the product before selling it.`,
      };
    } else if (line.quantity > product.currentStock) {
      return {
        ok: false,
        error: `Insufficient stock for ${product.name}. Available: ${product.currentStock} ${product.unit}, requested: ${line.quantity} ${product.unit}.`,
      };
    }

    const lineTotal = Math.round(line.quantity * line.unitPrice);
    const newBalance = product.currentStock - line.quantity;
    products = products.map((p) =>
      p.id === product!.id
        ? { ...p, currentStock: newBalance, lastSoldAt: new Date().toISOString() }
        : p
    );

    resolvedItems.push({
      productId: product.id,
      productName: product.name,
      unit: product.unit,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      costPriceSnapshot: product.avgCostPrice,
      lineTotal,
    });

    pendingMovements.push({
      id: nextId('mov'),
      productId: product.id,
      productName: product.name,
      type: 'SALE',
      deltaQty: -line.quantity,
      balanceAfter: newBalance,
      note: '',
    });
  }

  const discount = Math.max(0, Math.round(input.discount ?? 0));
  const subtotal = resolvedItems.reduce((sum, it) => sum + it.lineTotal, 0);
  if (discount > subtotal) {
    return { ok: false, error: 'Discount cannot exceed the subtotal.' };
  }

  const netTotal = subtotal - discount;
  const amountPaid = Math.min(netTotal, Math.max(0, Math.round(input.amountPaid)));
  const balanceDue = netTotal - amountPaid;
  const cogsTotal = resolvedItems.reduce(
    (sum, it) => sum + Math.round(it.quantity * it.costPriceSnapshot),
    0
  );
  const status: Sale['status'] =
    balanceDue === 0 ? 'PAID' : amountPaid > 0 ? 'PARTIAL' : 'PENDING';

  let customer: Customer | undefined = state.customers.find((c) => c.id === input.customerId);
  let customers = state.customers;

  if (!customer) {
    const cleanName = (input.customerName ?? '').trim();
    if (cleanName) {
      customer = state.customers.find(
        (c) =>
          c.name.toLowerCase() === cleanName.toLowerCase() ||
          c.aliases.some((a) => a.toLowerCase() === cleanName.toLowerCase())
      );
      if (!customer) {
        customer = {
          id: nextId('cust'),
          name: cleanName,
          phone: 'Pending update',
          city: 'Local',
          segment: 'Wholesale',
          creditLimit: 100000,
          aliases: [cleanName.toLowerCase()],
        };
        customers = [...customers, customer];
      }
    } else {
      customer = state.customers.find((c) => c.id === 'cust-walkin') ?? state.customers[0];
    }
  }

  if (balanceDue > 0) {
    const outstandingBefore = state.sales
      .filter((s) => s.customerId === customer.id && s.status !== 'RETURNED')
      .reduce((sum, s) => sum + s.balanceDue, 0);
    if (customer.creditLimit > 0 && outstandingBefore + balanceDue > customer.creditLimit) {
      return {
        ok: false,
        error: `Credit limit exceeded for ${customer.name}. Available credit: ₹${Math.max(
          0,
          customer.creditLimit - outstandingBefore
        ).toLocaleString('en-IN')}.`,
      };
    }
  }

  const now = new Date().toISOString();
  const syncState = getSyncState(state);
  const invoiceNo = `INV-${new Date().getFullYear()}-${1001 + state.sales.length}`;
  const saleId = nextId('sale');

  const newSale: Sale = {
    id: saleId,
    invoiceNo,
    customerId: customer.id,
    customerName: customer.name,
    items: resolvedItems,
    subtotal,
    discount,
    netTotal,
    cogsTotal,
    amountPaid,
    balanceDue,
    paymentMode: amountPaid === 0 ? 'CREDIT' : input.paymentMode,
    status,
    createdAt: now,
    source: input.source,
    syncState,
    languageCode: input.languageCode,
    originalTranscript: input.originalTranscript,
    idempotencyKey: input.idempotencyKey,
  };

  const movements: StockMovement[] = pendingMovements.map((m) => ({
    ...m,
    referenceId: invoiceNo,
    note: `Sold to ${customer!.name}`,
    createdAt: now,
    syncState,
  }));

  let payments = state.payments;
  if (amountPaid > 0) {
    const payment: Payment = {
      id: nextId('pay'),
      partyType: 'CUSTOMER',
      partyId: customer.id,
      partyName: customer.name,
      amount: amountPaid,
      mode: input.paymentMode === 'CREDIT' ? 'CASH' : input.paymentMode,
      referenceNo: `${input.paymentMode}-${Math.floor(1000 + Math.random() * 9000)}`,
      allocations: [
        {
          invoiceOrBillId: saleId,
          invoiceOrBillNo: invoiceNo,
          allocatedAmount: amountPaid,
        },
      ],
      createdAt: now,
      source: input.source,
      syncState,
      note: `Payment at time of sale (${invoiceNo})`,
    };
    payments = [payment, ...payments];
  }

  const itemSummary = resolvedItems
    .map((it) => `${it.quantity} ${it.unit} ${it.productName}`)
    .join(', ');

  const auditLogs = appendAudit(state.auditLogs, {
    actor: input.source === 'VOICE' ? 'Owner (Voice Confirmed)' : 'Owner (Dashboard)',
    action: 'COMMIT_SALE',
    entityType: 'SALE',
    entityId: invoiceNo,
    summary: `Sale ${invoiceNo}: ${itemSummary} to ${customer.name} for ₹${netTotal.toLocaleString('en-IN')} (Paid ₹${amountPaid.toLocaleString('en-IN')}, Pending ₹${balanceDue.toLocaleString('en-IN')})`,
    sourceInput: input.originalTranscript,
    approvedByOwner: true,
  });

  return {
    ok: true,
    entityId: saleId,
    syncState,
    message: `Sale ${invoiceNo} committed (${itemSummary} for ₹${netTotal.toLocaleString('en-IN')}).`,
    state: {
      ...state,
      customers,
      products,
      sales: [newSale, ...state.sales],
      payments,
      stockMovements: [...movements, ...state.stockMovements],
      auditLogs,
    },
  };
}

export function commitSaleReturn(
  state: BusinessState,
  saleId: string,
  productId: string,
  returnQty: number,
  reason: string
): EngineResult {
  const sale = state.sales.find((s) => s.id === saleId);
  if (!sale) return { ok: false, error: 'Invoice not found.' };
  if (sale.status === 'RETURNED') {
    return { ok: false, error: 'This invoice is already fully returned.' };
  }

  const item = sale.items.find((i) => i.productId === productId);
  if (!item) return { ok: false, error: 'Product not found in invoice.' };

  const alreadyReturned = item.returnedQty ?? 0;
  const maxReturnable = item.quantity - alreadyReturned;
  if (returnQty <= 0 || returnQty > maxReturnable) {
    return { ok: false, error: `Return quantity must be between 1 and ${maxReturnable}.` };
  }

  const product = state.products.find((p) => p.id === productId);
  if (!product) return { ok: false, error: 'Product record missing.' };

  const now = new Date().toISOString();
  const syncState = getSyncState(state);
  const returnCredit = Math.round(returnQty * item.unitPrice);
  const cogsReversed = Math.round(returnQty * item.costPriceSnapshot);

  let refundDueToCustomer = 0;
  const updatedSales = state.sales.map((s) => {
    if (s.id !== saleId) return s;
    const newNet = Math.max(0, s.netTotal - returnCredit);
    const newCogs = Math.max(0, s.cogsTotal - cogsReversed);
    let newAmountPaid = s.amountPaid;
    if (s.amountPaid > newNet) {
      refundDueToCustomer = s.amountPaid - newNet;
      newAmountPaid = newNet;
    }
    const newBalanceDue = Math.max(0, newNet - newAmountPaid);
    const allReturned = s.items.every((it) => {
      const returnedQtyForItem =
        it.productId === productId ? (it.returnedQty ?? 0) + returnQty : it.returnedQty ?? 0;
      return returnedQtyForItem >= it.quantity;
    });
    return {
      ...s,
      netTotal: newNet,
      cogsTotal: newCogs,
      amountPaid: newAmountPaid,
      balanceDue: newBalanceDue,
      refundedAmount: (s.refundedAmount ?? 0) + refundDueToCustomer,
      status: allReturned ? ('RETURNED' as const) : newBalanceDue === 0 ? ('PAID' as const) : s.status,
      items: s.items.map((it) =>
        it.productId === productId
          ? { ...it, returnedQty: (it.returnedQty ?? 0) + returnQty }
          : it
      ),
    };
  });

  const newStock = product.currentStock + returnQty;
  const updatedProducts = state.products.map((p) =>
    p.id === productId ? { ...p, currentStock: newStock } : p
  );

  const movement: StockMovement = {
    id: nextId('mov'),
    productId: product.id,
    productName: product.name,
    type: 'RETURN',
    deltaQty: returnQty,
    balanceAfter: newStock,
    referenceId: sale.invoiceNo,
    note: `Sales return: ${reason || 'Customer return'}`,
    createdAt: now,
    syncState,
  };

  let payments = state.payments;
  if (refundDueToCustomer > 0) {
    payments = [
      {
        id: nextId('pay'),
        partyType: 'CUSTOMER',
        partyId: sale.customerId,
        partyName: sale.customerName,
        amount: -refundDueToCustomer,
        mode: sale.paymentMode === 'CREDIT' ? 'CASH' : sale.paymentMode,
        referenceNo: `REFUND-${sale.invoiceNo}`,
        allocations: [
          {
            invoiceOrBillId: sale.id,
            invoiceOrBillNo: sale.invoiceNo,
            allocatedAmount: -refundDueToCustomer,
          },
        ],
        createdAt: now,
        source: 'DASHBOARD',
        syncState,
        note: `Refund due on sales return (${sale.invoiceNo})`,
      },
      ...payments,
    ];
  }

  const refundText =
    refundDueToCustomer > 0 ? ` Refund due to customer: ₹${refundDueToCustomer.toLocaleString('en-IN')}.` : '';

  const auditLogs = appendAudit(state.auditLogs, {
    actor: 'Owner (Dashboard Adjustment)',
    action: 'SALE_RETURN_ADJUSTMENT',
    entityType: 'SALE',
    entityId: sale.invoiceNo,
    summary: `Traceable return adjustment on ${sale.invoiceNo}: ${returnQty} ${item.unit} ${item.productName} returned (₹${returnCredit.toLocaleString('en-IN')} credit).${refundText} Reason: ${reason || 'Customer return'}`,
    approvedByOwner: true,
  });

  return {
    ok: true,
    entityId: saleId,
    syncState,
    message: `Recorded return of ${returnQty} ${item.unit} on ${sale.invoiceNo}.${refundText} Stock restored to ${newStock}.`,
    state: {
      ...state,
      sales: updatedSales,
      payments,
      products: updatedProducts,
      stockMovements: [movement, ...state.stockMovements],
      auditLogs,
    },
  };
}

export interface PurchaseLineInput {
  productId?: string;
  productName?: string;
  unit?: string;
  quantity: number;
  unitCost: number;
}

export interface CommitPurchaseInput {
  supplierId?: string;
  supplierName?: string;
  productId?: string;
  productName?: string;
  unit?: string;
  quantity?: number;
  unitCost?: number;
  items?: PurchaseLineInput[];
  amountPaid: number;
  paymentMode: PaymentMode;
  source: TransactionSource;
  languageCode?: string;
  originalTranscript?: string;
  idempotencyKey?: string;
}

export function commitPurchase(state: BusinessState, input: CommitPurchaseInput): EngineResult {
  if (input.idempotencyKey && state.purchases.some((p) => p.idempotencyKey === input.idempotencyKey)) {
    return { ok: false, error: 'Duplicate purchase blocked (idempotency check).' };
  }

  const rawLines: PurchaseLineInput[] =
    input.items && input.items.length > 0
      ? input.items
      : [
          {
            productId: input.productId,
            productName: input.productName,
            unit: input.unit,
            quantity: input.quantity ?? 0,
            unitCost: input.unitCost ?? 0,
          },
        ];

  if (rawLines.length === 0) {
    return { ok: false, error: 'At least one purchase item is required.' };
  }

  let products = [...state.products];
  const resolvedItems: Purchase['items'] = [];
  const pendingMovements: Omit<StockMovement, 'referenceId' | 'createdAt' | 'syncState'>[] = [];

  for (const line of rawLines) {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      return { ok: false, error: 'Purchase quantity must be positive.' };
    }
    if (!Number.isFinite(line.unitCost) || line.unitCost <= 0) {
      return { ok: false, error: 'Purchase unit cost must be greater than zero.' };
    }

    let product = line.productId
      ? products.find((p) => p.id === line.productId)
      : products.find(
          (p) =>
            line.productName &&
            (p.name.toLowerCase() === line.productName.trim().toLowerCase() ||
              p.aliases.some((a) => a.toLowerCase() === line.productName!.trim().toLowerCase()))
        );

    let newTotalStock = 0;
    if (!product) {
      const cleanName = (line.productName ?? '').trim();
      if (!cleanName) return { ok: false, error: 'Product name is required.' };
      newTotalStock = Math.round(line.quantity);
      product = {
        id: nextId('prod'),
        sku: `GEN-${101 + products.length}`,
        name: cleanName,
        category: 'General',
        unit: (line.unit ?? '').trim() || 'units',
        currentStock: newTotalStock,
        reorderLevel: 10,
        maxStock: Math.max(50, newTotalStock * 3),
        avgCostPrice: Math.round(line.unitCost),
        defaultSellPrice: Math.round(line.unitCost * 1.2),
        aliases: [cleanName.toLowerCase()],
      };
      products = [...products, product];
    } else {
      const totalExistingValue = product.currentStock * product.avgCostPrice;
      newTotalStock = product.currentStock + line.quantity;
      const weightedAvgCost = Math.round(
        (totalExistingValue + line.quantity * line.unitCost) / Math.max(1, newTotalStock)
      );
      products = products.map((p) =>
        p.id === product!.id
          ? { ...p, currentStock: newTotalStock, avgCostPrice: weightedAvgCost }
          : p
      );
    }

    const lineTotal = Math.round(line.quantity * line.unitCost);
    resolvedItems.push({
      productId: product.id,
      productName: product.name,
      unit: product.unit,
      quantity: line.quantity,
      unitCost: line.unitCost,
      lineTotal,
    });

    pendingMovements.push({
      id: nextId('mov'),
      productId: product.id,
      productName: product.name,
      type: 'PURCHASE',
      deltaQty: line.quantity,
      balanceAfter: newTotalStock,
      note: `@ ₹${line.unitCost}/${product.unit}`,
    });
  }

  let supplier: Supplier | undefined = state.suppliers.find((s) => s.id === input.supplierId);
  let suppliers = state.suppliers;
  if (!supplier) {
    const cleanName = (input.supplierName ?? '').trim();
    if (cleanName) {
      supplier = state.suppliers.find(
        (s) =>
          s.name.toLowerCase() === cleanName.toLowerCase() ||
          s.aliases.some((a) => a.toLowerCase() === cleanName.toLowerCase())
      );
      if (!supplier) {
        supplier = {
          id: nextId('sup'),
          name: cleanName,
          phone: 'Pending update',
          city: 'Local Mandi',
          category: 'General',
          aliases: [cleanName.toLowerCase()],
        };
        suppliers = [...suppliers, supplier];
      }
    } else {
      supplier = state.suppliers[0];
    }
  }

  const totalAmount = resolvedItems.reduce((sum, it) => sum + it.lineTotal, 0);
  const amountPaid = Math.min(totalAmount, Math.max(0, Math.round(input.amountPaid)));
  const balanceDue = totalAmount - amountPaid;
  const status: Purchase['status'] =
    balanceDue === 0 ? 'PAID' : amountPaid > 0 ? 'PARTIAL' : 'PENDING';

  const now = new Date().toISOString();
  const syncState = getSyncState(state);
  const billNo = `PO-${new Date().getFullYear()}-${2001 + state.purchases.length}`;
  const purchaseId = nextId('pur');

  const newPurchase: Purchase = {
    id: purchaseId,
    billNo,
    supplierId: supplier.id,
    supplierName: supplier.name,
    items: resolvedItems,
    totalAmount,
    amountPaid,
    balanceDue,
    paymentMode: amountPaid === 0 ? 'CREDIT' : input.paymentMode,
    status,
    createdAt: now,
    source: input.source,
    syncState,
    languageCode: input.languageCode,
    originalTranscript: input.originalTranscript,
    idempotencyKey: input.idempotencyKey,
  };

  const movements: StockMovement[] = pendingMovements.map((m) => ({
    ...m,
    referenceId: billNo,
    note: `Purchased from ${supplier!.name} ${m.note}`,
    createdAt: now,
    syncState,
  }));

  let payments = state.payments;
  if (amountPaid > 0) {
    payments = [
      {
        id: nextId('pay'),
        partyType: 'SUPPLIER',
        partyId: supplier.id,
        partyName: supplier.name,
        amount: amountPaid,
        mode: input.paymentMode === 'CREDIT' ? 'BANK_TRANSFER' : input.paymentMode,
        referenceNo: `${input.paymentMode}-${Math.floor(1000 + Math.random() * 9000)}`,
        allocations: [
          {
            invoiceOrBillId: purchaseId,
            invoiceOrBillNo: billNo,
            allocatedAmount: amountPaid,
          },
        ],
        createdAt: now,
        source: input.source,
        syncState,
        note: `Supplier payment on purchase (${billNo})`,
      },
      ...payments,
    ];
  }

  const itemSummary = resolvedItems
    .map((it) => `${it.quantity} ${it.unit} ${it.productName}`)
    .join(', ');

  const auditLogs = appendAudit(state.auditLogs, {
    actor: input.source === 'VOICE' ? 'Owner (Voice Confirmed)' : 'Owner (Dashboard)',
    action: 'COMMIT_PURCHASE',
    entityType: 'PURCHASE',
    entityId: billNo,
    summary: `Purchase ${billNo}: ${itemSummary} from ${supplier.name} for ₹${totalAmount.toLocaleString('en-IN')}`,
    sourceInput: input.originalTranscript,
    approvedByOwner: true,
  });

  return {
    ok: true,
    entityId: purchaseId,
    syncState,
    message: `Purchase ${billNo} recorded (${itemSummary} from ${supplier.name}).`,
    state: {
      ...state,
      suppliers,
      products,
      purchases: [newPurchase, ...state.purchases],
      payments,
      stockMovements: [...movements, ...state.stockMovements],
      auditLogs,
    },
  };
}

export interface CommitCustomerPaymentInput {
  customerId: string;
  amount: number;
  mode: PaymentMode;
  referenceNo?: string;
  targetSaleId?: string;
  source: TransactionSource;
  bankTxnId?: string;
  note?: string;
  idempotencyKey?: string;
}

export function commitCustomerPayment(
  state: BusinessState,
  input: CommitCustomerPaymentInput
): EngineResult {
  if (input.idempotencyKey && state.payments.some((p) => p.idempotencyKey === input.idempotencyKey)) {
    return { ok: false, error: 'Duplicate payment blocked (idempotency check).' };
  }
  const customer = state.customers.find((c) => c.id === input.customerId);
  if (!customer) return { ok: false, error: 'Customer not found.' };
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, error: 'Payment amount must be greater than zero.' };
  }

  // Sort open invoices oldest-first (FIFO) or prioritize targetSaleId
  const openSales = state.sales
    .filter((s) => s.customerId === customer.id && s.balanceDue > 0 && s.status !== 'RETURNED')
    .sort((a, b) => {
      if (input.targetSaleId) {
        if (a.id === input.targetSaleId) return -1;
        if (b.id === input.targetSaleId) return 1;
      }
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

  const totalOutstanding = openSales.reduce((sum, s) => sum + s.balanceDue, 0);
  if (totalOutstanding === 0) {
    return { ok: false, error: `${customer.name} has no pending invoice balance.` };
  }
  if (input.amount > totalOutstanding) {
    return {
      ok: false,
      error: `Payment ₹${input.amount.toLocaleString('en-IN')} exceeds total outstanding ₹${totalOutstanding.toLocaleString('en-IN')} for ${customer.name}.`,
    };
  }

  let remaining = Math.round(input.amount);
  const allocations: PaymentAllocation[] = [];
  const saleChanges = new Map<string, { addPaid: number }>();

  for (const sale of openSales) {
    if (remaining <= 0) break;
    const alloc = Math.min(remaining, sale.balanceDue);
    allocations.push({
      invoiceOrBillId: sale.id,
      invoiceOrBillNo: sale.invoiceNo,
      allocatedAmount: alloc,
    });
    saleChanges.set(sale.id, { addPaid: alloc });
    remaining -= alloc;
  }

  const updatedSales = state.sales.map((s) => {
    const change = saleChanges.get(s.id);
    if (!change) return s;
    const newPaid = s.amountPaid + change.addPaid;
    const newDue = Math.max(0, s.netTotal - newPaid);
    return {
      ...s,
      amountPaid: newPaid,
      balanceDue: newDue,
      status: newDue === 0 ? ('PAID' as const) : ('PARTIAL' as const),
    };
  });

  const now = new Date().toISOString();
  const syncState = getSyncState(state);
  const paymentId = nextId('pay');
  const refNo = (input.referenceNo ?? '').trim() || `PAY-${Math.floor(10000 + Math.random() * 90000)}`;

  const newPayment: Payment = {
    id: paymentId,
    partyType: 'CUSTOMER',
    partyId: customer.id,
    partyName: customer.name,
    amount: Math.round(input.amount),
    mode: input.mode === 'CREDIT' ? 'BANK_TRANSFER' : input.mode,
    referenceNo: refNo,
    allocations,
    createdAt: now,
    source: input.source,
    syncState,
    note: input.note,
    idempotencyKey: input.idempotencyKey,
  };

  let bankTransactions = state.bankTransactions;
  if (input.bankTxnId) {
    bankTransactions = bankTransactions.map((b) =>
      b.id === input.bankTxnId
        ? {
            ...b,
            matchStatus: 'RECONCILED' as const,
            matchedCustomerId: customer.id,
            matchedSaleId: allocations[0]?.invoiceOrBillId,
          }
        : b
    );
  }

  const closedList = allocations
    .map((a) => `${a.invoiceOrBillNo} (₹${a.allocatedAmount.toLocaleString('en-IN')})`)
    .join(', ');

  const auditLogs = appendAudit(state.auditLogs, {
    actor: input.bankTxnId ? 'Owner (Bank Recon Confirmed)' : 'Owner (Ledger Payment)',
    action: input.bankTxnId ? 'RECONCILE_BANK_PAYMENT' : 'RECORD_CUSTOMER_PAYMENT',
    entityType: input.bankTxnId ? 'BANK_RECON' : 'PAYMENT',
    entityId: refNo,
    summary: `Received ₹${input.amount.toLocaleString('en-IN')} from ${customer.name} via ${input.mode}. Allocated to: ${closedList}`,
    approvedByOwner: true,
  });

  return {
    ok: true,
    entityId: paymentId,
    syncState,
    message: `Payment of ₹${input.amount.toLocaleString('en-IN')} from ${customer.name} allocated to ${allocations.length} invoice(s).`,
    state: {
      ...state,
      sales: updatedSales,
      payments: [newPayment, ...state.payments],
      bankTransactions,
      auditLogs,
    },
  };
}

export function commitSupplierPayment(
  state: BusinessState,
  supplierId: string,
  amount: number,
  mode: PaymentMode,
  referenceNo?: string
): EngineResult {
  const supplier = state.suppliers.find((s) => s.id === supplierId);
  if (!supplier) return { ok: false, error: 'Supplier not found.' };
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'Amount must be greater than zero.' };
  }

  const openPurchases = state.purchases
    .filter((p) => p.supplierId === supplierId && p.balanceDue > 0)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const totalPayable = openPurchases.reduce((s, p) => s + p.balanceDue, 0);
  if (totalPayable === 0) {
    return { ok: false, error: `${supplier.name} has no pending supplier balance.` };
  }
  if (amount > totalPayable) {
    return {
      ok: false,
      error: `Payment exceeds total payable ₹${totalPayable.toLocaleString('en-IN')}.`,
    };
  }

  let rem = Math.round(amount);
  const allocations: PaymentAllocation[] = [];
  const changes = new Map<string, number>();

  for (const pur of openPurchases) {
    if (rem <= 0) break;
    const alloc = Math.min(rem, pur.balanceDue);
    allocations.push({
      invoiceOrBillId: pur.id,
      invoiceOrBillNo: pur.billNo,
      allocatedAmount: alloc,
    });
    changes.set(pur.id, alloc);
    rem -= alloc;
  }

  const updatedPurchases = state.purchases.map((p) => {
    const add = changes.get(p.id);
    if (!add) return p;
    const newPaid = p.amountPaid + add;
    const newDue = Math.max(0, p.totalAmount - newPaid);
    return {
      ...p,
      amountPaid: newPaid,
      balanceDue: newDue,
      status: newDue === 0 ? ('PAID' as const) : ('PARTIAL' as const),
    };
  });

  const syncState = getSyncState(state);
  const now = new Date().toISOString();
  const payId = nextId('pay');
  const ref = (referenceNo ?? '').trim() || `SUP-${Math.floor(10000 + Math.random() * 90000)}`;

  const payment: Payment = {
    id: payId,
    partyType: 'SUPPLIER',
    partyId: supplier.id,
    partyName: supplier.name,
    amount: Math.round(amount),
    mode: mode === 'CREDIT' ? 'BANK_TRANSFER' : mode,
    referenceNo: ref,
    allocations,
    createdAt: now,
    source: 'DASHBOARD',
    syncState,
  };

  return {
    ok: true,
    entityId: payId,
    syncState,
    message: `Paid ₹${amount.toLocaleString('en-IN')} to ${supplier.name}.`,
    state: {
      ...state,
      purchases: updatedPurchases,
      payments: [payment, ...state.payments],
      auditLogs: appendAudit(state.auditLogs, {
        actor: 'Owner (Dashboard)',
        action: 'SUPPLIER_PAYMENT',
        entityType: 'PAYMENT',
        entityId: ref,
        summary: `Paid ₹${amount.toLocaleString('en-IN')} to supplier ${supplier.name}`,
        approvedByOwner: true,
      }),
    },
  };
}

export interface CommitExpenseInput {
  category: ExpenseCategory;
  description: string;
  amount: number;
  paymentMode: PaymentMode;
  source: TransactionSource;
  languageCode?: string;
  originalTranscript?: string;
  idempotencyKey?: string;
}

export function commitExpense(state: BusinessState, input: CommitExpenseInput): EngineResult {
  if (input.idempotencyKey && state.expenses.some((e) => e.idempotencyKey === input.idempotencyKey)) {
    return { ok: false, error: 'Duplicate expense blocked (idempotency check).' };
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, error: 'Expense amount must be greater than zero.' };
  }
  const desc = input.description.trim();
  if (!desc) return { ok: false, error: 'Please provide an expense description.' };

  const syncState = getSyncState(state);
  const id = nextId('exp');
  const expense: Expense = {
    id,
    category: input.category,
    description: desc,
    amount: Math.round(input.amount),
    paymentMode: input.paymentMode === 'CREDIT' ? 'CASH' : input.paymentMode,
    createdAt: new Date().toISOString(),
    source: input.source,
    syncState,
    languageCode: input.languageCode,
    originalTranscript: input.originalTranscript,
    idempotencyKey: input.idempotencyKey,
  };

  return {
    ok: true,
    entityId: id,
    syncState,
    message: `Expense of ₹${expense.amount.toLocaleString('en-IN')} (${input.category}) saved.`,
    state: {
      ...state,
      expenses: [expense, ...state.expenses],
      auditLogs: appendAudit(state.auditLogs, {
        actor: input.source === 'VOICE' ? 'Owner (Voice Confirmed)' : 'Owner (Dashboard)',
        action: 'COMMIT_EXPENSE',
        entityType: 'EXPENSE',
        entityId: id,
        summary: `Recorded ${input.category} expense: ${desc} (₹${expense.amount.toLocaleString('en-IN')})`,
        sourceInput: input.originalTranscript,
        approvedByOwner: true,
      }),
    },
  };
}

export function commitStockAdjustment(
  state: BusinessState,
  productId: string,
  deltaQty: number,
  reason: string
): EngineResult {
  const product = state.products.find((p) => p.id === productId);
  if (!product) return { ok: false, error: 'Product not found.' };
  if (!Number.isFinite(deltaQty) || deltaQty === 0) {
    return { ok: false, error: 'Adjustment quantity cannot be zero.' };
  }
  const newStock = product.currentStock + deltaQty;
  if (newStock < 0) {
    return { ok: false, error: 'Stock cannot go below zero.' };
  }

  const syncState = getSyncState(state);
  const movId = nextId('mov');
  const movement: StockMovement = {
    id: movId,
    productId: product.id,
    productName: product.name,
    type: 'ADJUSTMENT',
    deltaQty,
    balanceAfter: newStock,
    referenceId: movId.toUpperCase(),
    note: reason.trim() || 'Manual stock audit adjustment',
    createdAt: new Date().toISOString(),
    syncState,
  };

  return {
    ok: true,
    entityId: movId,
    syncState,
    message: `Adjusted ${product.name} by ${deltaQty > 0 ? `+${deltaQty}` : deltaQty} ${product.unit}.`,
    state: {
      ...state,
      products: state.products.map((p) =>
        p.id === productId ? { ...p, currentStock: newStock } : p
      ),
      stockMovements: [movement, ...state.stockMovements],
      auditLogs: appendAudit(state.auditLogs, {
        actor: 'Owner (Stock Audit)',
        action: 'STOCK_ADJUSTMENT',
        entityType: 'INVENTORY',
        entityId: product.sku,
        summary: `Stock adjustment on ${product.name}: ${deltaQty > 0 ? `+${deltaQty}` : deltaQty} ${product.unit} (Reason: ${movement.note})`,
        approvedByOwner: true,
      }),
    },
  };
}

export interface AddProductInput {
  name: string;
  sku: string;
  category: string;
  unit: string;
  currentStock: number;
  reorderLevel: number;
  maxStock: number;
  avgCostPrice: number;
  defaultSellPrice: number;
  aliases: string[];
}

export function addProduct(state: BusinessState, input: AddProductInput): EngineResult {
  if (!input.name.trim()) return { ok: false, error: 'Product name is required.' };
  if (input.defaultSellPrice < 0 || input.avgCostPrice < 0 || input.currentStock < 0) {
    return { ok: false, error: 'Prices and stock cannot be negative.' };
  }
  if (state.products.some((p) => p.name.trim().toLowerCase() === input.name.trim().toLowerCase())) {
    return { ok: false, error: `Product "${input.name.trim()}" already exists.` };
  }
  const cleanSku = input.sku.trim();
  if (cleanSku && state.products.some((p) => p.sku.trim().toLowerCase() === cleanSku.toLowerCase())) {
    return { ok: false, error: `SKU "${cleanSku}" already exists.` };
  }
  const id = nextId('prod');
  const syncState = getSyncState(state);
  const product: Product = {
    id,
    sku: input.sku.trim() || `SKU-${state.products.length + 101}`,
    name: input.name.trim(),
    category: input.category.trim() || 'General',
    unit: input.unit.trim() || 'units',
    currentStock: Math.round(input.currentStock),
    reorderLevel: Math.round(input.reorderLevel),
    maxStock: Math.max(Math.round(input.maxStock), Math.round(input.reorderLevel) * 2),
    avgCostPrice: Math.round(input.avgCostPrice),
    defaultSellPrice: Math.round(input.defaultSellPrice),
    aliases: Array.from(new Set([input.name.toLowerCase(), ...input.aliases.map((a) => a.toLowerCase())])),
  };

  return {
    ok: true,
    entityId: id,
    syncState,
    message: `Added ${product.name} to inventory catalogue.`,
    state: {
      ...state,
      products: [...state.products, product],
      auditLogs: appendAudit(state.auditLogs, {
        actor: 'Owner (Dashboard)',
        action: 'ADD_PRODUCT',
        entityType: 'INVENTORY',
        entityId: product.sku,
        summary: `Added SKU ${product.sku} (${product.name}) with ${product.currentStock} ${product.unit}`,
        approvedByOwner: true,
      }),
    },
  };
}

export interface AddCustomerInput {
  name: string;
  phone: string;
  city: string;
  segment: 'Wholesale' | 'Retail';
  creditLimit: number;
}

export function addCustomer(state: BusinessState, input: AddCustomerInput): EngineResult {
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Customer name is required.' };
  if (state.customers.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: `Customer "${name}" already exists.` };
  }
  const id = nextId('cust');
  const customer: Customer = {
    id,
    name,
    phone: input.phone.trim() || 'Not provided',
    city: input.city.trim() || 'Local',
    segment: input.segment,
    creditLimit: Math.max(0, Math.round(input.creditLimit || 100000)),
    aliases: [name.toLowerCase()],
  };
  return {
    ok: true,
    entityId: id,
    syncState: getSyncState(state),
    message: `Added customer ${customer.name} to Khata.`,
    state: {
      ...state,
      customers: [...state.customers, customer],
      auditLogs: appendAudit(state.auditLogs, {
        actor: 'Owner (Dashboard)',
        action: 'ADD_CUSTOMER',
        entityType: 'SYSTEM',
        entityId: id,
        summary: `Registered ${customer.segment} customer ${customer.name} (${customer.city})`,
        approvedByOwner: true,
      }),
    },
  };
}

export interface AddSupplierInput {
  name: string;
  phone: string;
  city: string;
  category: string;
}

export function addSupplier(state: BusinessState, input: AddSupplierInput): EngineResult {
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Supplier name is required.' };
  if (state.suppliers.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: `Supplier "${name}" already exists.` };
  }
  const id = nextId('sup');
  const supplier: Supplier = {
    id,
    name,
    phone: input.phone.trim() || 'Not provided',
    city: input.city.trim() || 'Local Mandi',
    category: input.category.trim() || 'General',
    aliases: [name.toLowerCase()],
  };
  return {
    ok: true,
    entityId: id,
    syncState: getSyncState(state),
    message: `Added supplier ${supplier.name}.`,
    state: {
      ...state,
      suppliers: [...state.suppliers, supplier],
      auditLogs: appendAudit(state.auditLogs, {
        actor: 'Owner (Dashboard)',
        action: 'ADD_SUPPLIER',
        entityType: 'SYSTEM',
        entityId: id,
        summary: `Registered supplier ${supplier.name} (${supplier.city})`,
        approvedByOwner: true,
      }),
    },
  };
}

export function updateBusinessProfile(
  state: BusinessState,
  patch: Partial<BusinessState['profile']>
): BusinessState {
  return {
    ...state,
    profile: { ...state.profile, ...patch },
  };
}

export function importBankTransactions(
  state: BusinessState,
  entries: Omit<BankTransaction, 'id' | 'matchStatus' | 'matchedSaleId' | 'matchedCustomerId' | 'confidence'>[]
): BusinessState {
  const newTxns: BankTransaction[] = entries.map((entry) => {
    // Reconciliation matching heuristic (never auto-commits; only proposes!)
    const openSales = state.sales.filter((s) => s.balanceDue > 0 && s.status !== 'RETURNED');
    const senderLower = `${entry.senderHint} ${entry.description}`.toLowerCase();

    let bestSale: Sale | undefined;
    let bestConfidence = 0;

    for (const sale of openSales) {
      const cust = state.customers.find((c) => c.id === sale.customerId);
      const nameHit =
        senderLower.includes(sale.customerName.toLowerCase()) ||
        (cust?.aliases.some((a) => senderLower.includes(a.toLowerCase())) ?? false);
      const exactAmount = sale.balanceDue === entry.amount;
      const partialAmount = entry.amount > 0 && entry.amount < sale.balanceDue;

      let score = 0;
      if (nameHit && exactAmount) score = 0.96;
      else if (nameHit && partialAmount) score = 0.84;
      else if (exactAmount) score = 0.65;

      if (score > bestConfidence) {
        bestConfidence = score;
        bestSale = sale;
      }
    }

    return {
      ...entry,
      id: nextId('bnk'),
      matchStatus: bestSale && bestConfidence >= 0.65 ? 'PROPOSED' : 'UNMATCHED',
      matchedSaleId: bestSale?.id,
      matchedCustomerId: bestSale?.customerId,
      confidence: bestConfidence > 0 ? bestConfidence : undefined,
    };
  });

  return {
    ...state,
    bankTransactions: [...newTxns, ...state.bankTransactions],
    auditLogs: appendAudit(state.auditLogs, {
      actor: 'Reconciliation Agent',
      action: 'IMPORT_BANK_ENTRIES',
      entityType: 'BANK_RECON',
      entityId: `${newTxns.length}-ROWS`,
      summary: `Imported ${newTxns.length} bank credit entries for owner verification.`,
      approvedByOwner: true,
    }),
  };
}

export function flushPendingSync(state: BusinessState): BusinessState {
  return {
    ...state,
    offlineModeSimulated: false,
    sales: state.sales.map((s) => ({ ...s, syncState: 'COMMITTED' })),
    purchases: state.purchases.map((p) => ({ ...p, syncState: 'COMMITTED' })),
    payments: state.payments.map((p) => ({ ...p, syncState: 'COMMITTED' })),
    expenses: state.expenses.map((e) => ({ ...e, syncState: 'COMMITTED' })),
    stockMovements: state.stockMovements.map((m) => ({ ...m, syncState: 'COMMITTED' })),
    auditLogs: appendAudit(state.auditLogs, {
      actor: 'Sync Engine',
      action: 'SYNC_OFFLINE_QUEUE',
      entityType: 'SYSTEM',
      entityId: 'SYNC',
      summary: 'Synchronized all locally saved offline transactions to central ledger.',
      approvedByOwner: true,
    }),
  };
}

export interface ProductAnalytics {
  product: Product;
  unitsSold: number;
  revenue: number;
  cogs: number;
  realizedProfit: number;
  marginPercent: number;
  salesFrequency: number;
  daysSinceLastSale: number;
  alertStatus: 'OUT_OF_STOCK' | 'LOW_STOCK' | 'OVERSTOCK' | 'HEALTHY';
  suggestedRestockQty: number;
  classificationTags: string[];
}

export interface FinancialSummary {
  totalRevenue: number;
  totalCOGS: number;
  grossProfit: number;
  grossMarginPct: number;
  totalExpenses: number;
  netProfit: number;
  totalPurchases: number;
  totalReceivables: number;
  totalPayables: number;
  inventoryValue: number;
  lowStockCount: number;
  pendingSyncCount: number;
  productAnalytics: ProductAnalytics[];
  topSelling: ProductAnalytics | null;
  worstSelling: ProductAnalytics | null;
  mostProfitable: ProductAnalytics | null;
  leastProfitable: ProductAnalytics | null;
}

export function computeFinancialSummary(state: BusinessState): FinancialSummary {
  const validSales = state.sales.filter((s) => s.status !== 'RETURNED');
  const totalRevenue = validSales.reduce((sum, s) => sum + s.netTotal, 0);
  const totalCOGS = validSales.reduce((sum, s) => sum + s.cogsTotal, 0);
  const grossProfit = totalRevenue - totalCOGS;
  const grossMarginPct = totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 100) : 0;

  const totalExpenses = state.expenses.reduce((sum, e) => sum + e.amount, 0);
  const netProfit = grossProfit - totalExpenses;
  const totalPurchases = state.purchases.reduce((sum, p) => sum + p.totalAmount, 0);
  const totalReceivables = state.sales.reduce((sum, s) => sum + s.balanceDue, 0);
  const totalPayables = state.purchases.reduce((sum, p) => sum + p.balanceDue, 0);
  const inventoryValue = state.products.reduce(
    (sum, p) => sum + p.currentStock * p.avgCostPrice,
    0
  );

  const pendingSyncCount =
    state.sales.filter((s) => s.syncState !== 'COMMITTED').length +
    state.purchases.filter((p) => p.syncState !== 'COMMITTED').length +
    state.expenses.filter((e) => e.syncState !== 'COMMITTED').length +
    state.payments.filter((p) => p.syncState !== 'COMMITTED').length;

  const productAnalytics: ProductAnalytics[] = state.products.map((product) => {
    let unitsSold = 0;
    let revenue = 0;
    let cogs = 0;
    let salesFrequency = 0;

    for (const sale of validSales) {
      for (const item of sale.items) {
        if (item.productId === product.id) {
          const netQty = Math.max(0, item.quantity - (item.returnedQty ?? 0));
          unitsSold += netQty;
          revenue += netQty * item.unitPrice;
          cogs += netQty * item.costPriceSnapshot;
          salesFrequency += 1;
        }
      }
    }

    const realizedProfit = revenue - cogs;
    const marginPercent = revenue > 0 ? Math.round((realizedProfit / revenue) * 100) : 0;
    const daysIdle = daysSince(product.lastSoldAt);

    let alertStatus: ProductAnalytics['alertStatus'] = 'HEALTHY';
    if (product.currentStock === 0) alertStatus = 'OUT_OF_STOCK';
    else if (product.currentStock <= product.reorderLevel) alertStatus = 'LOW_STOCK';
    else if (product.currentStock >= product.maxStock * 0.75 && daysIdle >= 14)
      alertStatus = 'OVERSTOCK';

    const targetStock = Math.max(product.reorderLevel * 2, Math.round(unitsSold * 1.25));
    const suggestedRestockQty =
      alertStatus === 'LOW_STOCK' || alertStatus === 'OUT_OF_STOCK'
        ? Math.max(10, targetStock - product.currentStock)
        : 0;

    return {
      product,
      unitsSold,
      revenue,
      cogs,
      realizedProfit,
      marginPercent,
      salesFrequency,
      daysSinceLastSale: daysIdle,
      alertStatus,
      suggestedRestockQty,
      classificationTags: [],
    };
  });

  const sortedByUnits = [...productAnalytics].sort((a, b) => b.unitsSold - a.unitsSold);
  const sortedByProfit = [...productAnalytics].sort((a, b) => b.realizedProfit - a.realizedProfit);

  const topSelling = sortedByUnits[0] ?? null;
  const worstSelling = sortedByUnits[sortedByUnits.length - 1] ?? null;
  const mostProfitable = sortedByProfit[0] ?? null;
  const leastProfitable = sortedByProfit[sortedByProfit.length - 1] ?? null;

  for (const pa of productAnalytics) {
    if (topSelling && pa.product.id === topSelling.product.id && pa.unitsSold > 0) {
      pa.classificationTags.push('Best-selling');
    }
    if (worstSelling && pa.product.id === worstSelling.product.id) {
      pa.classificationTags.push('Worst-selling');
    }
    if (mostProfitable && pa.product.id === mostProfitable.product.id && pa.realizedProfit > 0) {
      pa.classificationTags.push('Most profitable');
    }
    if (leastProfitable && pa.product.id === leastProfitable.product.id) {
      pa.classificationTags.push('Least profitable');
    }
    if (pa.salesFrequency >= 1 && pa.daysSinceLastSale <= 5) {
      pa.classificationTags.push('Fast-moving');
    } else if (pa.daysSinceLastSale >= 14 || pa.unitsSold === 0) {
      pa.classificationTags.push('Slow-moving');
    }
  }

  const lowStockCount = productAnalytics.filter(
    (p) => p.alertStatus === 'LOW_STOCK' || p.alertStatus === 'OUT_OF_STOCK'
  ).length;

  return {
    totalRevenue,
    totalCOGS,
    grossProfit,
    grossMarginPct,
    totalExpenses,
    netProfit,
    totalPurchases,
    totalReceivables,
    totalPayables,
    inventoryValue,
    lowStockCount,
    pendingSyncCount,
    productAnalytics,
    topSelling,
    worstSelling,
    mostProfitable,
    leastProfitable,
  };
}
