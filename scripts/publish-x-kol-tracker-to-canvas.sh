#!/usr/bin/env bash
set -euo pipefail

ROOT="${X_KOL_TRACKER_ROOT:-/Users/jiaqi/research/追踪牛逼投资者}"
OUT_DIR="${X_KOL_TRACKER_OUT_DIR:-/private/tmp/research-canvas-trackers}"
NODE_BIN="${NODE_BIN:-/Users/jiaqi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}"
PUSH_SCRIPT="${RC_PUSH_HTML_SCRIPT:-/Users/jiaqi/.codex/skills/research-canvas-html-report/scripts/push_html_report.py}"

if [[ ! -x "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node)"
fi

export X_KOL_TRACKER_ROOT="$ROOT"
export X_KOL_TRACKER_OUT_DIR="$OUT_DIR"

"$NODE_BIN" --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';

const root = process.env.X_KOL_TRACKER_ROOT || '/Users/jiaqi/research/追踪牛逼投资者';
const outDir = process.env.X_KOL_TRACKER_OUT_DIR || '/private/tmp/research-canvas-trackers';
const htmlPath = path.join(root, 'x_kol_tracker.html');
const seedPath = path.join(root, 'assets/x_kol_seed_data.js');
const outPath = path.join(outDir, 'x_kol_tracker_canvas.html');

const escapeInlineScript = (source) => source.replace(/<\/script/gi, '<\\/script');
const replaceOnce = (source, needle, replacement) => {
  if (!source.includes(needle)) {
    throw new Error(`Missing expected HTML marker: ${needle}`);
  }
  return source.replace(needle, () => replacement);
};

let html = fs.readFileSync(htmlPath, 'utf8');
const seed = escapeInlineScript(fs.readFileSync(seedPath, 'utf8'));

html = replaceOnce(
  html,
  '<script src="assets/x_kol_seed_data.js"></script>',
  `<script>\n${seed}\n</script>`,
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
  "$OUT_DIR/x_kol_tracker_canvas.html" \
  --title "X KOL 投资观点追踪" \
  --category "投资者发言" \
  --source "local-report-agent" \
  --tag "投资研究" \
  --tag "X" \
  --tag "KOL" \
  --tag "行业分类" \
  --tag "Research Canvas" \
  --report-type "x_kol_investor_speech" \
  --report-type-label "投资者发言" \
  --report-key "x-kol-investor-speech-tracker" \
  --summary "按 Research Canvas 行业口径追踪 X 上投资者和行业 KOL 发言，支持行业树、主题、公司、立场、重要性和复核状态筛选。" \
  --mode upsert \
  --no-inline-assets
