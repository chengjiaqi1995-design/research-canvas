const FULL_TICKER_ALIASES: Record<string, string[]> = {
  'ACCE IN': ['ACE.NS', 'ACE.BO'],
  'EXID IN': ['EXIDEIND.NS', 'EXIDEIND.BO'],
  'MSIL IN': ['MARUTI.NS', 'MARUTI.BO'],
};

const EXCHANGE_SUFFIXES: Record<string, string[]> = {
  US: [''],
  UN: [''],
  UQ: [''],
  UP: [''],
  HK: ['.HK'],
  JP: ['.T'],
  JT: ['.T'],
  KS: ['.KS'],
  KQ: ['.KQ'],
  AU: ['.AX'],
  AT: ['.AX'],
  TT: ['.TW'],
  TW: ['.TW', '.TWO'],
  IN: ['.NS', '.BO'],
  IB: ['.BO', '.NS'],
  SP: ['.SI'],
  SI: ['.SI'],
  LN: ['.L'],
  LI: ['.L'],
  UK: ['.L'],
  GR: ['.DE'],
  GY: ['.DE'],
  FP: ['.PA'],
  PA: ['.PA'],
  SM: ['.MC'],
  MC: ['.MC'],
  IM: ['.MI'],
  IT: ['.MI'],
  SJ: ['.JO'],
  SS: ['.ST'],
  SW: ['.SW'],
  VX: ['.SW'],
  NA: ['.AS'],
  AS: ['.AS'],
  NO: ['.OL'],
  DC: ['.CO'],
  CO: ['.CO'],
  FH: ['.HE'],
  HE: ['.HE'],
  PW: ['.WA'],
  CN: ['.TO'],
  CA: ['.TO', '.V'],
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
  return code.trim().toUpperCase().replace(/\//g, '-');
}

function formatCodeForExchange(code: string, exchange: string): string {
  if (exchange === 'HK' && /^\d+$/.test(code)) return code.padStart(4, '0');
  return code;
}

function chinaYahooSymbol(code: string): string {
  if (/^6\d{5}$/.test(code)) return `${code}.SS`;
  if (/^[0-3]\d{5}$/.test(code)) return `${code}.SZ`;
  return `${code}.SS`;
}

export function bbgToYahooSymbolCandidates(tickerBbg: string, market?: string): string[] {
  const parts = tickerBbg.replace(/\s+Equity$/i, '').trim().split(/\s+/);
  const rawCode = cleanBbgCode(parts[0] || '');
  const suffix = (parts[1] || market || '').toUpperCase();
  if (!rawCode) return [];

  const aliasCandidates = FULL_TICKER_ALIASES[`${rawCode} ${suffix}`] || [];
  if (['CH', 'CS', 'CG'].includes(suffix)) return unique([...aliasCandidates, chinaYahooSymbol(rawCode)]);

  const suffixes = EXCHANGE_SUFFIXES[suffix] || [''];
  const formattedCode = formatCodeForExchange(rawCode, suffix);
  return unique([...aliasCandidates, ...suffixes.map((exchangeSuffix) => `${formattedCode}${exchangeSuffix}`)]);
}
