import { formatINR } from './formatters';
import { computeFinancialSummary } from './ledgerEngine';
import { BusinessState, Product } from './types';

export type BusinessQueryIntent =
  | 'PRODUCT_STOCK'
  | 'PRODUCT_AVAILABILITY'
  | 'PRODUCT_STATUS'
  | 'LOW_STOCK'
  | 'OUT_OF_STOCK'
  | 'INVENTORY_VALUE'
  | 'PRODUCT_COUNT'
  | 'INVENTORY_OVERVIEW'
  | 'PRODUCT_SEARCH'
  | 'PRODUCT_PRICE'
  | 'SALES_SUMMARY'
  | 'PURCHASE_SUMMARY'
  | 'CUSTOMER_OUTSTANDING'
  | 'SUPPLIER_OUTSTANDING'
  | 'EXPENSE_SUMMARY'
  | 'PROFIT_LOSS'
  | 'BANK_RECONCILIATION'
  | 'UNKNOWN';

export interface BusinessQueryResult {
  intent: BusinessQueryIntent;
  answer: string;
  productId?: string;
  products: Product[];
}

interface QueryContext {
  activeProductId?: string;
  languageCode?: string;
}

const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[₹,_]/g, ' ')
    .replace(/[^\p{L}\p{M}\p{N}\s/-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function findProducts(text: string, state: BusinessState): Product[] {
  const lower = normalize(text);
  const matches: { product: Product; score: number }[] = [];

  if (lower.includes('அரிசி')) {
    const riceProducts: Product[] = [];
    for (const product of state.products) {
      if (
        normalize(product.name).includes('rice') ||
        product.aliases.some((alias) => normalize(alias).includes('rice') || alias.includes('அரிசி'))
      ) {
        riceProducts.push(product);
      }
    }
    if (riceProducts.length > 0) return riceProducts;
  }

  for (const product of state.products) {
    const names = [product.name, ...product.aliases];
    let bestScore = 0;
    for (const name of names) {
      const alias = normalize(name);
      if (!alias || alias.length < 2) continue;
      if (lower.includes(alias)) {
        bestScore = Math.max(bestScore, alias.length);
      }
    }
    if (bestScore > 0) matches.push({ product, score: bestScore });
  }

  if (matches.length === 0) return [];
  const maxScore = Math.max(...matches.map((match) => match.score));
  return matches
    .filter((match) => match.score === maxScore)
    .map((match) => match.product);
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function formatStockAnswer(product: Product, languageCode: string): string {
  const { currentStock, reorderLevel, unit, name } = product;
  const templates: Record<string, string> = {
    'en-IN': `You currently have ${currentStock} ${unit} of ${name} in stock. Reorder level: ${reorderLevel} ${unit}.`,
    'hi-IN': `आपके पास ${name} का ${currentStock} ${unit} स्टॉक में है। रीऑर्डर स्तर: ${reorderLevel} ${unit}।`,
    'ta-IN': `உங்களிடம் ${name} ${currentStock} ${unit} இருப்பில் உள்ளது. மறுஆர்டர் நிலை: ${reorderLevel} ${unit}.`,
    'te-IN': `మీ వద్ద ${name} ${currentStock} ${unit} నిల్వలో ఉంది. మళ్లీ ఆర్డర్ స్థాయి: ${reorderLevel} ${unit}.`,
    'kn-IN': `ನಿಮ್ಮ ಬಳಿ ${name} ${currentStock} ${unit} ದಾಸ್ತಾನಿನಲ್ಲಿ ಇದೆ. ಮರುಆರ್ಡರ್ ಮಟ್ಟ: ${reorderLevel} ${unit}.`,
    'ml-IN': `നിങ്ങളുടെ പക്കൽ ${name} ${currentStock} ${unit} സ്റ്റോക്കിലുണ്ട്. വീണ്ടും ഓർഡർ ചെയ്യേണ്ട നില: ${reorderLevel} ${unit}.`,
    'bn-IN': `আপনার কাছে ${name} ${currentStock} ${unit} মজুত আছে। পুনরায় অর্ডারের মাত্রা: ${reorderLevel} ${unit}।`,
    'mr-IN': `तुमच्याकडे ${name} ${currentStock} ${unit} साठ्यात आहे. पुन्हा ऑर्डरची पातळी: ${reorderLevel} ${unit}.`,
    'gu-IN': `તમારી પાસે ${name} ${currentStock} ${unit} સ્ટોકમાં છે. ફરી ઓર્ડરનું સ્તર: ${reorderLevel} ${unit}.`,
    'pa-IN': `ਤੁਹਾਡੇ ਕੋਲ ${name} ${currentStock} ${unit} ਸਟਾਕ ਵਿੱਚ ਹੈ। ਦੁਬਾਰਾ ਆਰਡਰ ਦਾ ਪੱਧਰ: ${reorderLevel} ${unit}।`,
    'ur-IN': `آپ کے پاس ${name} کا ${currentStock} ${unit} اسٹاک میں ہے۔ دوبارہ آرڈر کی سطح: ${reorderLevel} ${unit}۔`,
  };
  return templates[languageCode] ??
    `Localized wording is unavailable. In English: ${templates['en-IN']}`;
}

function formatAmbiguousProductAnswer(products: Product[], languageCode: string): string {
  const names = products.map((product) => product.name).join(', ');
  const prompts: Record<string, string> = {
    'en-IN': `Multiple products match. Which one did you mean: ${names}?`,
    'hi-IN': `कई उत्पाद मिले। आप इनमें से किसकी बात कर रहे हैं: ${names}?`,
    'ta-IN': `பல பொருட்கள் பொருந்துகின்றன. இதில் எதைச் சொல்கிறீர்கள்: ${names}?`,
    'te-IN': `అనేక ఉత్పత్తులు సరిపోతున్నాయి. వీటిలో దేనిని ఉద్దేశించారు: ${names}?`,
    'kn-IN': `ಹಲವು ಉತ್ಪನ್ನಗಳು ಹೊಂದಿಕೆಯಾಗಿವೆ. ಇವುಗಳಲ್ಲಿ ಯಾವುದನ್ನು ಉದ್ದೇಶಿಸಿದ್ದೀರಿ: ${names}?`,
    'ml-IN': `ഒന്നിലധികം ഉൽപ്പന്നങ്ങൾ പൊരുത്തപ്പെടുന്നു. ഇതിൽ ഏതാണ് ഉദ്ദേശിച്ചത്: ${names}?`,
    'bn-IN': `একাধিক পণ্য মিলেছে। কোনটি বোঝাতে চেয়েছেন: ${names}?`,
    'mr-IN': `एकापेक्षा जास्त उत्पादने जुळली. यापैकी कोणते म्हणायचे आहे: ${names}?`,
    'gu-IN': `એકથી વધુ ઉત્પાદનો મળ્યાં. આમાંથી કયું કહેવા માંગો છો: ${names}?`,
    'pa-IN': `ਕਈ ਉਤਪਾਦ ਮਿਲਦੇ ਹਨ। ਤੁਸੀਂ ਇਨ੍ਹਾਂ ਵਿੱਚੋਂ ਕਿਸ ਦੀ ਗੱਲ ਕਰ ਰਹੇ ਹੋ: ${names}?`,
    'ur-IN': `متعدد مصنوعات ملتی ہیں۔ آپ ان میں سے کس کے بارے میں پوچھ رہے ہیں: ${names}?`,
  };
  return prompts[languageCode] ??
    `Localized wording is unavailable. In English: ${prompts['en-IN']}`;
}

const PRODUCT_QUERY_CUE =
  /stock|inventory|available|availability|quantity|how much|how many|left|remaining|price|cost|कितना|कितनी|किती|எவ்வளவு|இருப்பு|மிச்சம்|ఎంత|ఎన్ని|ಎಷ್ಟು|എത്ര|কত|কতটা|કેટલું|કેટલા|કેટલો|કેટલી|ਕਿੰਨਾ|ਕਿੰਨੇ|کتنا|کتنی|کتنے|কিমান|କେତେ|entha|evlo|eshtu|ethra|koto|ketla|kinne|kiti/i;

export function answerBusinessQuery(
  rawText: string,
  state: BusinessState,
  context: QueryContext = {}
): BusinessQueryResult | null {
  const text = normalize(rawText);
  const summary = computeFinancialSummary(state);

  if (PRODUCT_QUERY_CUE.test(rawText)) {
    const mixedMatches = findProducts(rawText, state);
    if (mixedMatches.length === 1) {
      const product = mixedMatches[0];
      if (!Number.isFinite(product.currentStock) || product.currentStock < 0) {
        return {
          intent: 'PRODUCT_STOCK',
          productId: product.id,
          products: [product],
          answer: `Inventory data for ${product.name} is invalid or unavailable. Please verify its stock record before using this quantity.`,
        };
      }
      return {
        intent: 'PRODUCT_STOCK',
        productId: product.id,
        products: [product],
        answer: formatStockAnswer(product, context.languageCode ?? 'en-IN'),
      };
    }
  }

  if (
    rawText.includes('அரிசி') &&
    PRODUCT_QUERY_CUE.test(rawText)
  ) {
    const riceProducts = state.products.filter(
      (product) =>
        normalize(product.name).includes('rice') ||
        product.aliases.some(
          (alias) =>
            alias.includes('அரிசி') ||
            normalize(alias).includes('rice')
        )
    );
    if (riceProducts.length > 1) {
      return {
        intent: 'PRODUCT_STOCK',
        products: riceProducts,
        answer: formatAmbiguousProductAnswer(riceProducts, context.languageCode ?? 'en-IN'),
      };
    }
    if (riceProducts.length === 1) {
      const product = riceProducts[0];
      return {
        intent: 'PRODUCT_STOCK',
        productId: product.id,
        products: [product],
        answer: formatStockAnswer(product, context.languageCode ?? 'en-IN'),
      };
    }
  }

  if (/\bsales summary\b|sales report|sales total|business sales|बिक्री|விற்பனை/.test(text)) {
    return {
      intent: 'SALES_SUMMARY',
      products: [],
      answer: `Sales summary: ${state.sales.length} invoices and ${formatINR(summary.totalRevenue)} net revenue.`,
    };
  }
  if (/\bpurchase summary\b|purchases total|purchase report|खरीद|கொள்முதல்/.test(text)) {
    return {
      intent: 'PURCHASE_SUMMARY',
      products: [],
      answer: `Purchase summary: ${state.purchases.length} bills totaling ${formatINR(summary.totalPurchases)}.`,
    };
  }
  if (/\bexpense summary\b|total expenses|operating expenses|खर्च|செலவு/.test(text)) {
    return {
      intent: 'EXPENSE_SUMMARY',
      products: [],
      answer: `Operating expenses total ${formatINR(summary.totalExpenses)}.`,
    };
  }
  if (/profit|loss|net profit|gross profit|लाभ|लாபம்|munafa/.test(text)) {
    return {
      intent: 'PROFIT_LOSS',
      products: [],
      answer: `Net profit is ${formatINR(summary.netProfit)}. Gross profit is ${formatINR(summary.grossProfit)} on revenue of ${formatINR(summary.totalRevenue)}.`,
    };
  }
  if (/supplier|payable|how much.*owe|supplier outstanding|விற்பனையாளர்.*பாக்கி/.test(text)) {
    const supplierMatch = state.suppliers.find((supplier) =>
      text.includes(normalize(supplier.name))
    );
    const payable = supplierMatch
      ? state.purchases
          .filter((purchase) => purchase.supplierId === supplierMatch.id)
          .reduce((total, purchase) => total + purchase.balanceDue, 0)
      : summary.totalPayables;
    return {
      intent: 'SUPPLIER_OUTSTANDING',
      products: [],
      answer: supplierMatch
        ? `${supplierMatch.name} currently has ${formatINR(payable)} payable.`
        : `Total supplier payables are ${formatINR(payable)}.`,
    };
  }
  if (/customer outstanding|who owes|receivable|khata|customer.*balance|கடன்|பாக்கி/.test(text)) {
    const customerMatch = state.customers.find((customer) =>
      text.includes(normalize(customer.name))
    );
    if (customerMatch) {
      const outstanding = state.sales
        .filter((sale) => sale.customerId === customerMatch.id)
        .reduce((total, sale) => total + sale.balanceDue, 0);
      return {
        intent: 'CUSTOMER_OUTSTANDING',
        products: [],
        answer: `${customerMatch.name} currently owes ${formatINR(outstanding)}.`,
      };
    }
    return {
      intent: 'CUSTOMER_OUTSTANDING',
      products: [],
      answer:
        `Total customer receivables are ${formatINR(summary.totalReceivables)}. ` +
        `Top dues: ${state.customers
          .map((customer) => ({
            name: customer.name,
            due: state.sales
              .filter((sale) => sale.customerId === customer.id)
              .reduce((total, sale) => total + sale.balanceDue, 0),
          }))
          .filter((balance) => balance.due > 0)
          .sort((a, b) => b.due - a.due)
          .map((balance) => `${balance.name} (${formatINR(balance.due)})`)
          .join(', ')}.`,
    };
  }
  if (/bank recon|reconciliation|bank statement|unmatched bank|बैंक.*रिकॉन्सिली/.test(text)) {
    const pending = state.bankTransactions.filter(
      (transaction) =>
        transaction.matchStatus === 'PROPOSED' ||
        transaction.matchStatus === 'UNMATCHED'
    ).length;
    return {
      intent: 'BANK_RECONCILIATION',
      products: [],
      answer: `${pending} bank transaction(s) are pending owner reconciliation.`,
    };
  }

  const normalText = normalize(text);
  const tamilRiceFallback =
    normalText.includes('அரிசி')
      ? state.products.filter(
          (product) =>
            normalize(product.name).includes('rice') ||
            product.aliases.some((alias) => alias.includes('அரிசி'))
        )
      : [];
  const entityMatches =
    findProducts(text, state).length > 0
      ? findProducts(text, state)
      : tamilRiceFallback;
  const entityQueryCue = entityMatches.length > 0 && hasAny(text, [
    PRODUCT_QUERY_CUE,
    /\bworth\b/,
  ]);
  const isInventoryQuery = entityQueryCue || PRODUCT_QUERY_CUE.test(text) || hasAny(text, [
    /\bstock\b/,
    /\binventory\b/,
    /\bavailable\b/,
    /\brestock\b/,
    /\breorder\b/,
    /\blow[- ]stock\b/,
    /\bout of stock\b/,
    /\bworth\b/,
    /\bhow much\b/,
    /\bhow many\b/,
    /\bquantity\b/,
    /\bquantity of\b/,
    /\bwhat about\b/,
    /\brestocking\b/,
    /\bprice\b/,
    /\bcost\b/,
    /\bமிச்சம்\b/,
    /\bஇருப்பு\b/,
    /\bஎவ்வளவு\b/,
    /\bstock\b/,
  ]);

  if (!isInventoryQuery) return null;

  if (hasAny(text, [/out of stock|stock out|zero stock|தீர்ந்த/, /ಖಾಲಿ/, /खतम/, /खाली/])) {
    const products = state.products.filter((product) => product.currentStock === 0);
    return {
      intent: 'OUT_OF_STOCK',
      products,
      answer:
        products.length === 0
          ? 'No products are currently out of stock.'
          : `Out of stock: ${products
              .map((product) => `${product.name} (0 ${product.unit})`)
              .join(', ')}.`,
    };
  }

  if (hasAny(text, [/low stock|restock|restocking|reorder|need.*stock|running low|shortage|குறைவு/, /कम है/, /తక్కువ/])) {
    const products = state.products.filter(
      (product) =>
        product.currentStock <= product.reorderLevel
    );
    return {
      intent: 'LOW_STOCK',
      products,
      answer:
        products.length === 0
          ? 'No products are currently at or below their reorder level.'
          : `These products need restocking: ${products
              .map(
                (product) =>
                  `${product.name} (${product.currentStock} ${product.unit} left; reorder at ${product.reorderLevel})`
              )
              .join('; ')}.`,
    };
  }

  if (hasAny(text, [/inventory value|inventory worth|stock worth|stock value|total.*worth|worth.*inventory/, /கையிருப்பு.*மதிப்பு/])) {
    return {
      intent: 'INVENTORY_VALUE',
      products: [],
      answer: `Your total inventory value is ${formatINR(summary.inventoryValue)}.`,
    };
  }

  if (hasAny(text, [/how many products|number of products|total products|product count|மொத்த.*பொருட்கள்/])) {
    return {
      intent: 'PRODUCT_COUNT',
      products: state.products,
      answer: `You currently have ${state.products.length} products in inventory.`,
    };
  }

  if (hasAny(text, [/inventory overview|inventory summary|stock summary|overall inventory|கையிருப்பு.*சுருக்கம்/])) {
    return {
      intent: 'INVENTORY_OVERVIEW',
      products: [],
      answer:
        `Inventory summary: ${state.products.length} products, ` +
        `total value ${formatINR(summary.inventoryValue)}, ` +
        `${summary.lowStockCount} low or out-of-stock items.`,
    };
  }

  if (hasAny(text, [/search.*product|find.*product|look for.*product|பொருள்.*தேடு/])) {
    const matches = findProducts(text, state);
    if (matches.length === 1) {
      return {
        intent: 'PRODUCT_SEARCH',
        productId: matches[0].id,
        products: matches,
        answer: `Found ${matches[0].name}: ${matches[0].currentStock} ${matches[0].unit} in stock.`,
      };
    }
    if (matches.length > 1) {
      return {
        intent: 'PRODUCT_SEARCH',
        products: matches,
        answer: `Multiple products matched. Which one did you mean: ${matches
          .map((product) => product.name)
          .join(', ')}?`,
      };
    }
  }

  const explicitMatches =
    findProducts(text, state).length > 0
      ? findProducts(text, state)
      : entityMatches;
  let matches = explicitMatches;
  if (
    matches.length === 0 &&
    context.activeProductId &&
    hasAny(text, [/how much|how many|what about|stock|quantity|available|left|remain|price|cost/])
  ) {
    const active = state.products.find((product) => product.id === context.activeProductId);
    if (active) matches = [active];
  }

  if (matches.length > 1) {
    return {
      intent: hasAny(text, [/price|cost|rate|விலை/]) ? 'PRODUCT_PRICE' : 'PRODUCT_STOCK',
      products: matches,
      answer: formatAmbiguousProductAnswer(matches, context.languageCode ?? 'en-IN'),
    };
  }

  if (matches.length === 1) {
    const product = matches[0];
    if (!Number.isFinite(product.currentStock) || product.currentStock < 0) {
      return {
        intent: 'PRODUCT_STOCK',
        productId: product.id,
        products: [product],
        answer: `Inventory data for ${product.name} is invalid or unavailable. Please verify its stock record before using this quantity.`,
      };
    }
    if (hasAny(text, [/price|cost|rate|selling price|விலை/])) {
      return {
        intent: 'PRODUCT_PRICE',
        productId: product.id,
        products: [product],
        answer: `${product.name} is priced at ${formatINR(product.defaultSellPrice)} per ${product.unit}.`,
      };
    }

    return {
      intent: hasAny(text, [/available|status|left|remaining|how much|how many|quantity|இருப்பு|எவ்வளவு/])
        ? 'PRODUCT_STOCK'
        : 'PRODUCT_AVAILABILITY',
      productId: product.id,
      products: [product],
      answer: formatStockAnswer(product, context.languageCode ?? 'en-IN'),
    };
  }

  if (hasAny(text, [/how much|how many|stock|inventory|available|quantity|எவ்வளவு|இருப்பு/, /कितना/, /ఎంత/])) {
    const nameHint = text
      .replace(/how much|how many|stock|inventory|available|quantity|right now|do we have|is|are|of|the|left|remaining/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      intent: 'PRODUCT_SEARCH',
      products: [],
      answer: nameHint
        ? `I couldn't find a matching "${nameHint}" product in your inventory.`
        : 'I could not identify the product. Please name the product you want to check.',
    };
  }

  return null;
}
