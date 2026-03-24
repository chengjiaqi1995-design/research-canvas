import { Request, Response } from 'express';
import archiver from 'archiver';
import prisma from '../utils/db';

/**
 * 一键导出备份
 * 生成 ZIP 包含：notes/*.md + metadata.json + projects.json + backup_info.json
 */
export async function exportBackup(req: Request, res: Response) {
    const userId = req.userId!;

    console.log(`📦 开始生成备份: userId=${userId}`);

    // 1. 查询所有数据
    const [transcriptions, projects, user] = await Promise.all([
        prisma.transcription.findMany({
            where: { userId },
            include: { project: { select: { id: true, name: true } } },
            orderBy: { createdAt: 'desc' },
        }),
        prisma.project.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
        }),
        prisma.user.findUnique({
            where: { id: userId },
            select: { email: true, name: true },
        }),
    ]);

    console.log(`📊 备份数据: ${transcriptions.length} 条笔记, ${projects.length} 个项目`);

    // 2. 设置 HTTP 响应头
    const dateStr = new Date().toISOString().slice(0, 10); // 2026-02-07
    const zipFileName = `AI-Notebook-Backup-${dateStr}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"`);

    // 3. 创建 archiver 流式 ZIP
    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.on('error', (err) => {
        console.error('❌ ZIP 生成错误:', err);
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: 'ZIP 生成失败' });
        }
    });

    archive.on('end', () => {
        console.log(`✅ 备份完成: ${archive.pointer()} bytes`);
    });

    // 管道到响应
    archive.pipe(res);

    const folderPrefix = `AI-Notebook-Backup-${dateStr}`;

    // 4. 生成每条笔记的 .md 文件
    const fileNameCounter: Record<string, number> = {};

    for (const t of transcriptions) {
        // 生成安全的文件名
        let baseName = sanitizeFileName(t.fileName || '未命名笔记');

        // 处理重名
        if (fileNameCounter[baseName] !== undefined) {
            fileNameCounter[baseName]++;
            baseName = `${baseName}_${fileNameCounter[baseName]}`;
        } else {
            fileNameCounter[baseName] = 0;
        }

        const mdContent = generateMarkdown(t);
        archive.append(mdContent, { name: `${folderPrefix}/notes/${baseName}.md` });
    }

    // 5. 生成 metadata.json（结构化数据，可用于恢复）
    const metadataJson = transcriptions.map((t) => ({
        id: t.id,
        fileName: t.fileName,
        fileSize: t.fileSize,
        duration: t.duration,
        aiProvider: t.aiProvider,
        status: t.status,
        type: t.type,
        topic: (t as any).topic,
        organization: (t as any).organization,
        intermediary: (t as any).intermediary,
        industry: (t as any).industry,
        country: (t as any).country,
        participants: (t as any).participants,
        eventDate: (t as any).eventDate,
        tags: safeParseTags(t.tags),
        projectId: t.projectId,
        projectName: (t as any).project?.name || null,
        actualDate: (t as any).actualDate,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
    }));

    archive.append(JSON.stringify(metadataJson, null, 2), {
        name: `${folderPrefix}/metadata.json`,
    });

    // 6. 生成 projects.json
    const projectsJson = projects.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
    }));

    archive.append(JSON.stringify(projectsJson, null, 2), {
        name: `${folderPrefix}/projects.json`,
    });

    // 7. 生成 backup_info.json
    const backupInfo = {
        backupDate: new Date().toISOString(),
        version: '1.0',
        userEmail: user?.email || 'unknown',
        userName: user?.name || 'unknown',
        totalNotes: transcriptions.length,
        totalProjects: projects.length,
        completedNotes: transcriptions.filter((t) => t.status === 'completed').length,
        noteTypes: {
            transcription: transcriptions.filter((t) => t.type === 'transcription').length,
            merge: transcriptions.filter((t) => t.type === 'merge').length,
        },
    };

    archive.append(JSON.stringify(backupInfo, null, 2), {
        name: `${folderPrefix}/backup_info.json`,
    });

    // 8. 完成 ZIP
    await archive.finalize();
}

/**
 * 将 Transcription 转为 Markdown 字符串
 */
function generateMarkdown(t: any): string {
    const lines: string[] = [];

    // 标题
    lines.push(`# ${t.fileName || '未命名笔记'}`);
    lines.push('');

    // 元数据块
    const metaParts: string[] = [];
    if (t.topic) metaParts.push(`**主题**: ${t.topic}`);
    if (t.organization) metaParts.push(`**公司**: ${t.organization}`);
    if (t.intermediary) metaParts.push(`**中介**: ${t.intermediary}`);
    if (t.industry) metaParts.push(`**行业**: ${t.industry}`);
    if (t.country) metaParts.push(`**国家**: ${t.country}`);

    if (metaParts.length > 0) {
        lines.push(`> ${metaParts.join(' | ')}`);
    }

    const metaParts2: string[] = [];
    if (t.participants) metaParts2.push(`**参与人**: ${t.participants}`);
    if (t.eventDate) metaParts2.push(`**日期**: ${t.eventDate}`);

    const tags = safeParseTags(t.tags);
    if (tags.length > 0) metaParts2.push(`**标签**: ${tags.join(', ')}`);

    if (metaParts2.length > 0) {
        lines.push(`> ${metaParts2.join(' | ')}`);
    }

    lines.push(`> **创建时间**: ${formatDate(t.createdAt)} | **AI 服务**: ${t.aiProvider}`);
    if (t.project?.name) {
        lines.push(`> **项目**: ${t.project.name}`);
    }

    lines.push('');

    // Notes (English)
    if (t.summary && t.summary.trim()) {
        lines.push('---');
        lines.push('');
        lines.push('## Notes');
        lines.push('');
        lines.push(htmlToPlainText(t.summary));
        lines.push('');
    }

    // Notes (中文)
    if (t.translatedSummary && t.translatedSummary.trim()) {
        lines.push('---');
        lines.push('');
        lines.push('## Notes (中文)');
        lines.push('');
        lines.push(htmlToPlainText(t.translatedSummary));
        lines.push('');
    }

    // 原始转录
    if (t.transcriptText && t.transcriptText.trim()) {
        lines.push('---');
        lines.push('');
        lines.push('## 原始转录');
        lines.push('');
        try {
            const parsed = JSON.parse(t.transcriptText);
            if (parsed.text) {
                lines.push(parsed.text);
            } else {
                lines.push(t.transcriptText);
            }
        } catch {
            lines.push(t.transcriptText);
        }
        lines.push('');
    }

    return lines.join('\n');
}

/**
 * HTML → 纯文本/Markdown（简单转换，不引入额外依赖）
 */
function htmlToPlainText(html: string): string {
    if (!html) return '';

    let text = html;

    // 块级元素转换
    text = text.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n');
    text = text.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n');
    text = text.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n');
    text = text.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n');
    text = text.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1\n');
    text = text.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1\n');

    // 粗体和斜体
    text = text.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
    text = text.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
    text = text.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
    text = text.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');

    // 列表项
    text = text.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');

    // 段落和换行
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/p>/gi, '\n\n');
    text = text.replace(/<p[^>]*>/gi, '');

    // 移除其他 HTML 标签
    text = text.replace(/<[^>]+>/g, '');

    // HTML 实体
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    text = text.replace(/&nbsp;/g, ' ');

    // 清理多余的空行
    text = text.replace(/\n{3,}/g, '\n\n');

    return text.trim();
}

/**
 * 安全文件名：移除不合法字符
 */
function sanitizeFileName(name: string): string {
    return name
        .replace(/[<>:"/\\|?*]/g, '_')  // 替换 Windows 非法字符
        .replace(/\s+/g, ' ')           // 合并空格
        .trim()
        .slice(0, 100);                 // 限制长度
}

/**
 * 安全解析 tags JSON
 */
function safeParseTags(tags: string | null | undefined): string[] {
    if (!tags) return [];
    try {
        const parsed = JSON.parse(tags);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

/**
 * 格式化日期
 */
function formatDate(date: Date | string): string {
    const d = new Date(date);
    return d.toISOString().slice(0, 10);
}
