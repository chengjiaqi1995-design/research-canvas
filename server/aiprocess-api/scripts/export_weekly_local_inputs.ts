import fs from 'fs';
import path from 'path';
import { Storage } from '@google-cloud/storage';
import prisma from '../src/utils/db';

const userId = process.env.RC_USER_ID || '104921709359061938941';
const bucketName = process.env.RC_SETTINGS_BUCKET || 'gen-lang-client-0634831802-uploads-asia';
const startArg = process.argv[2] || '2026-05-11';
const endArg = process.argv[3] || '2026-05-17';
const start = new Date(`${startArg}T00:00:00.000+08:00`);
const end = new Date(`${endArg}T23:59:59.999+08:00`);
const rangeKey = `${startArg}_${endArg}`;
const rangeLabel = `${startArg} 00:00:00 - ${endArg} 23:59:59 SGT`;
const outDir = path.resolve(process.cwd(), `../../tmp/local-weekly-inputs/${rangeKey}`);

type Note = {
  id: string;
  fileName: string | null;
  summary: string | null;
  translatedSummary: string | null;
  transcriptText: string | null;
  industry: string | null;
  organization: string | null;
  topic: string | null;
  tags: string[] | null;
  type: string | null;
  status: string | null;
  createdAt: Date;
  actualDate: Date | null;
};

function stripHtml(input = '') {
  return String(input)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function isGenericTitle(input = '') {
  const text = stripHtml(input);
  return !text || /^(?:源|来源|source)\s*\d+(?:\s*[·\-–—]\s*AI\s*(?:总结|summary|summaries))?$/i.test(text);
}

function title(note: Note) {
  const fileName = stripHtml(note.fileName || '');
  if (!isGenericTitle(fileName)) return fileName;
  const topic = stripHtml(note.topic || '');
  if (!isGenericTitle(topic)) return topic;
  const organization = stripHtml(note.organization || '');
  const industry = stripHtml(note.industry || '');
  if (organization && industry) return `${industry} - ${organization}`;
  return organization || industry || '未命名 note';
}

function industry(note: Note) {
  return stripHtml(note.industry || '未分类');
}

function preferred(note: Note) {
  return stripHtml(note.translatedSummary || note.summary || note.transcriptText || '');
}

function slugRef(index: number) {
  return `REF${String(index).padStart(2, '0')}`;
}

function yamlValue(input: unknown) {
  return JSON.stringify(input ?? '');
}

async function loadWeeklySkill() {
  const [content] = await new Storage().bucket(bucketName).file(`${userId}/settings/ai.json`).download();
  const settings = JSON.parse(content.toString());
  const weeklySkill = (settings.skills || []).find((skill: any) => skill.name === '周报skill');
  if (!weeklySkill?.content) throw new Error('Research Canvas skill "周报skill" not found in settings.');
  return weeklySkill.content;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.join(outDir, 'notes'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'skills'), { recursive: true });

  const [weeklySkill, notes] = await Promise.all([
    loadWeeklySkill(),
    prisma.transcription.findMany({
      where: {
        userId,
        status: 'completed',
        createdAt: { gte: start, lte: end },
        type: { notIn: ['weekly-summary', 'daily-summary'] },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        fileName: true,
        summary: true,
        translatedSummary: true,
        transcriptText: true,
        industry: true,
        organization: true,
        topic: true,
        createdAt: true,
        actualDate: true,
        tags: true,
        type: true,
        status: true,
      },
    }) as Promise<Note[]>,
  ]);

  if (!notes.length) throw new Error(`No Research Canvas notes found for ${rangeLabel}`);

  const sourceIndex = notes.map((note, index) => ({
    ref: `REF${index + 1}`,
    id: note.id,
    fileName: note.fileName || '',
    title: title(note),
    industry: industry(note),
    organization: note.organization || '',
    topic: note.topic || '',
    type: note.type || '',
    status: note.status || '',
    createdAt: note.createdAt.toISOString(),
    actualDate: note.actualDate?.toISOString() || '',
    preferredChars: preferred(note).length,
    summaryChars: stripHtml(note.summary || '').length,
    translatedSummaryChars: stripHtml(note.translatedSummary || '').length,
    transcriptTextChars: stripHtml(note.transcriptText || '').length,
    localPath: `notes/${slugRef(index + 1)}.md`,
  }));

  const references = sourceIndex.map((item, index) => ({
    refNumber: index + 1,
    ref: item.ref,
    id: item.id,
    title: item.title,
    fileName: item.title,
    summary: '',
    translatedSummary: '',
    industry: item.industry,
    organization: item.organization,
    date: item.createdAt,
    sourceType: 'aiprocess-transcription',
    canvasId: '',
    workspaceId: '',
    workspaceName: '',
  }));

  for (const [index, note] of notes.entries()) {
    const item = sourceIndex[index];
    const noteMd = `---
ref: ${yamlValue(item.ref)}
id: ${yamlValue(note.id)}
title: ${yamlValue(item.title)}
fileName: ${yamlValue(note.fileName || '')}
industry: ${yamlValue(item.industry)}
organization: ${yamlValue(note.organization || '')}
topic: ${yamlValue(note.topic || '')}
type: ${yamlValue(note.type || '')}
status: ${yamlValue(note.status || '')}
createdAt: ${yamlValue(note.createdAt.toISOString())}
actualDate: ${yamlValue(note.actualDate?.toISOString() || '')}
tags: ${yamlValue(note.tags || [])}
---

# ${item.ref} ${item.title}

## Preferred Input

${preferred(note)}

## translatedSummary

${stripHtml(note.translatedSummary || '')}

## summary

${stripHtml(note.summary || '')}

## transcriptText

${stripHtml(note.transcriptText || '')}
`;
    fs.writeFileSync(path.join(outDir, item.localPath), noteMd);
  }

  const sourcePack = `# Local Research Canvas Weekly Input Pack

Range: ${rangeLabel}
Count: ${notes.length}
Skill: 周报skill
Data source: Research Canvas notes downloaded to local files

${notes.map((note, index) => {
  const item = sourceIndex[index];
  return `## [${item.ref}] ${item.title}
- id: ${note.id}
- industry: ${item.industry}
- organization: ${note.organization || ''}
- createdAt: ${note.createdAt.toISOString()}
- localPath: ${item.localPath}

${preferred(note)}`;
}).join('\n\n---\n\n')}`;

  const manifest = {
    rangeLabel,
    start: start.toISOString(),
    end: end.toISOString(),
    userId,
    noteCount: notes.length,
    skillName: '周报skill',
    skillPath: 'skills/research-canvas-weekly-skill.md',
    sourcePackPath: 'source-pack.md',
    sourceIndexPath: 'source-index.json',
    referencesPath: 'references.json',
    notesDir: 'notes',
    generatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(outDir, 'skills/research-canvas-weekly-skill.md'), weeklySkill);
  fs.writeFileSync(path.join(outDir, 'source-pack.md'), sourcePack);
  fs.writeFileSync(path.join(outDir, 'source-index.json'), JSON.stringify(sourceIndex, null, 2));
  fs.writeFileSync(path.join(outDir, 'references.json'), JSON.stringify(references, null, 2));
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(JSON.stringify({
    outDir,
    rangeLabel,
    noteCount: notes.length,
    skillPath: path.join(outDir, 'skills/research-canvas-weekly-skill.md'),
    sourcePack: path.join(outDir, 'source-pack.md'),
    sourceIndex: path.join(outDir, 'source-index.json'),
    references: path.join(outDir, 'references.json'),
    notesDir: path.join(outDir, 'notes'),
  }, null, 2));
}

main().finally(async () => prisma.$disconnect());
