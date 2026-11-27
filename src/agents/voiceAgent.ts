import { formatINR } from '../domain/formatters';
import { computeFinancialSummary } from '../domain/ledgerEngine';
import {
  BusinessState,
  Customer,
  ExpenseCategory,
  PaymentMode,
  Product,
  ProposalDraft,
  Supplier,
} from '../domain/types';
import { detectLanguageFromText, languageRegistry } from '../speech/languages';

const INDIC_DIGIT_MAP: Record<string, string> = {
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
  '௦': '0', '௧': '1', '௨': '2', '௩': '3', '௪': '4', '௫': '5', '௬': '6', '௭': '7', '௮': '8', '௯': '9',
  '౦': '0', '౧': '1', '౨': '2', '౩': '3', '౪': '4', '౫': '5', '౬': '6', '౭': '7', '౮': '8', '౯': '9',
  '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
  '૦': '0', '૧': '1', '૨': '2', '૩': '3', '૪': '4', '૫': '5', '૬': '6', '૭': '7', '૮': '8', '૯': '9',
  '೦': '0', '೧': '1', '೨': '2', '೩': '3', '೪': '4', '೫': '5', '೬': '6', '೭': '7', '೮': '8', '೯': '9',
  '൦': '0', '൧': '1', '൨': '2', '൩': '3', '൪': '4', '൫': '5', '൬': '6', '൭': '7', '൮': '8', '൯': '9',
  '੦': '0', '੧': '1', '੨': '2', '੩': '3', '੪': '4', '੫': '5', '੬': '6', '੭': '7', '੮': '8', '੯': '9',
  '୦': '0', '୧': '1', '୨': '2', '୩': '3', '୪': '4', '୫': '5', '୬': '6', '୭': '7', '୮': '8', '୯': '9',
};

const WORD_NUMBERS: Record<string, number> = {
  one: 1, ek: 1, onnu: 1, okati: 1, ondu: 1, 'ஒரு': 1, 'ஒன்று': 1, 'एक': 1,
  two: 2, do: 2, rendu: 2, eradu: 2, dui: 2, 'இரண்டு': 2, 'ரெண்டு': 2, 'दो': 2,
  three: 3, teen: 3, moonu: 3, mudu: 3, mooru: 3, tin: 3, 'மூன்று': 3, 'மூணு': 3, 'तीन': 3,
  four: 4, char: 4, naalu: 4, nalugu: 4, 'நான்கு': 4, 'நாலு': 4, 'चार': 4,
  five: 5, paanch: 5, panch: 5, anju: 5, aidu: 5, 'ஐந்து': 5, 'அஞ்சு': 5, 'पांच': 5, 'पाँच': 5,
  six: 6, chhah: 6, aaru: 6, 'ஆறு': 6, 'छह': 6,
  seven: 7, saat: 7, ezhu: 7, 'ஏழு': 7, 'सात': 7,
  eight: 8, aath: 8, ettu: 8, 'எட்டு': 8, 'आठ': 8,
  nine: 9, nau: 9, onbadhu: 9, 'ஒன்பது': 9, 'नौ': 9,
  ten: 10, das: 10, patthu: 10, padi: 10, 'பத்து': 10, 'दस': 10,
  fifteen: 15, pandrah: 15, 'பதினைந்து': 15, 'पंद्रह': 15,
  twenty: 20, bees: 20, iruvadhu: 20, 'இருபது': 20, 'बीस': 20,
  twentyfive: 25, pachchis: 25, 'இருபத்தைந்து': 25, 'पच्चीस': 25,
  thirty: 30, tees: 30, 'முப்பது': 30, 'तीस': 30,
  forty: 40, chalis: 40, 'நாற்பது': 40, 'चालीस': 40,
  fifty: 50, pachas: 50, aimbadhu: 50, 'ஐம்பது': 50, 'पचास': 50,
  hundred: 100, sau: 100, nooru: 100, 'நூறு': 100, 'सौ': 100,
  thousand: 1000, hazaar: 1000, hajar: 1000, 'ஆயிரம்': 1000, 'हजार': 1000, 'हज़ार': 1000,
};

function normalizeSpeechText(input: string): string {
  let out = input
    .split('')
    .map((ch) => INDIC_DIGIT_MAP[ch] ?? ch)
    .join('');

  // Replace standalone small word numbers before multiplier parsing (e.g. "two thousand", "do hazaar", "twenty five")
  out = out.replace(/\btwenty[\s-]+five\b/gi, '25');
  out = out.replace(
    /\b(one|ek|two|do|three|teen|four|char|five|paanch|panch|six|seven|saat|eight|aath|nine|ten|das|twenty|bees|thirty|tees|forty|chalis|fifty|pachas)\s+(lakh|lac|lakhs|hazaar|hajar|thousand|sau|hundred)\b/gi,
    (_, w, mult) => {
      const base = WORD_NUMBERS[w.toLowerCase()] ?? 1;
      const mLower = mult.toLowerCase();
      const factor =
        mLower.startsWith('lakh') || mLower === 'lac'
          ? 100000
          : mLower === 'sau' || mLower === 'hundred'
          ? 100
          : 1000;
      return String(base * factor);
    }
  );

  // Handle "1 lakh", "1.5 lakh", "40k"
  out = out.replace(/(\d+(?:\.\d+)?)\s*(?:lakh|lac|lakhs)\b/gi, (_, n) =>
    String(Math.round(parseFloat(n) * 100000))
  );
  out = out.replace(/(\d+(?:\.\d+)?)\s*(?:hazaar|hajar|thousand)\b/gi, (_, n) =>
    String(Math.round(parseFloat(n) * 1000))
  );
  out = out.replace(/(\d+(?:\.\d+)?)k\b/gi, (_, n) =>
    String(Math.round(parseFloat(n) * 1000))
  );
  // Remove commas inside Indian-formatted numbers like 40,000 or 1,20,000
  out = out.replace(/(\d),(?=\d)/g, '$1');
  return out;
}

export function detectVoiceConfirmationDecision(text: string): 'CONFIRM' | 'REJECT' | null {
  const lower = text.trim().toLowerCase();
  if (/^(?:confirm|yes|yeah|ok|okay|save|commit|haan|ha|ji haan|pakka|kar do|done|sari|aama|avunu|houdu)\b/.test(lower)) {
    return 'CONFIRM';
  }
  if (/^(?:cancel|reject|discard|no|nope|nahi|mat karo|band karo|venda|vaddu|beda)\b/.test(lower)) {
    return 'REJECT';
  }
  return null;
}

function extractPrimaryAmount(normalized: string): number | undefined {
  // Prefer explicit currency/payment cues first
  const currencyMatch =
    normalized.match(/(?:₹|rs\.?|inr)\s*(\d{1,8})/i) ??
    normalized.match(/(\d{1,8})\s*(?:rupees|rupaye|rupaiye|rs\.?|inr|cash|upi|paid|received|mila|diya)/i);
  if (currencyMatch) return parseInt(currencyMatch[1], 10);

  // Otherwise choose the last multi-digit number >= 10 (avoids "Shop 12 bill 1850" picking 12)
  const allNums = Array.from(normalized.matchAll(/\b(\d{2,8})\b/g)).map((m) => parseInt(m[1], 10));
  return allNums.length > 0 ? allNums[allNums.length - 1] : undefined;
}

function extractAdhocPartyName(text: string): string | undefined {
  // Capture "to <Customer Name>" or "<Customer Name> ko" if not in existing list
  const toMatch = text.match(
    /\bto\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})(?=\s+(?:at|@|for|worth|paid|in|via|by|$))/
  );
  if (toMatch) return toMatch[1].trim();
  const koMatch = text.match(
    /\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})\s+ko\b/
  );
  if (koMatch) return koMatch[1].trim();
  return undefined;
}

function extractAdhocSupplierName(text: string): string | undefined {
  const fromMatch = text.match(
    /\b(?:from|supplied\s+by)\s+([A-Z][A-Za-z&]+(?:\s+[A-Z][A-Za-z&]+){0,2})(?=\s+(?:at|@|for|worth|paid|in|via|by|$))/
  );
  if (fromMatch) return fromMatch[1].trim();
  const seMatch = text.match(/\b([A-Z][A-Za-z&]+(?:\s+[A-Z][A-Za-z&]+){0,2})\s+se\b/);
  if (seMatch) return seMatch[1].trim();
  return undefined;
}

function extractAdhocProductAndUnit(normalized: string): { productName?: string; unit?: string } {
  // Match "<qty> <unit> (of) <Product Name>" before "to / from / at / @ / for"
  const m = normalized.match(
    /\b\d+(?:\.\d+)?\s+([a-zA-Z]+)\s+(?:of\s+)?([A-Za-z][A-Za-z0-9\s-]{1,36}?)(?=\s+(?:to|from|at|@|for|worth|paid|via|by|in|$))/i
  );
  if (!m) return {};
  const unit = m[1].trim().toLowerCase();
  const rawProd = m[2].trim();
  // Avoid treating party/payment words as product names
  if (!rawProd || /^(?:paid|cash|upi|bank|credit)$/i.test(rawProd)) return {};
  const titleProd = rawProd.replace(/\b\w/g, (ch) => ch.toUpperCase());
  return { productName: titleProd, unit };
}

interface ProductMatchResult {
  exact?: Product;
  candidates: Product[];
}

function matchProductsWithAmbiguity(text: string, products: Product[]): ProductMatchResult {
  const lower = text.toLowerCase();
  let bestScore = 0;
  let matchedAtBest: Product[] = [];

  for (const p of products) {
    const candidates = [p.name.toLowerCase(), ...p.aliases.map((a) => a.toLowerCase())];
    let prodBest = 0;
    for (const alias of candidates) {
      if (lower.includes(alias) && alias.length > prodBest) {
        prodBest = alias.length;
      }
    }
    if (prodBest > 0) {
      if (prodBest > bestScore) {
        bestScore = prodBest;
        matchedAtBest = [p];
      } else if (prodBest === bestScore) {
        matchedAtBest.push(p);
      }
    }
  }

  if (matchedAtBest.length === 1) {
    return { exact: matchedAtBest[0], candidates: matchedAtBest };
  }
  return { exact: undefined, candidates: matchedAtBest };
}

function matchProduct(text: string, products: Product[]): Product | undefined {
  return matchProductsWithAmbiguity(text, products).exact;
}

function matchCustomer(text: string, customers: Customer[]): Customer | undefined {
  const lower = text.toLowerCase();
  for (const c of customers) {
    if (c.id === 'cust-walkin') continue;
    const names = [c.name.toLowerCase(), ...c.aliases.map((a) => a.toLowerCase())];
    if (names.some((n) => lower.includes(n))) return c;
  }
  return undefined;
}

function matchSupplier(text: string, suppliers: Supplier[]): Supplier | undefined {
  const lower = text.toLowerCase();
  for (const s of suppliers) {
    const names = [s.name.toLowerCase(), ...s.aliases.map((a) => a.toLowerCase())];
    if (names.some((n) => lower.includes(n))) return s;
  }
  return undefined;
}

function extractPaymentMode(text: string): PaymentMode {
  const lower = text.toLowerCase();
  if (/(upi|gpay|phonepe|paytm|qr|யூபிஐ|ஜிபே|யுபிஐ|यूपीआई|जीपे)/.test(lower)) return 'UPI';
  if (/(bank|neft|rtgs|imps|transfer|account|வங்கி|அக்கவுண்ட்|நெஃப்ட்|बैंक|खाता)/.test(lower)) return 'BANK_TRANSFER';
  if (/(cheque|check|காசோலை|चेक)/.test(lower)) return 'CHEQUE';
  if (/(credit|udhaar|udhar|baaki|baki|pending|கடன்|பாக்கி|बाकी|उधार)/.test(lower) && !/(paid|diya|mila|cash|கொடுத்த|பெற்ற|पैसे दिए|पैसे मिले)/.test(lower)) {
    return 'CREDIT';
  }
  return 'CASH';
}

function extractQuantity(normalized: string): number | undefined {
  // Look for number right before English or Indic unit words
  const unitRegex =
    /(\d+(?:\.\d+)?)\s*(?:bags?|bori|boriyan|packets?|packs?|pkts?|kg|kilos?|kilograms?|tins?|litres?|liters?|units?|pieces?|pcs|बोरी|बोरियां|पैकेट|किलो|टिन|लीटर|पीस|பாக்கெட்|பைகள்|பை|மூட்டை|மூட்டைகள்|பேக்|கிலோ|லிட்டர்|டின்|பீஸ்|కిలో|బస్తాలు|ప్యాకెట్|ಚೀಲ|ಕೆಜಿ|বস্তা|কেজি)(?=\s|$|[.,])/i;
  const m = normalized.match(unitRegex);
  if (m) return Math.round(parseFloat(m[1]));

  // Look for word number before unit words or product words
  const wordUnitRegex =
    /(?:^|\s)(one|ek|onnu|two|do|rendu|three|teen|moonu|four|char|five|paanch|panch|anju|six|chhah|seven|saat|eight|aath|nine|nau|ten|das|patthu|fifteen|twenty|bees|twentyfive|thirty|tees|forty|chalis|fifty|pachas|hundred|sau|ஒரு|ஒன்று|இரண்டு|ரெண்டு|மூன்று|மூணு|நான்கு|நாலு|ஐந்து|அஞ்சு|ஆறு|ஏழு|எட்டு|ஒன்பது|பத்து|இருபது|முப்பது|நாற்பது|ஐம்பது|एक|दो|तीन|चार|पांच|पाँच|छह|सात|आठ|नौ|दस|बीस|तीस|चालीस|पचास)\s+(?:bags?|bori|packets?|packs?|kg|tins?|rice|chawal|sugar|cheeni|wheat|dal|ghee|oil|salt|பாக்கெட்|பைகள்|பை|மூட்டை|பேக்|கிலோ|அரிசி|சர்க்கரை|நெய்|உப்பு|பருப்பு|எண்ணெய்|बोरी|पैकेट|किलो|चावल|चीनी|घी|नमक|दाल)/i;
  const wm = normalized.match(wordUnitRegex);
  if (wm) return WORD_NUMBERS[wm[1]] ?? WORD_NUMBERS[wm[1].toLowerCase()];

  // Fallback: small number after sell/sold/purchased/bought/becha/kharida
  const verbNum = normalized.match(
    /(?:sold|sell|purchased|bought|becha|bechi|kharida|kharidi|ammanu|konnanu|vittu|vaangi|give|add|விற்றேன்|வாங்கினேன்)\s+(\d{1,4})(?=\s|$)/i
  );
  if (verbNum) return parseInt(verbNum[1], 10);

  return undefined;
}

function extractAmounts(normalized: string, qty?: number): {
  unitPrice?: number;
  totalAmount?: number;
  amountPaid?: number;
  isFullCredit: boolean;
} {
  const lower = normalized.toLowerCase();
  let unitPrice: number | undefined;
  let totalAmount: number | undefined;
  let amountPaid: number | undefined;

  // Unit price patterns: "@ 1200", "at ₹1200 per bag", "1200 each", "1200 ke bhav", "640 rupees ku", "1200 रुपये प्रति बोरी", "ஒன்று 1200 ரூபாய்"
  const unitPriceMatch =
    normalized.match(/(?:at|@|rate|bhav|each|per\s+(?:bag|kg|tin|pack|packet|unit)|rupees\s+each|ஒன்று|வீதம்|प्रति\s+\S+)\s*(?:₹|rs\.?|inr)?\s*(\d+)/i) ??
    normalized.match(/(?:₹|rs\.?|inr)?\s*(\d+)\s*(?:per\s+(?:bag|kg|tin|pack|packet|unit)|each|ke\s+bhav|rupaye\s+ka|ka\s+bhav|rupees\s+ku|ரூபாய்\s+வீதம்|ரூ\s+வீதம்|रुपये\s+प्रति\s+\S+|रुपये\s+के\s+भाव)/i);
  if (unitPriceMatch) {
    unitPrice = parseInt(unitPriceMatch[1], 10);
  }

  // Paid amount patterns: "paid 40000", "40000 diya", "40000 mila", "10000 cash mila", "40000 கொடுத்தார்"
  const paidMatch =
    normalized.match(
      /(?:paid|received|mila|mile|diya|diye|advance|credited|cash\s+mila|bank\s+transfer\s+mila|கொடுத்தார்|கொடுத்தார்கள்|பெற்றது|செலுத்தப்பட்டது)\s*(?:₹|rs\.?|inr)?\s*(\d+)/i
    ) ??
    normalized.match(
      /(?:₹|rs\.?|inr)?\s*(\d+)\s*(?:cash\s+mila|upi\s+mila|bank\s+(?:transfer|se)\s+mila|paid|received|mila|diya|diye|ரூபாய்\s+(?:கொடுத்த|பெற்ற|வந்த)|கொடுத்தார்|கொடுத்தார்கள்|பெற்றது)/i
    );
  if (paidMatch) {
    amountPaid = parseInt(paidMatch[1], 10);
  }

  // Total amount pattern: "for ₹300", "total 300", "300 ரூபாய்க்கு", "300 ரூபாய்", "300 रुपये में"
  const totalMatch =
    normalized.match(/(?:for|total|worth|kul|மொத்தம்|कुल)\s*(?:₹|rs\.?|inr)?\s*(\d+)/i) ??
    normalized.match(/(\d+)\s*(?:ரூபாய்க்கு|ரூபாய்|ரூ|रुपये\s+में|रुपये|रुपए|రూపాయలకు|రూపాయలు|ರೂಪಾಯಿ|টাকা)(?=\s|$|[.,])/i);
  if (totalMatch && !unitPrice) {
    const val = parseInt(totalMatch[1], 10);
    if (qty && qty > 0 && val >= qty) {
      totalAmount = val;
      unitPrice = Math.round(val / qty);
    } else {
      totalAmount = val;
    }
  }

  // Check if pure credit/pending without payment
  const isFullCredit =
    /(?:on\s+credit|udhaar|udhar|all\s+pending|full\s+pending|baki\s+likh|கடன்|முழு\s+பாக்கி|உதார்)/i.test(lower) &&
    amountPaid === undefined;

  if (unitPrice && qty && !totalAmount) {
    totalAmount = unitPrice * qty;
  }

  return { unitPrice, totalAmount, amountPaid, isFullCredit };
}

function detectExpenseCategory(text: string): ExpenseCategory {
  const lower = text.toLowerCase();
  if (/(rent|kiraya|godown)/.test(lower)) return 'Rent';
  if (/(salary|salaries|staff|wages|tankhwa|vetan)/.test(lower)) return 'Salaries';
  if (/(tempo|truck|freight|transport|bhada|hamali|loading|diesel|petrol)/.test(lower)) return 'Transport';
  if (/(electric|bijli|power|bill)/.test(lower)) return 'Electricity';
  if (/(repair|maintenance|marammat)/.test(lower)) return 'Maintenance';
  if (/(pack|bag|bora|carton|tape)/.test(lower)) return 'Packaging';
  return 'Other';
}

export function buildLocalizedReadback(proposal: Omit<ProposalDraft, 'readbackText'>): string {
  const lang = proposal.detectedLanguage;
  const qty = proposal.quantity ?? '?';
  const unit = proposal.unit ?? 'units';
  const prod = proposal.productName ?? 'item';
  const total = proposal.totalAmount !== undefined ? formatINR(proposal.totalAmount) : '₹?';
  const paid = proposal.amountPaid !== undefined ? formatINR(proposal.amountPaid) : '₹0';
  const pending = proposal.pendingAmount !== undefined ? formatINR(proposal.pendingAmount) : '₹0';
  const party = proposal.partyName ?? 'Walk-in Customer';

  if (proposal.ambiguousProducts && proposal.ambiguousProducts.length > 1 && !proposal.productId) {
    const names = proposal.ambiguousProducts.map((p) => p.name).join(' or ');
    const needPrice = !proposal.unitPrice;
    if (lang === 'hi-IN') {
      return `कौन-सी किस्म/ब्रांड चुनें: ${names}?${needPrice ? ' और प्रति यूनिट कीमत भी बताएं।' : ''}`;
    }
    if (lang === 'ta-IN') {
      return `எந்த பிராண்ட்/வகை வேண்டும்: ${names}?${needPrice ? ' விலையையும் கூறவும்.' : ''}`;
    }
    return `Which brand/variety did you mean: ${names}?${needPrice ? ' Also, what price per unit?' : ''}`;
  }

  if (proposal.missingFields.length > 0) {
    const missingStr = proposal.missingFields.join(', ');
    if (lang === 'hi-IN') {
      return `कृपया बताएं: ${missingStr} की जानकारी बाकी है।`;
    }
    if (lang === 'ta-IN') {
      return `தயவுசெய்து ${missingStr} விவரத்தைக் கூறவும்.`;
    }
    return `Got it so far. Please tell me the ${missingStr} to complete this entry.`;
  }

  if (proposal.intent === 'RECORD_SALE') {
    if (lang === 'hi-IN') {
      return `आप ${party} को ${qty} ${unit} ${prod} कुल ${total} में बेचने की एंट्री कर रहे हैं (${paid} प्राप्त, ${pending} बाकी)। क्या मैं इसे पक्का करूँ?`;
    }
    if (lang === 'ta-IN') {
      return `${party} அவர்களுக்கு ${qty} ${unit} ${prod}, மொத்தம் ${total} (${paid} பெற்றது, ${pending} பாக்கி) விற்பனையாகப் பதிவு செய்கிறீர்கள். உறுதி செய்யட்டுமா?`;
    }
    if (lang === 'te-IN') {
      return `మీరు ${party} కు ${qty} ${unit} ${prod} మొత్తం ${total} (${paid} చెల్లించారు, ${pending} బాకీ) అమ్మకంగా నమోదు చేస్తున్నారు. నిర్ధారించాలా?`;
    }
    if (lang === 'kn-IN') {
      return `${party} ಅವರಿಗೆ ${qty} ${unit} ${prod} ಒಟ್ಟು ${total} (${paid} ಪಾವತಿ, ${pending} ಬಾಕಿ) ಮಾರಾಟ ದಾಖಲಿಸುತ್ತಿದ್ದೀರಿ. ದೃಢೀಕರಿಸಲೇ?`;
    }
    if (lang === 'bn-IN') {
      return `আপনি ${party}-কে ${qty} ${unit} ${prod} মোট ${total}-এ বিক্রয় রেকর্ড করছেন (${paid} জমা, ${pending} বাকি)। নিশ্চিত করব কি?`;
    }
    if (lang === 'mr-IN') {
      return `तुम्ही ${party} यांना ${qty} ${unit} ${prod} एकूण ${total} मध्ये विक्री नोंदवत आहात (${paid} जमा, ${pending} बाकी). पक्के करू का?`;
    }
    if (lang === 'gu-IN') {
      return `તમે ${party} ને ${qty} ${unit} ${prod} કુલ ${total} માં વેચાણ નોંધાવી રહ્યા છો (${paid} જમા, ${pending} બાકી). કન્ફર્મ કરું?`;
    }
    if (lang === 'ml-IN') {
      return `നിങ്ങൾ ${party} യ്ക്ക് ${qty} ${unit} ${prod} ആകെ ${total} രൂപയ്ക്ക് വിൽപ്പന രേഖപ്പെടുത്തുന്നു (${paid} ലഭിച്ചു, ${pending} ബാക്കി). സ്ഥിരീകരിക്കട്ടെ?`;
    }
    if (lang === 'pa-IN') {
      return `ਤੁਸੀਂ ${party} ਨੂੰ ${qty} ${unit} ${prod} ਕੁੱਲ ${total} ਵਿੱਚ ਵਿਕਰੀ ਦਰਜ ਕਰ ਰਹੇ ਹੋ (${paid} ਪ੍ਰਾਪਤ, ${pending} ਬਾਕੀ)। ਕੀ ਮੈਂ ਪੱਕਾ ਕਰਾਂ?`;
    }
    return `You are recording a sale of ${qty} ${unit} ${prod} to ${party} for ${total} (${paid} paid, ${pending} pending). Shall I confirm?`;
  }

  if (proposal.intent === 'RECORD_PURCHASE') {
    if (lang === 'hi-IN') {
      return `आप ${party} से ${qty} ${unit} ${prod} कुल ${total} में खरीदने की एंट्री कर रहे हैं। स्टॉक जुड़ जाएगा। क्या मैं पक्का करूँ?`;
    }
    if (lang === 'ta-IN') {
      return `${party} இடமிருந்து ${qty} ${unit} ${prod} மொத்தம் ${total} கொள்முதல் பதிவு செய்கிறீர்கள். உறுதி செய்யட்டுமா?`;
    }
    return `You are recording a purchase of ${qty} ${unit} ${prod} from ${party} for ${total}. Shall I confirm and add to stock?`;
  }

  if (proposal.intent === 'RECORD_CUSTOMER_PAYMENT') {
    if (lang === 'hi-IN') {
      return `${party} से ${total} की पेमेंट (${proposal.paymentMode ?? 'CASH'}) प्राप्त हुई है। क्या मैं खाते में जमा करूँ?`;
    }
    return `Recording payment of ${total} received from ${party} via ${proposal.paymentMode ?? 'CASH'}. Shall I confirm and allocate to open invoices?`;
  }

  if (proposal.intent === 'RECORD_EXPENSE') {
    if (lang === 'hi-IN') {
      return `${proposal.expenseCategory ?? 'Other'} खर्च ${total} (${proposal.expenseDescription ?? ''}) दर्ज कर रहे हैं। क्या पक्का करूँ?`;
    }
    return `Recording ${proposal.expenseCategory ?? 'Other'} expense of ${total} (${proposal.expenseDescription ?? ''}). Shall I confirm?`;
  }

  return proposal.answerText ?? 'Ready to review.';
}

export function applyFieldCorrectionToProposal(
  existing: ProposalDraft,
  correctionText: string,
  state: BusinessState
): ProposalDraft {
  const normalized = normalizeSpeechText(correctionText);
  const next: ProposalDraft = { ...existing };

  const prodMatch = matchProductsWithAmbiguity(normalized, state.products);
  if (prodMatch.exact) {
    next.productId = prodMatch.exact.id;
    next.productName = prodMatch.exact.name;
    next.unit = prodMatch.exact.unit;
    next.ambiguousProducts = undefined;
  } else if (prodMatch.candidates.length > 1) {
    next.ambiguousProducts = prodMatch.candidates.map((p) => ({
      id: p.id,
      name: p.name,
      defaultSellPrice: p.defaultSellPrice,
      currentStock: p.currentStock,
      unit: p.unit,
    }));
  }

  const newQty = extractQuantity(normalized) ?? (() => {
    const m = normalized.match(/(?:make\s+it|change\s+qty\s+to|qty|quantity|kar\s+do)\s*(\d+)/i);
    return m ? parseInt(m[1], 10) : undefined;
  })();
  if (newQty && newQty > 0) next.quantity = newQty;

  const amounts = extractAmounts(normalized, next.quantity);
  if (amounts.unitPrice) next.unitPrice = amounts.unitPrice;
  if (amounts.amountPaid !== undefined) next.amountPaid = amounts.amountPaid;

  // Handle bare number replies in multi-turn slot filling (e.g., user just says "1200" when asked for price)
  const bareNumMatch = normalized.trim().match(/^(?:₹|rs\.?|inr)?\s*(\d{1,7})$/i);
  if (bareNumMatch) {
    const num = parseInt(bareNumMatch[1], 10);
    if (!next.quantity && existing.missingFields.includes('Quantity')) {
      next.quantity = num;
    } else if (!next.unitPrice && existing.missingFields.some((f) => f.includes('Price') || f.includes('Cost'))) {
      next.unitPrice = num;
    } else if (
      (next.intent === 'RECORD_EXPENSE' || next.intent === 'RECORD_CUSTOMER_PAYMENT') &&
      !next.totalAmount
    ) {
      next.totalAmount = num;
      if (next.intent === 'RECORD_CUSTOMER_PAYMENT') next.amountPaid = num;
    }
  }

  if (next.intent === 'RECORD_PURCHASE') {
    const sup = matchSupplier(normalized, state.suppliers);
    if (sup) {
      next.partyId = sup.id;
      next.partyName = sup.name;
    } else {
      const adhocSup = extractAdhocSupplierName(correctionText);
      if (adhocSup) {
        next.partyId = undefined;
        next.partyName = adhocSup;
      }
    }
  } else {
    const cust = matchCustomer(normalized, state.customers);
    if (cust) {
      next.partyId = cust.id;
      next.partyName = cust.name;
    } else {
      const adhoc = extractAdhocPartyName(correctionText);
      if (adhoc) {
        next.partyId = undefined;
        next.partyName = adhoc;
      }
    }
  }

  if (/(upi|gpay|phonepe|bank|neft|imps|cash|credit|udhaar|udhar)/i.test(normalized)) {
    next.paymentMode = extractPaymentMode(normalized);
    if (next.paymentMode === 'CREDIT' && amounts.amountPaid === undefined) {
      next.amountPaid = 0;
    }
  }

  if (next.quantity && next.unitPrice) {
    next.totalAmount = next.quantity * next.unitPrice;
    const paid = Math.min(next.totalAmount, next.amountPaid ?? next.totalAmount);
    next.amountPaid = paid;
    next.pendingAmount = Math.max(0, next.totalAmount - paid);
  }

  next.missingFields = [];
  if ((next.intent === 'RECORD_SALE' || next.intent === 'RECORD_PURCHASE') && !next.productId && !next.productName) {
    next.missingFields.push(next.ambiguousProducts?.length ? 'Product Brand / Variety' : 'Product');
  }
  if ((next.intent === 'RECORD_SALE' || next.intent === 'RECORD_PURCHASE') && !next.quantity) {
    next.missingFields.push('Quantity');
  }
  if ((next.intent === 'RECORD_SALE' || next.intent === 'RECORD_PURCHASE') && !next.unitPrice) {
    next.missingFields.push(
      next.intent === 'RECORD_PURCHASE' ? 'Purchase Unit Cost' : 'Unit Price'
    );
  }
  if ((next.intent === 'RECORD_EXPENSE' || next.intent === 'RECORD_CUSTOMER_PAYMENT') && !next.totalAmount) {
    next.missingFields.push('Amount');
  }

  next.warnings = [];
  if (next.intent === 'RECORD_SALE' && next.productId && next.quantity) {
    const p = state.products.find((x) => x.id === next.productId);
    if (p && next.quantity > p.currentStock) {
      next.warnings.push(
        `Requested ${next.quantity} ${p.unit} exceeds available stock (${p.currentStock} ${p.unit}).`
      );
    }
  }

  next.readbackText = buildLocalizedReadback(next);
  return next;
}

export function processVoiceOrTextCommand(
  rawText: string,
  state: BusinessState,
  options?: { preferredLangCode?: string; activeProposal?: ProposalDraft | null }
): ProposalDraft {
  const text = rawText.trim();
  const preferredCode = options?.preferredLangCode ?? state.profile.preferredLanguage;
  const preferredLangConfig = languageRegistry.getByCode(preferredCode);
  const detected = state.profile.autoDetectLanguage
    ? detectLanguageFromText(text, preferredCode)
    : {
        code: preferredCode,
        name: preferredLangConfig?.name ?? 'English (India)',
        codeSwitched: false,
      };

  const proposalId = `prop-${Date.now().toString(36)}`;

  // Check if selected language has no live NLU prototype support (respectful fallback!)
  const langConfig = languageRegistry.getByCode(detected.code);
  if (langConfig && !langConfig.nluPrototypeSupported) {
    return {
      proposalId,
      intent: 'UNSUPPORTED_LANGUAGE',
      routedAgents: ['Supervisor Agent', 'Voice Response Agent'],
      confidence: 0,
      detectedLanguage: detected.code,
      languageName: detected.name,
      codeSwitched: false,
      originalTranscript: text,
      source: 'VOICE',
      missingFields: [],
      warnings: [`Live speech/NLU for ${langConfig.name} requires an external BHASHINI or Sarvam AI adapter.`],
      readbackText: `${langConfig.name} speech understanding is not yet active in this browser-only prototype. Please switch to Hindi, Tamil, Telugu, Kannada, Bengali, Marathi, Gujarati, or English—or enter the transaction on the dashboard.`,
      answerText: `${langConfig.name} requires a configured external speech adapter (BHASHINI / Sarvam). No transaction was guessed or recorded.`,
      status: 'ANSWERED',
      createdAt: new Date().toISOString(),
    };
  }

  // Handle field-level voice correction OR conversational slot-filling on an incomplete proposal
  const isQueryText = /(how\s+much.*stock|stock.*left|who owes|net profit|restock|reorder)/i.test(text);
  if (
    options?.activeProposal &&
    options.activeProposal.status === 'PENDING_CONFIRMATION' &&
    !isQueryText &&
    (options.activeProposal.missingFields.length > 0 ||
      /^(?:make it|change|no,|nahi|update|correct|actually|kar do|qty|price|paid)/i.test(text))
  ) {
    return applyFieldCorrectionToProposal(options.activeProposal, text, state);
  }

  if (!text || text.length < 3) {
    return {
      proposalId,
      intent: 'CLARIFICATION_NEEDED',
      routedAgents: ['Supervisor Agent', 'Voice Response Agent'],
      confidence: 0.2,
      detectedLanguage: detected.code,
      languageName: detected.name,
      codeSwitched: detected.codeSwitched,
      originalTranscript: text,
      source: 'VOICE',
      missingFields: ['Clear speech input'],
      warnings: ['Speech was too short or unclear.'],
      readbackText: 'I could not hear that clearly. Please repeat the product, quantity, and price.',
      status: 'ANSWERED',
      createdAt: new Date().toISOString(),
    };
  }

  const normalized = normalizeSpeechText(text);
  const lower = normalized.toLowerCase();
  const summary = computeFinancialSummary(state);

  // 1. Check Business Intelligence / Query Intents first
  if (/(restock|reorder|low stock|out of stock|mangwana|order karna|shortage|khatam|ரீஸ்டாக்|தீர்ந்து|कम है)/.test(lower)) {
    const lowItems = summary.productAnalytics.filter(
      (p) => p.alertStatus === 'LOW_STOCK' || p.alertStatus === 'OUT_OF_STOCK'
    );
    const answer =
      lowItems.length === 0
        ? 'All products are comfortably above reorder levels right now.'
        : `${lowItems.length} product(s) need restocking: ` +
          lowItems
            .map(
              (p) =>
                `${p.product.name} (${p.product.currentStock} ${p.product.unit} left, suggested order +${p.suggestedRestockQty} ${p.product.unit})`
            )
            .join('; ') +
          '.';
    return {
      proposalId,
      intent: 'RESTOCK_ADVICE',
      routedAgents: ['Supervisor Agent', 'Inventory Agent', 'Reporting Agent', 'Voice Response Agent'],
      confidence: 0.94,
      detectedLanguage: detected.code,
      languageName: detected.name,
      dialectNote: detected.dialectNote,
      codeSwitched: detected.codeSwitched,
      originalTranscript: text,
      source: 'VOICE',
      missingFields: [],
      warnings: [],
      readbackText: answer,
      answerText: answer,
      status: 'ANSWERED',
      createdAt: new Date().toISOString(),
    };
  }

  if (/(how\s+much.*stock|stock.*left|kitna.*stock|kitna.*bacha|stock.*kitna|inventory|available|evlo.*irukku|stock\s+check|ஸ்டாக்|எவ்வளவு.*இருக்கு|स्टॉक|कितना.*बचा|స్టాక్|ಸ್ಟಾಕ್)/.test(lower)) {
    const matchedProd = matchProduct(normalized, state.products);
    const answer = matchedProd
      ? `${matchedProd.name} currently has ${matchedProd.currentStock} ${matchedProd.unit} in stock (Reorder level: ${matchedProd.reorderLevel} ${matchedProd.unit}).`
      : `Total inventory value is ${formatINR(summary.inventoryValue)} across ${state.products.length} products. Low-stock items: ${summary.lowStockCount}.`;
    return {
      proposalId,
      intent: 'QUERY_STOCK',
      routedAgents: ['Supervisor Agent', 'Inventory Agent', 'Voice Response Agent'],
      confidence: 0.95,
      detectedLanguage: detected.code,
      languageName: detected.name,
      dialectNote: detected.dialectNote,
      codeSwitched: detected.codeSwitched,
      originalTranscript: text,
      source: 'VOICE',
      productId: matchedProd?.id,
      productName: matchedProd?.name,
      missingFields: [],
      warnings: [],
      readbackText: answer,
      answerText: answer,
      status: 'ANSWERED',
      createdAt: new Date().toISOString(),
    };
  }

  if (/(who owes|owe me|outstanding|receivable|udhaar|baaki|baki|kiska paisa|pending payment|பாக்கி|எவ்வளவு\s+தரணும்|बाकी|उधार|किसका\s+पैसा|బాకీ|ಬಾಕಿ)/.test(lower)) {
    const cust = matchCustomer(normalized, state.customers);
    let answer = '';
    if (cust) {
      const custDue = state.sales
        .filter((s) => s.customerId === cust.id)
        .reduce((sum, s) => sum + s.balanceDue, 0);
      answer = `${cust.name} currently owes ${formatINR(custDue)}.`;
    } else {
      const balances = state.customers
        .map((c) => ({
          name: c.name,
          due: state.sales.filter((s) => s.customerId === c.id).reduce((sum, s) => sum + s.balanceDue, 0),
        }))
        .filter((b) => b.due > 0)
        .sort((a, b) => b.due - a.due);
      answer =
        balances.length === 0
          ? 'No customers currently have pending balances.'
          : `Total customer receivables: ${formatINR(summary.totalReceivables)}. Top dues: ` +
            balances.map((b) => `${b.name} (${formatINR(b.due)})`).join(', ') +
            '.';
    }
    return {
      proposalId,
      intent: 'QUERY_RECEIVABLES',
      routedAgents: ['Supervisor Agent', 'Customer Ledger Agent', 'Voice Response Agent'],
      confidence: 0.95,
      detectedLanguage: detected.code,
      languageName: detected.name,
      dialectNote: detected.dialectNote,
      codeSwitched: detected.codeSwitched,
      originalTranscript: text,
      source: 'VOICE',
      partyId: cust?.id,
      partyName: cust?.name,
      missingFields: [],
      warnings: [],
      readbackText: answer,
      answerText: answer,
      status: 'ANSWERED',
      createdAt: new Date().toISOString(),
    };
  }

  if (/(sold the most|best.?selling|top product|net profit|gross profit|business report|today.?s report|sales yesterday|highest profit|profit|லாபம்|ரிப்போர்ட்|விற்பனை\s+அறிக்கை|मुनाफा|लाभ|रिपोर्ट|లాభం|ಲಾಭ)/.test(lower)) {
    const top = summary.topSelling;
    const mostProf = summary.mostProfitable;
    const answer = `Total Revenue is ${formatINR(summary.totalRevenue)}, Gross Profit is ${formatINR(summary.grossProfit)} (${summary.grossMarginPct}%), Operating Expenses are ${formatINR(summary.totalExpenses)}, and Net Profit is ${formatINR(summary.netProfit)}. Best-selling item: ${top ? `${top.product.name} (${top.unitsSold} ${top.product.unit})` : 'N/A'}. Most profitable: ${mostProf ? `${mostProf.product.name} (${formatINR(mostProf.realizedProfit)} profit)` : 'N/A'}.`;
    return {
      proposalId,
      intent: 'QUERY_PROFIT_REPORT',
      routedAgents: ['Supervisor Agent', 'Finance Agent', 'Reporting Agent', 'Voice Response Agent'],
      confidence: 0.94,
      detectedLanguage: detected.code,
      languageName: detected.name,
      dialectNote: detected.dialectNote,
      codeSwitched: detected.codeSwitched,
      originalTranscript: text,
      source: 'VOICE',
      missingFields: [],
      warnings: [],
      readbackText: answer,
      answerText: answer,
      status: 'ANSWERED',
      createdAt: new Date().toISOString(),
    };
  }

  // 2. Transaction Recording Intents
  const productMatch = matchProductsWithAmbiguity(normalized, state.products);
  const matchedProduct = productMatch.exact;
  const ambiguousCandidates = !matchedProduct && productMatch.candidates.length > 1 ? productMatch.candidates : [];
  const adhocProd = !matchedProduct && ambiguousCandidates.length === 0 ? extractAdhocProductAndUnit(normalized) : {};
  const matchedCustomer = matchCustomer(normalized, state.customers);
  const matchedSupplier = matchSupplier(normalized, state.suppliers);
  const qty = extractQuantity(normalized);
  const amounts = extractAmounts(normalized, qty);
  const paymentMode = extractPaymentMode(normalized);

  const isExpense =
    /(expense|kharcha|rent|kiraya|salary|electricity|bijli|tempo|bhada|hamali|freight|maintenance|செலவு|வாடகை|சம்பளம்|மின்சாரம்|खर्च|किराया|बिजली)/.test(lower) &&
    !matchedProduct;
  const isPurchase =
    /(purchased from|bought|purchase|procured|kharida|kharidi|khareeda|stock intake|vaangi|konnanu|kinlam|ghetle|supplied by|வாங்கினேன்|கொள்முதல்|பர்சேஸ்|खरीदा|खरीदी|కొన్నాను|ಕೊಂಡೆ|কিনলাম|घेतले|ખરીદ્યું)/.test(lower) ||
    Boolean(matchedSupplier);
  const isCustomerPaymentOnly =
    Boolean(matchedCustomer) &&
    !matchedProduct &&
    /(cleared|settled|paid back|received payment|payment from|jama kiya|wapas diya|baki diya|cleared pending|பாக்கி\s+கொடுத்த|பணம்\s+கொடுத்த|जमा\s+किया)/.test(lower);

  if (isExpense) {
    const category = detectExpenseCategory(normalized);
    const amount = extractPrimaryAmount(normalized);
    const missingFields: string[] = [];
    if (!amount) missingFields.push('Expense Amount');

    const base: Omit<ProposalDraft, 'readbackText'> = {
      proposalId,
      intent: 'RECORD_EXPENSE',
      routedAgents: ['Supervisor Agent', 'Audit Agent', 'Finance Agent', 'Voice Response Agent'],
      confidence: amount ? 0.91 : 0.6,
      detectedLanguage: detected.code,
      languageName: detected.name,
      dialectNote: detected.dialectNote,
      codeSwitched: detected.codeSwitched,
      originalTranscript: text,
      source: 'VOICE',
      totalAmount: amount,
      paymentMode,
      expenseCategory: category,
      expenseDescription: text,
      missingFields,
      warnings: [],
      status: 'PENDING_CONFIRMATION',
      createdAt: new Date().toISOString(),
    };
    return { ...base, readbackText: buildLocalizedReadback(base) };
  }

  if (isCustomerPaymentOnly && matchedCustomer) {
    const amount = extractPrimaryAmount(normalized);
    const missingFields: string[] = [];
    if (!amount) missingFields.push('Payment Amount');

    const base: Omit<ProposalDraft, 'readbackText'> = {
      proposalId,
      intent: 'RECORD_CUSTOMER_PAYMENT',
      routedAgents: ['Supervisor Agent', 'Audit Agent', 'Customer Ledger Agent', 'Voice Response Agent'],
      confidence: amount ? 0.92 : 0.65,
      detectedLanguage: detected.code,
      languageName: detected.name,
      dialectNote: detected.dialectNote,
      codeSwitched: detected.codeSwitched,
      originalTranscript: text,
      source: 'VOICE',
      partyId: matchedCustomer.id,
      partyName: matchedCustomer.name,
      totalAmount: amount,
      amountPaid: amount,
      paymentMode,
      missingFields,
      warnings: [],
      status: 'PENDING_CONFIRMATION',
      createdAt: new Date().toISOString(),
    };
    return { ...base, readbackText: buildLocalizedReadback(base) };
  }

  if (isPurchase) {
    const adhocSupplierName = !matchedSupplier ? extractAdhocSupplierName(text) : undefined;
    const supplier = matchedSupplier ?? (adhocSupplierName ? undefined : state.suppliers[0]);
    const resolvedSupplierName = supplier?.name ?? adhocSupplierName ?? state.suppliers[0]?.name ?? 'General Supplier';
    const unitCost = amounts.unitPrice;
    const totalAmount = amounts.totalAmount ?? (qty && unitCost ? qty * unitCost : undefined);
    const amountPaid = amounts.amountPaid ?? (amounts.isFullCredit ? 0 : totalAmount);
    const pendingAmount =
      totalAmount !== undefined && amountPaid !== undefined
        ? Math.max(0, totalAmount - amountPaid)
        : undefined;

    const resolvedProdName = matchedProduct?.name ?? adhocProd.productName;
    const resolvedUnit = matchedProduct?.unit ?? adhocProd.unit ?? 'units';

    const missingFields: string[] = [];
    if (!resolvedProdName) {
      missingFields.push(ambiguousCandidates.length > 1 ? 'Product Brand / Variety' : 'Product');
    }
    if (!qty) missingFields.push('Quantity');
    if (!unitCost) missingFields.push('Purchase Unit Cost');

    const base: Omit<ProposalDraft, 'readbackText'> = {
      proposalId,
      intent: 'RECORD_PURCHASE',
      routedAgents: ['Supervisor Agent', 'Audit Agent', 'Inventory Agent', 'Voice Response Agent'],
      confidence: missingFields.length === 0 ? 0.93 : 0.64,
      detectedLanguage: detected.code,
      languageName: detected.name,
      dialectNote: detected.dialectNote,
      codeSwitched: detected.codeSwitched,
      originalTranscript: text,
      source: 'VOICE',
      partyId: supplier?.id,
      partyName: resolvedSupplierName,
      productId: matchedProduct?.id,
      productName: resolvedProdName,
      unit: resolvedUnit,
      quantity: qty,
      unitPrice: unitCost,
      totalAmount,
      amountPaid,
      pendingAmount,
      paymentMode,
      missingFields,
      ambiguousProducts: ambiguousCandidates.map((p) => ({
        id: p.id,
        name: p.name,
        defaultSellPrice: p.defaultSellPrice,
        currentStock: p.currentStock,
        unit: p.unit,
      })),
      warnings: [],
      status: 'PENDING_CONFIRMATION',
      createdAt: new Date().toISOString(),
    };
    return { ...base, readbackText: buildLocalizedReadback(base) };
  }

  // Default: Sale Intent (or ask for clarification if key fields missing)
  const isExplicitSale =
    /(sold|sell|sale|becha|bechi|ammanu|vittu|marata|bechlam|vikle|vechyu|purchased\s+\d+|recording|bill|விற்றேன்|விற்றது|விற்பனை|விற்க|சேல்|பில்|बेचा|बेची|बेच|बिक्री|అమ్మాను|ಮಾರಾಟ|বেচলাম|विकले|વેચ્યું)/.test(lower) ||
    Boolean((matchedProduct || adhocProd.productName || ambiguousCandidates.length > 0) && qty);

  if (!isExplicitSale && !matchedProduct && !adhocProd.productName && ambiguousCandidates.length === 0) {
    return {
      proposalId,
      intent: 'CLARIFICATION_NEEDED',
      routedAgents: ['Supervisor Agent', 'Voice Response Agent'],
      confidence: 0.35,
      detectedLanguage: detected.code,
      languageName: detected.name,
      dialectNote: detected.dialectNote,
      codeSwitched: detected.codeSwitched,
      originalTranscript: text,
      source: 'VOICE',
      missingFields: ['Transaction Type & Product'],
      warnings: ['Could not identify product or business question reliably.'],
      readbackText:
        'I want to make sure your ledger stays accurate. Please repeat with the product name, quantity, and price — or ask a stock, khata, or profit question.',
      status: 'ANSWERED',
      createdAt: new Date().toISOString(),
    };
  }

  const adhocPartyName = !matchedCustomer ? extractAdhocPartyName(text) : undefined;
  const customer = matchedCustomer ?? (adhocPartyName ? undefined : state.customers.find((c) => c.id === 'cust-walkin'));
  const resolvedCustomerName = customer?.name ?? adhocPartyName ?? 'Walk-in Cash Customer';
  const unitPrice = amounts.unitPrice;
  const totalAmount = amounts.totalAmount ?? (qty && unitPrice ? qty * unitPrice : undefined);
  const amountPaid =
    amounts.amountPaid !== undefined
      ? amounts.amountPaid
      : amounts.isFullCredit
      ? 0
      : totalAmount;
  const pendingAmount =
    totalAmount !== undefined && amountPaid !== undefined
      ? Math.max(0, totalAmount - amountPaid)
      : undefined;

  const resolvedProdName = matchedProduct?.name ?? adhocProd.productName;
  const resolvedUnit = matchedProduct?.unit ?? adhocProd.unit ?? 'units';

  const missingFields: string[] = [];
  if (!resolvedProdName) {
    missingFields.push(ambiguousCandidates.length > 1 ? 'Product Brand / Variety' : 'Product');
  }
  if (!qty) missingFields.push('Quantity');
  if (!unitPrice) missingFields.push('Unit Price');

  const warnings: string[] = [];
  if (matchedProduct && qty && qty > matchedProduct.currentStock) {
    warnings.push(
      `Requested ${qty} ${matchedProduct.unit} exceeds available stock (${matchedProduct.currentStock} ${matchedProduct.unit}).`
    );
  }

  const base: Omit<ProposalDraft, 'readbackText'> = {
    proposalId,
    intent: 'RECORD_SALE',
    routedAgents: [
      'Supervisor Agent',
      'Audit Agent',
      'Inventory Agent',
      'Customer Ledger Agent',
      'Voice Response Agent',
    ],
    confidence: missingFields.length === 0 ? 0.94 : 0.62,
    detectedLanguage: detected.code,
    languageName: detected.name,
    dialectNote: detected.dialectNote,
    codeSwitched: detected.codeSwitched,
    originalTranscript: text,
    source: 'VOICE',
    partyId: customer?.id,
    partyName: resolvedCustomerName,
    productId: matchedProduct?.id,
    productName: resolvedProdName,
    unit: resolvedUnit,
    quantity: qty,
    unitPrice,
    totalAmount,
    amountPaid,
    pendingAmount,
    paymentMode,
    missingFields,
    ambiguousProducts: ambiguousCandidates.map((p) => ({
      id: p.id,
      name: p.name,
      defaultSellPrice: p.defaultSellPrice,
      currentStock: p.currentStock,
      unit: p.unit,
    })),
    warnings,
    status: 'PENDING_CONFIRMATION',
    createdAt: new Date().toISOString(),
  };

  return { ...base, readbackText: buildLocalizedReadback(base) };
}

export function extractDocumentLinesToProposals(
  rawNoteText: string,
  state: BusinessState
): ProposalDraft[] {
  const lines = rawNoteText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 4);

  return lines.map((line, index) => {
    const draft = processVoiceOrTextCommand(line, state);
    return {
      ...draft,
      proposalId: `doc-${Date.now().toString(36)}-${index}`,
      source: 'DOCUMENT',
      routedAgents: ['Audit Agent', 'Inventory Agent', 'Customer Ledger Agent'],
    };
  });
}
