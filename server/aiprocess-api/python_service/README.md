# Python 实时转录服务

此服务使用 DashScope SDK 进行实时语音识别，通过 stdin/stdout 与 Node.js 后端通信。

## 安装依赖

```bash
pip install dashscope
```

或使用国内镜像源：

```bash
pip install dashscope -i https://pypi.tuna.tsinghua.edu.cn/simple
```

## 使用方法

服务通过 stdin/stdout 与 Node.js 通信，使用 JSON 格式的消息。

### 消息格式

**初始化消息（从 Node.js 发送到 Python）：**
```json
{
  "type": "init",
  "api_key": "your-api-key",
  "model_name": "fun-asr-realtime-2025-11-07",
  "noise_threshold": 500
}
```

**音频数据消息（从 Node.js 发送到 Python）：**
```json
{
  "type": "audio",
  "data": "base64-encoded-pcm-data"
}
```

**停止消息（从 Node.js 发送到 Python）：**
```json
{
  "type": "stop"
}
```

**状态消息（从 Python 发送到 Node.js）：**
```json
{
  "type": "status",
  "message": "✅ 连接建立，正在转录..."
}
```

**提交文本消息（从 Python 发送到 Node.js）：**
```json
{
  "type": "commit",
  "speaker_id": 0,
  "text": "这是最终文本"
}
```

**临时文本消息（从 Python 发送到 Node.js）：**
```json
{
  "type": "partial",
  "speaker_id": 0,
  "text": "这是临时文本"
}
```

**错误消息（从 Python 发送到 Node.js）：**
```json
{
  "type": "error",
  "message": "错误信息"
}
```

## 功能特性

- 使用 DashScope SDK 的 Recognition 类进行实时语音识别
- 实现三层漏斗策略（服务端信号、强标点、超时）进行文本提交
- 支持噪音过滤（基于 RMS 值）
- 支持说话人分离
- 支持标点符号

## 参考

参考代码：https://github.com/chengjiaqi1995-design/echo-transcribe

