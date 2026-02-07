/**
 * Convert column index (0-based) to A1-notation letter.
 * 0 -> A, 1 -> B, ..., 25 -> Z, 26 -> AA
 */
export function colIndexToLetter(col: number): string {
  let letter = '';
  let c = col;
  while (c >= 0) {
    letter = String.fromCharCode((c % 26) + 65) + letter;
    c = Math.floor(c / 26) - 1;
  }
  return letter;
}

/**
 * Convert A1-notation letter to column index (0-based).
 * A -> 0, B -> 1, ..., Z -> 25, AA -> 26
 */
export function letterToColIndex(letter: string): number {
  let index = 0;
  for (let i = 0; i < letter.length; i++) {
    index = index * 26 + (letter.charCodeAt(i) - 64);
  }
  return index - 1;
}

/**
 * Create A1-notation address from row/col indices (0-based).
 */
export function toA1(row: number, col: number): string {
  return `${colIndexToLetter(col)}${row + 1}`;
}

/**
 * Parse A1-notation address to row/col indices (0-based).
 */
export function fromA1(address: string): { row: number; col: number } {
  const match = address.match(/^([A-Z]+)(\d+)$/);
  if (!match) throw new Error(`Invalid A1 address: ${address}`);
  return {
    col: letterToColIndex(match[1]),
    row: parseInt(match[2], 10) - 1,
  };
}
