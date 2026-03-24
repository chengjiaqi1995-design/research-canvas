/**
 * 企业微信消息接收路由
 * 用于接收企业微信应用的消息，自动创建笔记
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../utils/db';

const router = Router();

// 企业微信配置（从环境变量读取）
const getConfig = () => ({
  corpId: process.env.WECHAT_WORK_CORP_ID || '',
  token: process.env.WECHAT_WORK_TOKEN || '',
  encodingAESKey: process.env.WECHAT_WORK_ENCODING_AES_KEY || '',
  agentId: process.env.WECHAT_WORK_AGENT_ID || '',
});

/**
 * 解密企业微信消息
 */
function decryptMessage(encryptedMsg: string, encodingAESKey: string): string {
  try {
    // AESKey = Base64_Decode(EncodingAESKey + "=")
    const aesKey = Buffer.from(encodingAESKey + '=', 'base64');
    const iv = aesKey.slice(0, 16);
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
    decipher.setAutoPadding(false);
    
    let decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedMsg, 'base64')),
      decipher.final()
    ]);
    
    // 去除 PKCS7 填充
    const pad = decrypted[decrypted.length - 1];
    decrypted = decrypted.slice(0, decrypted.length - pad);
    
    // 去除前16字节随机数
    decrypted = decrypted.slice(16);
    
    // 获取消息长度（4字节）
    const msgLen = decrypted.readUInt32BE(0);
    
    // 提取消息内容
    const message = decrypted.slice(4, 4 + msgLen).toString('utf8');
    
    return message;
  } catch (error) {
    console.error('解密消息失败:', error);
    return '';
  }
}

/**
 * 验证签名
 */
function verifySignature(token: string, timestamp: string, nonce: string, encrypt: string, msgSignature: string): boolean {
  const arr = [token, timestamp, nonce, encrypt].sort();
  const str = arr.join('');
  const hash = crypto.createHash('sha1').update(str).digest('hex');
  return hash === msgSignature;
}

/**
 * 解析 XML 消息
 */
function parseXML(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  const regex = /<(\w+)><!\[CDATA\[(.*?)\]\]><\/\1>|<(\w+)>(.*?)<\/\3>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const key = match[1] || match[3];
    const value = match[2] || match[4];
    result[key] = value;
  }
  return result;
}

/**
 * GET 请求 - 验证 URL（企业微信配置时会调用）
 */
router.get('/callback', (req: Request, res: Response) => {
  const config = getConfig();
  
  const { msg_signature, timestamp, nonce, echostr } = req.query as {
    msg_signature: string;
    timestamp: string;
    nonce: string;
    echostr: string;
  };
  
  console.log('📩 企业微信 URL 验证请求:', { timestamp, nonce });
  
  if (!config.token || !config.encodingAESKey) {
    console.error('❌ 企业微信配置缺失');
    return res.status(500).send('配置错误');
  }
  
  // 验证签名
  if (!verifySignature(config.token, timestamp, nonce, echostr, msg_signature)) {
    console.error('❌ 签名验证失败');
    return res.status(403).send('签名验证失败');
  }
  
  // 解密 echostr
  const decrypted = decryptMessage(echostr, config.encodingAESKey);
  console.log('✅ URL 验证成功');
  
  res.send(decrypted);
});

/**
 * POST 请求 - 接收消息
 */
router.post('/callback', async (req: Request, res: Response) => {
  const config = getConfig();
  
  const { msg_signature, timestamp, nonce } = req.query as {
    msg_signature: string;
    timestamp: string;
    nonce: string;
  };
  
  console.log('📩 收到企业微信消息');
  
  try {
    // 解析请求体中的 XML
    let body = '';
    if (typeof req.body === 'string') {
      body = req.body;
    } else if (req.body && req.body.xml) {
      // 某些 XML 解析器会把内容放在 xml 字段
      body = req.body.xml;
    } else {
      // 原始 XML 字符串
      body = JSON.stringify(req.body);
    }
    
    // 从 XML 中提取加密消息
    const encryptMatch = body.match(/<Encrypt><!\[CDATA\[(.*?)\]\]><\/Encrypt>/);
    if (!encryptMatch) {
      console.error('❌ 无法提取加密消息');
      return res.send('success');
    }
    
    const encryptedMsg = encryptMatch[1];
    
    // 验证签名
    if (!verifySignature(config.token, timestamp, nonce, encryptedMsg, msg_signature)) {
      console.error('❌ 消息签名验证失败');
      return res.send('success');
    }
    
    // 解密消息
    const decryptedXml = decryptMessage(encryptedMsg, config.encodingAESKey);
    if (!decryptedXml) {
      console.error('❌ 消息解密失败');
      return res.send('success');
    }
    
    console.log('📝 解密后的消息:', decryptedXml);
    
    // 解析消息内容
    const msgData = parseXML(decryptedXml);
    const { MsgType, Content, FromUserName } = msgData;
    
    console.log('📨 消息类型:', MsgType, '发送者:', FromUserName);
    
    // 只处理文本消息
    if (MsgType === 'text' && Content) {
      console.log('📝 消息内容:', Content);
      
      // 查找或创建用户（使用企业微信用户ID）
      // 这里简化处理，使用一个默认用户或根据企业微信用户ID关联
      // 你可以后续扩展，让用户绑定自己的账号
      
      // 先查找是否有绑定的用户
      let userId: string | null = null;
      
      // 查找企业微信绑定记录（如果有的话）
      // 这里简化为查找第一个用户，实际应该做用户绑定
      const firstUser = await prisma.user.findFirst();
      if (firstUser) {
        userId = firstUser.id;
      }
      
      if (!userId) {
        console.error('❌ 没有可用的用户账号');
        return res.send('success');
      }
      
      // 创建笔记
      const transcription = await prisma.transcription.create({
        data: {
          fileName: `微信笔记-${Content.substring(0, 20)}${Content.length > 20 ? '...' : ''}`,
          filePath: '',
          fileSize: Buffer.byteLength(Content, 'utf8'),
          aiProvider: 'text',
          status: 'completed',
          transcriptText: Content,
          type: 'note',
          userId,
        },
      });
      
      console.log('✅ 笔记创建成功:', transcription.id);
    }
    
    // 企业微信要求返回 success
    res.send('success');
    
  } catch (error) {
    console.error('❌ 处理消息错误:', error);
    res.send('success');
  }
});

/**
 * 健康检查
 */
router.get('/health', (req: Request, res: Response) => {
  const config = getConfig();
  res.json({
    status: 'ok',
    configured: !!(config.corpId && config.token && config.encodingAESKey),
    corpId: config.corpId ? '已配置' : '未配置',
    token: config.token ? '已配置' : '未配置',
    encodingAESKey: config.encodingAESKey ? '已配置' : '未配置',
  });
});

export default router;

