import LuckyExcel from '@zwight/luckyexcel';
import type { TableNodeData } from '../types/index.ts';

/**
 * Parse an Excel (.xlsx) file using luckyexcel → IWorkbookData.
 * Returns a single TableNodeData with the workbookData field set.
 */
export async function parseExcelFile(file: File): Promise<TableNodeData[]> {
  const title = file.name.replace(/\.[^.]+$/, '');
  const ext = file.name.split('.').pop()?.toLowerCase();

  return new Promise<TableNodeData[]>((resolve, reject) => {
    const handler = (workbookData: unknown) => {
      if (!workbookData) {
        reject(new Error('Failed to parse Excel file'));
        return;
      }
      // Store the raw IWorkbookData from Univer — preserves all formatting
      const result: TableNodeData = {
        type: 'table',
        title,
        sheetName: 'Sheet1',
        columns: [],  // backward compat fields (empty for new imports)
        rows: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        workbookData: workbookData as any,
      };
      resolve([result]);
    };

    const errorHandler = (err: Error) => {
      reject(err);
    };

    if (ext === 'csv') {
      LuckyExcel.transformCsvToUniver(file, handler, errorHandler);
    } else {
      LuckyExcel.transformExcelToUniver(file, handler, errorHandler);
    }
  });
}
