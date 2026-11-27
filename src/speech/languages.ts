export interface LanguageConfig {
  code: string;
  name: string;
  nativeName: string;
  scriptRange?: RegExp;
  browserSttSupported: boolean;
  nluPrototypeSupported: boolean;
  ttsLangCode: string;
  regionHint: string;
  /** Examples of colloquial/code-switched keywords for auto-detection */
  romanizedCues?: string[];
}

const DEFAULT_LANGUAGES: LanguageConfig[] = [
  {
    code: 'en-IN',
    name: 'English (India)',
    nativeName: 'English',
    browserSttSupported: true,
    nluPrototypeSupported: true,
    ttsLangCode: 'en-IN',
    regionHint: 'Pan-India Business English',
  },
  {
    code: 'hi-IN',
    name: 'Hindi / Hinglish',
    nativeName: 'हिन्दी',
    scriptRange: /[\u0900-\u097F]/,
    browserSttSupported: true,
    nluPrototypeSupported: true,
    ttsLangCode: 'hi-IN',
    regionHint: 'North & Central India (supports Hinglish code-switching)',
    romanizedCues: ['becha', 'bechi', 'kharida', 'kharidi', 'diya', 'mila', 'baki', 'baaki', 'rupaye', 'rupaiye', 'chawal', 'cheeni', 'gehu', 'bhada', 'aaj', 'kitna', 'kaun'],
  },
  {
    code: 'ta-IN',
    name: 'Tamil / Tanglish',
    nativeName: 'தமிழ்',
    scriptRange: /[\u0B80-\u0BFF]/,
    browserSttSupported: true,
    nluPrototypeSupported: true,
    ttsLangCode: 'ta-IN',
    regionHint: 'Tamil Nadu & Puducherry (supports Tanglish)',
    romanizedCues: ['arisi', 'sakkarai', 'nei', 'uppu', 'panninen', 'kudukka', 'vandhadhu', 'evlo', 'baakki', 'vikka'],
  },
  {
    code: 'te-IN',
    name: 'Telugu / Tenglish',
    nativeName: 'తెలుగు',
    scriptRange: /[\u0C00-\u0C7F]/,
    browserSttSupported: true,
    nluPrototypeSupported: true,
    ttsLangCode: 'te-IN',
    regionHint: 'Andhra Pradesh & Telangana (supports Tenglish)',
    romanizedCues: ['biyyam', 'panchadara', 'kandi', 'ammanu', 'konnanu', 'dabbu', 'entha', 'baaki'],
  },
  {
    code: 'kn-IN',
    name: 'Kannada / Kanglish',
    nativeName: 'ಕನ್ನಡ',
    scriptRange: /[\u0C80-\u0CFF]/,
    browserSttSupported: true,
    nluPrototypeSupported: true,
    ttsLangCode: 'kn-IN',
    regionHint: 'Karnataka (supports Kanglish)',
    romanizedCues: ['akki', 'sakkare', 'tuppa', 'marata', 'konde', 'eshtu', 'baaki'],
  },
  {
    code: 'ml-IN',
    name: 'Malayalam / Manglish',
    nativeName: 'മലയാളം',
    scriptRange: /[\u0D00-\u0D7F]/,
    browserSttSupported: true,
    nluPrototypeSupported: true,
    ttsLangCode: 'ml-IN',
    regionHint: 'Kerala (supports Manglish)',
    romanizedCues: ['ari', 'panchasara', 'vittu', 'vaangi', 'ethra'],
  },
  {
    code: 'bn-IN',
    name: 'Bengali / Banglish',
    nativeName: 'বাংলা',
    scriptRange: /[\u0980-\u09FF]/,
    browserSttSupported: true,
    nluPrototypeSupported: true,
    ttsLangCode: 'bn-IN',
    regionHint: 'West Bengal & Tripura (supports Banglish)',
    romanizedCues: ['chal', 'chini', 'kinlam', 'bechlam', 'taka', 'koto', 'baki'],
  },
  {
    code: 'mr-IN',
    name: 'Marathi',
    nativeName: 'मराठी',
    browserSttSupported: true,
    nluPrototypeSupported: true,
    ttsLangCode: 'mr-IN',
    regionHint: 'Maharashtra',
    romanizedCues: ['tandul', 'sakhar', 'vikle', 'vikli', 'ghetle', 'kiti', 'baki', 'rupaya'],
  },
  {
    code: 'gu-IN',
    name: 'Gujarati',
    nativeName: 'ગુજરાતી',
    scriptRange: /[\u0A80-\u0AFF]/,
    browserSttSupported: true,
    nluPrototypeSupported: true,
    ttsLangCode: 'gu-IN',
    regionHint: 'Gujarat',
    romanizedCues: ['chokha', 'khand', 'vechyu', 'kharidyu', 'ketla'],
  },
  {
    code: 'pa-IN',
    name: 'Punjabi',
    nativeName: 'ਪੰਜਾਬੀ',
    scriptRange: /[\u0A00-\u0A7F]/,
    browserSttSupported: true,
    nluPrototypeSupported: true,
    ttsLangCode: 'pa-IN',
    regionHint: 'Punjab',
    romanizedCues: ['chawl', 'khand', 'veche', 'kharide', 'kinne'],
  },
  {
    code: 'or-IN',
    name: 'Odia',
    nativeName: 'ଓଡ଼ିଆ',
    scriptRange: /[\u0B00-\u0B7F]/,
    browserSttSupported: false,
    nluPrototypeSupported: true,
    ttsLangCode: 'or-IN',
    regionHint: 'Odisha (Adapter-ready via Bhashini / Sarvam)',
  },
  {
    code: 'as-IN',
    name: 'Assamese',
    nativeName: 'অসমীয়া',
    browserSttSupported: false,
    nluPrototypeSupported: true,
    ttsLangCode: 'as-IN',
    regionHint: 'Assam (Adapter-ready via Bhashini / Sarvam)',
  },
  {
    code: 'ur-IN',
    name: 'Urdu',
    nativeName: 'اردو',
    scriptRange: /[\u0600-\u06FF]/,
    browserSttSupported: true,
    nluPrototypeSupported: true,
    ttsLangCode: 'ur-IN',
    regionHint: 'Pan-India Urdu',
  },
  {
    code: 'kok-IN',
    name: 'Konkani',
    nativeName: 'कोंकणी',
    browserSttSupported: false,
    nluPrototypeSupported: false,
    ttsLangCode: 'hi-IN',
    regionHint: 'Goa & Coastal Karnataka (Provider adapter required)',
  },
  {
    code: 'ks-IN',
    name: 'Kashmiri',
    nativeName: 'कॉशुर / کٲشُر',
    browserSttSupported: false,
    nluPrototypeSupported: false,
    ttsLangCode: 'ur-IN',
    regionHint: 'Jammu & Kashmir (Provider adapter required)',
  },
  {
    code: 'sa-IN',
    name: 'Sanskrit',
    nativeName: 'संस्कृतम्',
    browserSttSupported: false,
    nluPrototypeSupported: false,
    ttsLangCode: 'hi-IN',
    regionHint: 'Classical (Provider adapter required)',
  },
  {
    code: 'mni-IN',
    name: 'Manipuri (Meitei)',
    nativeName: 'মৈতৈলোন্ / ꯃꯩꯇꯩꯂꯣꯟ',
    scriptRange: /[\uABC0-\uABFF]/,
    browserSttSupported: false,
    nluPrototypeSupported: false,
    ttsLangCode: 'en-IN',
    regionHint: 'Manipur (Provider adapter required)',
  },
  {
    code: 'brx-IN',
    name: 'Bodo',
    nativeName: 'बड़ो',
    browserSttSupported: false,
    nluPrototypeSupported: false,
    ttsLangCode: 'hi-IN',
    regionHint: 'Assam BTR (Provider adapter required)',
  },
  {
    code: 'doi-IN',
    name: 'Dogri',
    nativeName: 'डोगरी',
    browserSttSupported: false,
    nluPrototypeSupported: false,
    ttsLangCode: 'hi-IN',
    regionHint: 'Jammu (Provider adapter required)',
  },
  {
    code: 'mai-IN',
    name: 'Maithili',
    nativeName: 'मैथिली',
    browserSttSupported: false,
    nluPrototypeSupported: false,
    ttsLangCode: 'hi-IN',
    regionHint: 'Bihar & Mithila (Provider adapter required)',
  },
  {
    code: 'sat-IN',
    name: 'Santali',
    nativeName: 'ᱥᱟᱱᱛᱟᱲᱤ',
    scriptRange: /[\u1C50-\u1C7F]/,
    browserSttSupported: false,
    nluPrototypeSupported: false,
    ttsLangCode: 'en-IN',
    regionHint: 'Jharkhand, Odisha & Bengal (Provider adapter required)',
  },
];

/**
 * Extensible registry so new regional languages/dialects can be registered
 * dynamically when external speech providers (e.g. Sarvam AI, Bhashini, Whisper) are attached.
 */
class LanguageRegistry {
  private languages: LanguageConfig[] = [...DEFAULT_LANGUAGES];

  list(): LanguageConfig[] {
    return this.languages;
  }

  getByCode(code: string): LanguageConfig | undefined {
    return this.languages.find((l) => l.code === code);
  }

  register(config: LanguageConfig): void {
    const idx = this.languages.findIndex((l) => l.code === config.code);
    if (idx >= 0) {
      this.languages[idx] = config;
    } else {
      this.languages = [...this.languages, config];
    }
  }
}

export const languageRegistry = new LanguageRegistry();

export function detectLanguageFromText(
  text: string,
  preferredCode: string
): { code: string; name: string; codeSwitched: boolean; dialectNote?: string } {
  const trimmed = text.trim();
  const hasLatin = /[a-zA-Z]/.test(trimmed);

  // 1. Check unique Indic scripts first
  for (const lang of languageRegistry.list()) {
    if (lang.scriptRange && lang.scriptRange.test(trimmed)) {
      // Devanagari is shared across Hindi, Marathi, Konkani, Bodo, Dogri, Maithili, Sanskrit
      if (lang.code === 'hi-IN') {
        const preferred = languageRegistry.getByCode(preferredCode);
        if (preferred && ['mr-IN', 'kok-IN', 'brx-IN', 'doi-IN', 'mai-IN', 'sa-IN'].includes(preferred.code)) {
          return {
            code: preferred.code,
            name: preferred.name,
            codeSwitched: hasLatin,
            dialectNote: hasLatin ? `${preferred.name} + English code-switch` : undefined,
          };
        }
      }
      return {
        code: lang.code,
        name: lang.name,
        codeSwitched: hasLatin,
        dialectNote: hasLatin ? `${lang.name} + English code-switch` : undefined,
      };
    }
  }

  // 2. Check romanized regional colloquial cues (Hinglish, Tanglish, Tenglish, Kanglish, etc.)
  const lower = trimmed.toLowerCase();
  const words = lower.split(/[^a-z0-9]+/).filter(Boolean);
  for (const lang of languageRegistry.list()) {
    if (!lang.romanizedCues) continue;
    const hit = lang.romanizedCues.some((cue) => words.includes(cue));
    if (hit) {
      return {
        code: lang.code,
        name: lang.name,
        codeSwitched: true,
        dialectNote: `Romanized ${lang.name.split('/')[0].trim()} + English code-switch`,
      };
    }
  }

  // 3. Fallback to preferred language or Indian English
  const pref = languageRegistry.getByCode(preferredCode);
  if (pref && pref.code !== 'en-IN') {
    return {
      code: pref.code,
      name: pref.name,
      codeSwitched: hasLatin,
      dialectNote: hasLatin ? `${pref.name} / English` : undefined,
    };
  }
  return {
    code: 'en-IN',
    name: 'English (India)',
    codeSwitched: false,
  };
}
