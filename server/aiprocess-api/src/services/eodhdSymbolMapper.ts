const FULL_TICKER_ALIASES: Record<string, string[]> = {
  'ACCE IN': ['ACE.NSE'],
  'HUSQB SS': ['HUSQ-B.ST'],
  'KAP LI': ['KAP.LSE'],
  'MSIL IN': ['MARUTI.NSE'],
};

const EXCHANGE_CANDIDATES: Record<string, string[]> = {
  US: ['US'],
  HK: ['HK'],
  JP: ['TSE'],
  JT: ['TSE'],
  KS: ['KO', 'KQ'],
  KQ: ['KQ', 'KO'],
  IN: ['NSE', 'BSE'],
  IB: ['BSE', 'NSE'],
  LN: ['LSE'],
  LI: ['LSE'],
  UK: ['LSE'],
  LSE: ['LSE'],
  FP: ['PA'],
  PA: ['PA'],
  GR: ['XETRA', 'F'],
  GY: ['XETRA', 'F'],
  DE: ['XETRA', 'F'],
  SW: ['SW'],
  VX: ['SW'],
  SS: ['ST'],
  ST: ['ST'],
  NO: ['OL'],
  OL: ['OL'],
  CN: ['TO', 'V', 'NEO'],
  CT: ['V', 'TO'],
  CA: ['TO', 'V', 'NEO'],
  TT: ['TW', 'TWO'],
  TW: ['TW', 'TWO'],
  AU: ['AU'],
  AT: ['AU'],
  NA: ['AS'],
  AS: ['AS'],
  IM: ['MI'],
  IT: ['MI'],
  SM: ['MC'],
  MC: ['MC'],
  BB: ['BR'],
  DC: ['CO'],
  FH: ['HE'],
  HKEX: ['HK'],
};

const INDIAN_CODE_ALIASES: Record<string, string[]> = {
  ACCE: ['ACE'],
  MSIL: ['MARUTI'],
};

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.trim().toUpperCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function cleanBbgCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/\//g, '-')
    .replace(/\s+/g, '');
}

function formatCodeForExchange(code: string, exchange: string): string {
  const normalizedExchange = exchange.toUpperCase();
  if (normalizedExchange === 'HK' && /^\d+$/.test(code)) return code.padStart(4, '0');
  if ((normalizedExchange === 'KO' || normalizedExchange === 'KQ') && /^\d+$/.test(code)) return code.padStart(6, '0');
  return code;
}

function chinaExchangeForCode(code: string): string {
  return code.startsWith('6') || code.startsWith('9') ? 'SHG' : 'SHE';
}

function candidatesForExchange(exchange: string): string[] {
  return EXCHANGE_CANDIDATES[exchange.toUpperCase()] || [exchange.toUpperCase()];
}

export function bbgToEodhdSymbolCandidates(tickerBbg: string, market?: string): string[] {
  const cleaned = tickerBbg.replace(/\s+Equity$/i, '').trim();
  if (!cleaned) return [];

  const parts = cleaned.split(/\s+/);
  const rawCode = cleanBbgCode(parts[0] || '');
  const suffix = (parts[1] || market || '').toUpperCase();
  if (!rawCode) return [];

  if (rawCode.includes('.')) return [rawCode];

  const fullTickerKey = `${rawCode} ${suffix}`;
  const aliasCandidates = FULL_TICKER_ALIASES[fullTickerKey] || [];

  if (suffix === 'CH' || suffix === 'CG' || suffix === 'CS' || (suffix === 'CN' && /^\d{6}$/.test(rawCode))) {
    return unique([...aliasCandidates, `${rawCode}.${chinaExchangeForCode(rawCode)}`]);
  }

  if ((suffix === 'SH' || suffix === 'SHG' || suffix === 'SZ' || suffix === 'SHE' || suffix === 'SS') && /^\d{6}$/.test(rawCode)) {
    const exchange = suffix === 'SZ' || suffix === 'SHE' ? 'SHE' : 'SHG';
    return unique([...aliasCandidates, `${rawCode}.${exchange}`]);
  }

  const codeCandidates = suffix === 'IN'
    ? unique([...(INDIAN_CODE_ALIASES[rawCode] || []), rawCode])
    : [rawCode];

  const exchangeCandidates = candidatesForExchange(suffix);
  const symbolCandidates = codeCandidates.flatMap((code) =>
    exchangeCandidates.map((exchange) => `${formatCodeForExchange(code, exchange)}.${exchange}`),
  );

  return unique([...aliasCandidates, ...symbolCandidates]);
}
