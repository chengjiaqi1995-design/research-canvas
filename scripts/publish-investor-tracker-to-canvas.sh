#!/usr/bin/env bash
set -euo pipefail

ROOT="${INVESTOR_TRACKER_ROOT:-/Users/jiaqi/research/追踪牛逼投资者}"
NODE_BIN="${NODE_BIN:-/Users/jiaqi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}"
PUSH_SCRIPT="${RC_PUSH_HTML_SCRIPT:-/Users/jiaqi/.codex/skills/research-canvas-html-report/scripts/push_html_report.py}"

if [[ ! -x "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node)"
fi

cd "$ROOT"

"$NODE_BIN" scripts/build_investor_database.mjs

"$NODE_BIN" --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';

const root = process.env.INVESTOR_TRACKER_ROOT || '/Users/jiaqi/research/追踪牛逼投资者';
const htmlPath = path.join(root, 'investor_tracker.html');
const xlsxPath = path.join(root, 'assets/xlsx.full.min.js');
const seedPath = path.join(root, 'assets/investor_seed_data.js');
const outPath = path.join(root, 'outputs/local_tracker/investor_tracker_canvas.html');

let html = fs.readFileSync(htmlPath, 'utf8');
const escapeInlineScript = source => source.replace(/<\/script/gi, '<\\/script');
const xlsx = escapeInlineScript(fs.readFileSync(xlsxPath, 'utf8'));
const seed = escapeInlineScript(fs.readFileSync(seedPath, 'utf8'));

const replaceOnce = (source, needle, replacement) => {
  if (!source.includes(needle)) {
    throw new Error(`Missing expected HTML marker: ${needle}`);
  }
  return source.replace(needle, () => replacement);
};

html = replaceOnce(html, '<script src="assets/xlsx.full.min.js"></script>', `<script>\n${xlsx}\n</script>`);
html = replaceOnce(html, '<script src="assets/investor_seed_data.js"></script>', `<script>\n${seed}\n</script>`);
html = html.replace('数据源：outputs/local_tracker/investor_database.xlsx', '数据源：Research Canvas 内置同步数据');
html = html.replace(
  'const DEFAULT_XLSX = "outputs/local_tracker/investor_database.xlsx";',
  'const DEFAULT_XLSX = "outputs/local_tracker/investor_database.xlsx"; // Canvas版会优先使用内置同步数据',
);

const scriptOpens = (html.match(/<script\b/gi) || []).length;
const scriptCloses = (html.match(/<\/script/gi) || []).length;
if (scriptOpens !== scriptCloses) {
  throw new Error(`Invalid Canvas HTML: script opens=${scriptOpens}, closes=${scriptCloses}`);
}
if (html.includes('<script src="assets/')) {
  throw new Error('Invalid Canvas HTML: local script marker was not inlined.');
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html, 'utf8');
console.log(`Canvas HTML: ${outPath}`);
NODE

python3 "$PUSH_SCRIPT" \
  "$ROOT/outputs/local_tracker/investor_tracker_canvas.html" \
  --title "投资者仓位追踪" \
  --category "投资者持仓" \
  --source "local-report-agent" \
  --tag "投资研究" \
  --tag "13F" \
  --tag "基金持仓" \
  --tag "私募持仓" \
  --tag "量化基金" \
  --tag "工业周期" \
  --report-key "investor-tracker-report" \
  --summary "追踪重点投资者、基金经理和私募产品的公开持仓变化，含13F、基金季报和前十大流通股东披露口径。" \
  --mode upsert \
  --no-inline-assets
