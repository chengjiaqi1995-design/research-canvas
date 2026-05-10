import { Storage } from '@google-cloud/storage';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const userId = process.env.CANVAS_USER_ID || '104921709359061938941';
const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'gen-lang-client-0634831802';
const bucketName = process.env.UPLOAD_BUCKET || `${projectId}-uploads-asia`;
const generatedAt = new Date();
const stamp = generatedAt.toISOString().replace(/[:.]/g, '-');

const storage = new Storage();
const bucket = storage.bucket(bucketName);

function dataPath(name) {
  return `${userId}/${name}`;
}

async function readJSON(name, fallback = null) {
  try {
    const [buf] = await bucket.file(name).download();
    return JSON.parse(buf.toString('utf8'));
  } catch (err) {
    if (err.code === 404) return fallback;
    throw err;
  }
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await mapper(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeBracketCode(code) {
  return String(code || '')
    .replace(/\s+Equity$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function parseLeadingBracket(title) {
  const match = String(title || '').match(/^\s*[\[【]\s*([^\]】]+?)\s*[\]】]\s*(.*)$/);
  if (!match) return null;
  const rawCode = normalizeText(match[1]);
  const code = normalizeBracketCode(rawCode);
  return {
    rawCode,
    code,
    suffix: normalizeText(match[2]),
    isPrivate: code === 'PRIVATE',
  };
}

function stripLeadingBracket(title) {
  return normalizeText(title)
    .replace(/^\s*[\[【]\s*[^\]】]+?\s*[\]】]\s*/, '')
    .trim();
}

function canonicalCanvasGroup(title) {
  const parsed = parseLeadingBracket(title);
  if (parsed?.isPrivate) {
    return {
      kind: 'private',
      key: `private::${normalizeKey(parsed.suffix)}`,
      canonicalTitle: parsed.suffix ? `[PRIVATE] ${parsed.suffix}` : '[PRIVATE]',
    };
  }
  if (parsed?.code) {
    return {
      kind: 'ticker',
      key: `ticker::${parsed.code}`,
      canonicalTitle: parsed.suffix ? `[${parsed.code}] ${parsed.suffix}` : `[${parsed.code}]`,
    };
  }
  return {
    kind: 'title',
    key: `title::${normalizeKey(title)}`,
    canonicalTitle: normalizeText(title),
  };
}

function isTickerCaseIssue(title) {
  const parsed = parseLeadingBracket(title);
  if (!parsed || parsed.isPrivate) return false;
  return parsed.rawCode !== parsed.code || /\s+Equity$/i.test(parsed.rawCode);
}

function nodeDataFor(bundle, nodeRef) {
  return bundle?.[nodeRef.id] || nodeRef.data || null;
}

function isDefaultEmptyTextNode(nodeRef, data) {
  if (nodeRef.type !== 'text' && data?.type !== 'text') return false;
  const title = normalizeText(data?.title || nodeRef.title || '');
  const content = normalizeText(data?.content || '');
  return (!title || title === '默认') && !content;
}

function isContentfulMainMarkdown(nodeRef, data) {
  if (!nodeRef.isMain) return false;
  if (nodeRef.type !== 'markdown' && data?.type !== 'markdown') return false;
  return Boolean(normalizeText(data?.title || '') || normalizeText(data?.content || ''));
}

function isMeaningfulNode(nodeRef, data) {
  if (!nodeRef) return false;
  if (isContentfulMainMarkdown(nodeRef, data)) return true;
  if (nodeRef.isMain) return false;
  if (isDefaultEmptyTextNode(nodeRef, data)) return false;
  return Boolean(data || nodeRef.type !== 'text');
}

function canvasMetaForIndex(doc) {
  return {
    id: doc.id,
    title: doc.title,
    workspaceId: doc.workspaceId,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    nodeCount: (doc.nodes || []).filter((n) => !n.isMain).length,
  };
}

function summarizeWorkspace(ws, doc) {
  const source = doc || ws;
  return {
    id: source.id || ws.id,
    name: source.name || ws.name || '',
    category: source.category || ws.category || '',
    industryCategory: source.industryCategory || ws.industryCategory || '',
    parentId: source.parentId || ws.parentId || '',
    canvasIds: Array.isArray(source.canvasIds) ? source.canvasIds : [],
    indexCanvasIds: Array.isArray(ws.canvasIds) ? ws.canvasIds : [],
    docMissing: !doc,
  };
}

function issueCanvas(record) {
  return {
    id: record.id,
    title: record.title,
    workspaceId: record.workspaceId,
    workspaceName: record.workspaceName,
    workspaceCategory: record.workspaceCategory,
    nodeCount: record.actualNodeCount,
    visibleNodeCount: record.visibleNodeCount,
  };
}

function topGroups(groups, limit = 100) {
  return Array.from(groups.values())
    .filter((group) => group.items.length > 1)
    .sort((a, b) => b.items.reduce((s, x) => s + x.actualNodeCount, 0) - a.items.reduce((s, x) => s + x.actualNodeCount, 0))
    .slice(0, limit)
    .map((group) => ({
      key: group.key,
      kind: group.kind,
      canonicalTitle: group.canonicalTitle,
      count: group.items.length,
      totalNodes: group.items.reduce((sum, item) => sum + item.actualNodeCount, 0),
      workspaces: Array.from(new Set(group.items.map((item) => item.workspaceName))).filter(Boolean),
      items: group.items.map(issueCanvas),
    }));
}

function summarizeIssues(report) {
  return {
    duplicateWorkspaceNameGroups: report.issues.duplicateWorkspaceNameGroups.length,
    sameWorkspaceDuplicateCanvasGroups: report.issues.sameWorkspaceDuplicateCanvasGroups.length,
    globalDuplicateCanvasGroups: report.issues.globalDuplicateCanvasGroups.length,
    privateCompanyPages: report.issues.privateCompanyPages.length,
    tickerTitleCaseIssues: report.issues.tickerTitleCaseIssues.length,
    zeroNodeCanvases: report.issues.zeroNodeCanvases.length,
    hiddenContentMainCanvases: report.issues.hiddenContentMainCanvases.length,
    workspaceDanglingCanvasIds: report.issues.workspaceDanglingCanvasIds.length,
    canvasesNotInWorkspaceIds: report.issues.canvasesNotInWorkspaceIds.length,
    canvasesMissingWorkspace: report.issues.canvasesMissingWorkspace.length,
    canvasIndexMismatches: report.issues.canvasIndexMismatches.length,
    longTitles: report.issues.longTitles.length,
  };
}

async function writeReports(report) {
  const reportDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migration-reports');
  await fs.mkdir(reportDir, { recursive: true });
  const jsonPath = path.join(reportDir, `global-canvas-dry-run-${stamp}.json`);
  const mdPath = path.join(reportDir, `global-canvas-dry-run-${stamp}.md`);
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));

  const topSame = report.issues.sameWorkspaceDuplicateCanvasGroups.slice(0, 12)
    .map((g) => `- ${g.canonicalTitle || g.key}: ${g.count} pages, ${g.totalNodes} nodes, ${g.workspaces.join(', ')}`)
    .join('\n') || '- none';
  const topPrivate = report.issues.privateCompanyPages.slice(0, 20)
    .map((c) => `- ${c.workspaceName} / ${c.title}: ${c.nodeCount} nodes`)
    .join('\n') || '- none';
  const topWorkspace = report.issues.duplicateWorkspaceNameGroups.slice(0, 20)
    .map((g) => `- ${g.name}: ${g.items.map((w) => `${w.category || 'uncategorized'}:${w.id}`).join(', ')}`)
    .join('\n') || '- none';

  const md = `# Global Canvas Dry Run

Generated: ${report.generatedAt}
User: ${report.userId}
Bucket: ${report.bucketName}

## Summary

\`\`\`json
${JSON.stringify(report.summary, null, 2)}
\`\`\`

## Recommended Auto-Fix Buckets

${report.recommendedActions.autoSafe.map((item) => `- ${item}`).join('\n')}

## Manual Review Buckets

${report.recommendedActions.manualReview.map((item) => `- ${item}`).join('\n')}

## Top Same-Workspace Duplicates

${topSame}

## Top Private Company Pages

${topPrivate}

## Duplicate Workspace Names

${topWorkspace}
`;
  await fs.writeFile(mdPath, md);
  return { jsonPath, mdPath };
}

async function main() {
  const workspacesIndex = await readJSON(dataPath('workspaces-index.json'), []);
  const canvasesIndex = await readJSON(dataPath('canvases-index.json'), []);
  const workspaceIndexById = new Map(workspacesIndex.map((ws) => [ws.id, ws]));
  const canvasIndexById = new Map(canvasesIndex.map((canvas) => [canvas.id, canvas]));

  const workspaceDocs = await mapLimit(workspacesIndex, 25, async (ws) => {
    const doc = await readJSON(dataPath(`workspaces/${ws.id}.json`), null);
    return summarizeWorkspace(ws, doc);
  });
  const workspaceById = new Map(workspaceDocs.map((ws) => [ws.id, ws]));

  const canvasRecords = await mapLimit(canvasesIndex, 20, async (meta) => {
    const doc = await readJSON(dataPath(`canvases/${meta.id}.json`), null);
    const bundle = await readJSON(dataPath(`canvas-data/${meta.id}.json`), {});
    const source = doc || meta;
    const workspace = workspaceById.get(source.workspaceId || meta.workspaceId);
    const nodes = Array.isArray(source.nodes) ? source.nodes : [];
    const actualNodeCount = nodes.filter((node) => isMeaningfulNode(node, nodeDataFor(bundle, node))).length;
    const visibleNodeCount = nodes.filter((node) => !node.isMain).length;
    const hiddenContentMainNodes = nodes
      .filter((node) => isContentfulMainMarkdown(node, nodeDataFor(bundle, node)))
      .map((node) => {
        const data = nodeDataFor(bundle, node) || {};
        return {
          id: node.id,
          title: data.title || '',
          contentLength: String(data.content || '').length,
        };
      });
    const canonical = canonicalCanvasGroup(source.title || meta.title || '');
    return {
      id: source.id || meta.id,
      title: source.title || meta.title || '',
      workspaceId: source.workspaceId || meta.workspaceId || '',
      workspaceName: workspace?.name || '',
      workspaceCategory: workspace?.category || '',
      docMissing: !doc,
      meta,
      doc,
      actualNodeCount,
      visibleNodeCount,
      hiddenContentMainNodes,
      canonical,
    };
  });

  const issues = {
    duplicateWorkspaceNameGroups: [],
    sameWorkspaceDuplicateCanvasGroups: [],
    globalDuplicateCanvasGroups: [],
    privateCompanyPages: [],
    tickerTitleCaseIssues: [],
    zeroNodeCanvases: [],
    hiddenContentMainCanvases: [],
    workspaceDanglingCanvasIds: [],
    canvasesNotInWorkspaceIds: [],
    canvasesMissingWorkspace: [],
    canvasIndexMismatches: [],
    longTitles: [],
    missingWorkspaceDocs: [],
    missingCanvasDocs: [],
  };

  const workspaceNameGroups = new Map();
  for (const ws of workspaceDocs) {
    if (ws.docMissing) issues.missingWorkspaceDocs.push(ws);
    const key = `${normalizeKey(ws.name)}::${ws.parentId || 'root'}`;
    if (!workspaceNameGroups.has(key)) workspaceNameGroups.set(key, { name: ws.name, items: [] });
    workspaceNameGroups.get(key).items.push(ws);
  }
  issues.duplicateWorkspaceNameGroups = Array.from(workspaceNameGroups.values())
    .filter((group) => group.items.length > 1)
    .map((group) => ({
      name: group.name,
      count: group.items.length,
      items: group.items.map((ws) => ({
        id: ws.id,
        category: ws.category,
        industryCategory: ws.industryCategory,
        canvasIds: ws.canvasIds.length,
      })),
    }));

  const canvasRecordsById = new Map(canvasRecords.map((record) => [record.id, record]));
  const byWorkspaceCanonical = new Map();
  const byGlobalCanonical = new Map();
  const byExactWorkspaceTitle = new Map();

  for (const record of canvasRecords) {
    if (record.docMissing) issues.missingCanvasDocs.push(issueCanvas(record));
    if (!workspaceById.has(record.workspaceId)) issues.canvasesMissingWorkspace.push(issueCanvas(record));
    const workspace = workspaceById.get(record.workspaceId);
    if (workspace && !workspace.canvasIds.includes(record.id)) {
      issues.canvasesNotInWorkspaceIds.push(issueCanvas(record));
    }

    const indexMeta = canvasIndexById.get(record.id);
    if (record.doc && indexMeta) {
      const expected = canvasMetaForIndex(record.doc);
      const mismatch = {};
      for (const key of ['title', 'workspaceId', 'nodeCount']) {
        if (indexMeta[key] !== expected[key]) mismatch[key] = { index: indexMeta[key], doc: expected[key] };
      }
      if (Object.keys(mismatch).length) {
        issues.canvasIndexMismatches.push({ ...issueCanvas(record), mismatch });
      }
    }

    if (record.canonical.kind === 'private') {
      issues.privateCompanyPages.push({
        ...issueCanvas(record),
        recommendedTarget: record.title.toLowerCase().includes('sellside') ? 'Sellside' : 'Expert/Sellside by node metadata',
      });
    }
    if (isTickerCaseIssue(record.title)) {
      issues.tickerTitleCaseIssues.push({
        ...issueCanvas(record),
        canonicalTitle: record.canonical.canonicalTitle,
      });
    }
    if (record.actualNodeCount === 0) issues.zeroNodeCanvases.push(issueCanvas(record));
    if (record.hiddenContentMainNodes.length) {
      issues.hiddenContentMainCanvases.push({
        ...issueCanvas(record),
        hiddenContentMainNodes: record.hiddenContentMainNodes,
      });
    }
    if (normalizeText(record.title).length > 72) issues.longTitles.push(issueCanvas(record));

    const workspaceKey = `${record.workspaceId}::${record.canonical.key}`;
    if (!byWorkspaceCanonical.has(workspaceKey)) {
      byWorkspaceCanonical.set(workspaceKey, { ...record.canonical, key: workspaceKey, items: [] });
    }
    byWorkspaceCanonical.get(workspaceKey).items.push(record);

    if (!byGlobalCanonical.has(record.canonical.key)) {
      byGlobalCanonical.set(record.canonical.key, { ...record.canonical, items: [] });
    }
    byGlobalCanonical.get(record.canonical.key).items.push(record);

    const exactKey = `${record.workspaceId}::${normalizeKey(record.title)}`;
    if (!byExactWorkspaceTitle.has(exactKey)) byExactWorkspaceTitle.set(exactKey, { key: exactKey, items: [] });
    byExactWorkspaceTitle.get(exactKey).items.push(record);
  }

  issues.sameWorkspaceDuplicateCanvasGroups = topGroups(byWorkspaceCanonical, 300);
  issues.globalDuplicateCanvasGroups = topGroups(byGlobalCanonical, 300)
    .filter((group) => new Set(group.items.map((item) => item.workspaceId)).size > 1);
  issues.exactDuplicateTitleGroups = topGroups(byExactWorkspaceTitle, 200);

  for (const ws of workspaceDocs) {
    for (const id of ws.canvasIds) {
      if (canvasIndexById.has(id)) continue;
      const doc = await readJSON(dataPath(`canvases/${id}.json`), null);
      issues.workspaceDanglingCanvasIds.push({
        workspaceId: ws.id,
        workspaceName: ws.name,
        workspaceCategory: ws.category,
        canvasId: id,
        canvasDocExists: Boolean(doc),
        canvasTitle: doc?.title || '',
      });
    }
  }

  issues.privateCompanyPages.sort((a, b) => b.nodeCount - a.nodeCount || a.workspaceName.localeCompare(b.workspaceName));
  issues.tickerTitleCaseIssues.sort((a, b) => a.workspaceName.localeCompare(b.workspaceName) || a.title.localeCompare(b.title));
  issues.zeroNodeCanvases.sort((a, b) => a.workspaceName.localeCompare(b.workspaceName) || a.title.localeCompare(b.title));
  issues.hiddenContentMainCanvases.sort((a, b) => b.hiddenContentMainNodes.length - a.hiddenContentMainNodes.length);
  issues.canvasesNotInWorkspaceIds.sort((a, b) => a.workspaceName.localeCompare(b.workspaceName) || a.title.localeCompare(b.title));

  const report = {
    mode: 'dry-run',
    generatedAt: generatedAt.toISOString(),
    userId,
    bucketName,
    counters: {
      workspacesIndex: workspacesIndex.length,
      workspaceDocsLoaded: workspaceDocs.filter((ws) => !ws.docMissing).length,
      canvasesIndex: canvasesIndex.length,
      canvasDocsLoaded: canvasRecords.filter((record) => !record.docMissing).length,
      totalMeaningfulNodes: canvasRecords.reduce((sum, record) => sum + record.actualNodeCount, 0),
    },
    issues,
    recommendedActions: {
      autoSafe: [
        'Normalize ticker badge/title casing for public bracketed canvases.',
        'Route [Private] company canvases into Expert/Sellside by node metadata, with backup and archive.',
        'Archive truly empty canvases after backup.',
        'Repair workspace.canvasIds and canvases-index drift where target workspace exists.',
        'Merge duplicate canvases within the same workspace and canonical key using sourceId/title/content de-dup.',
      ],
      manualReview: [
        'Cross-workspace public ticker duplicates may be legitimate multi-industry coverage; review before global merge.',
        'Duplicate workspace names need category/parent intent checked before merge.',
        'Non-empty canvases whose workspace is missing need a destination workspace selected.',
        'Very long or generic titles should be reviewed before automatic rename.',
      ],
    },
  };
  report.summary = summarizeIssues(report);

  const paths = await writeReports(report);
  console.log(JSON.stringify({
    reportJson: paths.jsonPath,
    reportMarkdown: paths.mdPath,
    counters: report.counters,
    summary: report.summary,
    topPrivatePages: report.issues.privateCompanyPages.slice(0, 8),
    topSameWorkspaceDuplicates: report.issues.sameWorkspaceDuplicateCanvasGroups.slice(0, 8).map((group) => ({
      canonicalTitle: group.canonicalTitle,
      count: group.count,
      totalNodes: group.totalNodes,
      workspaces: group.workspaces,
    })),
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
