import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import UniverPresetSheetsCoreZhCN from '@univerjs/preset-sheets-core/locales/zh-CN';
import '@univerjs/preset-sheets-core/lib/index.css';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import type { TableNodeData, TableColumn, TableRow, CellValue } from '../../types/index.ts';

interface SpreadsheetEditorProps {
  nodeId: string;
  data: TableNodeData;
}

/** Convert our TableNodeData → Univer IWorkbookData (partial) */
function tableDataToWorkbookData(data: TableNodeData) {
  const cellData: Record<number, Record<number, { v?: string | number | null; s?: string | null }>> = {};

  // Header row (row 0) — bold
  data.columns.forEach((col, c) => {
    if (!cellData[0]) cellData[0] = {};
    cellData[0][c] = { v: col.name, s: 'header' };
  });

  // Data rows
  data.rows.forEach((row, r) => {
    const rowIdx = r + 1;
    if (!cellData[rowIdx]) cellData[rowIdx] = {};
    data.columns.forEach((col, c) => {
      const raw = row.cells[col.id];
      if (raw === null || raw === undefined) return;
      if (typeof raw === 'object' && 'formula' in raw) {
        cellData[rowIdx][c] = { v: raw.formula };
      } else if (typeof raw === 'number') {
        cellData[rowIdx][c] = { v: raw };
      } else {
        cellData[rowIdx][c] = { v: String(raw) };
      }
    });
  });

  // Column widths
  const columnData: Record<number, { w: number }> = {};
  data.columns.forEach((col, i) => {
    columnData[i] = { w: col.width || 120 };
  });

  return {
    id: 'workbook_1',
    name: data.title,
    appVersion: '1.0.0',
    locale: LocaleType.ZH_CN,
    styles: {
      header: { bl: 1, bg: { rgb: '#f1f5f9' } },
    },
    sheetOrder: ['sheet_1'],
    sheets: {
      sheet_1: {
        id: 'sheet_1',
        name: data.sheetName || 'Sheet1',
        rowCount: Math.max(data.rows.length + 30, 50),
        columnCount: Math.max(data.columns.length + 5, 15),
        cellData,
        columnData,
        defaultColumnWidth: 120,
        defaultRowHeight: 24,
      },
    },
  };
}

/** Read Univer data back to our TableNodeData format */
function readUniverDataBack(
  univerAPI: ReturnType<typeof createUniver>['univerAPI'],
  originalData: TableNodeData
): Partial<TableNodeData> | null {
  try {
    const workbook = univerAPI.getActiveWorkbook();
    if (!workbook) return null;
    const sheet = workbook.getActiveSheet();
    if (!sheet) return null;

    // Use Facade API to read cell values
    const rowCount = sheet.getMaxRows();
    const colCount = sheet.getMaxColumns();

    // Find actual bounds
    let maxRow = 0;
    let maxCol = 0;
    for (let r = 0; r < Math.min(rowCount, 500); r++) {
      for (let c = 0; c < Math.min(colCount, 50); c++) {
        const range = sheet.getRange(r, c);
        const val = range.getValue();
        if (val !== undefined && val !== null && val !== '') {
          maxRow = Math.max(maxRow, r);
          maxCol = Math.max(maxCol, c);
        }
      }
    }

    if (maxCol < 0) return null;

    // Header = row 0
    const columns: TableColumn[] = [];
    for (let c = 0; c <= maxCol; c++) {
      const val = sheet.getRange(0, c).getValue();
      const name = val != null ? String(val) : `列${c + 1}`;
      const origCol = originalData.columns[c];
      columns.push({
        id: origCol?.id || `col_${c}`,
        name,
        width: origCol?.width || 120,
        colType: origCol?.colType || 'text',
      });
    }

    // Data rows = row 1+
    const rows: TableRow[] = [];
    for (let r = 1; r <= maxRow; r++) {
      const cells: Record<string, CellValue> = {};
      let hasData = false;
      for (let c = 0; c <= maxCol; c++) {
        const colId = columns[c]?.id || `col_${c}`;
        const val = sheet.getRange(r, c).getValue();
        if (val === undefined || val === null || val === '') {
          cells[colId] = null;
        } else if (typeof val === 'number') {
          cells[colId] = val;
          hasData = true;
        } else {
          cells[colId] = String(val);
          hasData = true;
        }
      }
      const origRow = originalData.rows[r - 1];
      if (hasData || origRow) {
        rows.push({ id: origRow?.id || `row_${r}`, cells });
      }
    }

    return { columns, rows };
  } catch {
    return null;
  }
}

export const SpreadsheetEditor = memo(function SpreadsheetEditor({
  nodeId,
  data,
}: SpreadsheetEditorProps) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const containerRef = useRef<HTMLDivElement>(null);
  const univerRef = useRef<ReturnType<typeof createUniver> | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  // Title editing
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(data.title);

  const handleSaveTitle = useCallback(() => {
    if (editTitle.trim()) {
      updateNodeData(nodeId, { title: editTitle.trim() });
    }
    setIsEditingTitle(false);
  }, [editTitle, nodeId, updateNodeData]);

  // Initialize Univer
  useEffect(() => {
    if (!containerRef.current) return;

    const workbookData = tableDataToWorkbookData(dataRef.current);

    const result = createUniver({
      locale: LocaleType.ZH_CN,
      locales: {
        [LocaleType.ZH_CN]: mergeLocales(UniverPresetSheetsCoreZhCN),
      },
      presets: [
        UniverSheetsCorePreset({
          container: containerRef.current,
        }),
      ],
    });

    result.univerAPI.createWorkbook(workbookData);
    univerRef.current = result;

    // Listen for changes and debounce save back
    const disposable = result.univerAPI.onCommandExecuted(() => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        if (!univerRef.current) return;
        const updates = readUniverDataBack(univerRef.current.univerAPI, dataRef.current);
        if (updates && (updates.columns || updates.rows)) {
          updateNodeData(nodeId, updates);
        }
      }, 1000);
    });

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      disposable?.dispose();
      result.univerAPI.dispose();
      univerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  return (
    <div className="flex flex-col h-full">
      {/* Editable title */}
      <div className="px-4 pt-3 pb-2 shrink-0">
        {isEditingTitle ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveTitle();
                if (e.key === 'Escape') {
                  setEditTitle(data.title);
                  setIsEditingTitle(false);
                }
              }}
              onBlur={handleSaveTitle}
              className="flex-1 text-base font-semibold border-b-2 border-green-400 outline-none pb-1 bg-transparent"
            />
            <button
              onClick={handleSaveTitle}
              className="text-xs text-green-500 px-2 py-0.5 rounded hover:bg-green-50"
            >
              OK
            </button>
          </div>
        ) : (
          <h2
            className="text-base font-semibold text-slate-800 cursor-pointer hover:text-green-600 transition-colors"
            onClick={() => {
              setEditTitle(data.title);
              setIsEditingTitle(true);
            }}
          >
            {data.title}
          </h2>
        )}
      </div>

      {/* Univer spreadsheet container */}
      <div ref={containerRef} className="flex-1 overflow-hidden" />
    </div>
  );
});
