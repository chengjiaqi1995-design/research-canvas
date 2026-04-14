import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { IncomingMessage } from 'http';
import jwt from 'jsonwebtoken';
import { PythonTranscriptionService } from './pythonTranscriptionService';
import prisma from '../utils/db';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/**
 * 验证 JWT token 并返回 userId
 * 用于 WebSocket 连接认证（兼容 Google Cloud Run）
 */
function verifyToken(token: string): string | null {
  // Dev token bypass
  if (token === 'dev-token') {
    return 'dev-local';
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sub?: string; userId?: string };
    // server.js signs JWT with { sub }, aiprocess-api signs with { userId }
    return decoded.sub || decoded.userId || null;
  } catch (error) {
    console.error('JWT 验证失败:', (error as Error).message, '| token length:', token.length);
    return null;
  }
}

interface RealtimeSession {
  pythonService: PythonTranscriptionService | null;
  transcriptionId: string;
  partialText: string;
  finalText: string;
  createdAt: number;
  lastActivity: number;
  audioChunksReceived: number;
  apiKey: string; // 客户端提供的 API 密钥，用于后续摘要生成
}

const sessions = new Map<WebSocket, RealtimeSession>();

/**
 * 初始化WebSocket服务器用于实时转录
 * 使用 Python DashScope SDK 服务
 */
export function initializeWebSocketServer(server: Server) {
  const wss = new WebSocketServer({
    server,
    path: '/ws/realtime-transcription'
  });

  wss.on('connection', async (clientWs: WebSocket, req: IncomingMessage) => {
    console.log('新的WebSocket连接建立');

    try {
      // 从 URL 查询参数中解析配置
      const url = new URL(req.url || '', `http://${req.headers.host || 'localhost:3001'}`);
      const params = url.searchParams;
      
      const apiProvider = (params.get('apiProvider') || 'qwen') as 'qwen' | 'google-speech' | 'echo-transcribe' | 'echo-transcribe-ga';
      
      if (apiProvider !== 'qwen' && apiProvider !== 'echo-transcribe' && apiProvider !== 'echo-transcribe-ga') {
        throw new Error(`当前仅支持通义千问 (qwen)、Echo Transcribe 和 Echo Transcribe GA，其他API提供商待实现`);
      }

      // 根据 provider 设置默认模型
      let defaultModel = 'paraformer-realtime-v2';
      if (apiProvider === 'echo-transcribe' || apiProvider === 'echo-transcribe-ga') {
        defaultModel = 'fun-asr-realtime-2025-11-07'; // echo-transcribe 默认模型
      }

      const transcriptionConfig = {
        sampleRate: params.get('sampleRate') ? parseInt(params.get('sampleRate')!) : 16000,
        enableSpeakerDiarization: params.get('enableSpeakerDiarization') !== 'false',
        enablePunctuation: params.get('enablePunctuation') !== 'false',
        model: params.get('model') || defaultModel,
        noiseThreshold: params.get('noiseThreshold') ? parseInt(params.get('noiseThreshold')!) : 500,
        // Echo Transcribe 专用参数
        commitTimeout: params.get('commitTimeout') ? parseFloat(params.get('commitTimeout')!) : undefined,
        silenceThreshold: params.get('silenceThreshold') ? parseFloat(params.get('silenceThreshold')!) : undefined,
        turnDetectionSilenceDuration: params.get('turnDetectionSilenceDuration') ? parseInt(params.get('turnDetectionSilenceDuration')!) : undefined,
        turnDetectionThreshold: params.get('turnDetectionThreshold') ? parseFloat(params.get('turnDetectionThreshold')!) : undefined,
      };

      // 获取API密钥（必须由客户端提供，不再回退到环境变量）
      let apiKey = params.get('apiKey') || '';

      if (!apiKey) {
        let providerName = '通义千问';
        if (apiProvider === 'echo-transcribe') {
          providerName = 'Echo Transcribe';
        } else if (apiProvider === 'echo-transcribe-ga') {
          providerName = 'Echo Transcribe GA';
        }
        throw new Error(`${providerName} API密钥未配置`);
      }

      console.log('📋 转录配置:', { ...transcriptionConfig, apiProvider });
      console.log('🔑 API密钥:', apiKey ? `${apiKey.substring(0, 8)}...` : '未配置');

      // 从查询参数获取 JWT token 并验证（兼容 Google Cloud Run）
      // WebSocket 不支持标准的 Authorization header，需要通过查询参数传递 token
      const token = params.get('token');
      if (!token) {
        throw new Error('未提供认证令牌');
      }

      const userId = verifyToken(token);
      if (!userId) {
        throw new Error('认证令牌无效或已过期');
      }

      console.log('👤 用户已认证:', userId);

      // 创建转录记录
      const currentDate = new Date();
      const dateStr = currentDate.toISOString().slice(0, 19).replace('T', ' ').replace(/-/g, '/');
      const transcription = await prisma.transcription.create({
        data: {
          fileName: dateStr,
          filePath: '', // 实时录音没有文件路径
          fileSize: 0,
          aiProvider: apiProvider, // 使用实际的 provider
          status: 'processing',
          userId, // 关联到当前用户
        },
      });

      // 创建 Python 转录服务，根据 provider 选择不同的脚本
      let provider: 'qwen' | 'echo-transcribe' | 'echo-transcribe-ga' = 'qwen';
      if (apiProvider === 'echo-transcribe') {
        provider = 'echo-transcribe';
      } else if (apiProvider === 'echo-transcribe-ga') {
        provider = 'echo-transcribe-ga';
      }
      
      const pythonService = new PythonTranscriptionService({
        apiKey,
        modelName: transcriptionConfig.model,
        noiseThreshold: transcriptionConfig.noiseThreshold,
        provider,
        // Echo Transcribe 专用参数
        commitTimeout: transcriptionConfig.commitTimeout,
        silenceThreshold: transcriptionConfig.silenceThreshold,
        turnDetectionSilenceDuration: transcriptionConfig.turnDetectionSilenceDuration,
        turnDetectionThreshold: transcriptionConfig.turnDetectionThreshold,
      });

      // 初始化会话
      const now = Date.now();
      const session: RealtimeSession = {
        pythonService,
        transcriptionId: transcription.id,
        partialText: '',
        finalText: '',
        createdAt: now,
        lastActivity: now,
        audioChunksReceived: 0,
        apiKey, // 保存客户端提供的 API 密钥
      };

      sessions.set(clientWs, session);

      // 设置 Python 服务事件监听
      pythonService.on('status', (message: string) => {
        console.log('📢 Python服务状态:', message);
        if (clientWs.readyState === WebSocket.OPEN) {
          if (message.includes('启动成功') || message.includes('连接建立')) {
            clientWs.send(JSON.stringify({
              type: 'init',
              transcriptionId: transcription.id,
            }));
          }
          clientWs.send(JSON.stringify({
            type: 'status',
            message,
          }));
        }
      });

      pythonService.on('commit', (data: { speakerId: number; text: string; [key: string]: any }) => {
        const t5NodeSend = Date.now(); // T5: Node.js 发送给前端的时间
        session.finalText += data.text + ' ';
        session.partialText = '';
        
        // ✅ 调试：打印 speakerId 信息
        console.log(`📤 发送给前端: speakerId=${data.speakerId}, text=${data.text.substring(0, 50)}`);
        
        if (clientWs.readyState === WebSocket.OPEN) {
          const message: any = {
            type: 'transcription',
            isFinal: true,
            ...data, // 包含所有时间戳字段和 text
            text: data.text, // 确保 text 使用正确的值
            t5NodeSend, // 添加 Node 发送时间
            speakerId: data.speakerId !== undefined && data.speakerId !== null && data.speakerId !== 0 
              ? String(data.speakerId) 
              : undefined, // ✅ 修复：只有当 speakerId 有效时才发送
          };
          clientWs.send(JSON.stringify(message));
        }
      });

      pythonService.on('partial', (data: { speakerId: number; text: string; [key: string]: any }) => {
        const t5NodeSend = Date.now(); // T5: Node.js 发送给前端的时间
        session.partialText = data.text;
        
        if (clientWs.readyState === WebSocket.OPEN) {
          const message: any = {
            type: 'transcription',
            isFinal: false,
            ...data, // 包含所有时间戳字段和 text
            text: data.text, // 确保 text 使用正确的值
            t5NodeSend, // 添加 Node 发送时间
          };
          // 只有当 speakerId 不为 0 时才发送（0 表示未启用说话人分离或只有一个说话人）
          if (data.speakerId && data.speakerId !== 0) {
            message.speakerId = String(data.speakerId); // 转换为字符串格式
          }
          clientWs.send(JSON.stringify(message));
        }
      });

      pythonService.on('error', (error: string) => {
        console.error('❌ Python服务错误:', error);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({
            type: 'error',
            error,
          }));
        }
      });

      pythonService.on('close', () => {
        console.log('Python服务已关闭');
      });

      // 启动 Python 服务
      try {
        await pythonService.start();
        console.log('✅ Python转录服务已启动');
      } catch (error: any) {
        console.error('❌ 启动Python服务失败:', error);
        clientWs.send(JSON.stringify({
          type: 'error',
          error: `启动转录服务失败: ${error.message}`,
        }));
        clientWs.close();
        return;
      }

      console.log(`实时转录会话创建: ${transcription.id}`);
    } catch (error: any) {
      console.error('创建实时转录会话失败:', error);
      clientWs.send(JSON.stringify({
        type: 'error',
        error: error.message,
      }));
      clientWs.close();
      return;
    }

    // 处理接收到的音频数据（从客户端浏览器）
    clientWs.on('message', async (data: Buffer) => {
      const session = sessions.get(clientWs);
      if (!session || !session.pythonService) return;

      try {
        const t3NodeReceive = Date.now(); // T3: Node.js 接收前端音频的时间
        session.lastActivity = t3NodeReceive;
        session.audioChunksReceived++;
        
        // ✅ 修复：降低日志频率，每 100 包记录一次（避免日志爆炸）
        if (session.audioChunksReceived % 100 === 0) {
          console.log(`📥 [${new Date(t3NodeReceive).toISOString().split('T')[1]}.${t3NodeReceive % 1000}] Node接收音频包 #${session.audioChunksReceived}`);
        }

        // 将音频数据发送给 Python 服务（带上时间戳）
        if (Buffer.isBuffer(data)) {
          session.pythonService.sendAudioFrame(data, t3NodeReceive);
        } else {
          console.warn('⚠️ 收到非二进制音频数据，已忽略');
        }
      } catch (error: any) {
        console.error('❌ 处理音频数据错误:', error);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({
            type: 'error',
            error: `音频数据处理错误: ${error.message}`,
          }));
        }
      }
    });

    // 处理客户端连接关闭
    clientWs.on('close', async () => {
      const session = sessions.get(clientWs);
      if (session) {
        try {
          // 停止 Python 服务
          if (session.pythonService) {
            session.pythonService.stop();
          }

          // 更新数据库
          const duration = Math.floor((Date.now() - session.createdAt) / 1000);
          if (session.finalText.trim()) {
            const finalText = session.finalText.trim();
            
            // 生成总结
            const { generateSummary, generateTitleAndTopics } = require('./aiService');
            let summary = '';
            let newFileName = '';
            let relatedTopics: string[] = [];
            
            try {
              // 获取转录记录以获取AI服务提供商
              const transcription = await prisma.transcription.findUnique({
                where: { id: session.transcriptionId },
              });
              
              if (transcription) {
                // 生成总结
                console.log(`📊 开始为实时转录生成总结: ${session.transcriptionId}`);
                const apiKey = session.apiKey;
                summary = await generateSummary(finalText, transcription.aiProvider as any, apiKey);
                console.log(`✅ 总结生成完成，长度: ${summary.length} 字符`);
                
                // 生成标题和相关主题
                console.log(`📝 开始生成标题和相关主题: ${session.transcriptionId}`);
                const titleAndTopics = await generateTitleAndTopics(
                  finalText,
                  summary,
                  transcription.aiProvider as any,
                  apiKey,
                  new Date(transcription.createdAt)
                );
                newFileName = titleAndTopics.title;
                relatedTopics = titleAndTopics.topics;
                console.log(`✅ 标题和主题生成成功: ${newFileName}`);
              }
            } catch (error: any) {
              console.error('⚠️ 生成总结或标题失败:', error.message);
              // 如果生成失败，使用默认值
              const transcription = await prisma.transcription.findUnique({
                where: { id: session.transcriptionId },
              });
              if (transcription) {
                newFileName = transcription.fileName;
              }
            }
            
            // 将转录文本存储为JSON格式（与文件转录保持一致）
            const transcriptData = {
              text: finalText,
              segments: []
            };
            const transcriptTextJson = JSON.stringify(transcriptData);
            
            await prisma.transcription.update({
              where: { id: session.transcriptionId },
              data: {
                transcriptText: transcriptTextJson,
                summary: summary || '',
                fileName: newFileName || undefined,
                tags: relatedTopics.length > 0 ? JSON.stringify(relatedTopics) : undefined,
                status: 'completed',
                duration,
              } as any,
            });
            console.log(`✅ 实时转录会话完成: ${session.transcriptionId} (${duration}秒, ${session.audioChunksReceived}个音频块)`);
          } else {
            await prisma.transcription.update({
              where: { id: session.transcriptionId },
              data: {
                status: 'failed',
                errorMessage: '未接收到转录内容',
                duration,
              },
            });
            console.log(`⚠️ 实时转录会话失败: ${session.transcriptionId} (未接收到内容)`);
          }
        } catch (error: any) {
          console.error('关闭会话错误:', error);
        }

        sessions.delete(clientWs);
      }
    });

    // 处理客户端错误
    clientWs.on('error', (error) => {
      console.error('客户端WebSocket错误:', error);
      const session = sessions.get(clientWs);
      if (session) {
        if (session.pythonService) {
          session.pythonService.stop();
        }
        sessions.delete(clientWs);
      }
    });
  });

  console.log('📡 WebSocket服务器已启动: /ws/realtime-transcription');

  return wss;
}
