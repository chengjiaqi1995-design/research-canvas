import { useState, useEffect, useMemo, useCallback } from "react";
import { Input } from "../../ui/input";
import { Button } from "../../ui/button";
import { Badge } from "../../ui/badge";
import { Label } from "../../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "../../ui/command";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "../../ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../../ui/dialog";
import { Loader2, Search, Plus, Check, ArrowUp, ArrowDown, ArrowUpDown, ChevronDown, ChevronRight, Edit3, Trash2, X, Tag, BriefcaseBusiness, PanelRightOpen, Wallet, ListFilter } from "lucide-react";
import { toast } from "sonner";
import type { PositionWithRelations, TaxonomyItem } from "../../../aiprocess/types/portfolio";
import * as api from "../../../aiprocess/api/portfolio";
import { useIndustryCategoryStore } from "../../../stores/industryCategoryStore";
import { resolveIcon } from "../../../constants/industryCategories";
import { SegmentedToggle, IconButton, PrimaryButton } from "../../ui/index";

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatMarketCap(rmb: number): string {
  return rmb.toFixed(1);
}

const MANUAL_POSITION_FIELDS = new Set([
  "longTermInvestmentLogic",
  "shortTermInvestmentLogic",
  "demandChange",
  "catalyst",
  "tradeIdea",
  "sellStopLossPlan",
  "wouldBuyWithoutPosition",
  "simpleArithmetic",
]);

function ManualTextCell({
  value,
  placeholder,
  saving,
  onSave,
}: {
  value?: string | null;
  placeholder: string;
  saving: boolean;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value || "");
  const [isComposing, setIsComposing] = useState(false);

  useEffect(() => {
    setDraft(value || "");
  }, [value]);

  const commit = () => {
    const current = value || "";
    if (draft !== current) onSave(draft);
  };

  return (
    <textarea
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onCompositionStart={() => setIsComposing(true)}
      onCompositionEnd={(event) => {
        setIsComposing(false);
        setDraft(event.currentTarget.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (isComposing || event.nativeEvent.isComposing || event.keyCode === 229) {
          return;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      placeholder={placeholder}
      title={draft || placeholder}
      rows={1}
      className={`h-5 w-full min-w-[130px] resize-none overflow-hidden border-0 bg-transparent px-1 py-0 text-[11px] leading-5 text-slate-700 outline-none transition-colors placeholder:text-slate-300 focus:bg-blue-50/60 ${
        saving ? "opacity-60" : ""
      }`}
    />
  );
}

function TaxonomyCombobox({
  items,
  value,
  onSelect,
  onCreate,
  placeholder = "搜索...",
}: {
  items: TaxonomyItem[];
  value: number | null;
  onSelect: (id: number | null) => void;
  onCreate: (name: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const current = items.find((i) => i.id === value);
  const hasExactMatch = items.some(
    (i) => i.name.toLowerCase() === search.trim().toLowerCase()
  );

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
      <PopoverTrigger asChild>
        <button
          className="h-5 w-full min-w-[70px] truncate rounded px-1 text-left text-[11px] leading-5 transition-colors hover:bg-slate-100"
        >
          {current?.name || "-"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start" sideOffset={2}>
        <Command>
          <CommandInput
            placeholder={placeholder}
            value={search}
            onValueChange={setSearch}
            className="h-8 text-xs"
          />
          <CommandList className="max-h-[280px]">
            <CommandEmpty>
              {search.trim() ? (
                <button
                  className="w-full px-2 py-1 text-xs text-left text-primary hover:bg-accent rounded flex items-center gap-1"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onCreate(search.trim());
                    setOpen(false);
                    setSearch("");
                  }}
                >
                  <Plus className="h-3 w-3" />
                  新建「{search.trim()}」
                </button>
              ) : (
                <span className="text-xs text-muted-foreground">无匹配项</span>
              )}
            </CommandEmpty>
            <CommandGroup className="p-1 max-h-[240px] overflow-y-auto">
              <CommandItem
                value="__clear__"
                onSelect={() => {
                  onSelect(null);
                  setOpen(false);
                  setSearch("");
                }}
                className="px-2 py-1 text-xs rounded"
              >
                <span className="text-muted-foreground">- 清除</span>
              </CommandItem>
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.name}
                  onSelect={() => {
                    onSelect(item.id);
                    setOpen(false);
                    setSearch("");
                  }}
                  className="px-2 py-1 text-xs rounded"
                >
                  <span className="truncate">{item.name}</span>
                  {item.id === value && (
                    <Check className="ml-auto h-3 w-3 shrink-0 text-primary" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            {search.trim() && !hasExactMatch && items.length > 0 && (
              <CommandGroup className="p-1 border-t">
                <CommandItem
                  value={`__create_${search.trim()}`}
                  onSelect={() => {
                    onCreate(search.trim());
                    setOpen(false);
                    setSearch("");
                  }}
                  className="px-2 py-1 text-xs text-primary rounded"
                >
                  <Plus className="h-3 w-3" />
                  新建「{search.trim()}」
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Sector combobox using Canvas unified industry categories */
function IndustryCombobox({
  value,
  onSelect,
  placeholder = "搜索行业...",
}: {
  value: string;
  onSelect: (name: string) => void;
  placeholder?: string;
}) {
  const industryCategories = useIndustryCategoryStore((s) => s.categories);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
      <PopoverTrigger asChild>
        <button className="h-5 w-full min-w-[70px] truncate rounded px-1 text-left text-[11px] leading-5 transition-colors hover:bg-slate-100">
          {value || "-"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start" sideOffset={2}>
        <Command>
          <CommandInput placeholder={placeholder} value={search} onValueChange={setSearch} className="h-8 text-xs" />
          <CommandList className="max-h-[320px]">
            <CommandEmpty>
              <span className="text-xs text-muted-foreground">无匹配项</span>
            </CommandEmpty>
            <CommandGroup className="p-1">
              <CommandItem
                value="__clear__"
                onSelect={() => { onSelect(""); setOpen(false); setSearch(""); }}
                className="px-2 py-1 text-xs rounded"
              >
                <span className="text-muted-foreground">- 清除</span>
              </CommandItem>
            </CommandGroup>
            {industryCategories.map((cat) => (
              <CommandGroup key={cat.label} heading={cat.label} className="p-1">
                {cat.subCategories.map((sub) => (
                  <CommandItem
                    key={sub}
                    value={sub}
                    onSelect={() => { onSelect(sub); setOpen(false); setSearch(""); }}
                    className="px-2 py-1 text-xs rounded"
                  >
                    <span className="truncate">{sub}</span>
                    {sub === value && <Check className="ml-auto h-3 w-3 shrink-0 text-primary" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function TaxonomySection({
  taxonomies,
  onTaxonomiesChange,
}: {
  taxonomies: TaxonomyItem[];
  onTaxonomiesChange: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [activeType, setActiveType] = useState<"theme" | "topdown">("theme");
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

  const items = taxonomies.filter((t) => t.type === activeType);
  const typeLabels = { theme: "主题 Theme", topdown: "策略 Topdown" };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      await api.createTaxonomy({ type: activeType, name: newName.trim() });
      setNewName("");
      onTaxonomiesChange();
    } catch {
      toast.error("创建失败");
    }
  };

  const handleUpdate = async (id: number) => {
    if (!editName.trim()) return;
    try {
      await api.updateTaxonomy(id, { name: editName.trim() });
      setEditingId(null);
      onTaxonomiesChange();
    } catch {
      toast.error("重命名失败");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("删除此分类？关联的持仓分类将被清除。")) return;
    try {
      await api.deleteTaxonomy(id);
      onTaxonomiesChange();
    } catch {
      toast.error("删除失败");
    }
  };

  return (
    <div className="border border-slate-200 rounded bg-white">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors rounded"
      >
        {expanded ? <ChevronDown size={13} className="text-slate-400" /> : <ChevronRight size={13} className="text-slate-400" />}
        <Tag size={12} className="text-slate-400" />
        分类管理 <span className="text-slate-400 font-normal">Taxonomy</span>
        <span className="ml-auto text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
          {taxonomies.length}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Type tabs */}
          <SegmentedToggle
            value={activeType}
            onChange={setActiveType}
            options={[
              { value: "theme", label: typeLabels.theme },
              { value: "topdown", label: typeLabels.topdown },
            ]}
          />

          {/* Add new */}
          <div className="flex gap-2">
            <Input
              className="flex-1 h-7 text-xs"
              placeholder={`新增${typeLabels[activeType]}...`}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <PrimaryButton size="sm" onClick={handleCreate} disabled={!newName.trim()} icon={<Plus size={12} />}>
              新增
            </PrimaryButton>
          </div>

          {/* Items list */}
          <div className="border border-slate-200 rounded divide-y divide-slate-100 max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <div className="text-center text-slate-400 text-xs py-6">暂无{typeLabels[activeType]}</div>
            ) : (
              items.map((item) => (
                <div key={item.id} className="flex items-center justify-between px-2 py-1.5">
                  {editingId === item.id ? (
                    <input
                      className="flex-1 border border-slate-200 rounded px-2 py-0.5 text-xs mr-2 outline-none focus:border-blue-400"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleUpdate(item.id)}
                      autoFocus
                    />
                  ) : (
                    <span className="text-xs text-slate-700">{item.name}</span>
                  )}
                  <div className="flex items-center gap-0.5 shrink-0">
                    {editingId === item.id ? (
                      <>
                        <IconButton variant="blue" onClick={() => handleUpdate(item.id)} title="保存">
                          <Check size={12} />
                        </IconButton>
                        <IconButton onClick={() => setEditingId(null)} title="取消">
                          <X size={12} />
                        </IconButton>
                      </>
                    ) : (
                      <>
                        <IconButton
                          onClick={() => { setEditingId(item.id); setEditName(item.name); }}
                          title="重命名"
                        >
                          <Edit3 size={12} />
                        </IconButton>
                        <IconButton variant="red" onClick={() => handleDelete(item.id)} title="删除">
                          <Trash2 size={12} />
                        </IconButton>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function PositionsView() {
  const industryCategories = useIndustryCategoryStore((s) => s.categories);
  const [positions, setPositions] = useState<PositionWithRelations[]>([]);
  const [taxonomies, setTaxonomies] = useState<TaxonomyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [taxonomyOpen, setTaxonomyOpen] = useState(false);

  // Filters
  const [aum, setAum] = useState(10_000_000);
  const [search, setSearch] = useState("");
  const [filterMarket, setFilterMarket] = useState<string>("all");
  const [filterSector, setFilterSector] = useState<string>("all");
  const [filterTheme, setFilterTheme] = useState<string>("all");
  const [filterLongShort, setFilterLongShort] = useState<string>("all");

  // Sorting
  type SortKey = "priority" | "topdown" | "sector" | "theme" | "market" | "longShort" | "positionWeight";
  const [sortKey, setSortKey] = useState<SortKey>("positionWeight");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "positionWeight" ? "desc" : "asc");
    }
  }

  // Sheet
  const [selectedPosition, setSelectedPosition] =
    useState<PositionWithRelations | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Sheet edit form state (only fields not handled inline)
  const [editLongShort, setEditLongShort] = useState("");
  const [editPositionAmount, setEditPositionAmount] = useState("");
  const [saving, setSaving] = useState(false);

  // Track which cell is currently saving (posId-field)
  const [savingCell, setSavingCell] = useState<string | null>(null);

  // New taxonomy dialog state
  const [newTaxDialog, setNewTaxDialog] = useState<{
    open: boolean;
    type: "topdown" | "sector" | "theme";
    field: "topdownId" | "sectorId" | "themeId";
    pos: PositionWithRelations | null;
  }>({ open: false, type: "topdown", field: "topdownId", pos: null });
  const [newTaxName, setNewTaxName] = useState("");
  const [creatingTax, setCreatingTax] = useState(false);

  // Rename taxonomy dialog state
  const [renameTaxDialog, setRenameTaxDialog] = useState<{
    open: boolean;
    item: TaxonomyItem | null;
  }>({ open: false, item: null });
  const [renameTaxName, setRenameTaxName] = useState("");
  const [renamingTax, setRenamingTax] = useState(false);

  async function handleCreateTaxonomy() {
    if (!newTaxName.trim() || !newTaxDialog.pos) return;
    setCreatingTax(true);
    try {
      // Create the taxonomy item
      const res = await api.createTaxonomy({ type: newTaxDialog.type, name: newTaxName.trim() });
      const created = res.data?.data;
      if (!created) throw new Error("Create failed");

      // Assign it to the position
      await inlineSave(newTaxDialog.pos, newTaxDialog.field, created.id);

      // Refresh taxonomy list
      const taxRes = await api.getTaxonomies();
      setTaxonomies(taxRes.data?.data || []);

      setNewTaxDialog((prev) => ({ ...prev, open: false }));
      setNewTaxName("");
    } catch {
      toast.error("创建失败");
    } finally {
      setCreatingTax(false);
    }
  }

  // Quick-create taxonomy from combobox and assign to position
  async function comboboxCreate(
    pos: PositionWithRelations,
    type: "topdown" | "sector" | "theme",
    field: "topdownId" | "sectorId" | "themeId",
    name: string
  ) {
    try {
      const res = await api.createTaxonomy({ type, name });
      const created = res.data?.data;
      if (!created) throw new Error("Create failed");
      await inlineSave(pos, field, created.id);
      const taxRes = await api.getTaxonomies();
      setTaxonomies(taxRes.data?.data || []);
    } catch {
      toast.error("创建失败");
    }
  }

  async function handleRenameTaxonomy() {
    if (!renameTaxName.trim() || !renameTaxDialog.item) return;
    setRenamingTax(true);
    try {
      const res = await api.updateTaxonomy(renameTaxDialog.item.id, { name: renameTaxName.trim() });
      if (!res.data?.success) throw new Error("Rename failed");
      toast.success("重命名成功");

      // Refresh taxonomy list and positions
      const taxRes = await api.getTaxonomies();
      setTaxonomies(taxRes.data?.data || []);
      fetchData();

      setRenameTaxDialog({ open: false, item: null });
      setRenameTaxName("");
    } catch {
      toast.error("重命名失败");
    } finally {
      setRenamingTax(false);
    }
  }

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [posRes, taxRes, settingsRes] = await Promise.all([
        api.getPositions(),
        api.getTaxonomies(),
        api.getPortfolioSettings(),
      ]);
      const posData = posRes.data?.data || [];
      const taxData = taxRes.data?.data || [];
      const settingsData = settingsRes.data?.data || { aum: 10000000 };
      setPositions(posData);
      setTaxonomies(taxData);
      if (settingsData.aum) setAum(settingsData.aum);
    } catch {
      toast.error("加载数据失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Derived taxonomy lists
  const sectors = useMemo(
    () => taxonomies.filter((t) => t.type === "sector"),
    [taxonomies]
  );
  const themes = useMemo(
    () => taxonomies.filter((t) => t.type === "theme"),
    [taxonomies]
  );
  const topdowns = useMemo(
    () => taxonomies.filter((t) => t.type === "topdown"),
    [taxonomies]
  );
  const markets = useMemo(() => {
    const set = new Set(positions.map((p) => p.market).filter(Boolean));
    return Array.from(set).sort();
  }, [positions]);

  // Filtered and sorted positions
  const filteredPositions = useMemo(() => {
    let result = [...positions];

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.tickerBbg.toLowerCase().includes(q) ||
          p.nameEn.toLowerCase().includes(q) ||
          p.nameCn.toLowerCase().includes(q)
      );
    }
    if (filterMarket !== "all") {
      result = result.filter((p) => p.market === filterMarket);
    }
    if (filterSector !== "all") {
      result = result.filter((p) => (p.sectorName || p.sector?.name || "") === filterSector);
    }
    if (filterTheme !== "all") {
      result = result.filter((p) => String(p.themeId) === filterTheme);
    }
    if (filterLongShort !== "all") {
      result = result.filter((p) => p.longShort === filterLongShort);
    }

    // Sort
    const dir = sortDir === "asc" ? 1 : -1;
    result.sort((a, b) => {
      let av: string | number = "";
      let bv: string | number = "";
      switch (sortKey) {
        case "priority": av = a.priority || ""; bv = b.priority || ""; break;
        case "topdown": av = a.topdown?.name || ""; bv = b.topdown?.name || ""; break;
        case "sector": av = a.sectorName || a.sector?.name || ""; bv = b.sectorName || b.sector?.name || ""; break;
        case "theme": av = a.theme?.name || ""; bv = b.theme?.name || ""; break;
        case "market": av = a.market || ""; bv = b.market || ""; break;
        case "longShort": av = a.longShort; bv = b.longShort; break;
        case "positionWeight": av = a.positionAmount / aum; bv = b.positionAmount / aum; break;
      }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return 0;
    });
    return result;
  }, [positions, search, filterMarket, filterSector, filterTheme, filterLongShort, sortKey, sortDir, aum]);

  // Tab splits
  const activePositions = filteredPositions.filter(
    (p) => p.longShort === "long" || p.longShort === "short"
  );
  const watchlistPositions = filteredPositions.filter(
    (p) => p.longShort === "/"
  );
  const activeFilterCount = [
    search.trim(),
    filterMarket !== "all" ? filterMarket : "",
    filterSector !== "all" ? filterSector : "",
    filterTheme !== "all" ? filterTheme : "",
    filterLongShort !== "all" ? filterLongShort : "",
  ].filter(Boolean).length;

  // Inline save: update a single field and propagate to same-ticker positions
  async function inlineSave(pos: PositionWithRelations, field: string, value: unknown) {
    const cellKey = `${pos.id}-${field}`;
    setSavingCell(cellKey);
    const shouldOnlyUpdateThisPosition = MANUAL_POSITION_FIELDS.has(field);

    // Optimistic update: taxonomy fields follow the existing same-ticker behavior;
    // manual notes are saved on the current position only.
    setPositions((prev) =>
      prev.map((p) => {
        if (shouldOnlyUpdateThisPosition ? p.id === pos.id : p.tickerBbg === pos.tickerBbg) {
          const updated = { ...p, [field]: value };
          // Also update the resolved taxonomy object for display
          if (field === "sectorName") {
            updated.sectorName = (value as string) || "";
          } else if (field === "sectorId") {
            updated.sector = value ? (sectors.find((s) => s.id === value) ?? null) : null;
          } else if (field === "themeId") {
            updated.theme = value ? (themes.find((t) => t.id === value) ?? null) : null;
          } else if (field === "topdownId") {
            updated.topdown = value ? (topdowns.find((t) => t.id === value) ?? null) : null;
          }
          return updated;
        }
        return p;
      })
    );

    try {
      const res = await api.updatePosition(pos.id, { [field]: value });
      if (!res.data?.success) throw new Error("Save failed");
    } catch {
      toast.error("保存失败");
      fetchData(); // revert on error
    } finally {
      setSavingCell(null);
    }
  }

  function openSheet(pos: PositionWithRelations) {
    setSelectedPosition(pos);
    setEditLongShort(pos.longShort);
    setEditPositionAmount(String(pos.positionAmount));
    setSheetOpen(true);
  }

  async function handleSheetSave() {
    if (!selectedPosition) return;
    setSaving(true);
    try {
      const res = await api.updatePosition(selectedPosition.id, {
          longShort: editLongShort,
          positionAmount: Number(editPositionAmount) || 0,
      });
      if (!res.data?.success) throw new Error("Save failed");
      toast.success("保存成功");
      setSheetOpen(false);
      fetchData();
    } catch {
      toast.error("保存失败");
    } finally {
      setSaving(false);
    }
  }

  function renderTable(data: PositionWithRelations[]) {
    if (data.length === 0) {
      return (
        <div className="py-12 text-center text-muted-foreground">暂无数据</div>
      );
    }
    return (
      <div className="overflow-hidden rounded border border-slate-200 bg-white">
      <div className="overflow-x-auto">
      <Table className="min-w-[2220px] text-[11px]">
        <TableHeader>
          <TableRow className="border-b border-slate-200 bg-slate-50/80">
            {([
              { key: "priority" as SortKey, label: "Priority", className: "w-16 px-2" },
              { key: "topdown" as SortKey, label: "Topdown", className: "px-2" },
              { key: "sector" as SortKey, label: "Sector", className: "px-2" },
              { key: "theme" as SortKey, label: "Theme", className: "px-2" },
              { key: "market" as SortKey, label: "Market", className: "px-2" },
            ] as const).map((col) => (
              <TableHead
                key={col.key}
                className={`${col.className} h-6 cursor-pointer select-none text-[10px] uppercase tracking-[0.08em] text-slate-400 hover:text-slate-700`}
                onClick={() => toggleSort(col.key)}
              >
                <span className="flex items-center gap-1">
                  {col.label}
                  {sortKey === col.key ? (
                    sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                  ) : (
                    <ArrowUpDown className="h-3 w-3 opacity-30" />
                  )}
                </span>
              </TableHead>
            ))}
            <TableHead className="h-6 min-w-[150px] px-2 text-[10px] uppercase tracking-[0.08em] text-slate-400">中长期投资逻辑</TableHead>
            <TableHead className="h-6 min-w-[150px] px-2 text-[10px] uppercase tracking-[0.08em] text-slate-400">短期投资逻辑</TableHead>
            <TableHead className="h-6 min-w-[140px] px-2 text-[10px] uppercase tracking-[0.08em] text-slate-400">需求变化</TableHead>
            <TableHead className="h-6 min-w-[140px] px-2 text-[10px] uppercase tracking-[0.08em] text-slate-400">催化</TableHead>
            <TableHead className="h-6 min-w-[150px] px-2 text-[10px] uppercase tracking-[0.08em] text-slate-400">交易思路</TableHead>
            <TableHead className="h-6 min-w-[160px] px-2 text-[10px] uppercase tracking-[0.08em] text-slate-400">什么时候卖/止损</TableHead>
            <TableHead className="h-6 min-w-[170px] px-2 text-[10px] uppercase tracking-[0.08em] text-slate-400">如果没有仓位，会买吗</TableHead>
            <TableHead className="h-6 min-w-[150px] px-2 text-[10px] uppercase tracking-[0.08em] text-slate-400">简单算数</TableHead>
            <TableHead className="h-6 px-2 text-[10px] uppercase tracking-[0.08em] text-slate-400">Company</TableHead>
            <TableHead
              className="h-6 w-14 cursor-pointer select-none px-2 text-[10px] uppercase tracking-[0.08em] text-slate-400 hover:text-slate-700"
              onClick={() => toggleSort("longShort")}
            >
              <span className="flex items-center gap-1">
                L/S
                {sortKey === "longShort" ? (
                  sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                ) : (
                  <ArrowUpDown className="h-3 w-3 opacity-30" />
                )}
              </span>
            </TableHead>
            <TableHead
              className="h-6 cursor-pointer select-none px-2 text-right text-[10px] uppercase tracking-[0.08em] text-slate-400 hover:text-slate-700"
              onClick={() => toggleSort("positionWeight")}
            >
              <span className="flex items-center justify-end gap-1">
                Position%
                {sortKey === "positionWeight" ? (
                  sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                ) : (
                  <ArrowUpDown className="h-3 w-3 opacity-30" />
                )}
              </span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((pos) => (
            <TableRow
              key={pos.id}
              className="border-b border-slate-100 hover:bg-blue-50/30"
            >
              {/* Priority - inline select */}
              <TableCell className="px-2 py-0.5">
                <Select
                  value={pos.priority || "_none"}
                  onValueChange={(v) => inlineSave(pos, "priority", v === "_none" ? "" : v)}
                >
                  <SelectTrigger className="!h-5 w-full min-w-[48px] gap-1 rounded-none border-0 bg-transparent px-1 py-0 text-[11px] shadow-none hover:bg-transparent focus-visible:ring-0 [&_svg]:size-3">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">-</SelectItem>
                    <SelectItem value="!!!">!!!</SelectItem>
                  </SelectContent>
                </Select>
              </TableCell>

              {/* Topdown - inline combobox */}
              <TableCell className="px-2 py-0.5">
                <TaxonomyCombobox
                  items={topdowns}
                  value={pos.topdownId}
                  placeholder="搜索 Topdown..."
                  onSelect={(id) => inlineSave(pos, "topdownId", id)}
                  onCreate={(name) => comboboxCreate(pos, "topdown", "topdownId", name)}
                />
              </TableCell>

              {/* Sector - unified industry from Canvas categories */}
              <TableCell className="px-2 py-0.5">
                <IndustryCombobox
                  value={pos.sectorName || pos.sector?.name || ""}
                  placeholder="搜索行业..."
                  onSelect={(name) => inlineSave(pos, "sectorName", name)}
                />
              </TableCell>

              {/* Theme - inline combobox */}
              <TableCell className="px-2 py-0.5">
                <TaxonomyCombobox
                  items={themes}
                  value={pos.themeId}
                  placeholder="搜索 Theme..."
                  onSelect={(id) => inlineSave(pos, "themeId", id)}
                  onCreate={(name) => comboboxCreate(pos, "theme", "themeId", name)}
                />
              </TableCell>

              {/* Market - read-only */}
              <TableCell className="px-2 py-0.5 text-[11px] text-slate-600">{pos.market}</TableCell>

              <TableCell className="px-2 py-0.5 align-middle">
                <ManualTextCell
                  value={pos.longTermInvestmentLogic}
                  placeholder="中长期逻辑"
                  saving={savingCell === `${pos.id}-longTermInvestmentLogic`}
                  onSave={(value) => inlineSave(pos, "longTermInvestmentLogic", value)}
                />
              </TableCell>

              <TableCell className="px-2 py-0.5 align-middle">
                <ManualTextCell
                  value={pos.shortTermInvestmentLogic}
                  placeholder="短期逻辑"
                  saving={savingCell === `${pos.id}-shortTermInvestmentLogic`}
                  onSave={(value) => inlineSave(pos, "shortTermInvestmentLogic", value)}
                />
              </TableCell>

              <TableCell className="px-2 py-0.5 align-middle">
                <ManualTextCell
                  value={pos.demandChange}
                  placeholder="需求变化"
                  saving={savingCell === `${pos.id}-demandChange`}
                  onSave={(value) => inlineSave(pos, "demandChange", value)}
                />
              </TableCell>

              <TableCell className="px-2 py-0.5 align-middle">
                <ManualTextCell
                  value={pos.catalyst}
                  placeholder="催化"
                  saving={savingCell === `${pos.id}-catalyst`}
                  onSave={(value) => inlineSave(pos, "catalyst", value)}
                />
              </TableCell>

              <TableCell className="px-2 py-0.5 align-middle">
                <ManualTextCell
                  value={pos.tradeIdea}
                  placeholder="交易思路"
                  saving={savingCell === `${pos.id}-tradeIdea`}
                  onSave={(value) => inlineSave(pos, "tradeIdea", value)}
                />
              </TableCell>

              <TableCell className="px-2 py-0.5 align-middle">
                <ManualTextCell
                  value={pos.sellStopLossPlan}
                  placeholder="什么时候卖/止损"
                  saving={savingCell === `${pos.id}-sellStopLossPlan`}
                  onSave={(value) => inlineSave(pos, "sellStopLossPlan", value)}
                />
              </TableCell>

              <TableCell className="px-2 py-0.5 align-middle">
                <ManualTextCell
                  value={pos.wouldBuyWithoutPosition}
                  placeholder="如果没有仓位，会买吗"
                  saving={savingCell === `${pos.id}-wouldBuyWithoutPosition`}
                  onSave={(value) => inlineSave(pos, "wouldBuyWithoutPosition", value)}
                />
              </TableCell>

              <TableCell className="px-2 py-0.5 align-middle">
                <ManualTextCell
                  value={pos.simpleArithmetic}
                  placeholder="简单算数"
                  saving={savingCell === `${pos.id}-simpleArithmetic`}
                  onSave={(value) => inlineSave(pos, "simpleArithmetic", value)}
                />
              </TableCell>

              {/* Company - clickable to open sheet */}
              <TableCell
                className="cursor-pointer px-2 py-0.5"
                onClick={() => openSheet(pos)}
              >
                <div className="max-w-[320px] truncate text-[11px] font-semibold leading-4 text-slate-900">{pos.nameEn}</div>
                <div className="font-mono text-[10px] leading-3 text-slate-400">
                  {pos.tickerBbg}
                </div>
              </TableCell>

              <TableCell className="px-2 py-0.5">
                <span
                  className={`inline-flex items-center justify-center h-5 w-5 rounded text-[10px] font-bold ${pos.longShort === "long"
                      ? "bg-emerald-100 text-emerald-700"
                      : pos.longShort === "short"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                >
                  {pos.longShort === "long" ? "L" : pos.longShort === "short" ? "S" : "/"}
                </span>
              </TableCell>

              {/* Position% */}
              <TableCell className="px-2 py-0.5 text-right font-mono text-[11px] font-medium text-slate-700">
                {formatPct(pos.positionAmount / aum)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-blue-50 text-blue-700 ring-1 ring-blue-100">
              <BriefcaseBusiness size={16} />
            </div>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <h2 className="text-sm font-semibold text-slate-900">Positions</h2>
                <span className="text-[11px] text-slate-400">{filteredPositions.length} / {positions.length}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                <span className="inline-flex items-center gap-1"><Wallet size={11} />AUM {(aum / 1_000_000).toFixed(1)}M</span>
                <span>Active {activePositions.length}</span>
                <span>Watchlist {watchlistPositions.length}</span>
              </div>
            </div>
          </div>
          <button
            onClick={() => setTaxonomyOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <PanelRightOpen size={13} />
            Taxonomy
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{taxonomies.length}</span>
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <div className="relative min-w-[260px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="搜索公司/代码..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 rounded border-slate-200 bg-slate-50/60 pl-8 text-xs shadow-none focus:bg-white"
            />
          </div>
          <Select value={filterMarket} onValueChange={setFilterMarket}>
            <SelectTrigger className="h-8 w-[124px] rounded border-slate-200 bg-white text-xs shadow-none">
              <SelectValue placeholder="Market" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">全部市场</SelectItem>
              {markets.map((m) => (
                <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterSector} onValueChange={setFilterSector}>
            <SelectTrigger className="h-8 w-[136px] rounded border-slate-200 bg-white text-xs shadow-none">
              <SelectValue placeholder="Sector" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">全部行业</SelectItem>
              {industryCategories.flatMap((cat) =>
                cat.subCategories.map((sub) => (
                  <SelectItem key={sub} value={sub} className="text-xs">{sub}</SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <Select value={filterTheme} onValueChange={setFilterTheme}>
            <SelectTrigger className="h-8 w-[136px] rounded border-slate-200 bg-white text-xs shadow-none">
              <SelectValue placeholder="Theme" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">全部主题</SelectItem>
              {themes.map((t) => (
                <SelectItem key={t.id} value={String(t.id)} className="text-xs">{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterLongShort} onValueChange={setFilterLongShort}>
            <SelectTrigger className="h-8 w-[104px] rounded border-slate-200 bg-white text-xs shadow-none">
              <SelectValue placeholder="L/S" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">全部</SelectItem>
              <SelectItem value="long" className="text-xs">Long</SelectItem>
              <SelectItem value="short" className="text-xs">Short</SelectItem>
              <SelectItem value="/" className="text-xs">/</SelectItem>
            </SelectContent>
          </Select>
          <div className="inline-flex h-8 items-center gap-1 rounded bg-slate-50 px-2 text-[11px] font-medium text-slate-500">
            <ListFilter size={12} />
            {activeFilterCount} filters
          </div>
        </div>
      </div>

      <Tabs defaultValue="active">
        <div className="mb-2 flex items-center justify-between gap-2">
          <TabsList className="!h-8 !rounded bg-white shadow-sm">
            <TabsTrigger value="active" className="text-xs">
              实盘持仓
              <Badge variant="secondary" className="ml-2">{activePositions.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="watchlist" className="text-xs">
              观察池
              <Badge variant="secondary" className="ml-2">{watchlistPositions.length}</Badge>
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="active" className="mt-0">{renderTable(activePositions)}</TabsContent>
        <TabsContent value="watchlist" className="mt-0">{renderTable(watchlistPositions)}</TabsContent>
      </Tabs>

      <Sheet open={taxonomyOpen} onOpenChange={setTaxonomyOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[420px]">
          <SheetHeader>
            <SheetTitle>Taxonomy</SheetTitle>
            <SheetDescription>主题和 Topdown 分类管理</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <TaxonomySection
              taxonomies={taxonomies}
              onTaxonomiesChange={async () => {
                const taxRes = await api.getTaxonomies();
                setTaxonomies(taxRes.data?.data || []);
                fetchData();
              }}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* New Taxonomy Dialog */}
      <Dialog
        open={newTaxDialog.open}
        onOpenChange={(open) => {
          setNewTaxDialog((prev) => ({ ...prev, open }));
          if (!open) setNewTaxName("");
        }}
      >
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>
              新增{newTaxDialog.type === "topdown" ? " Topdown" : newTaxDialog.type === "sector" ? " Sector" : " Theme"}
            </DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="输入名称"
            value={newTaxName}
            onChange={(e) => setNewTaxName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateTaxonomy();
            }}
          />
          <DialogFooter>
            <Button
              onClick={handleCreateTaxonomy}
              disabled={creatingTax || !newTaxName.trim()}
              size="sm"
            >
              {creatingTax && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              创建并分配
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Taxonomy Dialog */}
      <Dialog
        open={renameTaxDialog.open}
        onOpenChange={(open) => {
          setRenameTaxDialog((prev) => ({ ...prev, open }));
          if (!open) setRenameTaxName("");
        }}
      >
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>
              重命名「{renameTaxDialog.item?.name}」
            </DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="输入新名称"
            value={renameTaxName}
            onChange={(e) => setRenameTaxName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameTaxonomy();
            }}
          />
          <DialogFooter>
            <Button
              onClick={handleRenameTaxonomy}
              disabled={renamingTax || !renameTaxName.trim()}
              size="sm"
            >
              {renamingTax && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              确认修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Sheet — for L/S, Position Amount, and read-only details */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-full sm:w-[400px] sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {selectedPosition?.nameEn}
            </SheetTitle>
            <SheetDescription>{selectedPosition?.tickerBbg}</SheetDescription>
          </SheetHeader>

          {selectedPosition && (
            <div className="space-y-4 p-4">
              {/* Read-only info */}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Market:</span>{" "}
                  {selectedPosition.market}
                </div>
                
                
                <div>
                  <span className="text-muted-foreground">Topdown:</span>{" "}
                  {selectedPosition.topdown?.name ?? "-"}
                </div>
                <div>
                  <span className="text-muted-foreground">Sector:</span>{" "}
                  {selectedPosition.sector?.name ?? "-"}
                </div>
                <div>
                  <span className="text-muted-foreground">Theme:</span>{" "}
                  {selectedPosition.theme?.name ?? "-"}
                </div>
                <div>
                  <span className="text-muted-foreground">Priority:</span>{" "}
                  {selectedPosition.priority || "-"}
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <Label>Long / Short</Label>
                  <Select value={editLongShort} onValueChange={setEditLongShort}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="long">Long</SelectItem>
                      <SelectItem value="short">Short</SelectItem>
                      <SelectItem value="/">/</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>持仓金额 (USD)</Label>
                  <Input
                    type="number"
                    value={editPositionAmount}
                    onChange={(e) => setEditPositionAmount(e.target.value)}
                  />
                </div>

                <Button
                  onClick={handleSheetSave}
                  disabled={saving}
                  className="w-full"
                >
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  保存
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
