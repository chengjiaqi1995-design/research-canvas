import ExcelJS from 'exceljs';
import { generateId } from './id.ts';
import type { TableNodeData, TableColumn, TableRow, CellValue, SheetData, CellStyle } from '../types/index.ts';

/**
 * Convert an ExcelJS color to a hex string like "#RRGGBB".
 * ExcelJS uses { argb: 'FFRRGGBB' } or { theme: number, tint: number }.
 */
function excelColorToHex(color?: Partial<ExcelJS.Color>): string | undefined {
  if (!color) return undefined;
  if (color.argb) {
    // ExcelJS gives argb as 'AARRGGBB' (8 chars)
    const raw = color.argb;
    if (raw.length === 8) return `#${raw.substring(2)}`;
    if (raw.length === 6) return `#${raw}`;
    return `#${raw}`;
  }
  return undefined;
}

/**
 * Extract CellStyle from an ExcelJS cell.
 * Returns undefined if no meaningful style is found.
 */
function extractCellStyle(cell: ExcelJS.Cell): CellStyle | undefined {
  const style: CellStyle = {};

  // Background color — ExcelJS stores it in fill
  const fill = cell.fill;
  if (fill && fill.type === 'pattern' && fill.pattern === 'solid') {
    const bg = excelColorToHex(fill.fgColor as Partial<ExcelJS.Color> | undefined);
    if (bg && bg !== '#FFFFFF' && bg !== '#ffffff' && bg !== '#000000') {
      style.bg = bg;
    }
  }

  // Font properties
  const font = cell.font;
  if (font) {
    // Font color
    if (font.color) {
      const fc = excelColorToHex(font.color);
      if (fc && fc !== '#000000') {
        style.fc = fc;
      }
    }
    // Bold / Italic
    if (font.bold) style.bl = true;
    if (font.italic) style.it = true;
  }

  return Object.keys(style).length > 0 ? style : undefined;
}

/** Parse a single ExcelJS worksheet into columns + rows */
function parseSheet(ws: ExcelJS.Worksheet, sheetName: string): SheetData | null {
  const rowCount = ws.rowCount;
  const colCount = ws.columnCount;
  if (rowCount < 1 || colCount < 1) return null;

  // First row = headers
  const headerRow = ws.getRow(1);
  const columns: TableColumn[] = [];
  for (let c = 1; c <= colCount; c++) {
    const cell = headerRow.getCell(c);
    const headerName = cell.value != null ? String(cell.value) : `列${c}`;
    columns.push({
      id: `col_${c - 1}`,
      name: headerName || `列${c}`,
      width: Math.max(80, Math.min(200, headerName.length * 14 + 40)),
      colType: 'text',
    });
  }

  // Data rows (skip header row)
  const rows: TableRow[] = [];
  for (let r = 2; r <= rowCount; r++) {
    const row = ws.getRow(r);
    // Skip completely empty rows
    if (!row.hasValues) continue;

    const cells: Record<string, CellValue> = {};
    for (let c = 1; c <= colCount; c++) {
      const cell = row.getCell(c);
      const colId = `col_${c - 1}`;
      const val = cell.value;

      if (val === null || val === undefined) {
        cells[colId] = null;
        continue;
      }

      // Handle formula cells
      if (typeof val === 'object' && 'formula' in val) {
        cells[colId] = { formula: `=${(val as ExcelJS.CellFormulaValue).formula}` };
        continue;
      }

      // Extract raw value
      let rawValue: string | number | null;
      if (typeof val === 'number') {
        rawValue = val;
      } else if (typeof val === 'boolean') {
        rawValue = val ? 'TRUE' : 'FALSE';
      } else if (val instanceof Date) {
        rawValue = val.toLocaleDateString();
      } else if (typeof val === 'object' && 'richText' in val) {
        // Rich text — concatenate all parts
        rawValue = (val as ExcelJS.CellRichTextValue).richText
          .map((part) => part.text)
          .join('');
      } else if (typeof val === 'object' && 'error' in val) {
        rawValue = String((val as ExcelJS.CellErrorValue).error);
      } else {
        rawValue = String(val);
      }

      // Extract style
      const style = extractCellStyle(cell);
      if (style) {
        cells[colId] = { value: rawValue, style };
      } else {
        cells[colId] = rawValue;
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
      const rawVal = (typeof v === 'object' && v !== null && 'value' in v) ? v.value : v;
      total++;
      if (typeof rawVal === 'number') {
        numCount++;
        if (rawVal >= -1 && rawVal <= 1) pctCount++;
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
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const title = file.name.replace(/\.[^.]+$/, '');

  const allSheets: SheetData[] = [];
  workbook.eachSheet((ws) => {
    const parsed = parseSheet(ws, ws.name);
    if (parsed) allSheets.push(parsed);
  });

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
