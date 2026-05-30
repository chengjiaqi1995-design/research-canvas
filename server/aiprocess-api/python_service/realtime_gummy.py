#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gummy 实时语音识别 + 翻译 一体化服务

DashScope `gummy-realtime-v1` 在一次 WebSocket 调用里同时返回
ASR 文本和译文。stdio 协议与 realtime_transcription.py 保持兼容：

  入站:
    {"type": "init", "api_key", "model_name", "language",
     "translation_target", "max_end_silence_ms"}
    {"type": "audio", "data": <base64-pcm>, "t3NodeSend", "t3NodeReceive"}
    {"type": "stop"}

  出站:
    {"type": "status",  "message"}
    {"type": "partial", "speaker_id", "text"}                       # ASR 部分
    {"type": "commit",  "speaker_id", "text"}                       # ASR 整句
    {"type": "translation_partial", "speaker_id", "text", "segment_index"}
    {"type": "translation_commit",  "speaker_id", "text", "segment_index"}
    {"type": "error",   "message"}

`segment_index` 与 ASR 的 commit 顺序一一对应，前端按 index 关联两栏。
"""

import sys
import json
import struct
import math
import time
import io
import base64
from typing import Optional, Dict, Any

# Windows UTF-8 修复
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=True)
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace', line_buffering=True)
    sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8', errors='replace')

try:
    import dashscope
    from dashscope.audio.asr import (
        TranslationRecognizerRealtime,
        TranslationRecognizerCallback,
    )
except ImportError as e:
    print(json.dumps({"type": "error", "message": f"缺少依赖库或 Gummy 不可用 (需要 dashscope>=1.25.6): {e}"}))
    sys.exit(1)


def send_stdout_message(message: Dict[str, Any]):
    try:
        message["serverTime"] = int(time.time() * 1000)
        print(json.dumps(message, ensure_ascii=False))
        sys.stdout.flush()
    except Exception as e:
        print(json.dumps({"type": "error", "message": f"发送消息失败: {e}"}), file=sys.stderr)


def normalize_source_language(language: Optional[str]) -> str:
    """前端语言代码 → Gummy source_language 值."""
    value = (language or 'zh').strip().lower()
    if value in ('zh', 'en', 'ja', 'ko'):
        return value
    if value in ('mixed', 'ja-en', 'en-ja'):
        return 'auto'
    return 'zh'


class GummyCallback(TranslationRecognizerCallback):
    """Gummy 回调

    - 每个事件可能携带 transcription_result 和/或 translation_result
    - 同一 sentence_id 期间，text 会持续增长；is_sentence_end=True 时为整句
    - 翻译 sentence_id 与 ASR 对齐，但 is_sentence_end 可能稍晚（翻译延迟）
    """

    def __init__(self, service, target_language: str = 'en'):
        self.service = service
        self.target_language = target_language
        # ASR 与 翻译分别跟踪 sentence_id，避免互相干扰
        self._asr_last_sid = None
        self._asr_last_partial = ""
        self._tr_last_sid = None
        self._tr_last_partial = ""
        # ASR commit 时分配 segment_index，翻译 commit 时引用同一个
        # 假设两边按 sentence_id 顺序对齐（Gummy 保证）
        self._sid_to_segment_index: Dict[Any, int] = {}
        self._segment_counter = 0

    def on_open(self) -> None:
        print("DEBUG: [Gummy] on_open", file=sys.stderr)
        send_stdout_message({"type": "status", "message": "[Gummy] Connection established"})

    def on_close(self) -> None:
        print("DEBUG: [Gummy] on_close", file=sys.stderr)
        send_stdout_message({"type": "status", "message": "[Gummy] Connection closed"})

    def on_complete(self) -> None:
        print("DEBUG: [Gummy] on_complete", file=sys.stderr)

    def on_error(self, message) -> None:
        print(f"DEBUG: [Gummy] on_error: {message}", file=sys.stderr)
        send_stdout_message({"type": "error", "message": f"[Gummy] {message}"})

    def _get_segment_index(self, sid) -> int:
        if sid is None:
            # 没有 sid 时退化为递增
            idx = self._segment_counter
            self._segment_counter += 1
            return idx
        if sid not in self._sid_to_segment_index:
            self._sid_to_segment_index[sid] = self._segment_counter
            self._segment_counter += 1
        return self._sid_to_segment_index[sid]

    def on_event(self, request_id, transcription_result, translation_result, usage):
        # 更新 stall-detection 心跳
        self.service._last_callback_time = time.time()
        self.service._stall_warned = False

        t4_sdk_callback = int(time.time() * 1000)
        timestamp_data = {
            "t3NodeReceive": getattr(self.service, '_last_t3_node_receive', 0),
            "t3NodeSend": getattr(self.service, '_last_t3_node_send', 0),
            "t3PythonReceive": getattr(self.service, '_last_t3_python_receive', 0),
            "t4SdkCallback": t4_sdk_callback,
        }

        # ── ASR 部分 ──
        if transcription_result is not None:
            try:
                asr_text = getattr(transcription_result, 'text', '') or ''
                asr_is_end = bool(getattr(transcription_result, 'is_sentence_end', False))
                asr_sid = getattr(transcription_result, 'sentence_id', None)
            except Exception:
                asr_text, asr_is_end, asr_sid = '', False, None

            if asr_text:
                # sentence_id 变化 → 上一句完结，重置 partial 计数
                if self._asr_last_sid is not None and asr_sid != self._asr_last_sid:
                    self._asr_last_partial = ""
                self._asr_last_sid = asr_sid

                if asr_is_end:
                    seg_idx = self._get_segment_index(asr_sid)
                    send_stdout_message({
                        "type": "commit",
                        "speaker_id": 0,
                        "text": asr_text,
                        "segment_index": seg_idx,
                        **timestamp_data,
                    })
                    # 清空 partial
                    send_stdout_message({
                        "type": "partial",
                        "speaker_id": 0,
                        "text": "",
                        **timestamp_data,
                    })
                    self._asr_last_partial = ""
                else:
                    # 只在文本变化时发 partial，避免抖动
                    if asr_text != self._asr_last_partial:
                        self._asr_last_partial = asr_text
                        send_stdout_message({
                            "type": "partial",
                            "speaker_id": 0,
                            "text": asr_text,
                            **timestamp_data,
                        })

        # ── 翻译部分 ──
        if translation_result is not None:
            try:
                languages = translation_result.get_language_list() or []
            except Exception:
                languages = []
            # 选最合适的目标语：优先精确匹配，否则取第一个
            chosen_lang = None
            if self.target_language in languages:
                chosen_lang = self.target_language
            elif languages:
                chosen_lang = languages[0]

            if chosen_lang:
                try:
                    tr = translation_result.get_translation(chosen_lang)
                except Exception:
                    tr = None
                if tr is not None:
                    tr_text = getattr(tr, 'text', '') or ''
                    tr_is_end = bool(getattr(tr, 'is_sentence_end', False))
                    tr_sid = getattr(tr, 'sentence_id', None)

                    if tr_text:
                        if self._tr_last_sid is not None and tr_sid != self._tr_last_sid:
                            self._tr_last_partial = ""
                        self._tr_last_sid = tr_sid

                        # 翻译 segment_index 与同一 sid 的 ASR 对齐
                        seg_idx = self._get_segment_index(tr_sid)

                        if tr_is_end:
                            send_stdout_message({
                                "type": "translation_commit",
                                "speaker_id": 0,
                                "text": tr_text,
                                "segment_index": seg_idx,
                                **timestamp_data,
                            })
                            send_stdout_message({
                                "type": "translation_partial",
                                "speaker_id": 0,
                                "text": "",
                                "segment_index": seg_idx,
                                **timestamp_data,
                            })
                            self._tr_last_partial = ""
                        else:
                            if tr_text != self._tr_last_partial:
                                self._tr_last_partial = tr_text
                                send_stdout_message({
                                    "type": "translation_partial",
                                    "speaker_id": 0,
                                    "text": tr_text,
                                    "segment_index": seg_idx,
                                    **timestamp_data,
                                })


class GummyRealtimeService:
    def __init__(self):
        self.recognizer: Optional[TranslationRecognizerRealtime] = None
        self.callback: Optional[GummyCallback] = None
        self.api_key: Optional[str] = None
        self.model_name: str = 'gummy-realtime-v1'
        self.noise_threshold: int = 500
        self.initialized: bool = False
        self.audio_packet_count = 0

        # 重连冷却 + stall-detection（与 Paraformer 服务一致）
        self._reconnect_cooldown_until = 0
        self._last_callback_time = 0
        self._last_voice_audio_time = 0
        self._stall_threshold_sec = 20
        self._stall_warned = False

        # 时间戳
        self._last_t3_node_send = 0
        self._last_t3_python_receive = 0
        self._last_t3_node_receive = 0

        # 重连用参数
        self._last_source_language = 'zh'
        self._last_target_language = 'en'
        self._last_max_end_silence_ms = 800

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

    def initialize(self,
                   api_key: str,
                   model_name: str = 'gummy-realtime-v1',
                   noise_threshold: int = 500,
                   language: str = 'zh',
                   translation_target: str = 'en',
                   max_end_silence_ms: int = 800):
        if self.initialized:
            return

        self.api_key = api_key
        self.model_name = model_name or 'gummy-realtime-v1'
        self.noise_threshold = noise_threshold

        self._last_source_language = normalize_source_language(language)
        self._last_target_language = (translation_target or 'en').strip().lower() or 'en'
        self._last_max_end_silence_ms = max_end_silence_ms

        self._last_callback_time = time.time()
        self._last_voice_audio_time = 0
        self._stall_warned = False

        dashscope.api_key = api_key
        print(
            f"DEBUG: [Gummy] init model={self.model_name}, source_lang={self._last_source_language}, "
            f"target={self._last_target_language}, silence_ms={max_end_silence_ms}",
            file=sys.stderr,
        )

        self._build_and_start()

    def _build_and_start(self):
        self.callback = GummyCallback(self, target_language=self._last_target_language)
        try:
            self.recognizer = TranslationRecognizerRealtime(
                model=self.model_name,
                format='pcm',
                sample_rate=16000,
                transcription_enabled=True,
                translation_enabled=True,
                source_language=self._last_source_language,
                translation_target_languages=[self._last_target_language],
                callback=self.callback,
                max_end_silence=self._last_max_end_silence_ms,
            )
        except TypeError as e:
            # SDK 旧版本参数名可能略有差异；退化为最少必要参数
            print(f"DEBUG: [Gummy] full ctor failed ({e}), retry minimal", file=sys.stderr)
            self.recognizer = TranslationRecognizerRealtime(
                model=self.model_name,
                format='pcm',
                sample_rate=16000,
                transcription_enabled=True,
                translation_enabled=True,
                translation_target_languages=[self._last_target_language],
                callback=self.callback,
            )

        try:
            self.recognizer.start()
            self.initialized = True
            send_stdout_message({"type": "status", "message": "[SDK] Started successfully"})
            print("DEBUG: [Gummy] start() ok", file=sys.stderr)
        except Exception as e:
            send_stdout_message({"type": "error", "message": f"[Gummy] Start failed: {e}"})
            print(f"DEBUG: [Gummy] Start Exception: {e}", file=sys.stderr)
            raise

    def _reconnect(self):
        old = self.recognizer
        try:
            if old:
                old.stop()
        except Exception:
            pass
        self.initialized = False
        self.recognizer = None
        self._build_and_start()

    def send_audio_frame(self, pcm_data: bytes,
                         t3_node_send: int = 0,
                         t3_python_receive: int = 0,
                         t3_node_receive: int = 0):
        if self._reconnect_cooldown_until > 0 and time.time() < self._reconnect_cooldown_until:
            return
        self._reconnect_cooldown_until = 0
        if not self.initialized or not self.recognizer:
            return

        self.audio_packet_count += 1
        rms = self.calculate_rms(pcm_data)
        now = time.time()

        # stall detection（与 Paraformer 行为一致）
        if rms > self.noise_threshold:
            if self._last_voice_audio_time == 0:
                self._last_voice_audio_time = now
        else:
            self._last_voice_audio_time = 0

        if (self._last_voice_audio_time > 0
                and self._last_callback_time > 0
                and (now - self._last_callback_time) > self._stall_threshold_sec
                and (now - self._last_voice_audio_time) > self._stall_threshold_sec):
            if not self._stall_warned:
                stall_sec = int(now - self._last_callback_time)
                print(f"DEBUG: [Gummy] stall {stall_sec}s, reconnecting...", file=sys.stderr)
                send_stdout_message({
                    "type": "status",
                    "message": f"[Gummy] 模型无响应 {stall_sec}秒，正在自动重连..."
                })
                self._stall_warned = True
                try:
                    self._reconnect()
                    self._last_callback_time = now
                    self._last_voice_audio_time = 0
                    send_stdout_message({"type": "status", "message": "[Gummy] 重连成功"})
                except Exception as re_err:
                    print(f"DEBUG: [Gummy] reconnect failed: {re_err}", file=sys.stderr)
                    send_stdout_message({"type": "error", "message": f"Gummy 重连失败，3秒后重试..."})
                    self._reconnect_cooldown_until = now + 3
                return

        if self.audio_packet_count % 50 == 0:
            send_stdout_message({
                "type": "debug_progress",
                "packetId": self.audio_packet_count,
                "rms": rms,
                "initialized": self.initialized,
                "msg": f"Gummy received audio packet #{self.audio_packet_count}, RMS: {rms}"
            })

        self._last_t3_node_send = t3_node_send
        self._last_t3_python_receive = t3_python_receive if t3_python_receive else int(time.time() * 1000)
        self._last_t3_node_receive = t3_node_receive

        try:
            self.recognizer.send_audio_frame(pcm_data)
        except Exception as e:
            error_str = str(e)
            print(f"DEBUG: [Gummy] send_audio_frame error: {error_str}", file=sys.stderr)
            if any(k in error_str.lower() for k in ('stopped', 'closed', 'websocket', 'timeout')):
                send_stdout_message({"type": "status", "message": "[Gummy] 连接断开，正在重连..."})
                try:
                    self._reconnect()
                    self.recognizer.send_audio_frame(pcm_data)
                    send_stdout_message({"type": "status", "message": "[Gummy] 重连成功"})
                    return
                except Exception as re_err:
                    print(f"DEBUG: [Gummy] reconnect failed: {re_err}", file=sys.stderr)
                    send_stdout_message({"type": "error", "message": f"Gummy 重连失败，3秒后重试..."})
                    self._reconnect_cooldown_until = time.time() + 3
            else:
                send_stdout_message({"type": "error", "message": f"发送音频帧失败: {error_str}"})

    def stop(self):
        if self.recognizer:
            try:
                self.recognizer.stop()
            except Exception:
                pass
        self.initialized = False
        send_stdout_message({"type": "status", "message": "[Gummy] Stopped"})


def main():
    service = GummyRealtimeService()
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
                    if not api_key:
                        send_stdout_message({"type": "error", "message": "API密钥未提供"})
                        continue
                    service.initialize(
                        api_key=api_key,
                        model_name=message.get("model_name", "gummy-realtime-v1"),
                        noise_threshold=message.get("noise_threshold", 500),
                        language=message.get("language", "zh"),
                        translation_target=message.get("translation_target", "en"),
                        max_end_silence_ms=message.get("max_end_silence_ms",
                                                      message.get("turn_detection_silence_duration_ms", 800)),
                    )

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

                # update_params 对 Gummy 无意义（VAD/翻译都在云侧），忽略

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
