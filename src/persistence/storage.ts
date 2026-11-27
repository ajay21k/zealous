import { createInitialBusinessState } from '../domain/seedData';
import { BusinessState } from '../domain/types';

const STORAGE_KEY = 'vyapaarai_business_state_v1';

function isBusinessState(value: unknown): value is BusinessState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<BusinessState>;
  return (
    state.version === 1 &&
    !!state.profile &&
    Array.isArray(state.products) &&
    Array.isArray(state.stockMovements) &&
    Array.isArray(state.customers) &&
    Array.isArray(state.suppliers) &&
    Array.isArray(state.sales) &&
    Array.isArray(state.purchases) &&
    Array.isArray(state.payments) &&
    Array.isArray(state.bankTransactions) &&
    Array.isArray(state.expenses) &&
    Array.isArray(state.auditLogs)
  );
}

export function loadBusinessState(): BusinessState {
  if (typeof window === 'undefined') return createInitialBusinessState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialBusinessState();
    const parsed = JSON.parse(raw) as unknown;
    if (!isBusinessState(parsed)) {
      return createInitialBusinessState();
    }
    return parsed;
  } catch {
    return createInitialBusinessState();
  }
}

export function saveBusinessState(state: BusinessState): boolean {
  if (typeof window === 'undefined') return true;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function resetBusinessState(): BusinessState {
  const initial = createInitialBusinessState();
  saveBusinessState(initial);
  return initial;
}
