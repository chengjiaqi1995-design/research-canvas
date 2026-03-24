import { useState, useEffect, useCallback } from "react";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../../components/portfolio-ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../../components/portfolio-ui/alert-dialog";
import { Separator } from "../../components/portfolio-ui/separator";
import { Switch } from "../../components/portfolio-ui/switch";
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  ChevronRight,
  BrainCircuit,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import type { TaxonomyItem } from "../../lib/portfolio-types";
import type { AIProviderConfig, AIProvidersSettings } from "../../lib/portfolio-ai-config";
import { PROVIDER_DEFINITIONS } from "../../lib/portfolio-ai-config";

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const getHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
});

interface NameMapping {
  id: number;
  bbgName: string;
  chineseName: string;
  positionId: number | null;
}

function TaxonomySection({
  title,
  type,
  items,
  onRefresh,
  showTree,
}: {
  title: string;
  type: string;
  items: TaxonomyItem[];
  onRefresh: () => void;
  showTree?: boolean;
}) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newParentId, setNewParentId] = useState<string>("");
  const [editItem, setEditItem] = useState<TaxonomyItem | null>(null);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);

  // Build tree for topdown
  const topLevelItems = items.filter((i) => !i.parentId);
  const childrenMap: Record<number, TaxonomyItem[]> = {};
  items.forEach((item) => {
    if (item.parentId) {
      if (!childrenMap[item.parentId]) childrenMap[item.parentId] = [];
      childrenMap[item.parentId].push(item);
    }
  });

  async function handleAdd() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { type, name: newName.trim() };
      if (newParentId) body.parentId = Number(newParentId);
      const res = await fetch(`${API_BASE}/portfolio/taxonomy`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("添加成功");
      setAddDialogOpen(false);
      setNewName("");
      setNewParentId("");
      onRefresh();
    } catch {
      toast.error("添加失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit() {
    if (!editItem || !editName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/portfolio/taxonomy/${editItem.id}`, {
        method: "PUT",
        headers: getHeaders(),
        body: JSON.stringify({ name: editName.trim() }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("修改成功");
      setEditDialogOpen(false);
      setEditItem(null);
      onRefresh();
    } catch {
      toast.error("修改失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number, force = false) {
    try {
      const url = force ? `${API_BASE}/portfolio/taxonomy/${id}?force=true` : `${API_BASE}/portfolio/taxonomy/${id}`;
      const res = await fetch(url, { method: "DELETE", headers: getHeaders() });

      if (res.status === 409 && !force) {
        const raw = await res.json();
        const data = raw?.data || raw;
        const confirmed = window.confirm(
          `有 ${data.totalReferences} 个持仓引用了此分类，删除后这些持仓的对应字段将被清空。\n确认删除？`
        );
        if (confirmed) {
          await handleDelete(id, true);
        }
        return;
      }

      if (!res.ok) throw new Error("Failed");
      toast.success("删除成功");
      onRefresh();
    } catch {
      toast.error("删除失败");
    }
  }

  function openEdit(item: TaxonomyItem) {
    setEditItem(item);
    setEditName(item.name);
    setEditDialogOpen(true);
  }

  function renderItem(item: TaxonomyItem, indent: number = 0) {
    const children = childrenMap[item.id] || [];
    return (
      <div key={item.id}>
        <div
          className="group flex items-center gap-2 rounded-md px-3 py-2 hover:bg-muted"
          style={{ paddingLeft: `${12 + indent * 24}px` }}
        >
          <GripVertical className="h-4 w-4 text-muted-foreground/50 opacity-0 group-hover:opacity-100 cursor-grab" />
          {showTree && children.length > 0 && (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="flex-1 text-sm">{item.name}</span>
          <Badge variant="outline" className="text-[10px]">
            #{item.sortOrder}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100"
            onClick={() => openEdit(item)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>确认删除</AlertDialogTitle>
                <AlertDialogDescription>
                  确认删除 &quot;{item.name}&quot;? 此操作不可撤销。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => handleDelete(item.id)}
                  variant="destructive"
                >
                  删除
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        {showTree &&
          children
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((child) => renderItem(child, indent + 1))}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{title}</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddDialogOpen(true)}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            新增
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            暂无数据
          </div>
        ) : showTree ? (
          <div className="space-y-0.5">
            {topLevelItems
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((item) => renderItem(item))}
          </div>
        ) : (
          <div className="space-y-0.5">
            {items
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((item) => renderItem(item))}
          </div>
        )}
      </CardContent>

      {/* Add Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新增{title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>名称</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="输入名称"
              />
            </div>
            {showTree && topLevelItems.length > 0 && (
              <div>
                <Label>父级 (可选)</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                  value={newParentId}
                  onChange={(e) => setNewParentId(e.target.value)}
                >
                  <option value="">无 (顶级)</option>
                  {topLevelItems.map((item) => (
                    <option key={item.id} value={String(item.id)}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddDialogOpen(false)}
            >
              取消
            </Button>
            <Button onClick={handleAdd} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑{title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>名称</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="输入名称"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditDialogOpen(false)}
            >
              取消
            </Button>
            <Button onClick={handleEdit} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function SettingsPage() {
  const [topdowns, setTopdowns] = useState<TaxonomyItem[]>([]);
  const [sectors, setSectors] = useState<TaxonomyItem[]>([]);
  const [themes, setThemes] = useState<TaxonomyItem[]>([]);
  const [nameMappings, setNameMappings] = useState<NameMapping[]>([]);
  const [loading, setLoading] = useState(true);

  // AI Settings (legacy)
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [aiApiKey, setAiApiKey] = useState("");
  const [savingAi, setSavingAi] = useState(false);

  // AI Multi-provider Settings
  const [aiProviders, setAiProviders] = useState<AIProvidersSettings>({
    providers: PROVIDER_DEFINITIONS.map((d) => ({
      id: d.id,
      name: d.name,
      apiKey: "",
      enabled: false,
      baseUrl: d.defaultBaseUrl,
      defaultModel: d.defaultModel,
    })),
    selectedProviderId: "anthropic",
    selectedModel: "claude-sonnet-4-6-20260217",
  });
  const [savingAiProviders, setSavingAiProviders] = useState(false);

  // Name mapping dialog
  const [mappingDialogOpen, setMappingDialogOpen] = useState(false);
  const [editMapping, setEditMapping] = useState<NameMapping | null>(null);
  const [mappingBbgName, setMappingBbgName] = useState("");
  const [mappingChineseName, setMappingChineseName] = useState("");
  const [mappingSaving, setMappingSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [topdownRes, sectorRes, themeRes, mappingRes, settingsRes] = await Promise.all([
        fetch(`${API_BASE}/portfolio/taxonomy?type=topdown`, { headers: getHeaders() }),
        fetch(`${API_BASE}/portfolio/taxonomy?type=sector`, { headers: getHeaders() }),
        fetch(`${API_BASE}/portfolio/taxonomy?type=theme`, { headers: getHeaders() }),
        fetch(`${API_BASE}/portfolio/name-mappings`, { headers: getHeaders() }),
        fetch(`${API_BASE}/portfolio/settings`, { headers: getHeaders() }),
      ]);
      const topdownRaw = await topdownRes.json();
      const sectorRaw = await sectorRes.json();
      const themeRaw = await themeRes.json();
      const mappingRaw = await mappingRes.json();
      const settingsRaw = await settingsRes.json();

      setTopdowns(topdownRaw?.data || topdownRaw || []);
      setSectors(sectorRaw?.data || sectorRaw || []);
      setThemes(themeRaw?.data || themeRaw || []);
      setNameMappings(mappingRaw?.data || mappingRaw || []);

      const settings = settingsRaw?.data || settingsRaw || {};
      if (settings.ai_base_url) setAiBaseUrl(settings.ai_base_url);
      if (settings.ai_model) setAiModel(settings.ai_model);
      if (settings.ai_api_key) setAiApiKey(settings.ai_api_key);
      if (settings.ai_providers) setAiProviders(settings.ai_providers);
    } catch {
      toast.error("加载设置失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  function openAddMapping() {
    setEditMapping(null);
    setMappingBbgName("");
    setMappingChineseName("");
    setMappingDialogOpen(true);
  }

  function openEditMapping(mapping: NameMapping) {
    setEditMapping(mapping);
    setMappingBbgName(mapping.bbgName);
    setMappingChineseName(mapping.chineseName);
    setMappingDialogOpen(true);
  }

  async function handleSaveMapping() {
    if (!mappingBbgName.trim() || !mappingChineseName.trim()) {
      toast.error("请填写所有字段");
      return;
    }
    setMappingSaving(true);
    try {
      if (editMapping) {
        const res = await fetch(`${API_BASE}/portfolio/name-mappings/${editMapping.id}`, {
          method: "PUT",
          headers: getHeaders(),
          body: JSON.stringify({
            bbgName: mappingBbgName.trim(),
            chineseName: mappingChineseName.trim(),
          }),
        });
        if (!res.ok) throw new Error("Failed");
      } else {
        const res = await fetch(`${API_BASE}/portfolio/name-mappings`, {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify({
            bbgName: mappingBbgName.trim(),
            chineseName: mappingChineseName.trim(),
          }),
        });
        if (!res.ok) throw new Error("Failed");
      }
      toast.success(editMapping ? "修改成功" : "添加成功");
      setMappingDialogOpen(false);
      fetchAll();
    } catch {
      toast.error("保存失败");
    } finally {
      setMappingSaving(false);
    }
  }

  async function handleDeleteMapping(id: number) {
    try {
      const res = await fetch(`${API_BASE}/portfolio/name-mappings/${id}`, {
        method: "DELETE",
        headers: getHeaders(),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("删除成功");
      fetchAll();
    } catch {
      toast.error("删除失败");
    }
  }

  async function handleSaveAiSettings() {
    setSavingAi(true);
    try {
      const res = await fetch(`${API_BASE}/portfolio/settings`, {
        method: "PUT",
        headers: getHeaders(),
        body: JSON.stringify({
          ai_base_url: aiBaseUrl.trim(),
          ai_model: aiModel.trim(),
          ai_api_key: aiApiKey.trim(),
        }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("AI 配置保存成功");
    } catch {
      toast.error("保存失败");
    } finally {
      setSavingAi(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">设置</h1>

      {/* AI Multi-Provider Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5" />
            AI 模型配置
          </CardTitle>
          <CardDescription>
            配置 AI 模型提供商的 API Key，用于仓位分析和自动填表功能
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {aiProviders.providers.map((provider, index) => {
              const def = PROVIDER_DEFINITIONS.find((d) => d.id === provider.id);
              return (
                <Card
                  key={provider.id}
                  className={`relative ${
                    provider.enabled && provider.apiKey
                      ? "border-[var(--accent)]/30"
                      : ""
                  }`}
                >
                  <CardContent className="pt-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">
                          {provider.name}
                        </span>
                        {provider.enabled && provider.apiKey && (
                          <Check className="h-3.5 w-3.5 text-green-500" />
                        )}
                      </div>
                      <Switch
                        checked={provider.enabled}
                        onCheckedChange={(checked) => {
                          setAiProviders((prev) => {
                            const updated = { ...prev };
                            updated.providers = [...prev.providers];
                            updated.providers[index] = {
                              ...updated.providers[index],
                              enabled: checked,
                            };
                            return updated;
                          });
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">API Key</Label>
                      <Input
                        value={provider.apiKey}
                        onChange={(e) => {
                          setAiProviders((prev) => {
                            const updated = { ...prev };
                            updated.providers = [...prev.providers];
                            updated.providers[index] = {
                              ...updated.providers[index],
                              apiKey: e.target.value,
                            };
                            return updated;
                          });
                        }}
                        placeholder={
                          provider.id === "anthropic"
                            ? "sk-ant-..."
                            : provider.id === "google"
                            ? "AIza..."
                            : "sk-..."
                        }
                        type="password"
                        name={`apikey-${provider.id}`}
                        id={`apikey-${provider.id}`}
                        autoComplete="off"
                        className="text-xs"
                      />
                    </div>
                    {def?.needsBaseUrl && (
                      <div className="space-y-2">
                        <Label className="text-xs">Base URL</Label>
                        <Input
                          value={provider.baseUrl || ""}
                          onChange={(e) => {
                            setAiProviders((prev) => {
                              const updated = { ...prev };
                              updated.providers = [...prev.providers];
                              updated.providers[index] = {
                                ...updated.providers[index],
                                baseUrl: e.target.value,
                              };
                              return updated;
                            });
                          }}
                          placeholder={def.defaultBaseUrl}
                          className="text-xs"
                        />
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground">
                      Models: {def?.models.join(", ")}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <Button
            onClick={async () => {
              setSavingAiProviders(true);
              try {
                const res = await fetch(`${API_BASE}/portfolio/settings`, {
                  method: "PUT",
                  headers: getHeaders(),
                  body: JSON.stringify({ ai_providers: aiProviders }),
                });
                if (!res.ok) throw new Error("Failed");
                toast.success("AI 配置保存成功");
              } catch {
                toast.error("保存失败");
              } finally {
                setSavingAiProviders(false);
              }
            }}
            disabled={savingAiProviders}
          >
            {savingAiProviders && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            保存 AI 配置
          </Button>
        </CardContent>
      </Card>

      {/* Legacy AI Settings (for backward compatibility with fill/translate) */}
      <Card>
        <CardHeader>
          <CardTitle>AI 旧版配置 (OpenAI 兼容)</CardTitle>
          <CardDescription>
            用于"AI自动填表"和"名称翻译"功能 (兼容 OpenAI 格式)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>API Base URL</Label>
              <Input
                value={aiBaseUrl}
                onChange={(e) => setAiBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1 或者第三方代理地址"
              />
            </div>
            <div className="space-y-2">
              <Label>模型名称 (Model)</Label>
              <Input
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                placeholder="gpt-4o, deepseek-chat 等"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>API Key</Label>
            <Input
              value={aiApiKey}
              onChange={(e) => setAiApiKey(e.target.value)}
              placeholder="sk-..."
              type="password"
              name="legacy-api-key"
              id="legacy-api-key"
              autoComplete="off"
            />
          </div>
          <Button onClick={handleSaveAiSettings} disabled={savingAi}>
            {savingAi && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            保存配置
          </Button>
        </CardContent>
      </Card>

      <Separator />

      {/* Taxonomy Sections */}
      <div className="grid gap-6">
        <TaxonomySection
          title="Topdown主题"
          type="topdown"
          items={topdowns}
          onRefresh={fetchAll}
          showTree
        />
        <TaxonomySection
          title="一级板块 (Sector)"
          type="sector"
          items={sectors}
          onRefresh={fetchAll}
        />
        <TaxonomySection
          title="Theme"
          type="theme"
          items={themes}
          onRefresh={fetchAll}
        />
      </div>

      <Separator />

      {/* Name Mappings */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>名称映射管理</CardTitle>
              <CardDescription>
                Bloomberg 名称与中文名称的对应关系
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={openAddMapping}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              新增
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {nameMappings.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              暂无名称映射
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bloomberg 名称</TableHead>
                  <TableHead>中文名称</TableHead>
                  <TableHead className="w-[100px]">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nameMappings.map((mapping) => (
                  <TableRow key={mapping.id}>
                    <TableCell className="font-mono text-sm">
                      {mapping.bbgName}
                    </TableCell>
                    <TableCell>{mapping.chineseName}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => openEditMapping(mapping)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>确认删除</AlertDialogTitle>
                              <AlertDialogDescription>
                                确认删除映射 &quot;{mapping.bbgName}&quot; →
                                &quot;{mapping.chineseName}&quot;?
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>取消</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() =>
                                  handleDeleteMapping(mapping.id)
                                }
                                variant="destructive"
                              >
                                删除
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Mapping Add/Edit Dialog */}
      <Dialog open={mappingDialogOpen} onOpenChange={setMappingDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editMapping ? "编辑名称映射" : "新增名称映射"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Bloomberg 名称</Label>
              <Input
                value={mappingBbgName}
                onChange={(e) => setMappingBbgName(e.target.value)}
                placeholder="e.g. TENCENT HOLDINGS LTD"
                disabled={!!editMapping}
              />
            </div>
            <div>
              <Label>中文名称</Label>
              <Input
                value={mappingChineseName}
                onChange={(e) => setMappingChineseName(e.target.value)}
                placeholder="e.g. 腾讯控股"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMappingDialogOpen(false)}
            >
              取消
            </Button>
            <Button onClick={handleSaveMapping} disabled={mappingSaving}>
              {mappingSaving && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {editMapping ? "保存" : "添加"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
