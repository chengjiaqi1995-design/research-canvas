const FULL_TICKER_ALIASES: Record<string, string[]> = {
  'ACCE IN': ['ACE.NS', 'ACE.BO'],
  'MSIL IN': ['MARUTI.NS', 'MARUTI.BO'],
};

const EXCHANGE_CANDIDATES: Record<string, string[]> = {
  US: [''],
  HK: ['HK'],
  HKEX: ['HK'],
  JP: ['T'],
  JT: ['T'],
  IN: ['NS', 'BO'],
  IB: ['BO', 'NS'],
  KS: ['KS'],
  KQ: ['KQ'],
  TT: ['TW'],
  TW: ['TW', 'TWO'],
  SP: ['SI'],
  SI: ['SI'],
  LN: ['L'],
  LI: ['L'],
  UK: ['L'],
  LSE: ['L'],
  FP: ['PA'],
  PA: ['PA'],
  GR: ['DE', 'F'],
  GY: ['DE', 'F'],
  DE: ['DE', 'F'],
  SW: ['SW'],
  VX: ['SW'],
  SS: ['ST'],
  ST: ['ST'],
  DC: ['CO'],
  CO: ['CO'],
  BB: ['BR'],
  BR: ['BR'],
  FH: ['HE'],
  HE: ['HE'],
  NO: ['OL'],
  OL: ['OL'],
  CN: ['TO', 'V'],
  CT: ['V', 'TO'],
  CA: ['TO', 'V'],
  AU: ['AX'],
  AT: ['AX'],
  NA: ['AS'],
  AS: ['AS'],
  IM: ['MI'],
  IT: ['MI'],
  SM: ['MC'],
  MC: ['MC'],
  ID: ['JK'],
  IJ: ['JK'],
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
  if ((normalizedExchange === 'KS' || normalizedExchange === 'KQ') && /^\d+$/.test(code)) return code.padStart(6, '0');
  return code;
}

function codeCandidatesForExchange(code: string, exchange: string): string[] {
  const normalizedExchange = exchange.toUpperCase();
  const formattedCode = formatCodeForExchange(code, normalizedExchange);
  const candidates = [formattedCode];
  if (
    (normalizedExchange === 'ST' || normalizedExchange === 'CO') &&
    /^[A-Z]{3,}[AB]$/.test(formattedCode) &&
    !formattedCode.includes('-')
  ) {
    candidates.unshift(`${formattedCode.slice(0, -1)}-${formattedCode.slice(-1)}`);
  }
  return unique(candidates);
}

function chinaExchangeForCode(code: string): string {
  return code.startsWith('6') || code.startsWith('9') ? 'SS' : 'SZ';
}

function candidatesForExchange(exchange: string): string[] {
  return EXCHANGE_CANDIDATES[exchange.toUpperCase()] || [exchange.toUpperCase()];
}

function tickerSuffix(tickerBbg: string, market?: string): string {
  const cleaned = tickerBbg.replace(/\s+Equity$/i, '').trim();
  const parts = cleaned.split(/\s+/);
  return (parts[1] || market || '').toUpperCase();
}

export function fmpPreferredForMarket(tickerBbg: string, market?: string): boolean {
  return ['JP', 'JT', 'IN', 'IB'].includes(tickerSuffix(tickerBbg, market));
}

export function bbgToFmpSymbolCandidates(tickerBbg: string, market?: string): string[] {
  const cleaned = tickerBbg.replace(/\s+Equity$/i, '').trim();
  if (!cleaned) return [];

  const parts = cleaned.split(/\s+/);
  const rawCode = cleanBbgCode(parts[0] || '');
  const suffix = (parts[1] || market || '').toUpperCase();
  if (!rawCode) return [];

  if (rawCode.includes('.')) return [rawCode];

  const fullTickerKey = `${rawCode} ${suffix}`;
  const aliasCandidates = FULL_TICKER_ALIASES[fullTickerKey] || [];

  if ((suffix === 'CH' || suffix === 'CG' || suffix === 'CS' || suffix === 'CN') && /^\d{6}$/.test(rawCode)) {
    return unique([...aliasCandidates, `${rawCode}.${chinaExchangeForCode(rawCode)}`]);
  }

  if (suffix === 'SS' && /^\d{6}$/.test(rawCode)) {
    return unique([...aliasCandidates, `${rawCode}.SS`]);
  }

  if ((suffix === 'SH' || suffix === 'SHG' || suffix === 'SZ' || suffix === 'SHE') && /^\d{6}$/.test(rawCode)) {
    const exchange = suffix === 'SZ' || suffix === 'SHE' ? 'SZ' : 'SS';
    return unique([...aliasCandidates, `${rawCode}.${exchange}`]);
  }

  const codeCandidates = suffix === 'IN'
    ? unique([...(INDIAN_CODE_ALIASES[rawCode] || []), rawCode])
    : [rawCode];

  const exchangeCandidates = candidatesForExchange(suffix);
  const symbolCandidates = codeCandidates.flatMap((code) =>
    exchangeCandidates.flatMap((exchange) =>
      codeCandidatesForExchange(code, exchange).map((formattedCode) =>
        exchange ? `${formattedCode}.${exchange}` : formattedCode
      ),
    ),
  );

  return unique([...aliasCandidates, ...symbolCandidates]);
}
