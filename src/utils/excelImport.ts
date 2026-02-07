import * as XLSX from 'xlsx';
import { generateId } from './id.ts';
import type { TableNodeData, TableColumn, TableRow, CellValue } from '../types/index.ts';

/**
 * Parse an Excel (.xlsx/.xls/.csv) file into TableNodeData format.
 * Returns one TableNodeData per sheet in the workbook.
 */
export async function parseExcelFile(file: File): Promise<TableNodeData[]> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });
  const results: TableNodeData[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    // Get range
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    if (range.e.r < 0 || range.e.c < 0) continue;

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
        colType: 'text', // will be refined below
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
          // Check if it looks like percentages (values between 0 and 1)
          if (pctCount / numCount > 0.8 && numCount > 0) {
            columns[c].colType = 'percent';
          } else {
            columns[c].colType = 'number';
          }
        }
      }
    }

    const title = file.name.replace(/\.[^.]+$/, '');
    results.push({
      type: 'table',
      title: wb.SheetNames.length > 1 ? `${title} - ${sheetName}` : title,
      sheetName,
      columns,
      rows,
    });
  }

  return results;
}
