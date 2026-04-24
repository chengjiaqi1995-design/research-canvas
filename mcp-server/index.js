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

// ─── Config ─────────────────────────────────────────────────
const API_BASE =
  process.env.RC_API_BASE ||
  "https://research-canvas-api-208594497704.asia-southeast1.run.app/api";
const API_KEY = process.env.RC_API_KEY || "oc-api-jiaqi-2026-f8a3b7c1d9e2";

// ─── HTTP helper ────────────────────────────────────────────
async function api(path, { method = "GET", body } = {}) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${path}`, opts);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { _raw: text };
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

// Helper: return JSON text content
const json = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });

function now() {
  return Date.now();
}

function id(prefix) {
  return `${prefix}-${now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── MCP Server ─────────────────────────────────────────────
const server = new McpServer({
  name: "research-canvas",
  version: "2.0.0",
});

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
  "List feed items (news, industry updates, podcasts, weekly reports).",
  {
    type: z.string().optional().describe("'news' | 'industry' | 'podcast' | 'weekly' | 'macro'"),
    category: z.string().optional(),
    page: z.number().optional().default(1),
    pageSize: z.number().optional().default(20),
  },
  async ({ type, category, page, pageSize }) => {
    let qs = `?page=${page}&pageSize=${pageSize}`;
    if (type) qs += `&type=${type}`;
    if (category) qs += `&category=${encodeURIComponent(category)}`;
    return json(await api(`/feed${qs}`));
  }
);

server.tool(
  "feed_create",
  "Create a new feed item.",
  {
    type: z.string().describe("'news' | 'industry' | 'podcast' | 'weekly' | 'macro'"),
    title: z.string(),
    content: z.string().describe("Markdown content"),
    category: z.string().optional(),
    source: z.string().optional(),
    tags: z.array(z.string()).optional(),
  },
  async ({ type, title, content, category, source, tags }) =>
    json(await api("/feed", { method: "POST", body: { type, title, content, category, source, tags } }))
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
await server.connect(transport);
