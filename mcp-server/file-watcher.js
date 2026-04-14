#!/usr/bin/env node
/**
 * File Watcher — Auto-upload audio files to Research Canvas for transcription.
 *
 * Watches a directory (default: ~/Documents/for ai/) for new audio files,
 * uploads them via signed URL, and triggers transcription.
 *
 * Usage:
 *   node file-watcher.js
 *   WATCH_DIR=~/other/dir AI_PROVIDER=qwen node file-watcher.js
 */

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import os from "os";

// ─── Config ─────────────────────────────────────────────────
const WATCH_DIR = process.env.WATCH_DIR || path.join(os.homedir(), "Documents", "for ai");
const DONE_DIR = path.join(WATCH_DIR, "done");
const FAILED_DIR = path.join(WATCH_DIR, "failed");

const API_BASE =
  process.env.RC_API_BASE ||
  "https://research-canvas-api-208594497704.asia-southeast1.run.app/api";
const API_KEY = process.env.RC_API_KEY || "oc-api-jiaqi-2026-f8a3b7c1d9e2";
const AI_PROVIDER = process.env.AI_PROVIDER || "qwen";
const QWEN_MODEL = process.env.QWEN_MODEL || "qwen3-asr-flash-filetrans";
const MODEL_FOR_UPLOAD = AI_PROVIDER === "qwen" ? QWEN_MODEL : "gemini";

// API keys for transcription providers
const QWEN_API_KEY = process.env.QWEN_API_KEY || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

// Post-processing models (summary, metadata, etc.) — match frontend defaults
const SUMMARY_MODEL = process.env.SUMMARY_MODEL || "gemini-3-flash-preview";
const METADATA_MODEL = process.env.METADATA_MODEL || "gemini-3-flash-preview";

const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".ogg", ".webm", ".flac", ".aac", ".mp4"]);
const MIME_MAP = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".webm": "audio/webm",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
  ".mp4": "audio/mp4",
};

// Track files being processed to avoid duplicates
const processing = new Set();
// Debounce: wait for file to stop changing before processing
const pendingFiles = new Map(); // filename -> timeout

// ─── Helpers ───────────────────────────────────��────────────
async function apiRequest(urlPath, { method = "GET", body, rawBody, headers: extraHeaders } = {}) {
  const headers = {
    Authorization: `Bearer ${API_KEY}`,
    ...extraHeaders,
  };
  if (body) headers["Content-Type"] = "application/json";

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  if (rawBody) opts.body = rawBody;

  const res = await fetch(`${API_BASE}${urlPath}`, opts);
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) };
  } catch {
    return { ok: res.ok, status: res.status, data: { _raw: text } };
  }
}

function log(emoji, msg) {
  const ts = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  console.log(`[${ts}] ${emoji} ${msg}`);
}

async function ensureDir(dir) {
  try {
    await fsp.mkdir(dir, { recursive: true });
  } catch {}
}

async function moveFile(src, destDir) {
  await ensureDir(destDir);
  const dest = path.join(destDir, path.basename(src));
  // If dest exists, add timestamp
  let finalDest = dest;
  try {
    await fsp.access(dest);
    const ext = path.extname(dest);
    const base = path.basename(dest, ext);
    finalDest = path.join(destDir, `${base}_${Date.now()}${ext}`);
  } catch {}
  await fsp.rename(src, finalDest);
  return finalDest;
}

// ─── Upload Flow ─────────────────────────────────���──────────
async function processFile(filePath) {
  const fileName = path.basename(filePath);
  const ext = path.extname(fileName).toLowerCase();

  if (processing.has(filePath)) return;
  processing.add(filePath);

  log("📤", `开始处理: ${fileName}`);

  try {
    // Verify file still exists and is readable
    const stat = await fsp.stat(filePath);
    if (stat.size === 0) {
      log("⚠️", `文件为空，跳过: ${fileName}`);
      processing.delete(filePath);
      return;
    }

    const contentType = MIME_MAP[ext] || "audio/mpeg";

    // Step 1: Get signed upload URL
    log("🔑", `获取上传链接...`);
    const signedRes = await apiRequest(
      `/upload/signed-url?fileName=${encodeURIComponent(fileName)}&model=${MODEL_FOR_UPLOAD}&contentType=${encodeURIComponent(contentType)}`
    );

    if (!signedRes.ok || !signedRes.data?.data?.signedUrl) {
      throw new Error(`获取签名URL失败: ${JSON.stringify(signedRes.data)}`);
    }

    const { signedUrl, fileUrl, filePath: storagePath, storageType } = signedRes.data.data;

    // Step 2: Upload to cloud storage
    log("☁️", `上传到云存储 (${(stat.size / 1024 / 1024).toFixed(1)} MB)...`);
    const fileBuffer = await fsp.readFile(filePath);
    const uploadRes = await fetch(signedUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: fileBuffer,
    });

    if (!uploadRes.ok) {
      throw new Error(`云存储上传失败: ${uploadRes.status} ${uploadRes.statusText}`);
    }

    // Step 3: Confirm upload
    log("✅", `确认上传...`);
    const confirmRes = await apiRequest("/upload/confirm", {
      method: "POST",
      body: { filePath: storagePath, storageType },
    });

    if (!confirmRes.ok) {
      log("⚠️", `确认上传返回异常，继续尝试创建转录: ${JSON.stringify(confirmRes.data)}`);
    }

    // Step 4: Create transcription
    log("🎙️", `创建转录任务...`);
    const transcribeRes = await apiRequest("/transcriptions/from-url", {
      method: "POST",
      body: {
        fileUrl,
        fileName,
        fileSize: stat.size,
        aiProvider: AI_PROVIDER,
        storageType,
        qwenModel: AI_PROVIDER === "qwen" ? QWEN_MODEL : undefined,
        qwenApiKey: QWEN_API_KEY || undefined,
        geminiApiKey: GEMINI_API_KEY || undefined,
        summaryModel: SUMMARY_MODEL,
        metadataModel: METADATA_MODEL,
      },
    });

    if (!transcribeRes.ok) {
      throw new Error(`创建转录失败: ${JSON.stringify(transcribeRes.data)}`);
    }

    const transcriptionId = transcribeRes.data?.data?.id;
    log("🎉", `转录任务已创建: ${fileName} → ID: ${transcriptionId}`);

    // Move to done folder
    const movedTo = await moveFile(filePath, DONE_DIR);
    log("📁", `文件已移至: ${path.relative(WATCH_DIR, movedTo)}`);

  } catch (err) {
    log("❌", `处理失败: ${fileName} — ${err.message}`);
    try {
      await moveFile(filePath, FAILED_DIR);
      log("📁", `文件已移至 failed 目录`);
    } catch (moveErr) {
      log("⚠️", `移动文件失败: ${moveErr.message}`);
    }
  } finally {
    processing.delete(filePath);
  }
}

// ─── File Watcher ─────────────────────────────────��─────────
async function scanExisting() {
  try {
    const files = await fsp.readdir(WATCH_DIR);
    const audioFiles = files.filter(f => {
      const ext = path.extname(f).toLowerCase();
      return AUDIO_EXTENSIONS.has(ext) && !f.startsWith(".");
    });

    if (audioFiles.length > 0) {
      log("📂", `发现 ${audioFiles.length} 个已有音频文件`);
      for (const f of audioFiles) {
        await processFile(path.join(WATCH_DIR, f));
      }
    }
  } catch (err) {
    log("❌", `扫描目录失败: ${err.message}`);
  }
}

function startWatching() {
  log("👀", `监控目录: ${WATCH_DIR}`);
  log("⚙️", `AI Provider: ${AI_PROVIDER} | 上传模型: ${MODEL_FOR_UPLOAD}`);
  log("📁", `完成后移至: ${DONE_DIR}`);
  log("─", "等待新文件...");

  fs.watch(WATCH_DIR, (eventType, filename) => {
    if (!filename) return;
    const ext = path.extname(filename).toLowerCase();
    if (!AUDIO_EXTENSIONS.has(ext) || filename.startsWith(".")) return;

    const filePath = path.join(WATCH_DIR, filename);

    // Debounce: wait 2 seconds after last change to ensure file is fully written
    if (pendingFiles.has(filePath)) {
      clearTimeout(pendingFiles.get(filePath));
    }

    pendingFiles.set(
      filePath,
      setTimeout(async () => {
        pendingFiles.delete(filePath);
        try {
          await fsp.access(filePath);
          await processFile(filePath);
        } catch {
          // File was deleted before we could process it
        }
      }, 2000)
    );
  });
}

// ─── Main ───────────────────────────────────────────────────
async function main() {
  // Ensure watch dir exists
  try {
    await fsp.access(WATCH_DIR);
  } catch {
    log("❌", `监控目录不存在: ${WATCH_DIR}`);
    process.exit(1);
  }

  await ensureDir(DONE_DIR);
  await ensureDir(FAILED_DIR);

  // Process existing files first
  await scanExisting();

  // Then watch for new ones
  startWatching();
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGINT", () => {
  log("👋", "停止监控");
  process.exit(0);
});
process.on("SIGTERM", () => {
  log("👋", "停止监控");
  process.exit(0);
});
