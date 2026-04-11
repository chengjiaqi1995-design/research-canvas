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
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text, _status: res.status };
  }
}

// ─── MCP Server ─────────────────────────────────────────────
const server = new McpServer({
  name: "research-canvas",
  version: "1.0.0",
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
    const data = await api(`/industry-wiki/articles${qs}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "wiki_read_article",
  "Read a single wiki article with full content.",
  { id: z.string().describe("Article ID") },
  async ({ id }) => {
    const data = await api(`/industry-wiki/articles/${id}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
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
  async ({ industryCategory, title, content, description }) => {
    const data = await api("/industry-wiki/articles", {
      method: "POST",
      body: { industryCategory, title, content, description },
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
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
  async ({ id, ...fields }) => {
    const data = await api(`/industry-wiki/articles/${id}`, {
      method: "PUT",
      body: fields,
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
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
  async ({ id, sectionTitle, newContent, mode }) => {
    const data = await api(`/industry-wiki/articles/${id}/section`, {
      method: "PATCH",
      body: { sectionTitle, newContent, mode },
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "wiki_delete_article",
  "Delete a wiki article.",
  { id: z.string().describe("Article ID") },
  async ({ id }) => {
    const data = await api(`/industry-wiki/articles/${id}`, { method: "DELETE" });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "wiki_list_actions",
  "List recent wiki action log entries.",
  {
    scope: z.string().optional(),
    limit: z.number().optional().default(30),
  },
  async ({ scope, limit }) => {
    let qs = `?limit=${limit}`;
    if (scope) qs += `&scope=${encodeURIComponent(scope)}`;
    const data = await api(`/industry-wiki/actions${qs}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
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
  async ({ page, pageSize }) => {
    const data = await api(`/transcriptions?page=${page}&pageSize=${pageSize}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "notes_read",
  "Read a single transcription note with full transcript text and summary.",
  { id: z.string().describe("Transcription ID") },
  async ({ id }) => {
    const data = await api(`/transcriptions/${id}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "notes_update_summary",
  "Update the summary of a transcription note.",
  {
    id: z.string(),
    summary: z.string().describe("New summary text"),
  },
  async ({ id, summary }) => {
    const data = await api(`/transcriptions/${id}/summary`, {
      method: "PATCH",
      body: { summary },
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
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
  async ({ id, ...metadata }) => {
    const data = await api(`/transcriptions/${id}/metadata`, {
      method: "PATCH",
      body: metadata,
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "notes_update_tags",
  "Update tags for a transcription note.",
  {
    id: z.string(),
    tags: z.array(z.string()).describe("Array of tag strings, max 5"),
  },
  async ({ id, tags }) => {
    const data = await api(`/transcriptions/${id}/tags`, {
      method: "PATCH",
      body: { tags },
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "notes_search",
  "Search transcription notes in the knowledge base.",
  { query: z.string().describe("Search query") },
  async ({ query }) => {
    const data = await api("/knowledge-base/search", {
      method: "POST",
      body: { query },
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ═══════════════════════════════════════════════════════════
//  PORTFOLIO
// ═══════════════════════════════════════════════════════════

server.tool(
  "portfolio_list_positions",
  "List all portfolio positions with ticker, name, sector, weight, P&L, market cap.",
  {},
  async () => {
    const data = await api("/portfolio/positions");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "portfolio_get_position",
  "Get a single portfolio position with full details.",
  { id: z.number().describe("Position ID") },
  async ({ id }) => {
    const data = await api(`/portfolio/positions/${id}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
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
  async ({ id, ...fields }) => {
    const data = await api(`/portfolio/positions/${id}`, {
      method: "PUT",
      body: fields,
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "portfolio_summary",
  "Get portfolio summary: total AUM, position count, sector breakdown, top holdings.",
  {},
  async () => {
    const data = await api("/portfolio/summary");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "portfolio_get_research",
  "Get research notes for a portfolio position.",
  { id: z.number().describe("Position ID") },
  async ({ id }) => {
    const data = await api(`/portfolio/research/${id}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
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
  async ({ id, ...fields }) => {
    const data = await api(`/portfolio/research/${id}`, {
      method: "PUT",
      body: fields,
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "portfolio_list_trades",
  "List trade records.",
  {},
  async () => {
    const data = await api("/portfolio/trades");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
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
    const data = await api(`/feed${qs}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
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
  async ({ type, title, content, category, source, tags }) => {
    const data = await api("/feed", {
      method: "POST",
      body: { type, title, content, category, source, tags },
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ═══════════════════════════════════════════════════════════
//  PROJECTS
// ═══════════════════════════════════════════════════════════

server.tool(
  "projects_list",
  "List all projects.",
  {},
  async () => {
    const data = await api("/projects");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ═══════════════════════════════════════════════════════════
//  USER / INDUSTRIES
// ═══════════════════════════════════════════════════════════

server.tool(
  "industries_list",
  "List user's tracked industries.",
  {},
  async () => {
    const data = await api("/user/industries");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ═══════════════════════════════════════════════════════════
//  Start
// ═══════════════════════════════════════════════════════════

const transport = new StdioServerTransport();
await server.connect(transport);
