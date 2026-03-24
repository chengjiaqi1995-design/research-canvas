import { useState, useEffect, useCallback, useRef } from "react";
import { Input } from "../../components/portfolio-ui/input";
import { Button } from "../../components/portfolio-ui/button";
import { Badge } from "../../components/portfolio-ui/badge";
import { Label } from "../../components/portfolio-ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../components/portfolio-ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/portfolio-ui/table";
import {
  Loader2,
  Upload,
  FileSpreadsheet,
  Check,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const getHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
});
const uploadHeaders = { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` };

interface ImportPreview {
  totalRecords: number;
  matchedCount: number;
  unmatchedCount: number;
  unmatched: { bbgName: string; suggestedName: string }[];
}

interface ImportHistoryItem {
  id: number;
  importType: string;
  fileName: string;
  recordCount: number;
  newCount: number;
  updatedCount: number;
  createdAt: string;
}

interface NameMappingEntry {
  bbgName: string;
  chineseName: string;
}

function DropZone({
  title,
  description,
  onFile,
  loading,
  accepted,
}: {
  title: string;
  description: string;
  onFile: (file: File) => void;
  loading: boolean;
  accepted: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }
  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  }
  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onFile(file);
  }

  return (
    <div
      className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors cursor-pointer ${dragOver
        ? "border-primary bg-primary/5"
        : accepted
          ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/10"
          : "border-muted-foreground/25 hover:border-muted-foreground/50"
        }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".xlsx,.xls,.csv"
        onChange={handleInputChange}
      />
      {loading ? (
        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
      ) : accepted ? (
        <Check className="h-10 w-10 text-emerald-500" />
      ) : (
        <Upload className="h-10 w-10 text-muted-foreground" />
      )}
      <h3 className="mt-3 font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        拖拽文件到此处，或点击上传
      </p>
    </div>
  );
}

export default function ImportPage() {
  const [positionPreview, setPositionPreview] = useState<ImportPreview | null>(null);
  const [positionLoading, setPositionLoading] = useState(false);
  const [positionAccepted, setPositionAccepted] = useState(false);

  // Name mapping edits for unmatched
  const [nameMappings, setNameMappings] = useState<NameMappingEntry[]>([]);
  const [importConfirming, setImportConfirming] = useState(false);
  const [aiTranslating, setAiTranslating] = useState(false);

  // Import history
  const [history, setHistory] = useState<ImportHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Upload file references
  const [positionFile, setPositionFile] = useState<File | null>(null);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/portfolio/import-history`, { headers: getHeaders() });
      const raw = await res.json();
      setHistory(raw?.data || raw || []);
    } catch {
      // Silently fail for history
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  async function handlePositionFile(file: File) {
    setPositionFile(file);
    setPositionLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", "positions");
      formData.append("preview", "true");

      const res = await fetch(`${API_BASE}/portfolio/import`, {
        method: "POST",
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
        body: formData,
      });
      if (!res.ok) throw new Error("Preview failed");
      const previewRaw = await res.json();
      const preview: ImportPreview = previewRaw?.data || previewRaw;
      setPositionPreview(preview);
      setPositionAccepted(true);

      // Initialize name mappings for unmatched
      if (preview.unmatched.length > 0) {
        setNameMappings(
          preview.unmatched.map((u) => ({
            bbgName: u.bbgName,
            chineseName: u.suggestedName || "",
          }))
        );
      }
    } catch {
      toast.error("文件解析失败");
    } finally {
      setPositionLoading(false);
    }
  }

  function updateNameMapping(index: number, chineseName: string) {
    setNameMappings((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], chineseName };
      return next;
    });
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>, startIndex: number) {
    e.preventDefault();
    const pasteData = e.clipboardData.getData("text");
    if (!pasteData) return;

    // Split by newlines (handle both \r\n and \n)
    const lines = pasteData.split(/\r?\n/).filter((line) => line.trim() !== "");

    setNameMappings((prev) => {
      const next = [...prev];
      for (let i = 0; i < lines.length && startIndex + i < next.length; i++) {
        next[startIndex + i] = { ...next[startIndex + i], chineseName: lines[i].trim() };
      }
      return next;
    });
  }

  async function handleAiTranslate() {
    // Only translate the ones that don't have a chineseName yet
    const toTranslate = nameMappings.filter((m) => !m.chineseName.trim());
    if (toTranslate.length === 0) {
      toast.info("所有名称都已填写，无需翻译");
      return;
    }

    setAiTranslating(true);
    const toastId = toast.loading("AI 正在翻译公司名称，请稍候...");
    try {
      const res = await fetch(`${API_BASE}/portfolio/ai/translate-names`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          bbgNames: toTranslate.map((m) => m.bbgName),
        }),
      });
      const raw = await res.json();
      const data = raw?.data || raw;
      if (!res.ok) throw new Error(data.error || raw.error || "翻译失败");

      toast.success("AI 翻译完成", { id: toastId });

      // Update the name mappings with translations
      setNameMappings((prev) => {
        return prev.map((mapping) => {
          if (data.mappings && data.mappings[mapping.bbgName]) {
            return {
              ...mapping,
              chineseName: data.mappings[mapping.bbgName],
            };
          }
          return mapping;
        });
      });
    } catch (err: any) {
      toast.error(err.message, { id: toastId });
    } finally {
      setAiTranslating(false);
    }
  }

  async function handleConfirmImport() {
    setImportConfirming(true);
    try {
      // Save name mappings first
      const mappingsToSave = nameMappings.filter((m) => m.chineseName.trim());
      if (mappingsToSave.length > 0) {
        for (const mapping of mappingsToSave) {
          await fetch(`${API_BASE}/portfolio/name-mappings`, {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify(mapping),
          });
        }
      }

      // Confirm position import
      if (positionFile) {
        const formData = new FormData();
        formData.append("file", positionFile);
        formData.append("type", "positions");
        formData.append("confirm", "true");

        const res = await fetch(`${API_BASE}/portfolio/import`, {
          method: "POST",
          headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
          body: formData,
        });
        if (!res.ok) throw new Error("Import failed");
      }

      toast.success("导入成功!");
      setPositionPreview(null);
      setPositionAccepted(false);
      setPositionFile(null);
      setNameMappings([]);
      fetchHistory();
    } catch {
      toast.error("导入失败");
    } finally {
      setImportConfirming(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">数据导入</h1>

      {/* Drop Zones */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-1">
        <DropZone
          title="导入持仓数据"
          description="上传 Bloomberg Export Excel 文件"
          onFile={handlePositionFile}
          loading={positionLoading}
          accepted={positionAccepted}
        />
      </div>

      {/* Preview Section */}
      {positionPreview && (
        <Card>
          <CardHeader>
            <CardTitle>导入预览</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {positionPreview && (
                <div className="rounded-lg border p-4 space-y-2">
                  <h3 className="font-medium flex items-center gap-2">
                    <FileSpreadsheet className="h-4 w-4" />
                    持仓数据
                  </h3>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">总记录:</span>{" "}
                      <span className="font-mono font-medium">
                        {positionPreview.totalRecords}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">已匹配:</span>{" "}
                      <span className="font-mono font-medium text-emerald-600">
                        {positionPreview.matchedCount}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">未匹配:</span>{" "}
                      <span className="font-mono font-medium text-rose-600">
                        {positionPreview.unmatchedCount}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Unmatched Names */}
            {nameMappings.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-amber-500" />
                    <h4 className="text-sm font-medium">
                      未匹配名称 - 请输入中文名称
                    </h4>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleAiTranslate}
                    disabled={aiTranslating}
                    className="bg-purple-100 text-purple-700 hover:bg-purple-200 border-purple-200"
                  >
                    {aiTranslating ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    AI 一键翻译
                  </Button>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bloomberg 名称</TableHead>
                      <TableHead>中文名称</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {nameMappings.map((mapping, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-mono text-sm">
                          {mapping.bbgName}
                        </TableCell>
                        <TableCell>
                          <Input
                            value={mapping.chineseName}
                            onChange={(e) =>
                              updateNameMapping(idx, e.target.value)
                            }
                            onPaste={(e) => handlePaste(e, idx)}
                            placeholder="输入中文名称 (支持多行 Excel 粘贴)"
                            className="text-sm h-8"
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="flex justify-end">
              <Button
                onClick={handleConfirmImport}
                disabled={importConfirming}
                size="lg"
              >
                {importConfirming && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                确认导入
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Import History */}
      <Card>
        <CardHeader>
          <CardTitle>导入历史</CardTitle>
          <CardDescription>最近的数据导入记录</CardDescription>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : history.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              暂无导入记录
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>类型</TableHead>
                  <TableHead>文件名</TableHead>
                  <TableHead className="text-right">总记录</TableHead>
                  <TableHead className="text-right">新增</TableHead>
                  <TableHead className="text-right">更新</TableHead>
                  <TableHead>时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Badge
                        variant={
                          item.importType === "positions"
                            ? "default"
                            : "secondary"
                        }
                      >
                        {item.importType === "positions"
                          ? "持仓"
                          : "市值"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm font-mono">
                      {item.fileName}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {item.recordCount}
                    </TableCell>
                    <TableCell className="text-right font-mono text-emerald-600">
                      +{item.newCount}
                    </TableCell>
                    <TableCell className="text-right font-mono text-blue-600">
                      {item.updatedCount}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(item.createdAt.endsWith("Z") ? item.createdAt : item.createdAt + "Z").toLocaleString("zh-CN", { timeZone: "Asia/Hong_Kong" })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
