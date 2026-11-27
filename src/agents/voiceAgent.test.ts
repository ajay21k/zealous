import { describe, expect, it } from 'vitest';
import { createInitialBusinessState } from '../domain/seedData';
import {
  applyFieldCorrectionToProposal,
  detectVoiceConfirmationDecision,
  processVoiceOrTextCommand,
} from './voiceAgent';
import { resolveInteractionLanguage } from '../speech/languages';

describe('voiceAgent multilingual extraction & safeguards', () => {
  const state = createInitialBusinessState();

  it('extracts English wholesale sale with partial bank payment', () => {
    const proposal = processVoiceOrTextCommand(
      'Today I sold 50 bags of Basmati rice to Kumar Traders at ₹1,200 per bag. They paid ₹40,000 by bank transfer.',
      state
    );
    expect(proposal.intent).toBe('RECORD_SALE');
    expect(proposal.partyId).toBe('cust-kumar');
    expect(proposal.productId).toBe('prod-rice');
    expect(proposal.quantity).toBe(50);
    expect(proposal.unitPrice).toBe(1200);
    expect(proposal.totalAmount).toBe(60000);
    expect(proposal.amountPaid).toBe(40000);
    expect(proposal.pendingAmount).toBe(20000);
    expect(proposal.paymentMode).toBe('BANK_TRANSFER');
    expect(proposal.missingFields).toEqual([]);
  });

  it('understands Hinglish code-switched sale and reads back in Hindi', () => {
    const proposal = processVoiceOrTextCommand(
      'Aaj Sharma Kirana ko 10 bags cheeni 1850 ke bhav se becha, 10000 cash mila',
      state
    );
    expect(proposal.intent).toBe('RECORD_SALE');
    expect(proposal.detectedLanguage).toBe('hi-IN');
    expect(proposal.codeSwitched).toBe(true);
    expect(proposal.partyId).toBe('cust-sharma');
    expect(proposal.productId).toBe('prod-sugar');
    expect(proposal.quantity).toBe(10);
    expect(proposal.unitPrice).toBe(1850);
    expect(proposal.amountPaid).toBe(10000);
    expect(proposal.pendingAmount).toBe(8500);
    expect(proposal.readbackText).toContain('पक्का करूँ');
  });

  it('never silently guesses missing price and flags missingFields', () => {
    const proposal = processVoiceOrTextCommand('Sold 15 bags of Basmati rice to Kumar Traders', state);
    expect(proposal.intent).toBe('RECORD_SALE');
    expect(proposal.missingFields).toContain('Unit Price');
  });

  it('supports multi-turn conversational brand disambiguation and slot filling', () => {
    const turn1 = processVoiceOrTextCommand('5 bags of rice', state);
    expect(turn1.intent).toBe('RECORD_SALE');
    expect(turn1.productId).toBeUndefined();
    expect(turn1.ambiguousProducts?.length).toBe(2);
    expect(turn1.missingFields).toContain('Product Brand / Variety');
    expect(turn1.missingFields).toContain('Unit Price');
    expect(turn1.readbackText).toContain('Basmati Rice');

    const turn2 = processVoiceOrTextCommand('Basmati', state, { activeProposal: turn1 });
    expect(turn2.productId).toBe('prod-rice');
    expect(turn2.quantity).toBe(5);
    expect(turn2.missingFields).toEqual(['Unit Price']);

    const turn3 = processVoiceOrTextCommand('1200', state, { activeProposal: turn2 });
    expect(turn3.unitPrice).toBe(1200);
    expect(turn3.totalAmount).toBe(6000);
    expect(turn3.missingFields).toEqual([]);
  });

  it('applies voice field-level correction to pending proposal', () => {
    const initial = processVoiceOrTextCommand(
      'Sold 50 bags of Basmati rice to Kumar Traders at 1200 per bag, paid 40000',
      state
    );
    const corrected = applyFieldCorrectionToProposal(initial, 'make it 40 bags', state);
    expect(corrected.quantity).toBe(40);
    expect(corrected.totalAmount).toBe(48000);
    expect(corrected.pendingAmount).toBe(8000);
  });

  it('answers natural-language stock, receivables, and restock queries', () => {
    const stockQ = processVoiceOrTextCommand('How much Basmati rice stock is left?', state);
    expect(stockQ.intent).toBe('QUERY_STOCK');
    expect(stockQ.answerText).toContain('185 bags');

    const debtQ = processVoiceOrTextCommand('Who owes me money?', state);
    expect(debtQ.intent).toBe('QUERY_RECEIVABLES');
    expect(debtQ.answerText).toContain('Kumar Traders');

    const restockQ = processVoiceOrTextCommand('Which products need restocking?', state);
    expect(restockQ.intent).toBe('RESTOCK_ADVICE');
    expect(restockQ.answerText).toContain('Toor Dal');
  });

  it('offers respectful fallback when an unconfigured scheduled language is selected', () => {
    const fallback = processVoiceOrTextCommand('᱕᱐ rice sold', state, {
      preferredLangCode: 'sat-IN',
    });
    expect(fallback.intent).toBe('UNSUPPORTED_LANGUAGE');
    expect(fallback.readbackText).toContain('not yet active');
  });

  it('extracts Tanglish sale and Devanagari Hindi sale & expense commands', () => {
    const tanglish = processVoiceOrTextCommand(
      '5 packs nei 640 rupees ku sell panninen UPI payment',
      state,
      { preferredLangCode: 'ta-IN' }
    );
    expect(tanglish.intent).toBe('RECORD_SALE');
    expect(tanglish.detectedLanguage).toBe('ta-IN');
    expect(tanglish.productId).toBe('prod-ghee');
    expect(tanglish.quantity).toBe(5);
    expect(tanglish.unitPrice).toBe(640);
    expect(tanglish.paymentMode).toBe('UPI');

    const devanagari = processVoiceOrTextCommand(
      '५० बोरी बासमती चावल कुमार ट्रेडर्स को १२०० रुपये प्रति बोरी बेचा',
      state,
      { preferredLangCode: 'hi-IN' }
    );
    expect(devanagari.intent).toBe('RECORD_SALE');
    expect(devanagari.detectedLanguage).toBe('hi-IN');
    expect(devanagari.productId).toBe('prod-rice');
    expect(devanagari.quantity).toBe(50);

    const expense = processVoiceOrTextCommand(
      'Aaj tempo bhada aur hamali 1200 cash diya',
      state
    );
    expect(expense.intent).toBe('RECORD_EXPENSE');
    expect(expense.expenseCategory).toBe('Transport');
    expect(expense.totalAmount).toBe(1200);
  });

  it('handles expense street numbers, adhoc new customer names, and voice confirm/reject keywords', () => {
    const exp = processVoiceOrTextCommand('Shop 12 electricity bill 1850 paid cash', state);
    expect(exp.intent).toBe('RECORD_EXPENSE');
    expect(exp.totalAmount).toBe(1850);

    const newCustSale = processVoiceOrTextCommand(
      'Sold 10 bags rice to Mehta Traders at 1200 per bag',
      state
    );
    expect(newCustSale.partyName).toBe('Mehta Traders');
    expect(newCustSale.partyId).toBeUndefined();

    expect(detectVoiceConfirmationDecision('confirm')).toBe('CONFIRM');
    expect(detectVoiceConfirmationDecision('haan pakka')).toBe('CONFIRM');
    expect(detectVoiceConfirmationDecision('nahi cancel')).toBe('REJECT');
  });

  it('extracts native Tamil script sales and stock/khata queries from live STT', () => {
    const tamilSale = processVoiceOrTextCommand(
      '5 பாக்கெட் பாஸ்மதி அரிசி 300 ரூபாய்க்கு விற்றேன்',
      state,
      { preferredLangCode: 'ta-IN' }
    );
    expect(tamilSale.intent).toBe('RECORD_SALE');
    expect(tamilSale.detectedLanguage).toBe('ta-IN');
    expect(tamilSale.productId).toBe('prod-rice');
    expect(tamilSale.quantity).toBe(5);
    expect(tamilSale.totalAmount).toBe(300);
    expect(tamilSale.unitPrice).toBe(60);

    const tamilStock = processVoiceOrTextCommand(
      'நெய் ஸ்டாக் எவ்வளவு இருக்கு',
      state,
      { preferredLangCode: 'ta-IN' }
    );
    expect(tamilStock.intent).toBe('QUERY_STOCK');
    expect(tamilStock.answerText).toContain('14 packs');

    const tamilKhata = processVoiceOrTextCommand(
      'குமார் டிரேடர்ஸ் எவ்வளவு பாக்கி',
      state,
      { preferredLangCode: 'ta-IN' }
    );
    expect(tamilKhata.intent).toBe('QUERY_RECEIVABLES');
    expect(tamilKhata.answerText).toContain('Kumar Traders');
  });

  it('extracts unlisted ad-hoc products, units, and new suppliers without dropdown lock-in', () => {
    const pur = processVoiceOrTextCommand(
      'Purchased 20 cartons Bisleri Water from Metro Wholesale at 180 per carton',
      state
    );
    expect(pur.intent).toBe('RECORD_PURCHASE');
    expect(pur.partyName).toBe('Metro Wholesale');
    expect(pur.productName).toBe('Bisleri Water');
    expect(pur.unit).toBe('cartons');
    expect(pur.quantity).toBe(20);
    expect(pur.unitPrice).toBe(180);
    expect(pur.missingFields).toEqual([]);
  });

  it('keeps English input and output English even when Tamil is selected', () => {
    const resolved = resolveInteractionLanguage(
      'Sold 5 bags of rice for 6000',
      'ta-IN',
      true
    );
    expect(resolved.code).toBe('en-IN');
    expect(resolved.ttsCode).toBe('en-IN');
  });

  it('uses selected Tamil locale when auto-detect is off', () => {
    const resolved = resolveInteractionLanguage(
      '5 bags rice',
      'ta-IN',
      false
    );
    expect(resolved.code).toBe('ta-IN');
    expect(resolved.recognitionCode).toBe('ta-IN');
    expect(resolved.ttsCode).toBe('ta-IN');
  });

  it('detects Tanglish input and preserves a mixed-language response locale', () => {
    const resolved = resolveInteractionLanguage(
      '5 packs nei sell panninen',
      'en-IN',
      true
    );
    expect(resolved.code).toBe('ta-IN');
    expect(resolved.codeSwitched).toBe(true);
  });

  it('uses the selected locale to disambiguate shared Assamese and Kashmiri scripts', () => {
    expect(resolveInteractionLanguage('চাউল কিমান আছে?', 'as-IN', true).code).toBe('as-IN');
    expect(resolveInteractionLanguage('چاول کتنا ہے؟', 'ks-IN', true).code).toBe('ks-IN');
  });
});
