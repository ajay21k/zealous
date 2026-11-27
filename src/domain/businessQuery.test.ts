import { describe, expect, it } from 'vitest';
import { answerBusinessQuery } from './businessQuery';
import { createInitialBusinessState } from './seedData';

function controlledState() {
  const state = createInitialBusinessState();
  state.products = [
    ...state.products,
    {
      id: 'prod-milk',
      sku: 'DAIRY-701',
      name: 'Milk',
      category: 'Dairy',
      unit: 'litres',
      currentStock: 37,
      reorderLevel: 20,
      maxStock: 100,
      avgCostPrice: 48,
      defaultSellPrice: 60,
      aliases: ['milk', 'toned milk'],
    },
  ];
  return state;
}

describe('deterministic business inventory queries', () => {
  it('returns the actual milk stock quantity', () => {
    const state = controlledState();
    const result = answerBusinessQuery('How much milk do we have in stock?', state);
    expect(result?.intent).toBe('PRODUCT_STOCK');
    expect(result?.answer).toContain('37 litres');
    expect(result?.answer).toContain('Milk');
  });

  it('returns different records for milk and wheat', () => {
    const state = controlledState();
    const milk = answerBusinessQuery('How much milk is available?', state);
    const wheat = answerBusinessQuery('What is the wheat stock?', state);
    expect(milk?.answer).toContain('37 litres');
    expect(wheat?.answer).toContain('140 bags');
    expect(milk?.answer).not.toBe(wheat?.answer);
  });

  it('asks for clarification when several rice products match', () => {
    const state = controlledState();
    const result = answerBusinessQuery("What's the quantity of rice available?", state);
    expect(result?.answer).toContain('Multiple products');
    expect(result?.answer).toContain('Basmati Rice');
    expect(result?.answer).toContain('Sona Masoori Rice');
  });

  it('reports a missing product instead of inventing stock', () => {
    const state = controlledState();
    const result = answerBusinessQuery('How much chocolate do we have?', state);
    expect(result?.intent).toBe('PRODUCT_SEARCH');
    expect(result?.answer).toContain("couldn't find");
    expect(result?.products).toEqual([]);
  });

  it('returns real low-stock products', () => {
    const state = controlledState();
    const result = answerBusinessQuery('Which products need restocking?', state);
    expect(result?.intent).toBe('LOW_STOCK');
    expect(result?.answer).toContain('Sugar');
    expect(result?.answer).toContain('Toor Dal');
  });

  it('returns inventory summary and inventory value separately', () => {
    const state = controlledState();
    const summary = answerBusinessQuery('Give me an inventory overview', state);
    const value = answerBusinessQuery("What's our inventory worth?", state);
    expect(summary?.intent).toBe('INVENTORY_OVERVIEW');
    expect(summary?.answer).toContain(`${state.products.length} products`);
    expect(value?.intent).toBe('INVENTORY_VALUE');
    expect(value?.answer).toContain('inventory value');
  });

  it('handles follow-up product context', () => {
    const state = controlledState();
    const wheat = answerBusinessQuery('How much wheat is available?', state);
    const followUp = answerBusinessQuery('What about milk?', state, {
      activeProductId: wheat?.productId,
    });
    expect(followUp?.answer).toContain('37 litres');
  });

  it('supports multilingual product queries through the same inventory records', () => {
    const state = controlledState();
    const queries = [
      'அரிசி எவ்வளவு இருப்பு உள்ளது?',
      'चावल कितना स्टॉक में है?',
      'బియ్యం ఎంత స్టాక్ ఉంది?',
      'ಅಕ್ಕಿ ಎಷ್ಟು ಸ್ಟಾಕ್ ಇದೆ?',
      'അരി എത്ര സ്റ്റോക്ക്?',
      'চাল কত স্টক?',
      'तांदूळ किती स्टॉक?',
      'ચોખા કેટલું સ્ટોક?',
      'ਚੌਲ ਕਿੰਨਾ ਸਟਾਕ?',
      'چاول کتنا اسٹاک?',
      'arisi evlo stock irukku',
      'biyyam entha stock undi',
    ];
    for (const query of queries) {
      const result = answerBusinessQuery(query, state);
      expect(result?.intent, query).toBe('PRODUCT_STOCK');
      expect(result?.products.map((product) => product.id), query).toEqual([
        'prod-rice',
        'prod-sona-rice',
      ]);
    }

    const hindiMilk = answerBusinessQuery('Milk कितना स्टॉक में है?', state);
    expect(hindiMilk?.answer).toContain('37 litres');
  });

  it('localizes deterministic stock responses without changing the underlying values', () => {
    const state = controlledState();
    const tamil = answerBusinessQuery('How much milk is available?', state, {
      languageCode: 'ta-IN',
    });
    const hindi = answerBusinessQuery('How much milk is available?', state, {
      languageCode: 'hi-IN',
    });
    expect(tamil?.answer).toContain('உங்களிடம்');
    expect(tamil?.answer).toContain('37 litres');
    expect(tamil?.answer).toContain('20 litres');
    expect(hindi?.answer).toContain('आपके पास');
    expect(hindi?.answer).toContain('37 litres');

    const unsupportedLocale = answerBusinessQuery('How much milk is available?', state, {
      languageCode: 'or-IN',
    });
    expect(unsupportedLocale?.answer).toContain('Localized wording is unavailable');
    expect(unsupportedLocale?.answer).toContain('37 litres');
  });

  it('does not mutate inventory for read-only queries', () => {
    const state = controlledState();
    const snapshot = JSON.stringify(state.products);
    answerBusinessQuery('How much milk do we have?', state);
    answerBusinessQuery('Which products need restocking?', state);
    expect(JSON.stringify(state.products)).toBe(snapshot);
  });

  it('handles missing or invalid stock records without fabrication', () => {
    const state = controlledState();
    state.products[0].currentStock = Number.NaN;
    const result = answerBusinessQuery(
      `How much ${state.products[0].name} do we have?`,
      state
    );
    expect(result?.answer).toBeDefined();
    expect(result?.answer).not.toContain('NaN');
  });
});
