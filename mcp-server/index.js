#!/usr/bin/env node
/**
 * Research Canvas MCP Server
 *
 * Exposes the Research Canvas API as MCP tools so Claude Code
 * (or any MCP client) can read/write wiki articles, transcriptions,
 * portfolio positions, feed items, and more.
 *
 * Auth: uses the OpenClaw API key (Bearer token).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";

// ─── Config ─────────────────────────────────────────────────
const DEFAULT_API_BASE = "https://research-canvas-api-jxycyus54a-as.a.run.app/api";

function normalizeApiBase(value) {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_API_BASE;
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

const API_BASE =
  normalizeApiBase(process.env.RC_API_BASE || DEFAULT_API_BASE);
const API_KEY = process.env.RC_API_KEY;
const REQUEST_TIMEOUT_MS = Number(process.env.RC_REQUEST_TIMEOUT_MS || 30_000);
const REQUEST_RETRIES = Number(process.env.RC_REQUEST_RETRIES || 2);
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

if (!API_KEY) {
  console.error("RC_API_KEY is required. Put it in your local .mcp.json or MCP client env.");
  process.exit(1);
}

// ─── HTTP helper ────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function api(path, { method = "GET", body } = {}) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const url = `${API_BASE}${path}`;
  const maxAttempts = Math.max(1, REQUEST_RETRIES + 1);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res;
    let text;
    try {
      res = await fetch(url, { ...opts, signal: controller.signal });
      text = await res.text();
    } catch (error) {
      clearTimeout(timeout);
      if (attempt < maxAttempts) {
        await sleep(250 * attempt);
        continue;
      }
      return {
        success: false,
        status: 0,
        error: error?.name === "AbortError"
          ? `Request timed out after ${REQUEST_TIMEOUT_MS}ms`
          : error?.message || "Request failed",
      };
    }
    clearTimeout(timeout);

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { _raw: text };
    }

    if (!res.ok && RETRYABLE_STATUS.has(res.status) && attempt < maxAttempts) {
      await sleep(250 * attempt);
      continue;
    }

    if (!res.ok) {
      return {
        success: false,
        status: res.status,
        error: data?.error || data?.message || res.statusText,
        data,
      };
    }

    return data;
  }

  return {
    success: false,
    status: 0,
    error: "Request failed before a response was returned",
  };
}

function inferToolPolicy(name) {
  const destructive =
    name === "rc_raw_request"
    || name.includes("_delete")
    || name.includes("_revoke")
    || name.includes("_reset")
    || name.includes("mark_all_read")
    || name === "kb_delete_index";

  const adminTools = new Set([
    "rc_raw_request",
    "backup_export",
    "kb_sync",
    "kb_index_one",
    "kb_delete_index",
    "notes_reclassify_industries",
    "notes_normalize_companies",
    "notes_regenerate_summary",
    "notes_reprocess",
    "notes_generate_weekly",
  ]);

  if (destructive || adminTools.has(name)) {
    return { profile: "admin", destructive };
  }

  if (/(^|_)(create|update|edit|move|import|upsert|add|confirm|apply|upload|translate|generate|sync)$/i.test(name)) {
    return {
      profile: "write",
      destructive: false,
    };
  }

  if (/(create|update|edit|move|import|upsert|add|confirm|apply|upload|translate|generate)$/i.test(name)) {
    return { profile: "write", destructive: false };
  }

  return { profile: "read", destructive: false };
}

// Helper: return JSON text content
const json = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });

function now() {
  return Date.now();
}

function id(prefix) {
  return `${prefix}-${now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseDateInput(value) {
  const text = String(value || "").slice(0, 10);
  const [year, month, day] = text.split("-").map((part) => Number(part));
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(dateLike, days) {
  const date = typeof dateLike === "string" ? parseDateInput(dateLike) : new Date(dateLike);
  date.setDate(date.getDate() + days);
  return toDateInputValue(date);
}

function startOfWeekValue(value = new Date()) {
  const date = value instanceof Date ? new Date(value) : parseDateInput(value);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return toDateInputValue(date);
}

function stripMarkup(input) {
  return String(input || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[[^\]]+]\([^)]*\)/g, " ")
    .replace(/[#>*_`|~=-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function feedTimestamp(item) {
  const raw = item?.publishedAt || item?.pushedAt || item?.createdAt || item?.updatedAt;
  const time = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function pickFeedItemsForWeek(items, weekStart, weekEnd, maxFeedItems) {
  const start = new Date(`${weekStart}T00:00:00`).getTime();
  const end = new Date(`${weekEnd}T23:59:59.999`).getTime();
  return (items || [])
    .filter((item) => {
      const time = feedTimestamp(item);
      return time >= start && time <= end;
    })
    .sort((a, b) => feedTimestamp(b) - feedTimestamp(a))
    .slice(0, maxFeedItems);
}

function compactFeedItem(item, contentCharsPerItem) {
  return {
    id: item.id,
    type: item.type,
    category: item.category,
    title: item.title,
    source: item.source,
    reportType: item.reportType,
    reportTypeLabel: item.reportTypeLabel,
    publishedAt: item.publishedAt,
    pushedAt: item.pushedAt,
    tags: Array.isArray(item.tags) ? item.tags : [],
    contentSnippet: stripMarkup(item.content).slice(0, contentCharsPerItem),
  };
}

function normalizeIndustryName(name) {
  return String(name || "").trim();
}

const PORTFOLIO_PRIORITY_RANK = {
  core: 0,
  satellite: 1,
  trading: 2,
  watchlist: 3,
};

function portfolioPriorityRank(priority) {
  return PORTFOLIO_PRIORITY_RANK[String(priority || "").trim().toLowerCase()] ?? 4;
}

function isSummaryReportFeed(item) {
  const haystack = [
    item?.type,
    item?.category,
    item?.reportType,
    item?.reportTypeLabel,
    item?.title,
    ...(Array.isArray(item?.tags) ? item.tags : []),
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  return (
    haystack.includes("summary_report")
    || haystack.includes("总结报告")
    || haystack.includes("周报")
    || haystack.includes("weekly")
  );
}

function buildPortfolioIndustryStats(portfolioResult) {
  const positions = Array.isArray(portfolioResult?.data)
    ? portfolioResult.data
    : Array.isArray(portfolioResult)
      ? portfolioResult
      : [];
  const stats = new Map();

  for (const position of positions) {
    const name = normalizeIndustryName(position?.sectorName || position?.sector?.name);
    if (!name) continue;
    const current = stats.get(name) || { rank: 4, exposure: 0, count: 0 };
    const amount = Math.abs(Number(position?.positionAmount || 0));
    const weight = Math.abs(Number(position?.positionWeight || 0));
    current.rank = Math.min(current.rank, portfolioPriorityRank(position?.priority));
    current.exposure += amount || weight;
    current.count += 1;
    stats.set(name, current);
  }

  return stats;
}

function sortIndustryTargets(targets, portfolioStats) {
  return targets.sort((a, b) => {
    const aSystem = a.name.startsWith("_") ? 1 : 0;
    const bSystem = b.name.startsWith("_") ? 1 : 0;
    if (aSystem !== bSystem) return aSystem - bSystem;

    const aStats = portfolioStats.get(a.name);
    const bStats = portfolioStats.get(b.name);
    if (Boolean(aStats) !== Boolean(bStats)) return aStats ? -1 : 1;
    if (aStats && bStats) {
      if (aStats.rank !== bStats.rank) return aStats.rank - bStats.rank;
      if (bStats.exposure !== aStats.exposure) return bStats.exposure - aStats.exposure;
      if (bStats.count !== aStats.count) return bStats.count - aStats.count;
    }

    return a.name.localeCompare(b.name, "zh-Hans-CN");
  });
}

async function getIndustryReviewTargets(industryNames) {
  const [workspaceResult, categoryResult, customIndustryResult, portfolioResult] = await Promise.all([
    api("/workspaces"),
    api("/industry-categories"),
    api("/user/industries"),
    api("/portfolio/positions").catch(() => ({ data: [] })),
  ]);

  const workspaces = Array.isArray(workspaceResult) ? workspaceResult : [];
  const industryWorkspaces = workspaces.filter((workspace) => workspace.category === "industry" || !workspace.category);
  const workspaceByName = new Map(industryWorkspaces.map((workspace) => [normalizeIndustryName(workspace.name), workspace]));
  const byName = new Map();

  const addTarget = (name, workspaceId) => {
    const normalized = normalizeIndustryName(name);
    if (!normalized || byName.has(normalized)) return;
    byName.set(normalized, { name: normalized, workspaceId: workspaceId || workspaceByName.get(normalized)?.id || "" });
  };

  for (const category of categoryResult?.categories || []) {
    for (const subCategory of category?.subCategories || []) {
      addTarget(subCategory);
    }
  }

  for (const industry of customIndustryResult?.data?.industries || []) {
    addTarget(industry);
  }

  for (const workspace of industryWorkspaces) {
    addTarget(workspace.name, workspace.id);
  }

  const requested = new Set((industryNames || []).map(normalizeIndustryName).filter(Boolean));
  const portfolioStats = buildPortfolioIndustryStats(portfolioResult);
  const targets = sortIndustryTargets(
    Array.from(byName.values()).filter((target) => requested.size === 0 || requested.has(target.name)),
    portfolioStats,
  ).map((target, index) => ({
    ...target,
    portfolioOrder: index + 1,
    portfolioPriorityRank: portfolioStats.get(target.name)?.rank,
    portfolioExposure: portfolioStats.get(target.name)?.exposure,
  }));

  return { targets, workspaces: industryWorkspaces, portfolioStats };
}

function isLocalAssetRef(ref) {
  return ref && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref);
}

function mimeForAsset(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext === ".xls") return "application/vnd.ms-excel";
  if (ext === ".csv") return "text/csv;charset=utf-8";
  if (ext === ".json") return "application/json;charset=utf-8";
  if (ext === ".js") return "text/javascript;charset=utf-8";
  if (ext === ".css") return "text/css;charset=utf-8";
  if (ext === ".svg") return "image/svg+xml;charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

async function readExistingAsset(baseDir, ref) {
  if (!baseDir || !isLocalAssetRef(ref)) return null;
  const resolved = path.resolve(baseDir, ref);
  try {
    return { resolved, buffer: await fs.readFile(resolved) };
  } catch {
    return null;
  }
}

function escapeInlineScript(script) {
  return script.replace(/<\/script/gi, "<\\/script");
}

async function inlineLocalScriptTags(html, baseDir) {
  const scriptTagRe = /<script\b([^>]*)\bsrc\s*=\s*(["'])([^"']+)\2([^>]*)>\s*<\/script>/gi;
  let output = "";
  let lastIndex = 0;
  let match;

  while ((match = scriptTagRe.exec(html))) {
    output += html.slice(lastIndex, match.index);
    const [, beforeSrc, , src, afterSrc] = match;
    const asset = await readExistingAsset(baseDir, src);

    if (!asset) {
      output += match[0];
    } else {
      const attrs = `${beforeSrc || ""}${afterSrc || ""}`.replace(/\s+/g, " ").trim();
      const script = asset.buffer.toString("utf8");
      output += `<script${attrs ? ` ${attrs}` : ""}>\n${escapeInlineScript(script)}\n</script>`;
    }

    lastIndex = scriptTagRe.lastIndex;
  }

  return output + html.slice(lastIndex);
}

async function collectLocalDataFileRefs(html, baseDir) {
  const dataFileRe = /(["'`])([^"'`<>]+?\.(?:xlsx|xls|csv|json))\1/gi;
  let match;
  const assets = {};
  const seen = new Set();

  while ((match = dataFileRe.exec(html))) {
    const ref = match[2];
    if (seen.has(ref)) continue;
    seen.add(ref);

    const asset = await readExistingAsset(baseDir, ref);
    if (asset) {
      assets[ref] = `data:${mimeForAsset(asset.resolved)};base64,${asset.buffer.toString("base64")}`;
    }
  }

  return assets;
}

async function injectLocalAssetFetchShim(html, baseDir) {
  const assets = await collectLocalDataFileRefs(html, baseDir);
  if (!Object.keys(assets).length) return html;

  const shim = `<script>
window.__RC_LOCAL_ASSETS__ = ${escapeInlineScript(JSON.stringify(assets))};
(() => {
  const assets = window.__RC_LOCAL_ASSETS__ || {};
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const key = typeof input === "string" ? input : input && input.url;
    if (key && Object.prototype.hasOwnProperty.call(assets, key)) {
      return originalFetch(assets[key], init);
    }
    return originalFetch(input, init);
  };
})();
</script>`;

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>\n  ${shim}`);
  }
  return `${shim}\n${html}`;
}

async function bundleLocalHtmlReport(html, baseDir) {
  if (!baseDir) return html;
  let bundled = await injectLocalAssetFetchShim(html, baseDir);
  bundled = await inlineLocalScriptTags(bundled, baseDir);
  return bundled;
}

// ─── MCP Server ─────────────────────────────────────────────
const server = new McpServer({
  name: "research-canvas",
  version: "2.0.0",
});

const PROFILE_RANK = { read: 0, write: 1, admin: 2 };
const MCP_PROFILE = ["read", "write", "admin"].includes(process.env.RC_MCP_PROFILE)
  ? process.env.RC_MCP_PROFILE
  : "read";
const ALLOW_DESTRUCTIVE = process.env.RC_MCP_ALLOW_DESTRUCTIVE === "1";
const originalTool = server.tool.bind(server);
const registeredTools = [];

server.tool = (name, description, schema, handler) => {
  const policy = inferToolPolicy(name);
  if (PROFILE_RANK[policy.profile] > PROFILE_RANK[MCP_PROFILE]) return undefined;

  if (!policy.destructive) {
    registeredTools.push(name);
    return originalTool(name, description, schema, handler);
  }

  registeredTools.push(name);
  return originalTool(
    name,
    `${description} Requires confirm:${name} unless RC_MCP_ALLOW_DESTRUCTIVE=1 is set.`,
    {
      ...schema,
      confirm: z.string().optional().describe(`Type confirm:${name} to run this destructive/admin tool.`),
    },
    async (input, extra) => {
      if (!ALLOW_DESTRUCTIVE && input?.confirm !== `confirm:${name}`) {
        return json({
          success: false,
          error: `Confirmation required. Pass confirm: "confirm:${name}" to run this tool.`,
        });
      }
      const { confirm: _confirm, ...safeInput } = input || {};
      return handler(safeInput, extra);
    }
  );
};

// ═══════════════════════════════════════════════════════════
//  WIKI
// ═══════════════════════════════════════════════════════════

server.tool(
  "wiki_list_articles",
  "List wiki articles (index: id, title, description, updatedAt). Optionally filter by scope.",
  { scope: z.string().optional().describe("e.g. '算电协同' or '算电协同::Quanta'") },
  async ({ scope }) => {
    const qs = scope ? `?scope=${encodeURIComponent(scope)}` : "";
    return json(await api(`/industry-wiki/articles${qs}`));
  }
);

server.tool(
  "wiki_read_article",
  "Read a single wiki article with full content.",
  { id: z.string().describe("Article ID") },
  async ({ id }) => json(await api(`/industry-wiki/articles/${id}`))
);

server.tool(
  "wiki_create_article",
  "Create a new wiki article.",
  {
    industryCategory: z.string().describe("Scope, e.g. '算电协同' or '算电协同::Quanta'"),
    title: z.string().describe("Article title with page type prefix, e.g. '[经营] Quanta 经营数据'"),
    content: z.string().describe("Full markdown content"),
    description: z.string().optional().describe("One-line summary for index (<50 chars)"),
  },
  async ({ industryCategory, title, content, description }) =>
    json(await api("/industry-wiki/articles", { method: "POST", body: { industryCategory, title, content, description } }))
);

server.tool(
  "wiki_update_article",
  "Update a wiki article (full replace of provided fields).",
  {
    id: z.string().describe("Article ID"),
    title: z.string().optional(),
    content: z.string().optional().describe("Full markdown content (replaces existing)"),
    description: z.string().optional(),
  },
  async ({ id, ...fields }) =>
    json(await api(`/industry-wiki/articles/${id}`, { method: "PUT", body: fields }))
);

server.tool(
  "wiki_edit_section",
  "Edit a specific markdown section (## heading) within an article. Supports replace/append/prepend.",
  {
    id: z.string().describe("Article ID"),
    sectionTitle: z.string().describe("The ## section heading to edit, e.g. '核心指标趋势'"),
    newContent: z.string().describe("New content for this section"),
    mode: z.enum(["replace", "append", "prepend"]).default("replace").describe("How to apply the edit"),
  },
  async ({ id, sectionTitle, newContent, mode }) =>
    json(await api(`/industry-wiki/articles/${id}/section`, { method: "PATCH", body: { sectionTitle, newContent, mode } }))
);

server.tool(
  "wiki_delete_article",
  "Delete a wiki article.",
  { id: z.string().describe("Article ID") },
  async ({ id }) => json(await api(`/industry-wiki/articles/${id}`, { method: "DELETE" }))
);

server.tool(
  "wiki_list_actions",
  "List recent wiki action log entries.",
  { scope: z.string().optional(), limit: z.number().optional().default(30) },
  async ({ scope, limit }) => {
    let qs = `?limit=${limit}`;
    if (scope) qs += `&scope=${encodeURIComponent(scope)}`;
    return json(await api(`/industry-wiki/actions${qs}`));
  }
);

server.tool(
  "wiki_list_generation_logs",
  "List wiki generation history logs — each entry records the prompt, model, and generated articles from one ingest run.",
  { scope: z.string().optional(), limit: z.number().optional().default(20) },
  async ({ scope, limit }) => {
    let qs = `?limit=${limit}`;
    if (scope) qs += `&scope=${encodeURIComponent(scope)}`;
    return json(await api(`/industry-wiki/generation-logs${qs}`));
  }
);

server.tool(
  "wiki_get_generation_log",
  "Read a single generation log with full prompt, pageTypes, and all generated article content.",
  { id: z.string().describe("Generation log ID") },
  async ({ id }) => json(await api(`/industry-wiki/generation-logs/${id}`))
);

// ═══════════════════════════════════════════════════════════
//  RESEARCH CANVAS: WORKSPACES / CANVASES
// ═══════════════════════════════════════════════════════════

server.tool(
  "workspaces_list",
  "List Research Canvas workspaces/folders.",
  {},
  async () => json(await api("/workspaces"))
);

server.tool(
  "workspaces_create",
  "Create a Research Canvas workspace/folder.",
  {
    name: z.string().describe("Workspace name"),
    icon: z.string().optional().describe("Emoji/icon, default is 📁"),
    category: z.enum(["overall", "industry", "personal"]).optional(),
    industryCategory: z.string().optional().describe("Industry category label, e.g. 能源"),
  },
  async ({ name, icon = "📁", category = "industry", industryCategory }) => {
    const ts = now();
    const workspace = {
      id: id("ws"),
      name,
      icon,
      category,
      industryCategory,
      canvasIds: [],
      tags: [],
      createdAt: ts,
      updatedAt: ts,
      order: ts,
    };
    return json(await api("/workspaces", { method: "POST", body: workspace }));
  }
);

server.tool(
  "workspaces_update",
  "Update a Research Canvas workspace/folder.",
  {
    id: z.string().describe("Workspace ID"),
    name: z.string().optional(),
    icon: z.string().optional(),
    category: z.enum(["overall", "industry", "personal"]).optional(),
    industryCategory: z.string().optional(),
    order: z.number().optional(),
  },
  async ({ id, ...fields }) =>
    json(await api(`/workspaces/${id}`, { method: "PUT", body: { ...fields, updatedAt: now() } }))
);

server.tool(
  "workspaces_delete",
  "Delete a Research Canvas workspace and all canvases under it.",
  { id: z.string().describe("Workspace ID") },
  async ({ id }) => json(await api(`/workspaces/${id}`, { method: "DELETE" }))
);

server.tool(
  "canvases_list",
  "List Research Canvas canvases, optionally filtered by workspace.",
  {
    workspaceId: z.string().optional(),
    lite: z.boolean().optional().default(true).describe("Use lightweight metadata listing"),
  },
  async ({ workspaceId, lite }) => {
    const qs = new URLSearchParams();
    if (workspaceId) qs.set("workspaceId", workspaceId);
    if (lite) qs.set("lite", "1");
    const query = qs.toString();
    return json(await api(`/canvases${query ? `?${query}` : ""}`));
  }
);

server.tool(
  "canvases_get",
  "Read a full Research Canvas canvas, including modules, nodes, edges, and hydrated node data.",
  { id: z.string().describe("Canvas ID") },
  async ({ id }) => json(await api(`/canvases/${id}`))
);

server.tool(
  "canvases_create",
  "Create a new Research Canvas canvas in a workspace.",
  {
    workspaceId: z.string().describe("Workspace ID"),
    title: z.string().describe("Canvas title"),
    template: z.enum(["supply_demand", "cost_curve", "custom"]).optional().default("custom"),
    modules: z.array(z.object({
      id: z.string(),
      name: z.string(),
      order: z.number(),
      collapsed: z.boolean().optional(),
    })).optional().describe("Optional module list; defaults to one 默认 module"),
  },
  async ({ workspaceId, title, template, modules }) => {
    const ts = now();
    const canvasModules = modules?.length ? modules : [{ id: "default", name: "默认", order: 0 }];
    const nodes = canvasModules.map((m) => ({
      id: id("node"),
      type: "text",
      position: { x: 0, y: 0 },
      data: { type: "text", title: m.name, content: "" },
      module: m.id,
      isMain: true,
    }));
    const canvas = {
      id: id("canvas"),
      workspaceId,
      title,
      template,
      modules: canvasModules,
      nodes,
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      createdAt: ts,
      updatedAt: ts,
    };
    return json(await api("/canvases", { method: "POST", body: canvas }));
  }
);

server.tool(
  "canvases_update",
  "Patch a Research Canvas canvas. Provide only fields you want to replace.",
  {
    id: z.string().describe("Canvas ID"),
    title: z.string().optional(),
    modules: z.array(z.any()).optional(),
    nodes: z.array(z.any()).optional(),
    edges: z.array(z.any()).optional(),
    viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).optional(),
  },
  async ({ id, ...fields }) =>
    json(await api(`/canvases/${id}`, { method: "PUT", body: { ...fields, updatedAt: now() } }))
);

server.tool(
  "canvases_delete",
  "Delete a Research Canvas canvas.",
  { id: z.string().describe("Canvas ID") },
  async ({ id }) => json(await api(`/canvases/${id}`, { method: "DELETE" }))
);

server.tool(
  "canvas_move_node",
  "Move a node from one canvas to another.",
  {
    nodeId: z.string(),
    sourceCanvasId: z.string(),
    targetCanvasId: z.string(),
    updateCompany: z.string().optional().describe("Optional company metadata replacement"),
  },
  async ({ nodeId, sourceCanvasId, targetCanvasId, updateCompany }) =>
    json(await api("/canvas/move-node", {
      method: "POST",
      body: { nodeId, sourceCanvasId, targetCanvasId, updateCompany },
    }))
);

// ═══════════════════════════════════════════════════════════
//  TRANSCRIPTIONS (笔记/转录)
// ═══════════════════════════════════════════════════════════

server.tool(
  "notes_list",
  "List transcription notes. Returns id, fileName, status, industry, organization, tags, actualDate, createdAt.",
  {
    page: z.number().optional().default(1),
    pageSize: z.number().optional().default(50),
  },
  async ({ page, pageSize }) =>
    json(await api(`/transcriptions?page=${page}&pageSize=${pageSize}`))
);

server.tool(
  "notes_read",
  "Read a single transcription note with full transcript text and summary.",
  { id: z.string().describe("Transcription ID") },
  async ({ id }) => json(await api(`/transcriptions/${id}`))
);

server.tool(
  "notes_create_from_text",
  "Create a new note from text content (no audio upload needed).",
  {
    title: z.string().describe("Note title / file name"),
    content: z.string().describe("Full text content of the note"),
    industry: z.string().optional(),
    organization: z.string().optional(),
    topic: z.string().optional(),
    tags: z.array(z.string()).optional(),
  },
  async ({ title, content, industry, organization, topic, tags }) =>
    json(await api("/transcriptions/from-text", {
      method: "POST",
      body: { title, content, industry, organization, topic, tags },
    }))
);

server.tool(
  "notes_import_markdown",
  "Batch import multiple Markdown notes at once.",
  {
    notes: z.array(z.object({
      title: z.string(),
      content: z.string(),
      date: z.string().optional().describe("ISO date string"),
      industry: z.string().optional(),
      organization: z.string().optional(),
    })).describe("Array of notes to import"),
  },
  async ({ notes }) =>
    json(await api("/transcriptions/import-md", { method: "POST", body: { notes } }))
);

server.tool(
  "notes_delete",
  "Delete a transcription note.",
  { id: z.string().describe("Transcription ID") },
  async ({ id }) => json(await api(`/transcriptions/${id}`, { method: "DELETE" }))
);

server.tool(
  "notes_update_summary",
  "Update the summary of a transcription note.",
  { id: z.string(), summary: z.string().describe("New summary text") },
  async ({ id, summary }) =>
    json(await api(`/transcriptions/${id}/summary`, { method: "PATCH", body: { summary } }))
);

server.tool(
  "notes_update_translated_summary",
  "Update the Chinese translated summary of a transcription note.",
  { id: z.string(), translatedSummary: z.string().describe("Chinese summary text") },
  async ({ id, translatedSummary }) =>
    json(await api(`/transcriptions/${id}/translated-summary`, { method: "PATCH", body: { translatedSummary } }))
);

server.tool(
  "notes_update_metadata",
  "Update metadata (topic, organization, industry, participants, etc.) of a note.",
  {
    id: z.string(),
    topic: z.string().optional(),
    organization: z.string().optional(),
    industry: z.string().optional(),
    country: z.string().optional(),
    participants: z.string().optional(),
    speaker: z.string().optional(),
  },
  async ({ id, ...metadata }) =>
    json(await api(`/transcriptions/${id}/metadata`, { method: "PATCH", body: metadata }))
);

server.tool(
  "notes_update_tags",
  "Update tags for a transcription note.",
  { id: z.string(), tags: z.array(z.string()).describe("Array of tag strings, max 5") },
  async ({ id, tags }) =>
    json(await api(`/transcriptions/${id}/tags`, { method: "PATCH", body: { tags } }))
);

server.tool(
  "notes_update_filename",
  "Rename a transcription note.",
  { id: z.string(), fileName: z.string().describe("New file name") },
  async ({ id, fileName }) =>
    json(await api(`/transcriptions/${id}/file-name`, { method: "PATCH", body: { fileName } }))
);

server.tool(
  "notes_update_date",
  "Update the actual occurrence date of a note.",
  { id: z.string(), actualDate: z.string().describe("ISO date string, e.g. '2026-04-01'") },
  async ({ id, actualDate }) =>
    json(await api(`/transcriptions/${id}/actual-date`, { method: "PATCH", body: { actualDate } }))
);

server.tool(
  "notes_update_project",
  "Assign a note to a project.",
  { id: z.string(), projectId: z.string().describe("Project ID to assign") },
  async ({ id, projectId }) =>
    json(await api(`/transcriptions/${id}/project`, { method: "PATCH", body: { projectId } }))
);

server.tool(
  "notes_regenerate_summary",
  "Trigger AI to regenerate the summary for a note.",
  { id: z.string().describe("Transcription ID") },
  async ({ id }) =>
    json(await api(`/transcriptions/${id}/regenerate-summary`, { method: "POST" }))
);

server.tool(
  "notes_reprocess",
  "Force reprocess a transcription (re-run AI pipeline).",
  { id: z.string().describe("Transcription ID") },
  async ({ id }) =>
    json(await api(`/transcriptions/${id}/reprocess`, { method: "POST" }))
);

server.tool(
  "notes_generate_weekly",
  "Generate a weekly summary report from recent notes.",
  {},
  async () => json(await api("/transcriptions/generate-weekly", { method: "POST" }))
);

server.tool(
  "notes_directory",
  "Get directory page data (lightweight list for navigation).",
  {},
  async () => json(await api("/transcriptions/directory"))
);

server.tool(
  "notes_reclassify_industries",
  "Batch reclassify industries for all notes using AI.",
  {},
  async () => json(await api("/transcriptions/reclassify-industries", { method: "POST" }))
);

server.tool(
  "notes_normalize_companies",
  "Batch normalize company names across all notes.",
  {},
  async () => json(await api("/transcriptions/normalize-companies", { method: "POST" }))
);

server.tool(
  "notes_search",
  "Search transcription notes in the knowledge base.",
  { query: z.string().describe("Search query") },
  async ({ query }) =>
    json(await api("/knowledge-base/search", { method: "POST", body: { query } }))
);

// ═══════════════════════════════════════════════════════════
//  KNOWLEDGE BASE
// ═══════════════════════════════════════════════════════════

server.tool(
  "kb_status",
  "Get knowledge base status (indexed count, total, last sync).",
  {},
  async () => json(await api("/knowledge-base/status"))
);

server.tool(
  "kb_index_progress",
  "Get current knowledge base indexing progress.",
  {},
  async () => json(await api("/knowledge-base/index-progress"))
);

server.tool(
  "kb_sync",
  "Sync all transcriptions to the knowledge base index.",
  {},
  async () => json(await api("/knowledge-base/sync", { method: "POST" }))
);

server.tool(
  "kb_index_one",
  "Index a specific transcription into the knowledge base.",
  { id: z.string().describe("Transcription ID to index") },
  async ({ id }) => json(await api(`/knowledge-base/index/${id}`, { method: "POST" }))
);

server.tool(
  "kb_delete_index",
  "Remove a transcription from the knowledge base index.",
  { id: z.string().describe("Transcription ID") },
  async ({ id }) => json(await api(`/knowledge-base/index/${id}`, { method: "DELETE" }))
);

server.tool(
  "kb_notebooklm_query",
  "Query the NotebookLM-style knowledge base with a question.",
  { query: z.string().describe("Question to ask") },
  async ({ query }) =>
    json(await api("/knowledge-base/notebooklm/query", { method: "POST", body: { query } }))
);

// ═══════════════════════════════════════════════════════════
//  PORTFOLIO
// ═══════════════════════════════════════════════════════════

server.tool(
  "portfolio_list_positions",
  "List all portfolio positions with ticker, name, sector, weight, P&L, market cap.",
  {},
  async () => json(await api("/portfolio/positions"))
);

server.tool(
  "portfolio_get_position",
  "Get a single portfolio position with full details.",
  { id: z.number().describe("Position ID") },
  async ({ id }) => json(await api(`/portfolio/positions/${id}`))
);

server.tool(
  "portfolio_create_position",
  "Create a new portfolio position.",
  {
    ticker: z.string().describe("Stock ticker symbol"),
    name: z.string().optional().describe("Company name"),
    longShort: z.string().optional().describe("'long' | 'short' | '/'"),
    positionAmount: z.number().optional().describe("Position amount in USD"),
    sectorName: z.string().optional(),
    priority: z.string().optional(),
  },
  async ({ ticker, ...fields }) =>
    json(await api("/portfolio/positions", { method: "POST", body: { ticker, ...fields } }))
);

server.tool(
  "portfolio_update_position",
  "Update a portfolio position.",
  {
    id: z.number(),
    priority: z.string().optional(),
    longShort: z.string().optional().describe("'long' | 'short' | '/'"),
    positionAmount: z.number().optional().describe("Position amount in USD"),
    sectorName: z.string().optional(),
  },
  async ({ id, ...fields }) =>
    json(await api(`/portfolio/positions/${id}`, { method: "PUT", body: fields }))
);

server.tool(
  "portfolio_delete_position",
  "Delete a portfolio position.",
  { id: z.number().describe("Position ID") },
  async ({ id }) => json(await api(`/portfolio/positions/${id}`, { method: "DELETE" }))
);

server.tool(
  "portfolio_summary",
  "Get portfolio summary: total AUM, position count, sector breakdown, top holdings.",
  {},
  async () => json(await api("/portfolio/summary"))
);

server.tool(
  "portfolio_impact_agent_context",
  "Create a Codex-direct portfolio impact analysis packet. Use this when Codex should directly judge feed-to-position impacts via MCP, rather than relying on the automatic Gemini analyzer.",
  {
    days: z.number().optional().default(7),
    since: z.string().optional().describe("ISO timestamp lower bound"),
    feedItemId: z.string().optional().describe("Analyze a single feed item"),
    limit: z.number().optional().default(100),
    maxPairs: z.number().optional().default(120),
  },
  async ({ days, since, feedItemId, limit, maxPairs }) =>
    json(await api("/portfolio/impacts/agent-context", {
      method: "POST",
      body: { days, since, feedItemId, limit, maxPairs },
    }))
);

server.tool(
  "portfolio_impact_agent_apply",
  "Write Codex-direct portfolio impact analysis results back to Research Canvas. Call this after judging the context returned by portfolio_impact_agent_context.",
  {
    staleFeedItemIds: z.array(z.string()).optional().describe("Feed IDs whose previous unreviewed impacts should be marked stale"),
    results: z.array(z.object({
      itemId: z.string().optional(),
      feedItemId: z.string(),
      positionId: z.number(),
      hasImpact: z.boolean(),
      relevanceScore: z.number().optional(),
      fundamentalDirection: z.enum(["positive", "negative", "neutral", "mixed"]).optional(),
      fundamentalScore: z.number().optional().describe("-3 to +3"),
      confidence: z.number().optional().describe("0 to 1"),
      horizon: z.enum(["1d", "1w", "1m", "1q", "long_term"]).optional(),
      channel: z.enum(["revenue", "margin", "valuation", "policy", "competition", "supply_chain", "macro", "liquidity"]).optional(),
      thesis: z.string().optional(),
      evidenceSnippet: z.string().optional(),
      reasoning: z.string().optional(),
    })),
  },
  async ({ staleFeedItemIds, results }) =>
    json(await api("/portfolio/impacts/agent-apply", {
      method: "POST",
      body: { staleFeedItemIds, results },
    }))
);

server.tool(
  "portfolio_get_settings",
  "Get portfolio settings.",
  {},
  async () => json(await api("/portfolio/settings"))
);

server.tool(
  "portfolio_update_settings",
  "Update portfolio settings.",
  { settings: z.record(z.any()).describe("Settings object to update") },
  async ({ settings }) =>
    json(await api("/portfolio/settings", { method: "PUT", body: settings }))
);

server.tool(
  "portfolio_get_research",
  "Get research notes for a portfolio position.",
  { id: z.number().describe("Position ID") },
  async ({ id }) => json(await api(`/portfolio/research/${id}`))
);

server.tool(
  "portfolio_update_research",
  "Update research notes for a portfolio position.",
  {
    id: z.number().describe("Position ID"),
    strategy: z.string().optional(),
    tam: z.string().optional(),
    competition: z.string().optional(),
    valueProposition: z.string().optional(),
    outlook3to5y: z.string().optional(),
    trackingData: z.string().optional(),
    valuation: z.string().optional(),
    notes: z.string().optional(),
  },
  async ({ id, ...fields }) =>
    json(await api(`/portfolio/research/${id}`, { method: "PUT", body: fields }))
);

server.tool(
  "portfolio_list_trades",
  "List trade records.",
  {},
  async () => json(await api("/portfolio/trades"))
);

server.tool(
  "portfolio_create_trade",
  "Create a new trade record.",
  {
    positionId: z.number().describe("Position ID"),
    type: z.string().describe("'buy' | 'sell'"),
    quantity: z.number(),
    price: z.number(),
    date: z.string().optional().describe("ISO date string"),
    notes: z.string().optional(),
  },
  async ({ positionId, ...fields }) =>
    json(await api("/portfolio/trades", { method: "POST", body: { positionId, ...fields } }))
);

server.tool(
  "portfolio_update_trade",
  "Update an existing trade record.",
  {
    id: z.number().describe("Trade ID"),
    type: z.string().optional(),
    quantity: z.number().optional(),
    price: z.number().optional(),
    date: z.string().optional(),
    notes: z.string().optional(),
  },
  async ({ id, ...fields }) =>
    json(await api(`/portfolio/trades/${id}`, { method: "PUT", body: fields }))
);

server.tool(
  "portfolio_delete_trade",
  "Delete a trade record.",
  { id: z.number().describe("Trade ID") },
  async ({ id }) => json(await api(`/portfolio/trades/${id}`, { method: "DELETE" }))
);

server.tool(
  "portfolio_list_taxonomy",
  "List portfolio taxonomy (sector/category definitions).",
  {},
  async () => json(await api("/portfolio/taxonomy"))
);

server.tool(
  "portfolio_create_taxonomy",
  "Create a new taxonomy item (sector/category).",
  {
    name: z.string().describe("Taxonomy name"),
    type: z.string().optional().describe("Taxonomy type"),
    parentId: z.number().optional(),
  },
  async ({ name, type, parentId }) =>
    json(await api("/portfolio/taxonomy", { method: "POST", body: { name, type, parentId } }))
);

server.tool(
  "portfolio_earnings",
  "Get earnings data for portfolio positions.",
  {},
  async () => json(await api("/portfolio/earnings"))
);

server.tool(
  "portfolio_import_history",
  "Get portfolio import history.",
  {},
  async () => json(await api("/portfolio/import-history"))
);

server.tool(
  "portfolio_list_name_mappings",
  "List company name mappings (ticker ↔ display name).",
  {},
  async () => json(await api("/portfolio/name-mappings"))
);

server.tool(
  "portfolio_create_name_mapping",
  "Create a company name mapping.",
  {
    ticker: z.string(),
    displayName: z.string(),
  },
  async ({ ticker, displayName }) =>
    json(await api("/portfolio/name-mappings", { method: "POST", body: { ticker, displayName } }))
);

// ═══════════════════════════════════════════════════════════
//  FEED (信息流)
// ═══════════════════════════════════════════════════════════

server.tool(
  "feed_list",
  "List feed items (news, industry updates, podcasts, weekly reports, interactive reports).",
  {
    type: z.string().optional().describe("'news' | 'industry' | 'podcast' | 'weekly' | 'macro' | 'report'"),
    category: z.string().optional(),
    reportType: z.string().optional().describe("Report subtype, e.g. investor-holdings, industry-research"),
    page: z.number().optional().default(1),
    pageSize: z.number().optional().default(20),
  },
  async ({ type, category, reportType, page, pageSize }) => {
    let qs = `?page=${page}&pageSize=${pageSize}`;
    if (type) qs += `&type=${type}`;
    if (category) qs += `&category=${encodeURIComponent(category)}`;
    if (reportType) qs += `&reportType=${encodeURIComponent(reportType)}`;
    return json(await api(`/feed${qs}`));
  }
);

server.tool(
  "feed_create",
  "Create a new feed item. Use this for Markdown/text information-flow posts; creating a Canvas note alone does not add an item to the feed.",
  {
    type: z.string().describe("'news' | 'industry' | 'podcast' | 'weekly' | 'macro' | 'report'"),
    title: z.string(),
    content: z.string().describe("Markdown/text/HTML content"),
    category: z.string().optional(),
    source: z.string().optional(),
    tags: z.array(z.string()).optional(),
    publishedAt: z.string().optional().describe("ISO timestamp. Defaults to server time."),
    contentFormat: z.enum(["markdown", "text", "html"]).optional().default("markdown"),
    reportKey: z.string().optional().describe("Stable key for report items"),
    reportVersion: z.string().optional().describe("Version/hash/timestamp for report items"),
    reportType: z.string().optional().describe("Report subtype key, e.g. podcast-discovery"),
    reportTypeLabel: z.string().optional().describe("Human label for report subtype, e.g. 播客发现"),
    originalName: z.string().optional(),
    references: z.array(z.object({
      refNumber: z.number().optional(),
      ref: z.string().optional(),
      id: z.string().optional().describe("Source transcription/note id when available"),
      title: z.string().optional(),
      fileName: z.string().optional(),
      content: z.string().optional(),
      summary: z.string().optional(),
      translatedSummary: z.string().optional(),
      industry: z.string().optional(),
      organization: z.string().optional(),
      date: z.string().optional(),
      sourceType: z.string().optional(),
      canvasId: z.string().optional(),
      workspaceId: z.string().optional(),
      workspaceName: z.string().optional(),
    })).optional().describe("Structured [REFn] source map. Pass this so feed REF clicks open the exact source instead of fuzzy-searching."),
    mode: z.enum(["create", "upsert"]).optional().default("create"),
  },
  async ({ type, title, content, category, source, tags, publishedAt, contentFormat, reportKey, reportVersion, reportType, reportTypeLabel, originalName, references, mode }) =>
    json(await api("/feed", {
      method: "POST",
      body: { type, title, content, category, source, tags, publishedAt, contentFormat, reportKey, reportVersion, reportType, reportTypeLabel, originalName, references, mode },
    }))
);

server.tool(
  "feed_create_html_report",
  "Create an HTML report in the Research Canvas feed. Prefer htmlPath for local .html/.htm files. By default every push creates a new historical version; use mode='upsert' only when intentionally replacing the same report card.",
  {
    title: z.string().describe("Report title shown on the feed card"),
    htmlPath: z.string().optional().describe("Local path to an .html/.htm file. The MCP server reads this file."),
    html: z.string().optional().describe("Raw HTML content. Use this when the producer cannot expose a local file path."),
    assetBasePath: z.string().optional().describe("Base directory for resolving local assets when html is provided directly"),
    inlineLocalAssets: z.boolean().optional().default(true).describe("Inline local script tags and local .xlsx/.xls/.csv/.json references when possible"),
    category: z.string().optional().describe("Industry/category label"),
    source: z.string().optional().describe("Producer/source label, e.g. local-report-agent"),
    tags: z.array(z.string()).optional(),
    type: z.enum(["news", "industry", "podcast", "weekly", "macro", "report"]).optional().describe("Feed type. Use 'weekly' for weekly report pushes."),
    feedType: z.enum(["news", "industry", "podcast", "weekly", "macro", "report"]).optional().describe("Alias for type."),
    reportKey: z.string().optional().describe("Stable key for upsert, e.g. gas-turbine-weekly. Defaults to filename/title."),
    reportVersion: z.string().optional().describe("Version/hash/timestamp. Defaults to current ISO timestamp."),
    reportType: z.string().optional().describe("Report subtype key, e.g. investor-holdings"),
    reportTypeLabel: z.string().optional().describe("Human label for report subtype, e.g. 投资者持仓"),
    references: z.array(z.object({
      refNumber: z.number().optional(),
      ref: z.string().optional(),
      id: z.string().optional().describe("Source transcription/note id when available"),
      title: z.string().optional(),
      fileName: z.string().optional(),
      content: z.string().optional(),
      summary: z.string().optional(),
      translatedSummary: z.string().optional(),
      industry: z.string().optional(),
      organization: z.string().optional(),
      date: z.string().optional(),
      sourceType: z.string().optional(),
      canvasId: z.string().optional(),
      workspaceId: z.string().optional(),
      workspaceName: z.string().optional(),
    })).optional().describe("Structured [REFn] source map. Pass this for exact reference popups."),
    referencesPath: z.string().optional().describe("Optional JSON file containing a references array or {notes:[...]}; useful for local report generators."),
    preserveHistory: z.boolean().optional().default(true).describe("When true, create a new feed item for this version."),
    mode: z.enum(["create", "upsert"]).optional().default("create"),
  },
  async ({ title, htmlPath, html, assetBasePath, inlineLocalAssets, category, source, tags, type, feedType, reportKey, reportVersion, reportType, reportTypeLabel, references, referencesPath, preserveHistory, mode }) => {
    let htmlContent = html;
    let originalName = "";
    let baseDir = assetBasePath ? path.resolve(assetBasePath) : "";

    if (htmlPath) {
      const resolved = path.resolve(htmlPath);
      htmlContent = await fs.readFile(resolved, "utf8");
      originalName = path.basename(resolved);
      baseDir = path.dirname(resolved);
      if (!reportKey) reportKey = originalName.replace(/\.html?$/i, "");
    }

    if (!htmlContent) {
      return json({ success: false, error: "Provide either htmlPath or html" });
    }

    if (inlineLocalAssets !== false) {
      htmlContent = await bundleLocalHtmlReport(htmlContent, baseDir);
    }

    if (!references && referencesPath) {
      const raw = JSON.parse(await fs.readFile(path.resolve(referencesPath), "utf8"));
      const list = Array.isArray(raw) ? raw : (Array.isArray(raw.notes) ? raw.notes : []);
      references = list.map((entry, index) => ({
        refNumber: entry.refNumber || entry.number || (entry.ref && Number(String(entry.ref).match(/\d+/)?.[0])) || index + 1,
        ref: entry.ref,
        id: entry.id || entry.transcriptionId || entry.noteId,
        title: entry.title || entry.fileName || entry.name,
        fileName: entry.fileName,
        summary: entry.summary,
        translatedSummary: entry.translatedSummary,
        industry: entry.industry,
        organization: entry.organization || entry.org,
        date: entry.actualDate || entry.eventDate || entry.createdAt || entry.date,
        sourceType: entry.sourceType,
        canvasId: entry.canvasId,
        workspaceId: entry.workspaceId,
        workspaceName: entry.workspaceName,
      }));
    }

    return json(await api("/feed/html-report", {
      method: "POST",
      body: {
        title,
        html: htmlContent,
        category,
        source,
        tags,
        type,
        feedType,
        reportKey: reportKey || title,
        reportVersion: reportVersion || new Date().toISOString(),
        reportType,
        reportTypeLabel,
        originalName,
        references,
        preserveHistory,
        mode: preserveHistory === false ? mode : "create",
      },
    }));
  }
);

server.tool(
  "feed_update",
  "Update an existing feed item.",
  {
    id: z.string().describe("Feed item ID"),
    title: z.string().optional(),
    content: z.string().optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
  },
  async ({ id, ...fields }) =>
    json(await api(`/feed/${id}`, { method: "PATCH", body: fields }))
);

server.tool(
  "feed_delete",
  "Delete a feed item.",
  { id: z.string().describe("Feed item ID") },
  async ({ id }) => json(await api(`/feed/${id}`, { method: "DELETE" }))
);

server.tool(
  "feed_mark_all_read",
  "Mark all feed items as read.",
  {},
  async () => json(await api("/feed/mark-all-read", { method: "POST" }))
);

// ═══════════════════════════════════════════════════════════
//  PROJECTS
// ═══════════════════════════════════════════════════════════

server.tool(
  "projects_list",
  "List all projects.",
  {},
  async () => json(await api("/projects"))
);

server.tool(
  "projects_get",
  "Get a single project with details.",
  { id: z.string().describe("Project ID") },
  async ({ id }) => json(await api(`/projects/${id}`))
);

server.tool(
  "projects_create",
  "Create a new project.",
  {
    name: z.string().describe("Project name"),
    description: z.string().optional(),
  },
  async ({ name, description }) =>
    json(await api("/projects", { method: "POST", body: { name, description } }))
);

server.tool(
  "projects_update",
  "Update a project.",
  {
    id: z.string().describe("Project ID"),
    name: z.string().optional(),
    description: z.string().optional(),
  },
  async ({ id, ...fields }) =>
    json(await api(`/projects/${id}`, { method: "PATCH", body: fields }))
);

server.tool(
  "projects_delete",
  "Delete a project.",
  { id: z.string().describe("Project ID") },
  async ({ id }) => json(await api(`/projects/${id}`, { method: "DELETE" }))
);

// ═══════════════════════════════════════════════════════════
//  USER / INDUSTRIES
// ═══════════════════════════════════════════════════════════

server.tool(
  "industries_list",
  "List user's tracked industries.",
  {},
  async () => json(await api("/user/industries"))
);

server.tool(
  "industries_add",
  "Add a new tracked industry.",
  { name: z.string().describe("Industry name to add") },
  async ({ name }) =>
    json(await api("/user/industries", { method: "POST", body: { name } }))
);

server.tool(
  "industries_delete",
  "Remove a tracked industry.",
  { name: z.string().describe("Industry name to remove") },
  async ({ name }) =>
    json(await api("/user/industries", { method: "DELETE", body: { name } }))
);

server.tool(
  "industries_reset",
  "Bulk reset all tracked industries (replace with a new list).",
  { industries: z.array(z.string()).describe("Complete list of industry names") },
  async ({ industries }) =>
    json(await api("/user/industries/reset", { method: "PUT", body: { industries } }))
);

// ═══════════════════════════════════════════════════════════
//  TRACKERS / DASHBOARD
// ═══════════════════════════════════════════════════════════

server.tool(
  "trackers_list",
  "List industry tracker dashboards.",
  {},
  async () => json(await api("/trackers"))
);

server.tool(
  "trackers_upsert",
  "Create or update one industry tracker dashboard.",
  {
    tracker: z.object({
      id: z.string().optional(),
      workspaceId: z.string().describe("Bound Research Canvas workspace ID"),
      name: z.string(),
      moduleType: z.enum(["data", "company", "expert"]).optional(),
      columns: z.array(z.any()).default([]),
      entities: z.array(z.any()).default([]),
      records: z.array(z.any()).default([]),
      createdAt: z.number().optional(),
      updatedAt: z.number().optional(),
    }),
  },
  async ({ tracker }) => {
    const ts = now();
    const fullTracker = {
      id: tracker.id || id("tracker"),
      createdAt: tracker.createdAt || ts,
      updatedAt: ts,
      ...tracker,
    };
    return json(await api("/trackers", { method: "POST", body: { trackers: [fullTracker] } }));
  }
);

server.tool(
  "trackers_delete",
  "Delete an industry tracker dashboard.",
  { id: z.string().describe("Tracker ID") },
  async ({ id }) => json(await api(`/trackers/${id}`, { method: "DELETE" }))
);

server.tool(
  "tracker_inbox_list",
  "List pending extracted tracker facts in the tracker inbox.",
  {},
  async () => json(await api("/trackers/inbox"))
);

server.tool(
  "tracker_inbox_add",
  "Add one extracted fact to the tracker inbox.",
  {
    source: z.enum(["ai_snippet", "crawler", "canvas"]).default("ai_snippet"),
    content: z.string(),
    targetCompany: z.string(),
    targetMetric: z.string(),
    extractedValue: z.union([z.number(), z.string()]),
    timePeriod: z.string().describe("e.g. 2026-Q1 or 2026-03"),
  },
  async (item) => json(await api("/trackers/inbox", {
    method: "POST",
    body: { id: id("inbox"), timestamp: now(), ...item },
  }))
);

server.tool(
  "tracker_inbox_delete",
  "Delete one tracker inbox item.",
  { id: z.string().describe("Inbox item ID") },
  async ({ id }) => json(await api(`/trackers/inbox/${id}`, { method: "DELETE" }))
);

server.tool(
  "industry_weekly_reviews_list",
  "List saved industry weekly reviews. Use this to inspect what the dashboard already shows.",
  {
    weekStart: z.string().optional().describe("YYYY-MM-DD"),
    weekEnd: z.string().optional().describe("YYYY-MM-DD"),
    industryName: z.string().optional(),
  },
  async ({ weekStart, weekEnd, industryName }) => {
    const qs = new URLSearchParams();
    if (weekStart) qs.set("weekStart", weekStart);
    if (weekEnd) qs.set("weekEnd", weekEnd);
    if (industryName) qs.set("industryName", industryName);
    const query = qs.toString();
    return json(await api(`/trackers/weekly-reviews${query ? `?${query}` : ""}`));
  }
);

server.tool(
  "industry_weekly_reviews_context",
  "Create a Codex-direct weekly industry review packet. Use this when Codex should read Research Canvas industries and information flow via MCP, generate 1-2 sentence weekly views, and then write them back with industry_weekly_reviews_apply.",
  {
    weekStart: z.string().optional().describe("YYYY-MM-DD. Defaults to Monday of the current week."),
    weekEnd: z.string().optional().describe("YYYY-MM-DD. Defaults to weekStart + 6 days."),
    industryNames: z.array(z.string()).optional().describe("Optional subset of industries. Omit for all Canvas industries."),
    feedPageSize: z.number().optional().default(200).describe("How many recent feed items to inspect before week filtering; API caps this at 200."),
    maxFeedItems: z.number().optional().default(120).describe("Maximum feed items included in the packet after week filtering."),
    contentCharsPerItem: z.number().optional().default(16000).describe("Maximum plain-text content characters per feed item."),
    summaryReportsOnly: z.boolean().optional().default(true).describe("When true, include only weekly/summary report feed items for the requested week."),
    includeExisting: z.boolean().optional().default(true),
  },
  async ({ weekStart, weekEnd, industryNames, feedPageSize, maxFeedItems, contentCharsPerItem, summaryReportsOnly, includeExisting }) => {
    const resolvedWeekStart = weekStart ? String(weekStart).slice(0, 10) : startOfWeekValue();
    const resolvedWeekEnd = weekEnd ? String(weekEnd).slice(0, 10) : addDays(resolvedWeekStart, 6);
    const pageSize = Math.min(Math.max(1, Number(feedPageSize || 200)), 200);
    const feedLimit = Math.max(1, Number(maxFeedItems || 120));
    const snippetLimit = Math.max(200, Math.min(Number(contentCharsPerItem || 16000), 30000));

    const [{ targets }, feedResult, existingReviews] = await Promise.all([
      getIndustryReviewTargets(industryNames),
      api(`/feed?page=1&pageSize=${pageSize}`),
      includeExisting
        ? api(`/trackers/weekly-reviews?weekStart=${encodeURIComponent(resolvedWeekStart)}`)
        : Promise.resolve([]),
    ]);

    const weekFeedItems = pickFeedItemsForWeek(feedResult?.data || [], resolvedWeekStart, resolvedWeekEnd, feedLimit);
    const evidenceFeedItems = weekFeedItems
      .filter((item) => !summaryReportsOnly || isSummaryReportFeed(item))
      .slice(0, feedLimit);
    const feedItems = evidenceFeedItems
      .map((item) => compactFeedItem(item, snippetLimit));

    return json({
      weekStart: resolvedWeekStart,
      weekEnd: resolvedWeekEnd,
      summaryReportsOnly: Boolean(summaryReportsOnly),
      feedItemCountBeforeSummaryFilter: weekFeedItems.length,
      industries: targets,
      existingReviews: Array.isArray(existingReviews) ? existingReviews : [],
      feedItems,
      outputSchema: {
        reviews: [{
          industryName: "string, must match one of industries[].name",
          workspaceId: "string, copy from industries[].workspaceId when available",
          weekStart: resolvedWeekStart,
          weekEnd: resolvedWeekEnd,
          rating: "+ | - | =",
          summary: "1-2 Chinese sentences; overall weekly view",
          demand: "One concise Chinese sentence on demand",
          supplyDemandSignals: ["short signal on price/inventory/capacity/imports/orders/etc."],
          watchPoints: ["forward-looking issue to monitor from the information flow"],
          sourceFeedIds: ["feed item ids used as evidence"],
          sourceTitles: ["feed item titles used as evidence"],
        }],
      },
      codexInstructions: [
        "Read the summary/weekly reports in feedItems once, map their signals to the relevant industries in industries, and do not fabricate facts not supported by the packet.",
        "Generate reviews only for industries directly mentioned or clearly covered by the weekly reports. Omit industries with no direct evidence entirely; do not create neutral filler rows saying the industry was not mentioned.",
        "Keep each cell compact: summary 1-2 sentences, demand 1 sentence, supplyDemandSignals/watchPoints as short arrays.",
        "Industries are already ordered by portfolio priority/exposure when portfolio data exists; preserve that order in the reviews array.",
        "Preserve userNotes by omitting userNotes unless the user explicitly asks to write it.",
        "After drafting, call industry_weekly_reviews_apply with the reviews array.",
      ],
    });
  }
);

server.tool(
  "industry_weekly_reviews_apply",
  "Write Codex-direct industry weekly reviews back to Research Canvas. Call this after generating from industry_weekly_reviews_context.",
  {
    reviews: z.array(z.object({
      industryName: z.string(),
      workspaceId: z.string().optional(),
      weekStart: z.string().describe("YYYY-MM-DD"),
      weekEnd: z.string().describe("YYYY-MM-DD"),
      rating: z.enum(["+", "-", "="]),
      summary: z.string(),
      demand: z.string(),
      supplyDemandSignals: z.array(z.string()).optional(),
      watchPoints: z.array(z.string()).optional(),
      userNotes: z.string().optional(),
      sourceFeedIds: z.array(z.string()).optional(),
      sourceTitles: z.array(z.string()).optional(),
      aiGeneratedAt: z.number().optional(),
    })),
  },
  async ({ reviews }) => {
    const generatedAt = now();
    const normalized = reviews.map((review) => ({
      ...review,
      industryName: normalizeIndustryName(review.industryName),
      weekStart: String(review.weekStart || "").slice(0, 10),
      weekEnd: String(review.weekEnd || "").slice(0, 10),
      supplyDemandSignals: review.supplyDemandSignals || [],
      watchPoints: review.watchPoints || [],
      sourceFeedIds: review.sourceFeedIds || [],
      sourceTitles: review.sourceTitles || [],
      aiGeneratedAt: review.aiGeneratedAt || generatedAt,
    })).filter((review) => review.industryName && review.weekStart);

    return json(await api("/trackers/weekly-reviews", {
      method: "POST",
      body: { reviews: normalized },
    }));
  }
);

// ═══════════════════════════════════════════════════════════
//  TRANSLATION
// ═══════════════════════════════════════════════════════════

server.tool(
  "translate_to_chinese",
  "Translate text to Chinese using AI.",
  { text: z.string().describe("Text to translate") },
  async ({ text }) =>
    json(await api("/translation/translate", { method: "POST", body: { text } }))
);

// ═══════════════════════════════════════════════════════════
//  SHARE
// ═══════════════════════════════════════════════════════════

server.tool(
  "share_create",
  "Create a shareable link for a transcription or wiki article.",
  {
    type: z.string().describe("'transcription' | 'wiki'"),
    targetId: z.string().describe("ID of the item to share"),
    expiresIn: z.number().optional().describe("Expiration in hours (default: no expiry)"),
  },
  async ({ type, targetId, expiresIn }) =>
    json(await api("/share/create", { method: "POST", body: { type, targetId, expiresIn } }))
);

server.tool(
  "share_list",
  "List all my active shares.",
  {},
  async () => json(await api("/share/my/list"))
);

server.tool(
  "share_get",
  "Get details of a shared item by token.",
  { token: z.string().describe("Share token") },
  async ({ token }) => json(await api(`/share/${token}`))
);

server.tool(
  "share_update_settings",
  "Update share settings (e.g. expiration, access control).",
  {
    token: z.string().describe("Share token"),
    settings: z.record(z.any()).describe("Settings to update"),
  },
  async ({ token, settings }) =>
    json(await api(`/share/${token}/settings`, { method: "PATCH", body: settings }))
);

server.tool(
  "share_revoke",
  "Revoke access to a share.",
  { token: z.string().describe("Share token") },
  async ({ token }) =>
    json(await api(`/share/${token}/revoke-access`, { method: "POST" }))
);

server.tool(
  "share_delete",
  "Delete a share entirely.",
  { id: z.string().describe("Share ID") },
  async ({ id }) => json(await api(`/share/${id}`, { method: "DELETE" }))
);

server.tool(
  "share_access_logs",
  "Get access logs for a share (who viewed it and when).",
  { token: z.string().describe("Share token") },
  async ({ token }) => json(await api(`/share/${token}/access-logs`))
);

// ═══════════════════════════════════════════════════════════
//  UPLOAD
// ═══════════════════════════════════════════════════════════

server.tool(
  "upload_get_signed_url",
  "Get a signed URL for uploading a file to cloud storage.",
  {
    fileName: z.string().describe("Original file name"),
    contentType: z.string().optional().describe("MIME type, e.g. 'audio/mp3'"),
  },
  async ({ fileName, contentType }) => {
    let qs = `?fileName=${encodeURIComponent(fileName)}`;
    if (contentType) qs += `&contentType=${encodeURIComponent(contentType)}`;
    return json(await api(`/upload/signed-url${qs}`));
  }
);

server.tool(
  "upload_confirm",
  "Confirm that a file upload has completed (triggers processing).",
  {
    fileName: z.string(),
    gcsPath: z.string().describe("Cloud storage path returned from signed-url"),
  },
  async ({ fileName, gcsPath }) =>
    json(await api("/upload/confirm", { method: "POST", body: { fileName, gcsPath } }))
);

// ═══════════════════════════════════════════════════════════
//  BACKUP
// ═══════════════════════════════════════════════════════════

server.tool(
  "backup_export",
  "Export a full backup of all user data as a download URL.",
  {},
  async () => json(await api("/backup/export"))
);

// ═══════════════════════════════════════════════════════════
//  HEALTH
// ═══════════════════════════════════════════════════════════

server.tool(
  "health_check",
  "Check API server health and available features.",
  {},
  async () => json(await api("/health"))
);

server.tool(
  "rc_raw_request",
  "Advanced escape hatch: call any Research Canvas API path with the configured auth token.",
  {
    path: z.string().describe("API path under /api, e.g. /workspaces or /canvases?lite=1"),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional().default("GET"),
    body: z.record(z.any()).optional(),
  },
  async ({ path, method, body }) => {
    const safePath = path.startsWith("/") ? path : `/${path}`;
    return json(await api(safePath, { method, body }));
  }
);

// ═══════════════════════════════════════════════════════════
//  Start
// ═══════════════════════════════════════════════════════════

const transport = new StdioServerTransport();
console.error(`[research-canvas MCP] profile=${MCP_PROFILE} tools=${registeredTools.length} api=${API_BASE}`);
await server.connect(transport);
