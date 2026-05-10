import { Storage } from '@google-cloud/storage';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const userId = process.env.CANVAS_USER_ID || '104921709359061938941';
const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'gen-lang-client-0634831802';
const bucketName = process.env.UPLOAD_BUCKET || `${projectId}-uploads-asia`;
const now = Date.now();
const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
const backupPrefix = `${userId}/migration-backups/aerospace-canvas-cleanup-${stamp}`;
const archivePrefix = `${userId}/archives/aerospace-canvas-cleanup-${stamp}`;

const PUBLIC_CANONICAL_TITLES = new Map([
  ['BA US', '[BA US] The Boeing Company'],
  ['EH US', '[EH US] EHang Holdings Ltd.'],
  ['FTAI US', '[FTAI US] Fortress Transportation and Infrastructure Investors LLC'],
  ['GE US', '[GE US] GE Aerospace'],
  ['HWM US', '[HWM US] Howmet Aerospace Inc.'],
  ['MTX GR', '[MTX GR] MTU Aero Engines AG'],
  ['RTX US', '[RTX US] RTX Corp'],
]);

const storage = new Storage();
const bucket = storage.bucket(bucketName);
const report = {
  apply,
  userId,
  bucketName,
  backupPrefix: apply ? backupPrefix : null,
  archivePrefix: apply ? archivePrefix : null,
  targetWorkspace: null,
  sourceWorkspace: null,
  operations: [],
  counters: {
    renamed: 0,
    unhiddenMainNodes: 0,
    movedCanvases: 0,
    mergedCanvases: 0,
    copiedNodes: 0,
    skippedDuplicateNodes: 0,
    archivedCanvases: 0,
    archivedEmptyCanvases: 0,
    createdCanvases: 0,
    archivedWorkspaces: 0,
  },
  warnings: [],
};

const dirtyCanvases = new Set();
const dirtyBundles = new Set();
const archivedCanvasIds = new Set();
const touchedPaths = new Set();
const canvasRecords = new Map();

function dataPath(name) {
  return `${userId}/${name}`;
}

function logOperation(type, payload) {
  report.operations.push({ type, ...payload });
}

async function exists(name) {
  const [ok] = await bucket.file(name).exists();
  return ok;
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

async function writeJSON(name, value) {
  if (!apply) return;
  await bucket.file(name).save(JSON.stringify(value, null, 2), { contentType: 'application/json' });
}

async function copyIfExists(from, to) {
  if (!(await exists(from))) return false;
  await bucket.file(from).copy(bucket.file(to));
  return true;
}

async function deleteIfExists(name) {
  if (!apply) return;
  await bucket.file(name).delete({ ignoreNotFound: true });
}

function normalizeBracketCode(code) {
  return String(code || '')
    .replace(/\s+Equity$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function extractLeadingBracketCode(title) {
  const match = String(title || '').match(/^\s*[\[【]\s*([^\]】]+?)\s*[\]】]/);
  if (!match) return '';
  const code = normalizeBracketCode(match[1]);
  return code === 'PRIVATE' ? '' : code;
}

function isPrivateTitle(title) {
  return /^\s*[\[【]\s*private\s*[\]】]/i.test(String(title || ''));
}

function normalizeTitleKey(title) {
  return String(title || '')
    .replace(/^\s*[\[【]\s*private\s*[\]】]\s*/i, '')
    .replace(/^\s*[\[【]\s*[^\]】]+?\s*[\]】]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function canonicalPublicTitle(title) {
  const code = extractLeadingBracketCode(title);
  if (!code) return '';
  if (PUBLIC_CANONICAL_TITLES.has(code)) return PUBLIC_CANONICAL_TITLES.get(code);
  const suffix = String(title || '').replace(/^\s*[\[【]\s*[^\]】]+?\s*[\]】]\s*/, '').replace(/\s+/g, ' ').trim();
  return suffix ? `[${code}] ${suffix}` : `[${code}]`;
}

function canonicalGroup(record) {
  if (isPrivateTitle(record.title)) return { kind: 'private', key: `private::${normalizeTitleKey(record.title)}` };
  const code = extractLeadingBracketCode(record.title);
  if (code) return { kind: 'public', key: `ticker::${code}`, canonicalTitle: canonicalPublicTitle(record.title) };
  return { kind: 'name', key: `name::${normalizeTitleKey(record.title)}`, canonicalTitle: String(record.title || '').trim() };
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

function nodeDataFor(record, nodeRef) {
  return record.bundle[nodeRef.id] || nodeRef.data || null;
}

function isMigratableNode(record, nodeRef) {
  if (!nodeRef) return false;
  if (!nodeRef.isMain) return true;
  const data = nodeDataFor(record, nodeRef);
  return nodeRef.type === 'markdown' && Boolean((data?.content || '').trim() || (data?.title || '').trim());
}

function migratableNodes(record) {
  return (record.doc.nodes || []).filter((node) => isMigratableNode(record, node));
}

function migratableNodeCount(record) {
  return migratableNodes(record).length;
}

function contentHash(input) {
  return crypto.createHash('sha1').update(String(input || '')).digest('hex');
}

function nodeDedupKey(nodeRef, data) {
  const meta = data?.metadata || {};
  const sourceId = meta.sourceId || meta.sourceID || meta['sourceId'] || meta['来源ID'];
  if (sourceId) return `source:${sourceId}`;
  const title = data?.title || nodeRef?.data?.title || nodeRef?.id || '';
  const normalizedTitle = String(title).replace(/\s+/g, ' ').trim().toLowerCase();
  if (normalizedTitle.length >= 5) return `title:${normalizedTitle}`;
  const content = data?.content || nodeRef?.data?.content || '';
  return `hash:${contentHash(`${title}\n${content}`)}`;
}

function privateTargetForNode(data) {
  const meta = data?.metadata || {};
  const participants = String(
    meta.participants ||
    meta['参与人'] ||
    meta['参与者'] ||
    meta['笔记类型'] ||
    data?.participants ||
    ''
  ).toLowerCase();
  return participants.includes('sellside') || participants.includes('卖方') ? 'Sellside' : 'Expert';
}

function nextPosition(index) {
  const col = index % 4;
  const row = Math.floor(index / 4);
  return { x: col * 620, y: row * 460 };
}

async function loadCanvasRecord(meta) {
  const canvasPath = dataPath(`canvases/${meta.id}.json`);
  const bundlePath = dataPath(`canvas-data/${meta.id}.json`);
  const doc = await readJSON(canvasPath, null) || {
    id: meta.id,
    workspaceId: meta.workspaceId,
    title: meta.title,
    nodes: [],
    edges: [],
    createdAt: meta.createdAt || now,
    updatedAt: meta.updatedAt || meta.createdAt || now,
  };
  const bundle = await readJSON(bundlePath, {}) || {};
  const record = {
    id: doc.id || meta.id,
    workspaceId: doc.workspaceId || meta.workspaceId,
    title: doc.title || meta.title || '',
    doc,
    bundle,
    originalMeta: meta,
    nodeCount: 0,
  };
  record.nodeCount = migratableNodeCount(record);
  canvasRecords.set(record.id, record);
  return record;
}

async function collectWorkspaceCanvases(workspace, canvasIndexById, canvasIndex) {
  const byId = new Map();
  for (const meta of canvasIndex.filter((c) => c.workspaceId === workspace.id)) {
    byId.set(meta.id, meta);
  }
  for (const id of workspace.canvasIds || []) {
    if (byId.has(id)) continue;
    const meta = canvasIndexById.get(id);
    if (meta) byId.set(id, meta);
    else {
      const doc = await readJSON(dataPath(`canvases/${id}.json`), null);
      if (doc) byId.set(id, canvasMetaForIndex(doc));
      else report.warnings.push(`workspace ${workspace.id} references missing canvas ${id}`);
    }
  }
  return Promise.all(Array.from(byId.values()).map(loadCanvasRecord));
}

function recordNodeKeys(record) {
  const keys = new Set();
  for (const node of migratableNodes(record)) {
    const data = nodeDataFor(record, node);
    keys.add(nodeDedupKey(node, data));
  }
  return keys;
}

function markCanvasDirty(record) {
  dirtyCanvases.add(record.id);
  dirtyBundles.add(record.id);
}

function renameRecord(record, title) {
  if (!title || record.doc.title === title) return;
  logOperation('rename_canvas', { id: record.id, from: record.doc.title, to: title });
  report.counters.renamed += 1;
  record.title = title;
  record.doc.title = title;
  record.doc.updatedAt = now;
  markCanvasDirty(record);
}

function unhideContentfulMainNodes(record) {
  let count = 0;
  for (const node of record.doc.nodes || []) {
    if (!node.isMain || !isMigratableNode(record, node)) continue;
    node.isMain = false;
    count += 1;
  }
  if (!count) return;
  record.nodeCount = migratableNodeCount(record);
  record.doc.updatedAt = now;
  markCanvasDirty(record);
  logOperation('unhide_main_nodes', { id: record.id, title: record.title, count });
  report.counters.unhiddenMainNodes += count;
}

function moveRecordToTarget(record, targetWorkspace, title) {
  logOperation('move_canvas', {
    id: record.id,
    title: record.doc.title,
    fromWorkspaceId: record.doc.workspaceId,
    toWorkspaceId: targetWorkspace.id,
  });
  report.counters.movedCanvases += 1;
  record.workspaceId = targetWorkspace.id;
  record.doc.workspaceId = targetWorkspace.id;
  record.doc.updatedAt = now;
  if (title) renameRecord(record, title);
  markCanvasDirty(record);
}

function mergeRecordIntoTarget(source, target) {
  const existingKeys = recordNodeKeys(target);
  let copied = 0;
  let skipped = 0;
  let visibleCount = (target.doc.nodes || []).filter((n) => !n.isMain).length;

  for (const sourceNode of migratableNodes(source)) {
    const sourceData = nodeDataFor(source, sourceNode);
    const key = nodeDedupKey(sourceNode, sourceData);
    if (existingKeys.has(key)) {
      skipped += 1;
      continue;
    }

    let nodeId = sourceNode.id;
    if (!nodeId || (target.doc.nodes || []).some((n) => n.id === nodeId) || target.bundle[nodeId]) {
      nodeId = `node-${now}-${crypto.randomUUID().slice(0, 8)}`;
    }

    const copiedNode = {
      ...sourceNode,
      id: nodeId,
      isMain: false,
      position: nextPosition(visibleCount),
      size: sourceNode.size || { width: 600, height: 400 },
    };
    delete copiedNode.data;
    target.doc.nodes = [...(target.doc.nodes || []), copiedNode];

    if (sourceData) {
      target.bundle[nodeId] = {
        ...sourceData,
        metadata: {
          ...(sourceData.metadata || {}),
          mergedFromCanvasId: source.id,
          mergedFromCanvasTitle: source.title,
          mergedFromWorkspaceId: source.workspaceId,
          mergedAt: new Date(now).toISOString(),
        },
      };
    }

    existingKeys.add(key);
    copied += 1;
    visibleCount += 1;
  }

  target.doc.updatedAt = now;
  markCanvasDirty(target);
  logOperation('merge_canvas', {
    sourceId: source.id,
    sourceTitle: source.title,
    targetId: target.id,
    targetTitle: target.doc.title,
    copiedNodes: copied,
    skippedDuplicateNodes: skipped,
  });
  report.counters.mergedCanvases += 1;
  report.counters.copiedNodes += copied;
  report.counters.skippedDuplicateNodes += skipped;
}

function archiveCanvas(record, reason) {
  if (archivedCanvasIds.has(record.id)) return;
  archivedCanvasIds.add(record.id);
  logOperation('archive_canvas', {
    id: record.id,
    title: record.title,
    workspaceId: record.workspaceId,
    nodeCount: record.nodeCount,
    reason,
  });
  report.counters.archivedCanvases += 1;
  if (record.nodeCount === 0) report.counters.archivedEmptyCanvases += 1;
}

function ensureCanvasIndex(canvasIndex, record) {
  const meta = canvasMetaForIndex(record.doc);
  const idx = canvasIndex.findIndex((c) => c.id === record.id);
  if (idx >= 0) canvasIndex[idx] = meta;
  else canvasIndex.push(meta);
}

async function main() {
  const workspacesPath = dataPath('workspaces-index.json');
  const canvasesPath = dataPath('canvases-index.json');
  let workspaces = await readJSON(workspacesPath, []);
  let canvases = await readJSON(canvasesPath, []);
  const workspaceById = new Map(workspaces.map((w) => [w.id, w]));
  const canvasIndexById = new Map(canvases.map((c) => [c.id, c]));

  const aerospaceWorkspaces = workspaces.filter((w) => w.name === '航空航天' && !w.parentId);
  const targetWorkspace = aerospaceWorkspaces.find((w) => (!w.category || w.category === 'industry'));
  const sourceWorkspace = aerospaceWorkspaces.find((w) => w.category === 'overall');

  if (!targetWorkspace) throw new Error('Missing target industry workspace: 航空航天');

  report.targetWorkspace = { id: targetWorkspace.id, name: targetWorkspace.name, category: targetWorkspace.category };
  report.sourceWorkspace = sourceWorkspace ? { id: sourceWorkspace.id, name: sourceWorkspace.name, category: sourceWorkspace.category } : null;

  const targetRecords = await collectWorkspaceCanvases(targetWorkspace, canvasIndexById, canvases);
  const sourceRecords = sourceWorkspace ? await collectWorkspaceCanvases(sourceWorkspace, canvasIndexById, canvases) : [];
  const relevantRecords = [...targetRecords, ...sourceRecords];

  const activeTargetRecords = new Map(targetRecords.map((r) => [r.id, r]));
  const nonPrivateGroups = new Map();
  const privateRecords = [];

  for (const record of relevantRecords) {
    const group = canonicalGroup(record);
    if (group.kind === 'private') {
      privateRecords.push(record);
      continue;
    }
    if (!nonPrivateGroups.has(group.key)) {
      nonPrivateGroups.set(group.key, { ...group, records: [] });
    }
    nonPrivateGroups.get(group.key).records.push(record);
  }

  for (const group of nonPrivateGroups.values()) {
    const nonEmpty = group.records.filter((r) => r.nodeCount > 0);
    if (nonEmpty.length === 0) {
      for (const record of group.records) archiveCanvas(record, 'empty');
      continue;
    }

    const target = nonEmpty.find((r) => r.workspaceId === targetWorkspace.id) || nonEmpty[0];
    const title = group.kind === 'public' ? group.canonicalTitle : group.canonicalTitle;

    if (target.workspaceId !== targetWorkspace.id) {
      moveRecordToTarget(target, targetWorkspace, title);
      activeTargetRecords.set(target.id, target);
    } else if (title) {
      renameRecord(target, title);
    }
    unhideContentfulMainNodes(target);

    for (const record of group.records) {
      if (record.id === target.id) continue;
      if (record.nodeCount > 0) {
        mergeRecordIntoTarget(record, target);
        archiveCanvas(record, 'merged');
      } else {
        archiveCanvas(record, 'empty_duplicate');
      }
    }
  }

  function findActiveTargetByTitle(title) {
    return Array.from(activeTargetRecords.values()).find((r) => r.doc.title.toLowerCase() === title.toLowerCase() && !archivedCanvasIds.has(r.id));
  }

  function createTargetCanvas(title) {
    const record = {
      id: `canvas-${now}-${crypto.randomUUID().slice(0, 8)}`,
      workspaceId: targetWorkspace.id,
      title,
      doc: {
        id: `canvas-${now}-${crypto.randomUUID().slice(0, 8)}`,
        workspaceId: targetWorkspace.id,
        title,
        template: 'custom',
        modules: [],
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        createdAt: now,
        updatedAt: now,
      },
      bundle: {},
      nodeCount: 0,
    };
    record.doc.id = record.id;
    activeTargetRecords.set(record.id, record);
    canvasRecords.set(record.id, record);
    markCanvasDirty(record);
    logOperation('create_canvas', { id: record.id, title, workspaceId: targetWorkspace.id });
    report.counters.createdCanvases += 1;
    return record;
  }

  for (const record of privateRecords) {
    if (record.nodeCount === 0) {
      archiveCanvas(record, 'empty_private');
      continue;
    }

    const buckets = new Map();
    for (const node of record.doc.nodes || []) {
      const data = nodeDataFor(record, node);
      const targetTitle = privateTargetForNode(data);
      if (!buckets.has(targetTitle)) buckets.set(targetTitle, []);
      buckets.get(targetTitle).push(node);
    }

    for (const [targetTitle, nodes] of buckets) {
      let target = findActiveTargetByTitle(targetTitle);
      if (!target) target = createTargetCanvas(targetTitle);
      const partialSource = {
        ...record,
        doc: { ...record.doc, nodes },
      };
      mergeRecordIntoTarget(partialSource, target);
    }
    archiveCanvas(record, 'private_routed_to_expert_sellside');
  }

  const finalActiveTargetIds = new Set(
    Array.from(activeTargetRecords.values())
      .filter((record) => !archivedCanvasIds.has(record.id))
      .map((record) => record.id)
  );

  targetWorkspace.canvasIds = Array.from(new Set([...(targetWorkspace.canvasIds || []), ...finalActiveTargetIds]))
    .filter((id) => finalActiveTargetIds.has(id));
  targetWorkspace.updatedAt = now;

  if (sourceWorkspace) {
    sourceWorkspace.canvasIds = [];
    sourceWorkspace.updatedAt = now;
    logOperation('archive_workspace', { id: sourceWorkspace.id, name: sourceWorkspace.name, category: sourceWorkspace.category });
    report.counters.archivedWorkspaces += 1;
  }

  canvases = canvases.filter((c) => !archivedCanvasIds.has(c.id));
  for (const record of activeTargetRecords.values()) {
    if (!archivedCanvasIds.has(record.id)) ensureCanvasIndex(canvases, record);
  }

  workspaces = workspaces.filter((w) => !sourceWorkspace || w.id !== sourceWorkspace.id);
  const targetIdx = workspaces.findIndex((w) => w.id === targetWorkspace.id);
  if (targetIdx >= 0) workspaces[targetIdx] = targetWorkspace;

  if (apply) {
    touchedPaths.add(workspacesPath);
    touchedPaths.add(canvasesPath);
    touchedPaths.add(dataPath(`workspaces/${targetWorkspace.id}.json`));
    if (sourceWorkspace) touchedPaths.add(dataPath(`workspaces/${sourceWorkspace.id}.json`));

    for (const record of canvasRecords.values()) {
      if (dirtyCanvases.has(record.id) || archivedCanvasIds.has(record.id)) {
        touchedPaths.add(dataPath(`canvases/${record.id}.json`));
        touchedPaths.add(dataPath(`canvas-data/${record.id}.json`));
      }
    }

    for (const name of touchedPaths) {
      await copyIfExists(name, `${backupPrefix}/${name}`);
    }

    for (const id of archivedCanvasIds) {
      const record = canvasRecords.get(id);
      if (!record) continue;
      const canvasPath = dataPath(`canvases/${id}.json`);
      const bundlePath = dataPath(`canvas-data/${id}.json`);
      await copyIfExists(canvasPath, `${archivePrefix}/canvases/${id}.json`);
      await copyIfExists(bundlePath, `${archivePrefix}/canvas-data/${id}.json`);
      await deleteIfExists(canvasPath);
      await deleteIfExists(bundlePath);
      activeTargetRecords.delete(id);
    }

    if (sourceWorkspace) {
      const sourcePath = dataPath(`workspaces/${sourceWorkspace.id}.json`);
      await copyIfExists(sourcePath, `${archivePrefix}/workspaces/${sourceWorkspace.id}.json`);
      await deleteIfExists(sourcePath);
    }

    for (const record of activeTargetRecords.values()) {
      if (dirtyCanvases.has(record.id)) {
        await writeJSON(dataPath(`canvases/${record.id}.json`), record.doc);
      }
      if (dirtyBundles.has(record.id)) {
        await writeJSON(dataPath(`canvas-data/${record.id}.json`), record.bundle);
      }
    }

    await writeJSON(dataPath(`workspaces/${targetWorkspace.id}.json`), targetWorkspace);
    await writeJSON(workspacesPath, workspaces);
    await writeJSON(canvasesPath, canvases);
  }

  const reportDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migration-reports');
  await fs.mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `aerospace-canvas-cleanup-${apply ? 'apply' : 'dry-run'}-${stamp}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    reportPath,
    targetWorkspace: report.targetWorkspace,
    sourceWorkspace: report.sourceWorkspace,
    counters: report.counters,
    warnings: report.warnings,
    backupPrefix: report.backupPrefix,
    archivePrefix: report.archivePrefix,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
