import * as XLSX from 'xlsx';
import { generateId } from './id.ts';
import type { TableNodeData, TableColumn, TableRow, CellValue, SheetData } from '../types/index.ts';

/** Parse a single worksheet into columns + rows */
function parseSheet(ws: XLSX.WorkSheet, sheetName: string): SheetData | null {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  if (range.e.r < 0 || range.e.c < 0) return null;

  // First row = headers
  const columns: TableColumn[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cellAddr = XLSX.utils.encode_cell({ r: range.s.r, c });
    const cell = ws[cellAddr];
    const headerName = cell ? String(cell.v ?? '') : `列${c + 1}`;
    columns.push({
      id: `col_${c}`,
      name: headerName || `列${c + 1}`,
      width: Math.max(80, Math.min(200, headerName.length * 14 + 40)),
      colType: 'text',
    });
  }

  // Data rows (skip header row)
  const rows: TableRow[] = [];
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const cells: Record<string, CellValue> = {};
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cellAddr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[cellAddr];
      const colId = `col_${c}`;
      if (!cell) {
        cells[colId] = null;
      } else if (cell.f) {
        cells[colId] = { formula: `=${cell.f}` };
      } else if (typeof cell.v === 'number') {
        cells[colId] = cell.v;
      } else {
        cells[colId] = cell.v != null ? String(cell.v) : null;
      }
    }
    rows.push({ id: generateId(), cells });
  }

  // Infer column types from data
  for (let c = 0; c < columns.length; c++) {
    const colId = columns[c].id;
    let numCount = 0;
    let pctCount = 0;
    let total = 0;
    for (const row of rows) {
      const v = row.cells[colId];
      if (v === null) continue;
      total++;
      if (typeof v === 'number') {
        numCount++;
        if (v >= -1 && v <= 1) pctCount++;
      }
    }
    if (total > 0) {
      if (numCount / total > 0.6) {
        if (pctCount / numCount > 0.8 && numCount > 0) {
          columns[c].colType = 'percent';
        } else {
          columns[c].colType = 'number';
        }
      }
    }
  }

  return { sheetName, columns, rows };
}

/**
 * Parse an Excel (.xlsx/.xls/.csv) file into a single TableNodeData.
 * Multiple sheets are stored in the `sheets` array; the first sheet is
 * also duplicated into the top-level columns/rows for backward compat.
 */
export async function parseExcelFile(file: File): Promise<TableNodeData[]> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });
  const title = file.name.replace(/\.[^.]+$/, '');

  const allSheets: SheetData[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const parsed = parseSheet(ws, sheetName);
    if (parsed) allSheets.push(parsed);
  }

  if (allSheets.length === 0) return [];

  // First sheet goes into top-level fields (backward compat)
  const first = allSheets[0];
  const result: TableNodeData = {
    type: 'table',
    title,
    sheetName: first.sheetName,
    columns: first.columns,
    rows: first.rows,
  };

  // Multi-sheet: attach all sheets
  if (allSheets.length > 1) {
    result.sheets = allSheets;
  }

  return [result];
}
