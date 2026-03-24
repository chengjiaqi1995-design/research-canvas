const opencc = require('opencc-js');

/**
 * 检测文本是否包含中文，并将繁体中文转换为简体中文
 * 如果文本不包含中文，则原样返回
 */
export function convertTraditionalToSimplified(text: string): string {
  if (!text || typeof text !== 'string') {
    return text;
  }

  // 检测是否包含中文字符
  const hasChinese = /[\u4e00-\u9fa5]/.test(text);

  if (!hasChinese) {
    // 不包含中文，直接返回
    return text;
  }

  try {
    // 创建繁体转简体的转换器
    const converter = opencc.Converter({ from: 'tw', to: 'cn' });

    // 转换文本
    return converter(text);
  } catch (error) {
    // 如果转换失败，返回原文本
    console.warn('繁体转简体失败，返回原文本:', error);
    return text;
  }
}

/**
 * 解析 Gemini 转录文本，提取分段和时间戳信息
 */
export function parseGeminiTranscript(text: string): { text: string; segments: Array<{ text: string; speakerId: number; startTime: number; endTime?: number }> } {
  const rawSegments: Array<{ text: string; speakerId: number; startTime: number; endTime?: number }> = [];
  let fullText = '';

  // 按行分割
  const lines = text.split('\n').filter(line => line.trim());

  // 匹配多种时间戳格式
  const timePatterns = [
    /\[(\d{1,2}):(\d{2})\]/,                    // [MM:SS] 或 [M:SS]
    /\[(\d{1,2}):(\d{2}):(\d{2})\]/,            // [HH:MM:SS]
    /^(\d{1,2}):(\d{2})\s/,                     // MM:SS 开头
    /^(\d{1,2}):(\d{2}):(\d{2})\s/,             // HH:MM:SS 开头
    /\((\d{1,2}):(\d{2})\)/,                    // (MM:SS)
    /【(\d{1,2}):(\d{2})】/,                    // 【MM:SS】
    /(\d{1,2})分(\d{2})秒/,                     // X分XX秒
  ];

  // 匹配多种说话人格式
  const speakerPatterns = [
    /\[说话人\s*(\d+)\]/,                       // [说话人1] 或 [说话人 1]
    /【说话人\s*(\d+)】/,                       // 【说话人1】
    /\[Speaker\s*(\d+)\]/i,                     // [Speaker 1]
    /\[Spk\s*(\d+)\]/i,                         // [Spk1]
    /说话人\s*(\d+)\s*[:\uff1a\s]/,             // 说话人1: 或 说话人1：
    /Speaker\s*(\d+)\s*[:\s]/i,                 // Speaker 1:
    /\*\*说话人\s*(\d+)\*\*/,                   // **说话人1**
    /发言人\s*(\d+)\s*[:\uff1a\s]/,             // 发言人1:
    /讲者\s*(\d+)\s*[:\uff1a\s]/,               // 讲者1:
  ];

  let currentSpeakerId = 0;
  const speakerMap = new Map<string, number>();
  let lastValidTime = 0;

  for (const line of lines) {
    let segmentText = line.trim();
    let startTime = lastValidTime; // 默认使用上一个有效时间
    let speakerId = currentSpeakerId;
    let foundTime = false;

    // 提取时间戳（尝试所有格式）
    for (const pattern of timePatterns) {
      const timeMatch = segmentText.match(pattern);
      if (timeMatch) {
        if (timeMatch.length === 4 && pattern.source.includes(':')) {
          // HH:MM:SS 格式
          const hours = parseInt(timeMatch[1], 10);
          const minutes = parseInt(timeMatch[2], 10);
          const seconds = parseInt(timeMatch[3], 10);
          startTime = hours * 3600 + minutes * 60 + seconds;
        } else if (pattern.source.includes('分')) {
          // X分XX秒 格式
          const minutes = parseInt(timeMatch[1], 10);
          const seconds = parseInt(timeMatch[2], 10);
          startTime = minutes * 60 + seconds;
        } else {
          // MM:SS 格式
          const minutes = parseInt(timeMatch[1], 10);
          const seconds = parseInt(timeMatch[2], 10);
          startTime = minutes * 60 + seconds;
        }
        lastValidTime = startTime;
        foundTime = true;
        segmentText = segmentText.replace(pattern, '').trim();
        break;
      }
    }

    // 提取说话人（尝试多种格式）
    for (const pattern of speakerPatterns) {
      const speakerMatch = segmentText.match(pattern);
      if (speakerMatch) {
        const speakerNum = parseInt(speakerMatch[1], 10);
        const speakerLabel = `说话人${speakerNum}`;
        if (!speakerMap.has(speakerLabel)) {
          speakerMap.set(speakerLabel, speakerNum - 1); // 转为 0-based
        }
        speakerId = speakerMap.get(speakerLabel)!;
        currentSpeakerId = speakerId;
        segmentText = segmentText.replace(pattern, '').trim();
        break;
      }
    }

    // 清理文本（移除多余的空白和标点）
    segmentText = segmentText.replace(/^[:\uff1a\-\s*]+/, '').trim();

    // 移除可能的 markdown 格式
    segmentText = segmentText.replace(/^\*\*|\*\*$/g, '').trim();

    if (segmentText && segmentText.length > 1) {
      rawSegments.push({
        text: segmentText,
        speakerId,
        startTime,
        endTime: undefined
      });
      fullText += segmentText + ' ';
    }
  }

  // 如果没有解析到分段，返回空数组
  if (rawSegments.length === 0) {
    return { text, segments: [] };
  }

  // 按时间排序，确保顺序正确
  rawSegments.sort((a, b) => a.startTime - b.startTime);

  // 合并短段落：同一说话人的连续段落，如果合并后不超过 400 字符就合并
  const mergedSegments: Array<{ text: string; speakerId: number; startTime: number; endTime?: number }> = [];
  const maxSegmentLength = 400;
  const minSegmentLength = 50; // 最小段落长度，太短就合并

  for (const segment of rawSegments) {
    if (mergedSegments.length === 0) {
      mergedSegments.push({ ...segment });
      continue;
    }

    const lastSegment = mergedSegments[mergedSegments.length - 1];
    const combinedLength = lastSegment.text.length + segment.text.length + 1;

    // 如果是同一说话人，且合并后不超过 400 字符，或者当前段太短（< 50字符），就合并
    if (lastSegment.speakerId === segment.speakerId &&
      (combinedLength <= maxSegmentLength || segment.text.length < minSegmentLength)) {
      lastSegment.text += ' ' + segment.text;
      // 结束时间用新段落的时间
    } else {
      mergedSegments.push({ ...segment });
    }
  }

  // 计算每个分段的结束时间（使用下一个分段的开始时间）
  for (let i = 0; i < mergedSegments.length - 1; i++) {
    mergedSegments[i].endTime = mergedSegments[i + 1].startTime;
  }

  // 重新生成 fullText
  fullText = mergedSegments.map(s => s.text).join(' ');

  return {
    text: fullText.trim(),
    segments: mergedSegments
  };
}
