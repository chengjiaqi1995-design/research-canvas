#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
实时语音转录 Python 服务
支持两种 SDK API:
  1. Recognition API (paraformer-realtime-v2, fun-asr-realtime 等)
  2. OmniRealtimeConversation API (qwen3-asr-flash-realtime)
通过 stdin/stdout 与 Node.js 后端通信
"""

import sys
import json
import struct
import math
import time
import re
import io
import base64
from typing import Optional, Dict, Any

# 修复 Windows 编码问题：强制使用 UTF-8
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=True)
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace', line_buffering=True)
    sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8', errors='replace')

try:
    import dashscope
    from dashscope.audio.asr import Recognition, RecognitionCallback, RecognitionResult
except ImportError:
    print(json.dumps({"type": "error", "message": "缺少依赖库 dashscope，请运行: pip install dashscope"}))
    sys.exit(1)

# 尝试导入 Qwen Omni API (需要 dashscope >= 1.25.6)
HAS_OMNI = False
try:
    from dashscope.audio.qwen_omni import (
        OmniRealtimeConversation,
        OmniRealtimeCallback,
        MultiModality,
        AudioFormat,
    )
    from dashscope.audio.qwen_omni.omni_realtime import TranscriptionParams
    HAS_OMNI = True
except ImportError:
    print("DEBUG: dashscope.audio.qwen_omni 不可用，qwen3-asr-flash-realtime 将不可用", file=sys.stderr)

# 使用 qwen3-asr-flash-realtime 的模型列表
OMNI_MODELS = {'qwen3-asr-flash-realtime'}


def send_stdout_message(message: Dict[str, Any]):
    """发送消息到 stdout"""
    try:
        message["serverTime"] = int(time.time() * 1000)
        print(json.dumps(message, ensure_ascii=False))
        sys.stdout.flush()
    except Exception as e:
        print(json.dumps({"type": "error", "message": f"发送消息失败: {e}"}), file=sys.stderr)


# ============================================================
# Recognition API 回调 (paraformer / fun-asr)
# ============================================================
class TranscriptionCallback(RecognitionCallback):
    """转录回调处理器 (Recognition API)"""

    def __init__(self, service):
        self.service = service
        self.current_sentence_id = None
        self.committed_offset = 0
        self.last_text_content = ""
        self.last_text_change_time = time.time()

    def on_open(self):
        print(f"DEBUG: on_open 回调被调用", file=sys.stderr)
        send_stdout_message({"type": "status", "message": "[ASR] Connection established, transcribing..."})

    def on_close(self):
        print(f"DEBUG: on_close 回调被调用", file=sys.stderr)
        send_stdout_message({"type": "status", "message": "[ASR] Connection closed"})

    def on_error(self, result):
        print(f"DEBUG: on_error 回调被调用, result: {result}", file=sys.stderr)
        send_stdout_message({"type": "error", "message": str(result)})

    def on_event(self, result: RecognitionResult):
        """事件处理 - 三层漏斗策略"""
        t4_sdk_callback = int(time.time() * 1000)

        if not result or not hasattr(result, 'output') or not result.output:
            return
        if not hasattr(result.output, 'sentence') or not result.output.sentence:
            return

        sentence = result.output.sentence
        if not isinstance(sentence, dict):
            if hasattr(sentence, '__dict__'):
                sentence = sentence.__dict__
            else:
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

        if text:
            print(f"DEBUG: 收到文本: {text}, is_end: {is_end}, sid: {sid}", file=sys.stderr)

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
                send_stdout_message({
                    "type": "commit",
                    "speaker_id": spk_id,
                    "text": commit_chunk,
                    **timestamp_data
                })

            rem = ""
            if self.committed_offset < len(text):
                rem = text[self.committed_offset:]
            send_stdout_message({
                "type": "partial",
                "speaker_id": spk_id,
                "text": rem,
                **timestamp_data
            })
            self.last_text_change_time = current_time
        else:
            send_stdout_message({
                "type": "partial",
                "speaker_id": spk_id,
                "text": display_text,
                **timestamp_data
            })


# ============================================================
# OmniRealtimeConversation 回调 (qwen3-asr-flash-realtime)
# ============================================================
if HAS_OMNI:
    class QwenAsrCallback(OmniRealtimeCallback):
        """Qwen3-ASR 实时回调处理器"""

        def __init__(self, service):
            self.service = service
            self.last_partial_text = ""

        def on_open(self):
            print("DEBUG: [QwenASR] on_open", file=sys.stderr)
            send_stdout_message({"type": "status", "message": "[ASR] Connection established, transcribing..."})

        def on_close(self, code=None, msg=None):
            print(f"DEBUG: [QwenASR] on_close code={code} msg={msg}", file=sys.stderr)
            send_stdout_message({"type": "status", "message": "[ASR] Connection closed"})

        def on_error(self, error=None):
            print(f"DEBUG: [QwenASR] on_error: {error}", file=sys.stderr)
            send_stdout_message({"type": "error", "message": str(error)})

        def on_event(self, response):
            """处理 qwen3-asr-flash-realtime 事件"""
            t4_sdk_callback = int(time.time() * 1000)

            if not isinstance(response, dict):
                try:
                    if hasattr(response, '__dict__'):
                        response = response.__dict__
                    else:
                        response = json.loads(str(response))
                except:
                    print(f"DEBUG: [QwenASR] 无法解析 response: {response}", file=sys.stderr)
                    return

            event_type = response.get('type', '')

            timestamp_data = {
                "t3NodeReceive": getattr(self.service, '_last_t3_node_receive', 0),
                "t3NodeSend": getattr(self.service, '_last_t3_node_send', 0),
                "t3PythonReceive": getattr(self.service, '_last_t3_python_receive', 0),
                "t4SdkCallback": t4_sdk_callback,
            }

            # 最终转录结果
            if event_type == 'conversation.item.input_audio_transcription.completed':
                text = response.get('transcript', '')
                if text and text.strip():
                    print(f"DEBUG: [QwenASR] commit: {text}", file=sys.stderr)
                    send_stdout_message({
                        "type": "commit",
                        "speaker_id": 0,
                        "text": text.strip(),
                        **timestamp_data
                    })
                    send_stdout_message({
                        "type": "partial",
                        "speaker_id": 0,
                        "text": "",
                        **timestamp_data
                    })
                    self.last_partial_text = ""

            # 中间转录结果 (partial)
            elif event_type == 'conversation.item.input_audio_transcription.text':
                text = response.get('stash', '') or response.get('text', '')
                if text:
                    print(f"DEBUG: [QwenASR] partial: {text}", file=sys.stderr)
                    self.last_partial_text = text
                    send_stdout_message({
                        "type": "partial",
                        "speaker_id": 0,
                        "text": text,
                        **timestamp_data
                    })

            # Session 相关事件
            elif event_type in ('session.created', 'session.updated'):
                print(f"DEBUG: [QwenASR] {event_type}", file=sys.stderr)

            else:
                # 其他事件类型
                print(f"DEBUG: [QwenASR] unknown event: {event_type}, keys: {list(response.keys())}", file=sys.stderr)


# ============================================================
# 统一服务接口
# ============================================================
class RealtimeTranscriptionService:
    """实时转录服务 - 根据模型自动选择 Recognition 或 OmniRealtimeConversation API"""

    def __init__(self):
        self.recognizer = None  # Recognition or OmniRealtimeConversation
        self.callback = None
        self.api_key: Optional[str] = None
        self.model_name: str = "paraformer-realtime-v2"
        self.noise_threshold: int = 500
        self.initialized: bool = False
        self.audio_packet_count = 0
        self.use_omni: bool = False  # 是否使用 OmniRealtimeConversation API

        # 时间戳字段
        self._last_t3_node_send = 0
        self._last_t3_python_receive = 0
        self._last_t3_node_receive = 0

    def calculate_rms(self, data: bytes) -> int:
        count = len(data) // 2
        if count == 0:
            return 0
        try:
            shorts = struct.unpack(f"<{count}h", data)
        except Exception:
            return 0
        sum_squares = sum(s * s for s in shorts)
        return int(math.sqrt(sum_squares / count))

    def initialize(self, api_key: str, model_name: str, noise_threshold: int = 500,
                   turn_detection_silence_duration_ms: int = 800,
                   turn_detection_threshold: float = 0.4,
                   disable_speaker_diarization: bool = False):
        """初始化识别器"""
        if self.initialized:
            return

        self.api_key = api_key
        self.model_name = model_name
        self.noise_threshold = noise_threshold
        self.use_omni = model_name in OMNI_MODELS

        dashscope.api_key = api_key
        print(f"DEBUG: api_key length={len(api_key)}, model={model_name}, use_omni={self.use_omni}, silence={turn_detection_silence_duration_ms}ms", file=sys.stderr)

        if self.use_omni:
            self._init_omni(turn_detection_silence_duration_ms)
        else:
            self._init_recognition(model_name, turn_detection_silence_duration_ms,
                                   turn_detection_threshold, disable_speaker_diarization)

    def _init_recognition(self, model_name, silence_ms, threshold, no_diarization):
        """使用 Recognition API (paraformer / fun-asr)"""
        self.callback = TranscriptionCallback(self)
        self.recognizer = Recognition(
            model=model_name,
            format='pcm',
            sample_rate=16000,
            callback=self.callback,
            enable_turn_detection=True,
            turn_detection_threshold=threshold,
            turn_detection_silence_duration_ms=silence_ms,
            disabling_speaker_diarization=no_diarization,
        )
        try:
            self.recognizer.start()
            self.initialized = True
            send_stdout_message({"type": "status", "message": "[SDK] Started successfully"})
        except Exception as e:
            send_stdout_message({"type": "error", "message": f"[SDK] Start failed: {e}"})
            print(f"DEBUG: SDK Start Exception: {e}", file=sys.stderr)
            raise

    def _init_omni(self, silence_ms):
        """使用 OmniRealtimeConversation API (qwen3-asr-flash-realtime)"""
        if not HAS_OMNI:
            send_stdout_message({"type": "error", "message": "qwen3-asr-flash-realtime 需要 dashscope >= 1.25.6，请运行: pip install --upgrade dashscope"})
            raise RuntimeError("OmniRealtimeConversation not available")

        self.callback = QwenAsrCallback(self)

        # 检测是否需要用国际版 endpoint
        # 默认使用北京 endpoint
        ws_url = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime'

        try:
            self.recognizer = OmniRealtimeConversation(
                model=self.model_name,
                url=ws_url,
                callback=self.callback,
            )
        except Exception as e:
            print(f"DEBUG: OmniRealtimeConversation 创建失败: {e}", file=sys.stderr)
            send_stdout_message({"type": "error", "message": f"[SDK] 创建 Qwen ASR 实例失败: {e}"})
            raise

        try:
            transcription_params = TranscriptionParams(
                language='zh',
                sample_rate=16000,
                input_audio_format='pcm',
            )

            self.recognizer.update_session(
                output_modalities=[MultiModality.TEXT],
                input_audio_format=AudioFormat.PCM_16000HZ_MONO_16BIT,
                enable_turn_detection=True,
                turn_detection_type='server_vad',
                turn_detection_silence_duration_ms=silence_ms,
                enable_input_audio_transcription=True,
                transcription_params=transcription_params,
            )

            self.recognizer.connect()
            self.initialized = True
            send_stdout_message({"type": "status", "message": "[SDK] Started successfully"})
            print("DEBUG: [QwenASR] 连接成功", file=sys.stderr)
        except Exception as e:
            send_stdout_message({"type": "error", "message": f"[SDK] Qwen ASR start failed: {e}"})
            print(f"DEBUG: [QwenASR] Start Exception: {e}", file=sys.stderr)
            raise

    def send_audio_frame(self, pcm_data: bytes, t3_node_send: int = 0, t3_python_receive: int = 0, t3_node_receive: int = 0):
        """发送音频帧"""
        if not self.initialized or not self.recognizer:
            return

        self.audio_packet_count += 1
        rms = self.calculate_rms(pcm_data)

        if self.audio_packet_count % 50 == 0:
            send_stdout_message({
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

        try:
            if self.use_omni:
                # OmniRealtimeConversation 需要 base64 编码
                audio_b64 = base64.b64encode(pcm_data).decode('ascii')
                self.recognizer.append_audio(audio_b64)
            else:
                # Recognition API 直接发送 bytes
                self.recognizer.send_audio_frame(pcm_data)
        except Exception as e:
            print(f"DEBUG: Send Audio Exception: {e}", file=sys.stderr)
            send_stdout_message({
                "type": "error",
                "message": f"发送音频帧失败: {str(e)}"
            })

    def stop(self):
        """停止识别器"""
        if self.recognizer:
            try:
                if self.use_omni:
                    self.recognizer.end_session(timeout=5)
                    self.recognizer.close()
                else:
                    self.recognizer.stop()
            except:
                pass
        self.initialized = False
        send_stdout_message({"type": "status", "message": "[ASR] Stopped"})


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
                    api_key = message.get("api_key")
                    model_name = message.get("model_name", "paraformer-realtime-v2")
                    noise_threshold = message.get("noise_threshold", 500)
                    turn_detection_silence_duration_ms = message.get("turn_detection_silence_duration_ms", 800)
                    turn_detection_threshold = message.get("turn_detection_threshold", 0.4)
                    disable_speaker_diarization = message.get("disable_speaker_diarization", False)

                    if not api_key:
                        send_stdout_message({"type": "error", "message": "API密钥未提供"})
                        continue

                    service.initialize(api_key, model_name, noise_threshold,
                                       turn_detection_silence_duration_ms,
                                       turn_detection_threshold,
                                       disable_speaker_diarization)

                elif msg_type == "audio":
                    t3_python_receive = int(time.time() * 1000)
                    t3_node_send = message.get("t3NodeSend", 0)
                    t3_node_receive = message.get("t3NodeReceive", 0)
                    audio_data_b64 = message.get("data")
                    if audio_data_b64:
                        pcm_data = base64.b64decode(audio_data_b64)
                        service.send_audio_frame(pcm_data, t3_node_send, t3_python_receive, t3_node_receive)

                elif msg_type == "stop":
                    service.stop()
                    break

                elif msg_type == "ping":
                    send_stdout_message({"type": "pong"})

            except json.JSONDecodeError as e:
                send_stdout_message({"type": "error", "message": f"JSON解析错误: {e}"})
            except Exception as e:
                send_stdout_message({"type": "error", "message": f"处理错误: {e}"})

    except KeyboardInterrupt:
        service.stop()
    except Exception as e:
        send_stdout_message({"type": "error", "message": f"服务错误: {e}"})
    finally:
        service.stop()


if __name__ == "__main__":
    main()
