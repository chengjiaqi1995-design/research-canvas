import { marked } from 'marked';

export type CanvasTextImportKind = 'markdown' | 'html';

const IMPORT_CONFIG: Record<CanvasTextImportKind, {
  extensionPattern: RegExp;
  label: string;
}> = {
  markdown: {
    extensionPattern: /\.md$/i,
    label: 'markdown (.md)',
  },
  html: {
    extensionPattern: /\.html?$/i,
    label: 'HTML (.html)',
  },
};

export interface CanvasTextImportResult {
  title: string;
  content: string;
}

export function markdownToHtml(markdown: string): string {
  return marked.parse(markdown, { async: false }) as string;
}

export function getCanvasImportTitle(file: File, kind: CanvasTextImportKind): string {
  return file.name.replace(IMPORT_CONFIG[kind].extensionPattern, '');
}

export function validateCanvasTextFile(file: File, kind: CanvasTextImportKind): string | null {
  if (IMPORT_CONFIG[kind].extensionPattern.test(file.name)) return null;
  return `请选择 ${IMPORT_CONFIG[kind].label} 格式的文件`;
}

export function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      resolve(String(event.target?.result || ''));
    };
    reader.onerror = () => {
      reject(new Error('读取文件失败'));
    };

    reader.readAsText(file);
  });
}

export async function readCanvasTextImport(
  file: File,
  kind: CanvasTextImportKind,
): Promise<CanvasTextImportResult> {
  const validationError = validateCanvasTextFile(file, kind);
  if (validationError) throw new Error(validationError);

  const rawContent = await readTextFile(file);
  return {
    title: getCanvasImportTitle(file, kind),
    content: kind === 'markdown' ? markdownToHtml(rawContent) : rawContent,
  };
}
