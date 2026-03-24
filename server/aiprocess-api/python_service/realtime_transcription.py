#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
实时语音转录 Python 服务
使用 DashScope SDK 进行实时语音识别
通过 stdin/stdout 与 Node.js 后端通信
"""

import sys
import json
import struct
import math
import time
import re
import io
from typing import Optional, Dict, Any

# 修复 Windows 编码问题：强制使用 UTF-8
if sys.platform == 'win32':
    # Windows 上设置 stdout 和 stderr 为 UTF-8
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=True)
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace', line_buffering=True)
    sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8', errors='replace')

try:
    import dashscope
    from dashscope.audio.asr import Recognition, RecognitionCallback, RecognitionResult
except ImportError:
    print(json.dumps({"type": "error", "message": "缺少依赖库 dashscope，请运行: pip install dashscope"}))
    sys.exit(1)


class TranscriptionCallback(RecognitionCallback):
    """转录回调处理器"""
    
    def __init__(self, service):
        self.service = service  # 引用服务以获取时间戳
        self.current_sentence_id = None
        self.committed_offset = 0
        self.last_text_content = ""
        self.last_text_change_time = time.time()
    
    def on_open(self):
        """连接建立"""
        print(f"DEBUG: on_open 回调被调用", file=sys.stderr)
        self._send_message({"type": "status", "message": "[ASR] Connection established, transcribing..."})
    
    def on_close(self):
        """连接关闭"""
        print(f"DEBUG: on_close 回调被调用", file=sys.stderr)
        self._send_message({"type": "status", "message": "[ASR] Connection closed"})
    
    def on_error(self, result):
        """错误处理"""
        print(f"DEBUG: on_error 回调被调用, result: {result}", file=sys.stderr)
        self._send_message({"type": "error", "message": str(result)})
        print(f"DEBUG: SDK Error: {result}", file=sys.stderr)
    
    def on_event(self, result: RecognitionResult):
        """事件处理 - 实现三层漏斗策略（完全按照参考代码）"""
        t4_sdk_callback = int(time.time() * 1000) # T4: SDK 回调时间
        
        # 调试：记录所有回调事件，打印 result 的完整结构
        try:
            print(f"DEBUG: on_event 被调用, result 类型: {type(result)}", file=sys.stderr)
            if hasattr(result, '__dict__'):
                print(f"DEBUG: result.__dict__: {result.__dict__}", file=sys.stderr)
            if hasattr(result, 'output'):
                print(f"DEBUG: result.output 类型: {type(result.output)}, 值: {result.output}", file=sys.stderr)
                if hasattr(result.output, '__dict__'):
                    print(f"DEBUG: result.output.__dict__: {result.output.__dict__}", file=sys.stderr)
        except Exception as debug_err:
            print(f"DEBUG: 打印调试信息时出错: {debug_err}", file=sys.stderr)
        
        if not result:
            print(f"DEBUG: result 为空", file=sys.stderr)
            return
            
        if not hasattr(result, 'output') or not result.output:
            print(f"DEBUG: result.output 不存在或为空, result: {result}", file=sys.stderr)
            return
            
        if not hasattr(result.output, 'sentence') or not result.output.sentence:
            print(f"DEBUG: result.output.sentence 不存在或为空, result.output: {result.output}", file=sys.stderr)
            return
        
        sentence = result.output.sentence
        # 参考代码中，sentence 是一个字典
        # 如果 DashScope SDK 返回的是对象，需要转换为字典
        if not isinstance(sentence, dict):
            # 尝试转换为字典
            if hasattr(sentence, '__dict__'):
                sentence = sentence.__dict__
            else:
                # 使用属性访问并构建字典
                sentence = {
                    'text': getattr(sentence, 'text', ''),
                    'is_sentence_end': getattr(sentence, 'is_sentence_end', ''),
                    'sentence_id': getattr(sentence, 'sentence_id', None),
                    'speaker_id': getattr(sentence, 'speaker_id', 0),
                }
        
        text = sentence.get('text', '')
        is_end = str(sentence.get('is_sentence_end', '')).lower() == 'true'
        sid = sentence.get('sentence_id')
        spk_id = sentence.get('speaker_id', 0)
        
        # 调试：打印句子信息
        if text:
            print(f"DEBUG: 收到文本: {text}, is_end: {is_end}, sid: {sid}, spk_id: {spk_id}", file=sys.stderr)
        
        # 三层漏斗策略
        current_time = time.time()
        if text != self.last_text_content:
            self.last_text_change_time = current_time
            self.last_text_content = text
        
        logic_sil = current_time - self.last_text_change_time
        
        should_commit = False
        split_idx = -1
        
        if len(text) < self.committed_offset:
            self.committed_offset = 0
        display_text = text[self.committed_offset:]
        
        if not display_text:
            return

        # 1. 服务端信号
        if is_end:
            should_commit = True
            split_idx = len(text)
        
        # 2. 强标点
        elif not should_commit:
            match = re.search(r'([。？！])', display_text)
            if match and len(display_text) > 2:
                split_idx = self.committed_offset + match.end()
                should_commit = True
        
        # 3. 超时
        if not should_commit and logic_sil > 1.2:
            should_commit = True
            split_idx = len(text)

        # ID 变化
        if self.current_sentence_id is not None and sid != self.current_sentence_id:
            self.current_sentence_id = sid
            self.committed_offset = 0
            display_text = text

        if self.current_sentence_id is None:
            self.current_sentence_id = sid

        # 推送数据（携带所有时间戳）
        timestamp_data = {
            "t3NodeReceive": getattr(self.service, '_last_t3_node_receive', 0),
            "t3NodeSend": getattr(self.service, '_last_t3_node_send', 0),
            "t3PythonReceive": getattr(self.service, '_last_t3_python_receive', 0),
            "t4SdkCallback": t4_sdk_callback,
        }
        
        if should_commit:
            commit_chunk = text[self.committed_offset:split_idx]
            self.committed_offset = split_idx
            if commit_chunk.strip():
                self._send_message({
                    "type": "commit",
                    "speaker_id": spk_id,
                    "text": commit_chunk,
                    **timestamp_data
                })
            
            rem = ""
            if self.committed_offset < len(text):
                rem = text[self.committed_offset:]
            self._send_message({
                "type": "partial",
                "speaker_id": spk_id,
                "text": rem,
                **timestamp_data
            })
            self.last_text_change_time = current_time
        else:
            self._send_message({
                "type": "partial",
                "speaker_id": spk_id,
                "text": display_text,
                **timestamp_data
            })
    
    def _send_message(self, message: Dict[str, Any]):
        """发送消息到 stdout，带上 Python 时间戳 T4"""
        try:
            message["serverTime"] = int(time.time() * 1000)
            print(json.dumps(message, ensure_ascii=False))
            sys.stdout.flush()
        except Exception as e:
            print(json.dumps({"type": "error", "message": f"发送消息失败: {e}"}), file=sys.stderr)


class RealtimeTranscriptionService:
    """实时转录服务"""
    
    def __init__(self):
        self.recognizer: Optional[Recognition] = None
        self.callback: Optional[TranscriptionCallback] = None
        self.api_key: Optional[str] = None
        self.model_name: str = "paraformer-realtime-v2"
        self.noise_threshold: int = 500
        self.phy_silence_start: Optional[float] = None
        self.initialized: bool = False
        self.audio_packet_count = 0

    def calculate_rms(self, data: bytes) -> int:
        """计算音频 RMS 值（参考代码的calculate_rms函数）"""
        count = len(data) // 2
        if count == 0:
            return 0
        try:
            shorts = struct.unpack(f"<{count}h", data)
        except Exception:
            return 0
        sum_squares = sum(s * s for s in shorts)
        return int(math.sqrt(sum_squares / count))
    
    def initialize(self, api_key: str, model_name: str, noise_threshold: int = 500):
        """初始化识别器"""
        if self.initialized:
            return
        
        self.api_key = api_key
        self.model_name = model_name
        self.noise_threshold = noise_threshold
        
        dashscope.api_key = api_key
        self.callback = TranscriptionCallback(self)  # 传递 service 引用
        
        # 初始化时间戳字段
        self._last_t3_node_send = 0
        self._last_t3_python_receive = 0
        self._last_t3_node_receive = 0
        
        self.recognizer = Recognition(
            model=model_name,
            format='pcm',
            sample_rate=16000,
            callback=self.callback,
            enable_turn_detection=True,
            turn_detection_threshold=0.4,
            turn_detection_silence_duration_ms=800,
            disabling_speaker_diarization=False
        )
        
        try:
            self.recognizer.start()
            self.initialized = True
            self._send_message({"type": "status", "message": "[SDK] Started successfully"})
        except Exception as e:
            self._send_message({"type": "error", "message": f"[SDK] Start failed: {e}"})
            print(f"DEBUG: SDK Start Exception: {e}", file=sys.stderr)
            raise
    
    def send_audio_frame(self, pcm_data: bytes, t3_node_send: int = 0, t3_python_receive: int = 0, t3_node_receive: int = 0):
        """发送音频帧"""
        if not self.initialized:
            print(f"DEBUG: 服务未初始化，无法发送音频 (initialized={self.initialized})", file=sys.stderr)
            return
        
        if not self.recognizer:
            print(f"DEBUG: 识别器未创建，无法发送音频", file=sys.stderr)
            return
        
        self.audio_packet_count += 1
        rms = self.calculate_rms(pcm_data)
        
        # 每 50 包发送一个确认消息和调试信息
        if self.audio_packet_count % 50 == 0:
            self._send_message({
                "type": "debug_progress", 
                "packetId": self.audio_packet_count, 
                "rms": rms,
                "initialized": self.initialized,
                "msg": f"Python received audio packet #{self.audio_packet_count}, RMS: {rms}"
            })
            print(f"DEBUG: 发送音频包 #{self.audio_packet_count}, RMS: {rms}, 数据长度: {len(pcm_data)}", file=sys.stderr)
        
        # 保存时间戳供回调使用
        self._last_t3_node_send = t3_node_send
        self._last_t3_python_receive = t3_python_receive if t3_python_receive else int(time.time() * 1000)
        self._last_t3_node_receive = t3_node_receive
        
        # 发送音频帧到 SDK（与 echo-transcribe 一致，不进行 RMS 过滤，让 SDK 处理）
        try:
            self.recognizer.send_audio_frame(pcm_data)
        except Exception as e:
            print(f"DEBUG: Send Audio Exception: {e}", file=sys.stderr)
            self._send_message({
                "type": "error",
                "message": f"发送音频帧失败: {str(e)}"
            })
    
    def stop(self):
        """停止识别器"""
        if self.recognizer:
            try:
                self.recognizer.stop()
            except:
                pass
        self.initialized = False
        self._send_message({"type": "status", "message": "[ASR] Stopped"})
    
    def _send_message(self, message: Dict[str, Any]):
        """发送消息"""
        try:
            print(json.dumps(message, ensure_ascii=False))
            sys.stdout.flush()
        except Exception as e:
            print(json.dumps({"type": "error", "message": f"发送消息失败: {e}"}), file=sys.stderr)


def main():
    """主函数 - 通过 stdin/stdout 与 Node.js 通信"""
    service = RealtimeTranscriptionService()
    
    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            
            try:
                message = json.loads(line)
                msg_type = message.get("type")
                
                if msg_type == "init":
                    # 初始化识别器
                    api_key = message.get("api_key")
                    model_name = message.get("model_name", "paraformer-realtime-v2")
                    noise_threshold = message.get("noise_threshold", 500)
                    
                    if not api_key:
                        service._send_message({"type": "error", "message": "API密钥未提供"})
                        continue
                    
                    service.initialize(api_key, model_name, noise_threshold)
                
                elif msg_type == "audio":
                    # 接收音频数据（base64编码的PCM数据）
                    t3_python_receive = int(time.time() * 1000) # T3: Python 接收时间
                    t3_node_send = message.get("t3NodeSend", 0) # T3: Node 发送时间
                    t3_node_receive = message.get("t3NodeReceive", 0) # T3: Node 接收时间
                    audio_data_b64 = message.get("data")
                    if audio_data_b64:
                        import base64
                        pcm_data = base64.b64decode(audio_data_b64)
                        # 传递时间戳给 send_audio_frame
                        service.send_audio_frame(pcm_data, t3_node_send, t3_python_receive, t3_node_receive)
                    else:
                        # 调试：记录未收到音频数据的情况
                        print(f"DEBUG: 收到 audio 消息但 data 字段为空", file=sys.stderr)
                
                elif msg_type == "stop":
                    # 停止识别
                    service.stop()
                    break
                
                elif msg_type == "ping":
                    # 心跳检测
                    service._send_message({"type": "pong"})
                
            except json.JSONDecodeError as e:
                service._send_message({"type": "error", "message": f"JSON解析错误: {e}"})
            except Exception as e:
                service._send_message({"type": "error", "message": f"处理错误: {e}"})
    
    except KeyboardInterrupt:
        service.stop()
    except Exception as e:
        service._send_message({"type": "error", "message": f"服务错误: {e}"})
    finally:
        service.stop()


if __name__ == "__main__":
    main()

