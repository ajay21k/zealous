import { createInitialBusinessState } from '../domain/seedData';
import { BusinessState } from '../domain/types';

const STORAGE_KEY = 'vyapaarai_business_state_v1';

export function loadBusinessState(): BusinessState {
  if (typeof window === 'undefined') return createInitialBusinessState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialBusinessState();
    const parsed = JSON.parse(raw) as BusinessState;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.products)) {
      return createInitialBusinessState();
    }
    return parsed;
  } catch {
    return createInitialBusinessState();
  }
}

export function saveBusinessState(state: BusinessState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors cleanly
  }
}

export function resetBusinessState(): BusinessState {
  const initial = createInitialBusinessState();
  saveBusinessState(initial);
  return initial;
}
