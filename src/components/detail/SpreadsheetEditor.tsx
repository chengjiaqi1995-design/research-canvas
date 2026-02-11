import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import UniverPresetSheetsCoreZhCN from '@univerjs/preset-sheets-core/locales/zh-CN';
import '@univerjs/preset-sheets-core/lib/index.css';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import type { TableNodeData, SheetData, TableColumn, TableRow, CellValue, CellStyle } from '../../types/index.ts';

interface SpreadsheetEditorProps {
  nodeId: string;
  data: TableNodeData;
}

/** Check if a CellValue is a styled cell object */
function isStyledCell(v: CellValue): v is { value: string | number | null; style: CellStyle } {
  return typeof v === 'object' && v !== null && 'value' in v && 'style' in v;
}

/** Get the raw value from a CellValue (unwrap styled cells) */
/**
 * Build Univer cell data + column widths for one sheet.
 * Returns cellData, columnData, and a dynamically generated styles dictionary.
 */
function buildSheetCells(sheet: SheetData) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cellData: Record<number, Record<number, any>> = {};
  const dynamicStyles: Record<string, Record<string, unknown>> = {};
  let styleIdx = 0;

  /** Get or create a style key for a given CellStyle */
  function getStyleKey(cs: CellStyle): string {
    // Create a deterministic key from the style properties
    const parts: string[] = [];
    if (cs.bg) parts.push(`bg:${cs.bg}`);
    if (cs.fc) parts.push(`fc:${cs.fc}`);
    if (cs.bl) parts.push('bl');
    if (cs.it) parts.push('it');
    const lookupKey = parts.join('|');

    // Check if we already have this style
    for (const [key, val] of Object.entries(dynamicStyles)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existing = val as any;
      const existingParts: string[] = [];
      if (existing.bg?.rgb) existingParts.push(`bg:${existing.bg.rgb}`);
      if (existing.cl?.rgb) existingParts.push(`fc:${existing.cl.rgb}`);
      if (existing.bl) existingParts.push('bl');
      if (existing.it) existingParts.push('it');
      if (existingParts.join('|') === lookupKey) return key;
    }

    // Create new style
    const key = `cell_style_${styleIdx++}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const univerStyle: any = {};
    if (cs.bg) univerStyle.bg = { rgb: cs.bg };
    if (cs.fc) univerStyle.cl = { rgb: cs.fc };
    if (cs.bl) univerStyle.bl = 1;
    if (cs.it) univerStyle.it = 1;
    dynamicStyles[key] = univerStyle;
    return key;
  }

  // Header row (row 0) — bold with light background
  sheet.columns.forEach((col, c) => {
    if (!cellData[0]) cellData[0] = {};
    cellData[0][c] = { v: col.name, s: 'header' };
  });

  // Data rows
  sheet.rows.forEach((row, r) => {
    const rowIdx = r + 1;
    if (!cellData[rowIdx]) cellData[rowIdx] = {};
    sheet.columns.forEach((col, c) => {
      const raw = row.cells[col.id];
      if (raw === null || raw === undefined) return;

      if (isStyledCell(raw)) {
        // Styled cell — apply dynamic style
        const styleKey = getStyleKey(raw.style);
        if (typeof raw.value === 'number') {
          cellData[rowIdx][c] = { v: raw.value, s: styleKey };
        } else {
          cellData[rowIdx][c] = { v: raw.value != null ? String(raw.value) : '', s: styleKey };
        }
      } else if (typeof raw === 'object' && 'formula' in raw) {
        cellData[rowIdx][c] = { v: raw.formula };
      } else if (typeof raw === 'number') {
        cellData[rowIdx][c] = { v: raw };
      } else {
        cellData[rowIdx][c] = { v: String(raw) };
      }
    });
  });

  const columnData: Record<number, { w: number }> = {};
  sheet.columns.forEach((col, i) => {
    columnData[i] = { w: col.width || 120 };
  });

  return { cellData, columnData, dynamicStyles };
}

/** Convert our TableNodeData → Univer IWorkbookData (supports multi-sheet) */
function tableDataToWorkbookData(data: TableNodeData) {
  // Determine sheets list
  const sheetsList: SheetData[] = data.sheets && data.sheets.length > 0
    ? data.sheets
    : [{ sheetName: data.sheetName || 'Sheet1', columns: data.columns, rows: data.rows }];

  const sheetOrder: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sheets: Record<string, any> = {};
  // Collect all dynamic styles across all sheets
  const allStyles: Record<string, Record<string, unknown>> = {
    header: { bl: 1, bg: { rgb: '#f1f5f9' } },
  };

  sheetsList.forEach((s, idx) => {
    const sheetId = `sheet_${idx}`;
    sheetOrder.push(sheetId);
    const { cellData, columnData, dynamicStyles } = buildSheetCells(s);

    // Merge dynamic styles into allStyles
    Object.assign(allStyles, dynamicStyles);

    sheets[sheetId] = {
      id: sheetId,
      name: s.sheetName || `Sheet${idx + 1}`,
      rowCount: Math.max(s.rows.length + 30, 50),
      columnCount: Math.max(s.columns.length + 5, 15),
      cellData,
      columnData,
      defaultColumnWidth: 120,
      defaultRowHeight: 24,
    };
  });

  return {
    id: 'workbook_1',
    name: data.title,
    appVersion: '1.0.0',
    locale: LocaleType.ZH_CN,
    styles: allStyles,
    sheetOrder,
    sheets,
  };
}

/** Read one Univer sheet back to SheetData format */
function readOneSheet(
  sheet: ReturnType<ReturnType<typeof createUniver>['univerAPI']['getActiveWorkbook']> extends infer W ? W extends { getActiveSheet(): infer S } ? S : never : never,
  origSheet?: SheetData
): SheetData | null {
  if (!sheet) return null;
  try {
    const rowCount = sheet.getMaxRows();
    const colCount = sheet.getMaxColumns();

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

    const columns: TableColumn[] = [];
    for (let c = 0; c <= maxCol; c++) {
      const val = sheet.getRange(0, c).getValue();
      const name = val != null ? String(val) : `列${c + 1}`;
      const origCol = origSheet?.columns[c];
      columns.push({
        id: origCol?.id || `col_${c}`,
        name,
        width: origCol?.width || 120,
        colType: origCol?.colType || 'text',
      });
    }

    const rows: TableRow[] = [];
    for (let r = 1; r <= maxRow; r++) {
      const cells: Record<string, CellValue> = {};
      let hasData = false;
      for (let c = 0; c <= maxCol; c++) {
        const colId = columns[c]?.id || `col_${c}`;
        const range = sheet.getRange(r, c);
        const val = range.getValue();

        // Try to read background color from Univer cell
        let cellStyle: CellStyle | undefined;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const bgObj = (range as any).getBackground?.();
          if (bgObj && typeof bgObj === 'string' && bgObj !== '#ffffff' && bgObj !== '#FFFFFF') {
            cellStyle = { ...cellStyle, bg: bgObj };
          }
        } catch {
          // ignore — API may not support getBackground
        }

        // Also try to preserve original style if the value hasn't changed
        const origRow = origSheet?.rows[r - 1];
        if (origRow) {
          const origCell = origRow.cells[colId];
          if (isStyledCell(origCell) && !cellStyle) {
            cellStyle = origCell.style;
          }
        }

        if (val === undefined || val === null || val === '') {
          if (cellStyle) {
            cells[colId] = { value: null, style: cellStyle };
          } else {
            cells[colId] = null;
          }
        } else if (typeof val === 'number') {
          if (cellStyle) {
            cells[colId] = { value: val, style: cellStyle };
          } else {
            cells[colId] = val;
          }
          hasData = true;
        } else {
          if (cellStyle) {
            cells[colId] = { value: String(val), style: cellStyle };
          } else {
            cells[colId] = String(val);
          }
          hasData = true;
        }
      }
      const origRow = origSheet?.rows[r - 1];
      if (hasData || origRow) {
        rows.push({ id: origRow?.id || `row_${r}`, cells });
      }
    }

    const sheetName = (sheet as unknown as { getName(): string }).getName?.() || origSheet?.sheetName || 'Sheet';
    return { sheetName, columns, rows };
  } catch {
    return null;
  }
}

/** Read Univer data back to our TableNodeData format (supports multi-sheet) */
function readUniverDataBack(
  univerAPI: ReturnType<typeof createUniver>['univerAPI'],
  originalData: TableNodeData
): Partial<TableNodeData> | null {
  try {
    const workbook = univerAPI.getActiveWorkbook();
    if (!workbook) return null;

    // If multi-sheet data, read all sheets
    if (originalData.sheets && originalData.sheets.length > 0) {
      const updatedSheets: SheetData[] = [];
      // Use getSheets() to iterate all sheets in the workbook
      const allSheets = (workbook as unknown as { getSheets(): unknown[] }).getSheets?.();
      if (allSheets && Array.isArray(allSheets)) {
        allSheets.forEach((s: unknown, idx: number) => {
          const origSheet = originalData.sheets![idx];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const parsed = readOneSheet(s as any, origSheet);
          if (parsed) updatedSheets.push(parsed);
        });
      }
      if (updatedSheets.length > 0) {
        const first = updatedSheets[0];
        return {
          columns: first.columns,
          rows: first.rows,
          sheetName: first.sheetName,
          sheets: updatedSheets,
        };
      }
      return null;
    }

    // Single sheet: original behavior
    const sheet = workbook.getActiveSheet();
    const parsed = readOneSheet(sheet as unknown as Parameters<typeof readOneSheet>[0], {
      sheetName: originalData.sheetName,
      columns: originalData.columns,
      rows: originalData.rows,
    });
    if (!parsed) return null;
    return { columns: parsed.columns, rows: parsed.rows };
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

    // Use workbookData if available (new luckyexcel import), else fall back to old format
    const workbookData = dataRef.current.workbookData
      ? dataRef.current.workbookData
      : tableDataToWorkbookData(dataRef.current);

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

        // Save the Univer snapshot as workbookData (preserves all formatting)
        try {
          const workbook = univerRef.current.univerAPI.getActiveWorkbook();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const wb = workbook as any;
          // Univer Facade API: .save() returns IWorkbookData
          const snapshot = wb?.save?.() ?? wb?.getSnapshot?.();
          if (snapshot) {
            updateNodeData(nodeId, { workbookData: snapshot });
            return;
          }
        } catch {
          // fallback to old method
        }

        // Fallback: read back to old format
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
