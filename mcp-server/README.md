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
- A raw authenticated API escape hatch: `rc_raw_request`

## Run Locally

```bash
cd /Users/jiaqi/research-canvas/mcp-server
npm install
RC_API_BASE="https://research-canvas-api-jxycyus54a-as.a.run.app/api" \
RC_API_KEY="your-token" \
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
