# Research Canvas MCP Server

This MCP server exposes Research Canvas as tools for MCP clients such as Claude Desktop, Cursor, Codex, or other local agents.

## What It Exposes

- Research Canvas workspaces and canvases
- Canvas node moves and canvas CRUD
- Industry wiki articles and generation logs
- AI Process transcription notes
- Knowledge base search and sync
- Portfolio positions, research, trades, taxonomy, and settings
- Feed items
- Projects, user industries, shares, uploads, backups
- Industry trackers and tracker inbox
- Industry weekly reviews: Codex-direct context packet + write-back tools
- Financial Modeling Prep (FMP) market data, quotes, charts, financials, metrics, and news
- A raw authenticated API escape hatch: `rc_raw_request`

## Run Locally

```bash
cd /Users/jiaqi/research-canvas/mcp-server
npm install
RC_API_BASE="https://research-canvas-api-jxycyus54a-as.a.run.app/api" \
RC_API_KEY="your-token" \
FMP_API_KEY="your-fmp-key" \
RC_MCP_PROFILE="read" \
npm start
```

For local development against the dev API:

```bash
RC_API_BASE="http://localhost:8080/api" RC_API_KEY="dev-token" RC_MCP_PROFILE="write" npm start
```

## MCP Client Config

Add this to your MCP client config:

```json
{
  "mcpServers": {
    "research-canvas": {
      "command": "node",
      "args": ["/Users/jiaqi/research-canvas/mcp-server/index.js"],
      "env": {
        "RC_API_BASE": "https://research-canvas-api-jxycyus54a-as.a.run.app/api",
        "RC_API_KEY": "your-token",
        "FMP_API_KEY": "your-fmp-key",
        "RC_MCP_PROFILE": "read"
      }
    }
  }
}
```

`RC_MCP_PROFILE` controls which tool group is exposed:

- `read`: read-only tools only; this is the default.
- `write`: read tools plus create/update/import/upload tools.
- `admin`: all tools, including delete/reset/raw request. Destructive tools still require a `confirm:<tool_name>` argument unless `RC_MCP_ALLOW_DESTRUCTIVE=1` is set.

Use the root `.mcp.example.json` as the template for local MCP config. Keep the real `.mcp.json` local only.

## FMP Market Data

FMP tools are read-only and use `FMP_API_KEY` or `FMP_API_TOKEN` from the MCP client environment. The server appends `apikey` itself and redacts tokens in responses.

Common tools:

- `fmp_docs` — lists FMP usage notes and available tools.
- `fmp_request` — calls any stable FMP GET endpoint, for example `/financial-scores` with `{ "symbol": "AAPL" }`.
- `fmp_search_symbol` — auto-selects FMP name search for company names and symbol search for ticker-like queries.
- `fmp_quote`, `fmp_batch_quote`, `fmp_company_profile`.
- `fmp_historical_price_eod`, `fmp_historical_chart`.
- `fmp_financials`, `fmp_metrics`, `fmp_stock_news`.

## Codex-Direct Weekly Reviews

Use these tools when Codex should generate the industry weekly review board through MCP instead of the in-app AI endpoint:

1. `industry_weekly_reviews_context` — fetches Canvas industries, week-filtered feed items, existing reviews, and the expected output schema.
2. `industry_weekly_reviews_apply` — writes Codex-generated reviews back to `/api/trackers/weekly-reviews`.
3. `industry_weekly_reviews_list` — reads saved reviews for inspection.

Set `RC_MCP_PROFILE="write"` for `industry_weekly_reviews_apply`.
