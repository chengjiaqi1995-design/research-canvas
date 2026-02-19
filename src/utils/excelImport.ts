import LuckyExcel from '@zwight/luckyexcel';
import ExcelJS from '@zwight/exceljs';
import type { TableNodeData } from '../types/index.ts';

/**
 * Parse an Excel (.xlsx) file using luckyexcel → IWorkbookData.
 * If luckyexcel fails (e.g. charts), falls back to exceljs to read raw cell data.
 */
export async function parseExcelFile(file: File): Promise<TableNodeData[]> {
  const title = file.name.replace(/\.[^.]+$/, '');
  const ext = file.name.split('.').pop()?.toLowerCase();

  // Try luckyexcel first (preserves all formatting)
  try {
    const result = await parseLuckyExcel(file, ext, title);
    return result;
  } catch (luckyErr) {
    console.warn('LuckyExcel failed, falling back to ExcelJS:', luckyErr);
  }

  // Fallback: use exceljs to read raw cell data (ignores charts)
  return parseWithExcelJS(file, title);
}

/** Primary: luckyexcel parse with timeout */
function parseLuckyExcel(file: File, ext: string | undefined, title: string): Promise<TableNodeData[]> {
  return new Promise<TableNodeData[]>((resolve, reject) => {
    // 10s timeout in case the library hangs
    const timer = setTimeout(() => reject(new Error('LuckyExcel timeout')), 10_000);

    const handler = (workbookData: unknown) => {
      clearTimeout(timer);
      if (!workbookData) {
        reject(new Error('Failed to parse Excel file'));
        return;
      }
      const result: TableNodeData = {
        type: 'table',
        title,
        sheetName: 'Sheet1',
        columns: [],
        rows: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        workbookData: workbookData as any,
      };
      resolve([result]);
    };

    const errorHandler = (err: Error) => {
      clearTimeout(timer);
      reject(err);
    };

    if (ext === 'csv') {
      LuckyExcel.transformCsvToUniver(file, handler, errorHandler);
    } else {
      LuckyExcel.transformExcelToUniver(file, handler, errorHandler);
    }
  });
}

/** Fallback: read raw data with exceljs → build Univer IWorkbookData manually */
async function parseWithExcelJS(file: File, title: string): Promise<TableNodeData[]> {
  const buffer = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  // Build a minimal IWorkbookData-compatible structure
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sheets: Record<string, any> = {};
  let sheetOrder = 0;

  wb.eachSheet((ws: ExcelJS.Worksheet) => {
    const sheetId = `sheet_${sheetOrder}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cellData: Record<number, Record<number, any>> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const columnData: Record<number, any> = {};
    let maxRow = 0;
    let maxCol = 0;

    ws.eachRow({ includeEmpty: false }, (row: ExcelJS.Row, rowNumber: number) => {
      const r = rowNumber - 1; // 0-indexed
      if (r > maxRow) maxRow = r;
      cellData[r] = {};

      row.eachCell({ includeEmpty: false }, (cell: ExcelJS.Cell, colNumber: number) => {
        const c = colNumber - 1; // 0-indexed
        if (c > maxCol) maxCol = c;

        // Extract cell value
        let v: string | number = '';
        if (cell.value !== null && cell.value !== undefined) {
          if (typeof cell.value === 'object' && 'result' in cell.value) {
            // Formula cell — use the cached result
            v = cell.value.result as string | number;
          } else if (typeof cell.value === 'object' && 'richText' in cell.value) {
            // Rich text — concatenate
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            v = (cell.value as any).richText.map((t: any) => t.text).join('');
          } else if (cell.value instanceof Date) {
            v = cell.value.toISOString().split('T')[0];
          } else {
            v = cell.value as string | number;
          }
        }

        cellData[r][c] = { v };
      });
    });

    // Column widths
    ws.columns?.forEach((col, idx) => {
      if (col.width) {
        columnData[idx] = { w: Math.round(col.width * 7) }; // approx px
      }
    });

    sheets[sheetId] = {
      id: sheetId,
      name: ws.name || `Sheet${sheetOrder + 1}`,
      cellData,
      columnData,
      rowCount: maxRow + 2,
      columnCount: maxCol + 2,
      defaultColumnWidth: 73,
      defaultRowHeight: 19,
    };
    sheetOrder++;
  });

  const workbookData = {
    id: 'fallback-workbook',
    appVersion: '1.0.0',
    name: title,
    locale: 'zhCN',
    styles: {},
    sheetOrder: Object.keys(sheets),
    sheets,
    resources: [],
  };

  const result: TableNodeData = {
    type: 'table',
    title,
    sheetName: Object.values(sheets)[0]?.name || 'Sheet1',
    columns: [],
    rows: [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    workbookData: workbookData as any,
  };

  return [result];
}
