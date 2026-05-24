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
const backupPrefix = `${userId}/migration-backups/short-title-canvas-cleanup-${stamp}`;
const archivePrefix = `${userId}/archives/short-title-canvas-cleanup-${stamp}`;

const storage = new Storage();
const bucket = storage.bucket(bucketName);
const report = {
  apply,
  userId,
  bucketName,
  backupPrefix: apply ? backupPrefix : null,
  archivePrefix: apply ? archivePrefix : null,
  counters: {
    sourceCanvases: 0,
    createdCanvases: 0,
    copiedNodes: 0,
    skippedDuplicateNodes: 0,
    archivedCanvases: 0,
    staleIndexEntriesRemoved: 0,
  },
  operations: [],
  warnings: [],
};

const workspaceRecords = new Map();
const dirtyCanvases = new Set();
const dirtyBundles = new Set();
const dirtyWorkspaces = new Set();
const archivedCanvasIds = new Set();
const touchedPaths = new Set();

function dataPath(name) {
  return `${userId}/${name}`;
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

function parseLeadingBracket(value) {
  const match = String(value || '').match(/^\s*[\[【]\s*([^\]】]+?)\s*[\]】]\s*(.*)$/);
  if (!match) return null;
  const code = normalizeBracketCode(match[1]);
  return {
    code,
    isPrivate: code === 'PRIVATE',
    suffix: normalizeText(match[2]),
  };
}

function publicCanvasTitle(value) {
  const parsed = parseLeadingBracket(value);
  if (!parsed || parsed.isPrivate || !parsed.code) return '';
  return parsed.suffix ? `[${parsed.code}] ${parsed.suffix}` : `[${parsed.code}]`;
}

function publicCanvasCode(value) {
  const parsed = parseLeadingBracket(value);
  if (!parsed || parsed.isPrivate) return '';
  return parsed.code;
}

function hasPrivateCompany(value) {
  return /\[\s*private\s*\]/i.test(String(value || ''));
}

function participantText(data) {
  const meta = data?.metadata || {};
  return normalizeText(
    meta.participants ||
    meta['参与人'] ||
    meta['参与者'] ||
    meta['笔记类型'] ||
    data?.participants ||
    ''
  ).toLowerCase();
}

function noteTypeTarget(participants) {
  if (participants.includes('sellside') || participants.includes('卖方')) return 'Sellside';
  if (participants.includes('expert') || participants.includes('专家')) return 'Expert';
  return 'Expert';
}

function companyText(data) {
  const meta = data?.metadata || {};
  return normalizeText(meta.company || meta['公司'] || meta.organization || meta['机构'] || data?.organization || '');
}

function targetTitleForNode(data) {
  const company = companyText(data);
  const participants = participantText(data);
  const title = normalizeText(data?.title || '');
  const publicTitle = publicCanvasTitle(company) || publicCanvasTitle(title);
  if (publicTitle) return publicTitle;
  if (hasPrivateCompany(company) || hasPrivateCompany(title)) return noteTypeTarget(participants);
  if (!company || company === '-' || company.length <= 2) return noteTypeTarget(participants);
  if (participants.includes('sellside') || participants.includes('expert')) return noteTypeTarget(participants);
  return company;
}

function nodeDataFor(record, nodeRef) {
  return record.bundle?.[nodeRef.id] || nodeRef.data || null;
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

function isMeaningfulNode(record, nodeRef) {
  const data = nodeDataFor(record, nodeRef);
  if (isContentfulMainMarkdown(nodeRef, data)) return true;
  if (nodeRef.isMain) return false;
  if (isDefaultEmptyTextNode(nodeRef, data)) return false;
  return Boolean(data || nodeRef.type !== 'text');
}

function meaningfulNodes(record) {
  return (record.doc.nodes || []).filter((node) => isMeaningfulNode(record, node));
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

function contentHash(input) {
  return crypto.createHash('sha1').update(String(input || '')).digest('hex');
}

function nodeDedupKey(nodeRef, data) {
  const meta = data?.metadata || {};
  const sourceId = meta.sourceId || meta.sourceID || meta['sourceId'] || meta['来源ID'];
  if (sourceId) return `source:${sourceId}`;
  const title = normalizeText(data?.title || nodeRef?.data?.title || nodeRef?.id || '');
  if (title.length >= 5) return `title:${title.toLowerCase()}`;
  return `hash:${contentHash(`${title}\n${data?.content || nodeRef?.data?.content || ''}`)}`;
}

function nextPosition(index) {
  return { x: (index % 4) * 620, y: Math.floor(index / 4) * 460 };
}

async function loadCanvasRecord(meta, { warnMissing = true } = {}) {
  const doc = await readJSON(dataPath(`canvases/${meta.id}.json`), null);
  if (!doc) {
    if (warnMissing) report.warnings.push(`missing canvas doc: ${meta.id}`);
    return null;
  }
  const bundle = await readJSON(dataPath(`canvas-data/${meta.id}.json`), {}) || {};
  return {
    id: doc.id || meta.id,
    workspaceId: doc.workspaceId || meta.workspaceId,
    title: doc.title || meta.title || '',
    doc,
    bundle,
  };
}

async function collectWorkspaceRecords(workspace, canvasIndex, canvasIndexById) {
  if (workspaceRecords.has(workspace.id)) return workspaceRecords.get(workspace.id);

  const metasById = new Map();
  for (const meta of canvasIndex.filter((c) => c.workspaceId === workspace.id)) {
    metasById.set(meta.id, meta);
  }
  for (const id of workspace.canvasIds || []) {
    if (metasById.has(id)) continue;
    const meta = canvasIndexById.get(id);
    if (meta) metasById.set(id, meta);
  }

  const records = [];
  for (const meta of metasById.values()) {
    if (archivedCanvasIds.has(meta.id)) continue;
    const record = await loadCanvasRecord(meta);
    if (record) records.push(record);
  }
  workspaceRecords.set(workspace.id, records);
  return records;
}

function isShortTitleCanvas(title) {
  const normalized = normalizeText(title);
  return /^(d|-|[a-z])$/i.test(normalized);
}

function findTargetRecord(records, title) {
  const targetCode = publicCanvasCode(title);
  if (targetCode) {
    const byCode = records.find((record) => publicCanvasCode(record.title) === targetCode && !archivedCanvasIds.has(record.id));
    if (byCode) return byCode;
  }
  const key = normalizeKey(title);
  return records.find((record) => normalizeKey(record.title) === key && !archivedCanvasIds.has(record.id)) || null;
}

function createTargetRecord(workspace, records, title) {
  const id = `canvas-${now}-${crypto.randomUUID().slice(0, 8)}`;
  const record = {
    id,
    workspaceId: workspace.id,
    title,
    doc: {
      id,
      workspaceId: workspace.id,
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
  };
  records.push(record);
  workspace.canvasIds = Array.from(new Set([...(workspace.canvasIds || []), id]));
  dirtyCanvases.add(id);
  dirtyBundles.add(id);
  dirtyWorkspaces.add(workspace.id);
  report.counters.createdCanvases += 1;
  report.operations.push({ type: 'create_canvas', workspaceId: workspace.id, workspaceName: workspace.name, id, title });
  return record;
}

function recordExistingKeys(record) {
  const keys = new Set();
  for (const node of meaningfulNodes(record)) {
    keys.add(nodeDedupKey(node, nodeDataFor(record, node)));
  }
  return keys;
}

function copyNodes(source, target, nodes) {
  const existingKeys = recordExistingKeys(target);
  let copied = 0;
  let skipped = 0;
  let visibleCount = (target.doc.nodes || []).filter((node) => !node.isMain).length;

  for (const sourceNode of nodes) {
    const sourceData = nodeDataFor(source, sourceNode);
    const key = nodeDedupKey(sourceNode, sourceData);
    if (existingKeys.has(key)) {
      skipped += 1;
      continue;
    }

    let nodeId = sourceNode.id;
    if (!nodeId || (target.doc.nodes || []).some((node) => node.id === nodeId) || target.bundle[nodeId]) {
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
          migratedFromShortTitleCanvasId: source.id,
          migratedFromShortTitleCanvasTitle: source.title,
          migratedFromShortTitleWorkspaceId: source.workspaceId,
          migratedAt: new Date(now).toISOString(),
        },
      };
    }

    existingKeys.add(key);
    copied += 1;
    visibleCount += 1;
  }

  if (copied || skipped) {
    target.doc.updatedAt = now;
    dirtyCanvases.add(target.id);
    dirtyBundles.add(target.id);
  }
  report.counters.copiedNodes += copied;
  report.counters.skippedDuplicateNodes += skipped;
  return { copied, skipped };
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
  const workspaceById = new Map(workspaces.map((ws) => [ws.id, ws]));
  const canvasIndexById = new Map(canvases.map((canvas) => [canvas.id, canvas]));

  for (const meta of canvases) {
    if (!isShortTitleCanvas(meta.title)) continue;
    const workspace = workspaceById.get(meta.workspaceId);
    if (!workspace) {
      report.warnings.push(`short title canvas ${meta.id} has missing workspace ${meta.workspaceId}`);
      continue;
    }

    const source = await loadCanvasRecord(meta, { warnMissing: false });
    if (!source) {
      archivedCanvasIds.add(meta.id);
      report.counters.staleIndexEntriesRemoved += 1;
      report.operations.push({
        type: 'remove_stale_canvas_index',
        id: meta.id,
        title: meta.title,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
      });
      continue;
    }

    const records = await collectWorkspaceRecords(workspace, canvases, canvasIndexById);
    if (!records.some((record) => record.id === source.id)) records.push(source);
    if (archivedCanvasIds.has(source.id)) continue;

    const nodes = meaningfulNodes(source);
    if (!nodes.length) continue;

    report.counters.sourceCanvases += 1;
    const buckets = new Map();
    for (const node of nodes) {
      const data = nodeDataFor(source, node);
      const title = targetTitleForNode(data);
      if (!buckets.has(title)) buckets.set(title, []);
      buckets.get(title).push(node);
    }

    for (const [targetTitle, bucketNodes] of buckets) {
      let target = findTargetRecord(records, targetTitle);
      if (!target) target = createTargetRecord(workspace, records, targetTitle);
      const { copied, skipped } = copyNodes(source, target, bucketNodes);
      report.operations.push({
        type: 'move_nodes',
        sourceId: source.id,
        sourceTitle: source.title,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        targetId: target.id,
        targetTitle,
        copied,
        skippedDuplicateNodes: skipped,
        nodes: bucketNodes.map((node) => {
          const data = nodeDataFor(source, node);
          return {
            id: node.id,
            title: normalizeText(data?.title || node.data?.title || ''),
            company: companyText(data),
            participants: participantText(data),
          };
        }),
      });
    }

    archivedCanvasIds.add(source.id);
    dirtyWorkspaces.add(workspace.id);
    report.counters.archivedCanvases += 1;
    report.operations.push({
      type: 'archive_canvas',
      id: source.id,
      title: source.title,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      nodeCount: nodes.length,
      reason: 'short_low_signal_title_split',
    });
  }

  for (const workspace of workspaces) {
    if (!dirtyWorkspaces.has(workspace.id)) continue;
    const records = workspaceRecords.get(workspace.id) || [];
    const activeIds = new Set(records.filter((record) => !archivedCanvasIds.has(record.id)).map((record) => record.id));
    workspace.canvasIds = Array.from(new Set([...(workspace.canvasIds || []), ...activeIds]))
      .filter((id) => activeIds.has(id) || (!archivedCanvasIds.has(id) && canvasIndexById.has(id)));
    workspace.updatedAt = now;
  }

  canvases = canvases.filter((canvas) => !archivedCanvasIds.has(canvas.id));
  for (const records of workspaceRecords.values()) {
    for (const record of records) {
      if (archivedCanvasIds.has(record.id)) continue;
      if (dirtyCanvases.has(record.id)) ensureCanvasIndex(canvases, record);
    }
  }

  if (apply) {
    touchedPaths.add(workspacesPath);
    touchedPaths.add(canvasesPath);
    for (const workspaceId of dirtyWorkspaces) {
      touchedPaths.add(dataPath(`workspaces/${workspaceId}.json`));
    }
    for (const records of workspaceRecords.values()) {
      for (const record of records) {
        if (dirtyCanvases.has(record.id) || archivedCanvasIds.has(record.id)) {
          touchedPaths.add(dataPath(`canvases/${record.id}.json`));
          touchedPaths.add(dataPath(`canvas-data/${record.id}.json`));
        }
      }
    }

    for (const name of touchedPaths) {
      await copyIfExists(name, `${backupPrefix}/${name}`);
    }

    for (const id of archivedCanvasIds) {
      await copyIfExists(dataPath(`canvases/${id}.json`), `${archivePrefix}/canvases/${id}.json`);
      await copyIfExists(dataPath(`canvas-data/${id}.json`), `${archivePrefix}/canvas-data/${id}.json`);
      await deleteIfExists(dataPath(`canvases/${id}.json`));
      await deleteIfExists(dataPath(`canvas-data/${id}.json`));
    }

    for (const records of workspaceRecords.values()) {
      for (const record of records) {
        if (archivedCanvasIds.has(record.id)) continue;
        if (dirtyCanvases.has(record.id)) {
          await writeJSON(dataPath(`canvases/${record.id}.json`), record.doc);
        }
        if (dirtyBundles.has(record.id)) {
          await writeJSON(dataPath(`canvas-data/${record.id}.json`), record.bundle);
        }
      }
    }

    for (const workspace of workspaces) {
      if (dirtyWorkspaces.has(workspace.id)) {
        const existingDoc = await readJSON(dataPath(`workspaces/${workspace.id}.json`), {});
        await writeJSON(dataPath(`workspaces/${workspace.id}.json`), {
          ...existingDoc,
          ...workspace,
          canvasIds: workspace.canvasIds,
          updatedAt: workspace.updatedAt,
        });
      }
    }
    await writeJSON(workspacesPath, workspaces);
    await writeJSON(canvasesPath, canvases);
  }

  const reportDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migration-reports');
  await fs.mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `short-title-canvas-cleanup-${apply ? 'apply' : 'dry-run'}-${stamp}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    reportPath,
    counters: report.counters,
    backupPrefix: report.backupPrefix,
    archivePrefix: report.archivePrefix,
    warnings: report.warnings,
    operations: report.operations.map((operation) => ({
      type: operation.type,
      workspaceName: operation.workspaceName,
      sourceTitle: operation.sourceTitle,
      targetTitle: operation.targetTitle,
      copied: operation.copied,
      id: operation.id,
      title: operation.title,
      nodeCount: operation.nodeCount,
    })),
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
