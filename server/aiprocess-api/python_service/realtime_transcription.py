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
        TranscriptionParams,
        MultiModality,
    )
    HAS_OMNI = True
except ImportError:
    try:
        # Fallback: older SDK versions may have TranscriptionParams in a submodule
        from dashscope.audio.qwen_omni import (
            OmniRealtimeConversation,
            OmniRealtimeCallback,
            MultiModality,
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
    """转录回调处理器 (Recognition API)

    每个模型+语言组合有不同的 commit 参数：
    - paraformer-realtime-v2 中文：句末标点立即 commit，逗号处 >50 字符才 commit
    - paraformer-realtime-v2 英文：保守策略，主要依赖 is_end 信号
    - fun-asr-realtime 中文：更保守，is_end 短文本也积累
    """

    # ── 每模型每语言的 commit 参数 ──
    COMMIT_PARAMS = {
        # (model_prefix, language) → params
        # strong_min: 强标点最小长度
        # weak_min: 弱标点最小累积长度
        # force_len: 强制 commit 长度
        # buffer_is_end: is_end 信号时，如果文本 < 此值则不立即 commit（积累到下一句）
        # max_pending: pending buffer 上限，攒超过此长度强制输出
        ('paraformer-realtime-v2', 'zh'): {'strong_min': 5, 'weak_min': 50, 'force_len': 120, 'buffer_is_end': 3, 'max_pending': 10},
        ('paraformer-realtime-v2', 'en'): {'strong_min': 25, 'weak_min': 60, 'force_len': 150, 'buffer_is_end': 10, 'max_pending': 30},
        ('fun-asr', 'zh'):                {'strong_min': 8, 'weak_min': 60, 'force_len': 150, 'buffer_is_end': 5, 'max_pending': 15},
        ('fun-asr', 'en'):                {'strong_min': 40, 'weak_min': 120, 'force_len': 250, 'buffer_is_end': 20, 'max_pending': 50},
        ('qwen3-asr', 'zh'):              {'strong_min': 5, 'weak_min': 50, 'force_len': 120, 'buffer_is_end': 0, 'max_pending': 0},
        ('qwen3-asr', 'en'):              {'strong_min': 20, 'weak_min': 60, 'force_len': 150, 'buffer_is_end': 0, 'max_pending': 0},
    }

    DEFAULT_PARAMS = {'strong_min': 8, 'weak_min': 50, 'force_len': 120, 'buffer_is_end': 3, 'max_pending': 10}

    def __init__(self, service, language='zh', model='paraformer-realtime-v2'):
        self.service = service
        self.language = language
        self.model = model
        self.current_sentence_id = None
        self.committed_offset = 0
        self.last_text_content = ""
        self.last_text_change_time = time.time()
        self._committed_prefix = ""
        # 跨句子合并缓冲：短文本（如 "you know,"）不立即 commit，
        # 攒到下一个较长句子一起输出
        self._pending_buffer = ""
        self._pending_speaker_id = 0
        # 说话人分配：SDK 不一定返回 speaker_id，用 sentence_id 变化来推断
        self._sid_to_speaker = {}  # sentence_id → speaker_id 映射
        self._last_spk_id = 0

        # 选择 commit 参数
        lang_key = 'en' if language in ('en', 'mixed') else language
        if lang_key not in ('zh', 'en', 'ja'):
            lang_key = 'zh'
        params = None
        for prefix in [model, model.rsplit('-', 1)[0] if '-' in model else model]:
            params = self.COMMIT_PARAMS.get((prefix, lang_key))
            if params:
                break
        if not params:
            params = self.COMMIT_PARAMS.get(('paraformer-realtime-v2', lang_key), self.DEFAULT_PARAMS)
        # 复制一份，然后应用前端传来的覆盖值
        self.p = dict(params)
        overrides = getattr(service, '_commit_overrides', {})
        if overrides.get('commit_strong_min'):
            self.p['strong_min'] = overrides['commit_strong_min']
        if overrides.get('commit_weak_min'):
            self.p['weak_min'] = overrides['commit_weak_min']
        if overrides.get('commit_force_len'):
            self.p['force_len'] = overrides['commit_force_len']
        if overrides.get('commit_buffer_is_end'):
            self.p['buffer_is_end'] = overrides['commit_buffer_is_end']
        if overrides.get('commit_max_pending'):
            self.p['max_pending'] = overrides['commit_max_pending']
        # sil_timeout 存在 self 上，commit 时使用
        self._sil_timeout_override = overrides.get('commit_sil_timeout', 0)
        print(f"DEBUG: commit params for model={model}, lang={language}: {self.p}, sil_timeout_override={self._sil_timeout_override}", file=sys.stderr)

    def on_open(self):
        print(f"DEBUG: on_open 回调被调用", file=sys.stderr)
        send_stdout_message({"type": "status", "message": "[ASR] Connection established, transcribing..."})

    def on_close(self):
        print(f"DEBUG: on_close 回调被调用", file=sys.stderr)
        # Flush pending buffer on close — 不丢失最后攒的短文本
        if self._pending_buffer and self._pending_buffer.strip():
            meaningful = re.sub(r'[\s.,;:!?。，、；：！？\-\'"()（）\[\]【】]', '', self._pending_buffer)
            if meaningful:
                send_stdout_message({
                    "type": "commit",
                    "speaker_id": self._pending_speaker_id,
                    "text": self._pending_buffer.strip(),
                })
            self._pending_buffer = ""
        send_stdout_message({"type": "status", "message": "[ASR] Connection closed"})

    def on_error(self, result):
        print(f"DEBUG: on_error 回调被调用, result: {result}", file=sys.stderr)
        send_stdout_message({"type": "error", "message": str(result)})

    def on_event(self, result: RecognitionResult):
        """事件处理 - 五层漏斗策略 + ASR 改写检测

        DashScope 英文 ASR 会改写之前已识别的文本（如 "I." → "I time now..."），
        导致 committed_offset 指向错误位置。本方法通过检测前缀改写并自动调整 offset
        来保证后续 commit 正常工作。
        """
        t4_sdk_callback = int(time.time() * 1000)

        # 更新 stall detection 计时器
        self.service._last_callback_time = time.time()
        self.service._stall_warned = False

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

        # ── 说话人识别：多重回退策略 ──
        # DashScope 实时 API 的 speaker_id 字段不稳定，可能在不同字段名下
        spk_id = None
        for key in ('speaker_id', 'spk_id', 'speaker'):
            if key in sentence and sentence[key] is not None and sentence[key] != '':
                try:
                    spk_id = int(sentence[key])
                except (ValueError, TypeError):
                    pass
                if spk_id is not None:
                    break
        # 回退：从 words 数组中获取
        if spk_id is None and 'words' in sentence:
            words = sentence.get('words', [])
            if words and isinstance(words, list) and len(words) > 0:
                w = words[0] if isinstance(words[0], dict) else {}
                for key in ('speaker_id', 'spk_id', 'speaker'):
                    v = w.get(key)
                    if v is not None and v != '':
                        try:
                            spk_id = int(v)
                            break
                        except (ValueError, TypeError):
                            pass
        # 回退：基于 sentence_id 变化推断说话人切换
        if spk_id is None:
            if sid is not None:
                if sid not in self._sid_to_speaker:
                    if self.current_sentence_id is not None and sid != self.current_sentence_id:
                        # sentence_id 变了，可能换了说话人
                        existing = set(self._sid_to_speaker.values())
                        # 在已知说话人之间轮换（而不是无限递增）
                        next_id = 0
                        for candidate in range(max(len(existing) + 1, 2)):
                            if candidate not in existing or candidate == self._last_spk_id:
                                continue
                            next_id = candidate
                            break
                        else:
                            next_id = (self._last_spk_id + 1) % max(len(existing) + 1, 2)
                        self._sid_to_speaker[sid] = next_id
                    else:
                        self._sid_to_speaker[sid] = 0
                spk_id = self._sid_to_speaker[sid]
            else:
                spk_id = 0
        else:
            # SDK 返回了有效 speaker_id，记录映射
            if sid is not None:
                self._sid_to_speaker[sid] = spk_id
        self._last_spk_id = spk_id

        if text:
            print(f"DEBUG: 收到文本: {text}, is_end: {is_end}, sid: {sid}, spk_id: {spk_id} (raw: {sentence.get('speaker_id', 'N/A')})", file=sys.stderr)

        current_time = time.time()
        if text != self.last_text_content:
            self.last_text_change_time = current_time
            self.last_text_content = text

        logic_sil = current_time - self.last_text_change_time

        # ── ASR 改写检测 ──
        # DashScope 英文 ASR 经常改写之前已识别的文本。如果已提交区域被改写，
        # 需要调整 committed_offset 到最后一个未被改写的位置。
        if self.committed_offset > 0 and self._committed_prefix:
            if len(text) < self.committed_offset:
                # 文本变短 — 完全重置
                print(f"DEBUG: 文本变短 {len(text)}<{self.committed_offset}, 重置offset→0", file=sys.stderr)
                self.committed_offset = 0
                self._committed_prefix = ""
            else:
                current_prefix = text[:self.committed_offset]
                if current_prefix != self._committed_prefix:
                    # 找到公共前缀长度
                    old_prefix = self._committed_prefix
                    common = 0
                    for i in range(min(len(old_prefix), len(text))):
                        if old_prefix[i] == text[i]:
                            common = i + 1
                        else:
                            break
                    old_off = self.committed_offset
                    self.committed_offset = common
                    self._committed_prefix = text[:common] if common > 0 else ""
                    print(f"DEBUG: ASR改写已提交文本, offset {old_off}→{common}", file=sys.stderr)

        display_text = text[self.committed_offset:]

        if not display_text:
            return

        should_commit = False
        split_idx = -1
        is_en = self.language in ('en', 'mixed')
        p = self.p  # commit params

        # ── sentence_id 变化：先处理，让后续逻辑基于新句子 ──
        sid_changed = False
        if self.current_sentence_id is not None and sid != self.current_sentence_id:
            sid_changed = True
            self.current_sentence_id = sid
            self.committed_offset = 0
            self._committed_prefix = ""
            display_text = text
        if self.current_sentence_id is None:
            self.current_sentence_id = sid

        # 合并后的 display_text（包含之前攒的短文本）
        effective_text = self._pending_buffer + display_text if self._pending_buffer else display_text

        # pending buffer 长度上限
        max_pending = p.get('max_pending', p['strong_min'])

        # 1. 服务端 is_end 信号
        if is_end:
            # 短文本积累：如果合并后仍然太短且 buffer 没超限，攒到 _pending_buffer 等下一句
            if len(effective_text.strip()) <= p['buffer_is_end'] and len(self._pending_buffer) < max_pending:
                # 攒到 pending buffer，不 commit
                self._pending_buffer = effective_text.rstrip() + " "
                self._pending_speaker_id = spk_id
            else:
                should_commit = True
                split_idx = len(text)

        # 2. 强标点（句末标点 + 最小长度）
        if not should_commit:
            match = re.search(r'[。？！]', display_text)
            if not match:
                match = re.search(r'[.?!](?:\s|$)', display_text)
            if match and len(effective_text.strip()) > p['strong_min']:
                split_idx = self.committed_offset + match.end()
                should_commit = True

        # 3. 弱标点 + 长度（逗号处切分，需累积足够长度）
        if not should_commit and len(effective_text) > p['weak_min']:
            match = re.search(r'[，、；]', display_text)
            if not match:
                match = re.search(r',\s', display_text)
            if match:
                split_idx = self.committed_offset + match.end()
                should_commit = True

        # 4. 长度兜底
        if not should_commit and len(effective_text) > p['force_len']:
            should_commit = True
            split_idx = len(text)

        # 5. 超时（文本停止变化）— 英文用更长超时，因为英文单句字符数更多
        if self._sil_timeout_override:
            sil_timeout = self._sil_timeout_override
        else:
            sil_timeout = 1.0 if is_en else 0.8
        if not should_commit and logic_sil > sil_timeout:
            should_commit = True
            split_idx = len(text)

        timestamp_data = {
            "t3NodeReceive": getattr(self.service, '_last_t3_node_receive', 0),
            "t3NodeSend": getattr(self.service, '_last_t3_node_send', 0),
            "t3PythonReceive": getattr(self.service, '_last_t3_python_receive', 0),
            "t4SdkCallback": t4_sdk_callback,
        }

        if should_commit:
            commit_chunk = text[self.committed_offset:split_idx]
            # 如果有 pending buffer，合并到 commit 内容前面
            if self._pending_buffer:
                commit_chunk = self._pending_buffer + commit_chunk
                self._pending_buffer = ""
            self._committed_prefix = text[:split_idx]
            self.committed_offset = split_idx
            # 过滤纯标点/空白 commit（去掉标点后仍有实质内容才发送）
            meaningful = re.sub(r'[\s.,;:!?。，、；：！？\-\'"()（）\[\]【】]', '', commit_chunk)
            if meaningful:
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
            # 显示 pending buffer + 当前 partial
            partial_display = effective_text if not is_end else display_text
            send_stdout_message({
                "type": "partial",
                "speaker_id": spk_id,
                "text": partial_display,
                **timestamp_data
            })


# ============================================================
# OmniRealtimeConversation 回调 (qwen3-asr-flash-realtime)
# ============================================================
if HAS_OMNI:
    class QwenAsrCallback(OmniRealtimeCallback):
        """Qwen3-ASR 实时回调处理器

        事件模型（DashScope OmniRealtimeConversation）：
        - stash 事件：当前语段的最新识别结果，每次替换上一次（同一段话越来越准确）
        - completed 事件：当前语段的最终结果（只包含这一段，非累积全文）

        合并策略：短文本（如"嗯。"、"对。"）不立即 commit，缓存后与下一个语段合并，
        减少琐碎单行。超时 1.5 秒后强制 flush 缓存。
        """

        # 每语言的短文本阈值（去标点后的字符数）
        # 英文单词更长，阈值需要更高
        LANG_PARAMS = {
            'zh': {'short_threshold': 8,  'buffer_timeout': 1.5},
            'en': {'short_threshold': 20, 'buffer_timeout': 2.0},
            'ja': {'short_threshold': 8,  'buffer_timeout': 1.5},
            'mixed': {'short_threshold': 15, 'buffer_timeout': 1.8},
        }
        DEFAULT_LANG_PARAMS = {'short_threshold': 8, 'buffer_timeout': 1.5}

        def __init__(self, service, language='zh'):
            self.service = service
            self.language = language
            self._buffer = ""          # 缓存的短文本
            self._buffer_time = 0.0    # 缓存最后更新时间
            # 选择语言参数
            lang_key = 'en' if language in ('en', 'mixed') else language
            if lang_key not in self.LANG_PARAMS:
                lang_key = 'zh'
            self._params = self.LANG_PARAMS[lang_key]
            print(f"DEBUG: [QwenASR] language={language}, params={self._params}", file=sys.stderr)

        def on_open(self):
            print("DEBUG: [QwenASR] on_open", file=sys.stderr)
            send_stdout_message({"type": "status", "message": "[ASR] Connection established, transcribing..."})

        def on_close(self, code=None, msg=None):
            print(f"DEBUG: [QwenASR] on_close code={code} msg={msg}", file=sys.stderr)
            # Flush any buffered text before closing
            self._flush_buffer()
            send_stdout_message({"type": "status", "message": "[ASR] Connection closed"})

        def on_error(self, error=None):
            print(f"DEBUG: [QwenASR] on_error: {error}", file=sys.stderr)
            send_stdout_message({"type": "error", "message": str(error)})

        def _flush_buffer(self):
            """强制输出缓存中的文本"""
            if self._buffer:
                text = self._buffer.strip()
                self._buffer = ""
                if text:
                    timestamp_data = {
                        "t3NodeReceive": getattr(self.service, '_last_t3_node_receive', 0),
                        "t3NodeSend": getattr(self.service, '_last_t3_node_send', 0),
                        "t3PythonReceive": getattr(self.service, '_last_t3_python_receive', 0),
                        "t4SdkCallback": int(time.time() * 1000),
                    }
                    print(f"DEBUG: [QwenASR] flush buffer: {text}", file=sys.stderr)
                    send_stdout_message({
                        "type": "commit",
                        "speaker_id": 0,
                        "text": text,
                        **timestamp_data
                    })

        def on_event(self, response):
            """处理 qwen3-asr-flash-realtime 事件"""
            t4_sdk_callback = int(time.time() * 1000)

            # 更新 stall detection 计时器
            self.service._last_callback_time = time.time()
            self.service._stall_warned = False

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

            # 最终转录结果：当前语段结束
            if event_type == 'conversation.item.input_audio_transcription.completed':
                text = response.get('transcript', '')
                if not text or not text.strip():
                    return

                text = text.strip()
                now = time.time()

                # 检查缓存超时：如果缓存太久了，先 flush
                if self._buffer and (now - self._buffer_time) > self._params['buffer_timeout']:
                    self._flush_buffer()

                # 去掉标点后看实质内容长度
                meaningful = re.sub(r'[\s.,;:!?。，、；：！？\-\'"()（）\[\]【】]', '', text)

                if len(meaningful) <= self._params['short_threshold']:
                    # 短文本：缓存，不立即 commit
                    self._buffer += text
                    if not self._buffer_time:
                        self._buffer_time = now
                    print(f"DEBUG: [QwenASR] buffered short: '{text}' → buffer='{self._buffer}'", file=sys.stderr)
                    # 更新 partial 显示，让用户看到缓存内容
                    send_stdout_message({
                        "type": "partial",
                        "speaker_id": 0,
                        "text": self._buffer,
                        **timestamp_data
                    })
                else:
                    # 长文本：合并缓存 + 当前文本，一起 commit
                    commit_text = (self._buffer + text).strip() if self._buffer else text
                    self._buffer = ""
                    self._buffer_time = 0
                    print(f"DEBUG: [QwenASR] commit: {commit_text}", file=sys.stderr)
                    send_stdout_message({
                        "type": "commit",
                        "speaker_id": 0,
                        "text": commit_text,
                        **timestamp_data
                    })
                    # 清空 partial 显示
                    send_stdout_message({
                        "type": "partial",
                        "speaker_id": 0,
                        "text": "",
                        **timestamp_data
                    })

            # 中间转录结果：stash 替换当前 partial
            elif event_type == 'conversation.item.input_audio_transcription.text':
                text = response.get('stash', '') or response.get('text', '')
                if text:
                    # 如果有缓存，在 partial 前面显示缓存内容
                    display = (self._buffer + text) if self._buffer else text
                    send_stdout_message({
                        "type": "partial",
                        "speaker_id": 0,
                        "text": display,
                        **timestamp_data
                    })

                # 顺便检查缓存超时
                if self._buffer and (time.time() - self._buffer_time) > self._params['buffer_timeout']:
                    self._flush_buffer()

            # Session 相关事件
            elif event_type in ('session.created', 'session.updated'):
                print(f"DEBUG: [QwenASR] {event_type}", file=sys.stderr)

            else:
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

        # 重连冷却
        self._reconnect_cooldown_until = 0

        # Stall detection: 检测 ASR 模型内部卡住（连接正常但无回调）
        self._last_callback_time = 0          # 最近一次收到 ASR 回调的时间
        self._last_voice_audio_time = 0       # 最近一次发送有语音音频的时间
        self._stall_threshold_sec = 20        # 有语音音频但无回调超过此秒数则判定卡住
        self._stall_warned = False             # 避免重复提示

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
                   disable_speaker_diarization: bool = False,
                   enable_disfluency_removal: bool = False,
                   language: str = 'zh',
                   commit_overrides: dict = None):
        """初始化识别器"""
        if self.initialized:
            return

        self.api_key = api_key
        self.model_name = model_name
        self.noise_threshold = noise_threshold
        self.use_omni = model_name in OMNI_MODELS

        # 保存参数用于重连
        self._last_silence_ms = turn_detection_silence_duration_ms
        self._last_threshold = turn_detection_threshold
        self._last_no_diarization = disable_speaker_diarization
        self._last_disfluency_removal = enable_disfluency_removal
        self._last_language = language

        # 初始化 stall detection 计时器
        self._last_callback_time = time.time()
        self._last_voice_audio_time = 0
        self._stall_warned = False

        self._commit_overrides = commit_overrides or {}

        dashscope.api_key = api_key
        print(f"DEBUG: api_key length={len(api_key)}, model={model_name}, use_omni={self.use_omni}, silence={turn_detection_silence_duration_ms}ms, disfluency_removal={enable_disfluency_removal}, language={language}, commit_overrides={self._commit_overrides}", file=sys.stderr)

        if self.use_omni:
            self._init_omni(turn_detection_silence_duration_ms)
        else:
            self._init_recognition(model_name, turn_detection_silence_duration_ms,
                                   turn_detection_threshold, disable_speaker_diarization,
                                   enable_disfluency_removal, language)

    def _init_recognition(self, model_name, silence_ms, threshold, no_diarization, disfluency_removal=False, language='zh'):
        """使用 Recognition API (paraformer / fun-asr)"""
        print(f"DEBUG _init_recognition: model={model_name}, no_diarization={no_diarization}, disfluency_removal={disfluency_removal}, language={language}", file=sys.stderr)
        self.callback = TranscriptionCallback(self, language=language, model=model_name)
        kwargs = dict(
            model=model_name,
            format='pcm',
            sample_rate=16000,
            callback=self.callback,
            enable_turn_detection=True,
            turn_detection_threshold=threshold,
            turn_detection_silence_duration_ms=silence_ms,
            disabling_speaker_diarization=no_diarization,
            request_timeout=14400,  # 4 hours (default 300s causes reconnects)
        )
        # disfluency_removal_enabled removes filler words like 嗯、啊、就是 etc.
        if disfluency_removal:
            kwargs['disfluency_removal_enabled'] = True
        self.recognizer = Recognition(**kwargs)
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

        self.callback = QwenAsrCallback(self, language=self._last_language)

        # 默认使用北京 endpoint；国际版用 wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime
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
            # 关键：必须先 connect() 再 update_session()
            # connect() 建立 WebSocket 连接，update_session() 通过连接发送配置
            self.recognizer.connect()
            print("DEBUG: [QwenASR] WebSocket 连接建立", file=sys.stderr)

            transcription_params = TranscriptionParams(
                language=self._last_language or 'zh',
                sample_rate=16000,
                input_audio_format='pcm',
            )

            self.recognizer.update_session(
                output_modalities=[MultiModality.TEXT],
                enable_turn_detection=True,
                turn_detection_type='server_vad',
                turn_detection_silence_duration_ms=silence_ms,
                enable_input_audio_transcription=True,
                transcription_params=transcription_params,
            )

            self.initialized = True
            send_stdout_message({"type": "status", "message": "[SDK] Started successfully"})
            print("DEBUG: [QwenASR] 初始化完成", file=sys.stderr)
        except Exception as e:
            send_stdout_message({"type": "error", "message": f"[SDK] Qwen ASR start failed: {e}"})
            print(f"DEBUG: [QwenASR] Start Exception: {e}", file=sys.stderr)
            raise

    def send_audio_frame(self, pcm_data: bytes, t3_node_send: int = 0, t3_python_receive: int = 0, t3_node_receive: int = 0):
        """发送音频帧，如果 ASR 连接断开则自动重连"""
        # 如果正在重连冷却中，静默丢弃音频帧
        if self._reconnect_cooldown_until > 0 and time.time() < self._reconnect_cooldown_until:
            return
        self._reconnect_cooldown_until = 0

        if not self.initialized or not self.recognizer:
            return

        self.audio_packet_count += 1
        rms = self.calculate_rms(pcm_data)
        now = time.time()

        # ── Stall Detection: 检测 ASR 模型卡住 ──
        # 如果持续发送有语音的音频，但长时间没收到任何回调，说明模型卡住了
        if rms > self.noise_threshold:
            if self._last_voice_audio_time == 0:
                self._last_voice_audio_time = now
        else:
            # 静音时重置语音计时器
            self._last_voice_audio_time = 0

        if (self._last_voice_audio_time > 0
            and self._last_callback_time > 0
            and (now - self._last_callback_time) > self._stall_threshold_sec
            and (now - self._last_voice_audio_time) > self._stall_threshold_sec):
            if not self._stall_warned:
                stall_sec = int(now - self._last_callback_time)
                print(f"DEBUG: ASR Stall detected! {stall_sec}s since last callback, reconnecting...", file=sys.stderr)
                send_stdout_message({
                    "type": "status",
                    "message": f"[ASR] 模型无响应 {stall_sec}秒，正在自动重连..."
                })
                self._stall_warned = True
                try:
                    self._reconnect()
                    self._last_callback_time = now  # 重连后重置计时
                    self._last_voice_audio_time = 0
                    send_stdout_message({"type": "status", "message": "[ASR] 重连成功，继续转录"})
                    print(f"DEBUG: Stall reconnect successful", file=sys.stderr)
                except Exception as re_err:
                    print(f"DEBUG: Stall reconnect failed: {re_err}", file=sys.stderr)
                    send_stdout_message({"type": "error", "message": f"ASR 重连失败，{3}秒后重试..."})
                    self._reconnect_cooldown_until = now + 3
                return  # 这一帧丢弃，下一帧开始用新连接

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
                audio_b64 = base64.b64encode(pcm_data).decode('ascii')
                self.recognizer.append_audio(audio_b64)
            else:
                self.recognizer.send_audio_frame(pcm_data)
        except Exception as e:
            error_str = str(e)
            print(f"DEBUG: Send Audio Exception: {error_str}", file=sys.stderr)

            # 检测 ASR 连接断开，尝试自动重连
            if 'stopped' in error_str.lower() or 'closed' in error_str.lower() or 'websocket' in error_str.lower() or 'timeout' in error_str.lower():
                print(f"DEBUG: ASR 连接已断开，尝试自动重连...", file=sys.stderr)
                send_stdout_message({"type": "status", "message": "[ASR] 连接断开，正在重连..."})
                try:
                    self._reconnect()
                    # 重连成功，重试发送
                    if self.use_omni:
                        audio_b64 = base64.b64encode(pcm_data).decode('ascii')
                        self.recognizer.append_audio(audio_b64)
                    else:
                        self.recognizer.send_audio_frame(pcm_data)
                    send_stdout_message({"type": "status", "message": "[ASR] 重连成功，继续转录"})
                    print(f"DEBUG: ASR 重连成功", file=sys.stderr)
                    return
                except Exception as re_err:
                    print(f"DEBUG: ASR 重连失败: {re_err}", file=sys.stderr)
                    send_stdout_message({"type": "error", "message": f"ASR 重连失败，{3}秒后重试..."})
                    # 冷却 3 秒，避免每帧都尝试重连导致日志洪水
                    self._reconnect_cooldown_until = time.time() + 3
            else:
                send_stdout_message({"type": "error", "message": f"发送音频帧失败: {error_str}"})

    def _reconnect(self):
        """尝试重新创建 ASR 连接（保留回调和参数）"""
        old_recognizer = self.recognizer
        try:
            if old_recognizer:
                old_recognizer.stop()
        except:
            pass

        self.initialized = False
        self.recognizer = None

        if self.use_omni:
            self._init_omni(self._last_silence_ms)
        else:
            # 重用上次的参数重新初始化
            self._init_recognition(
                self.model_name, self._last_silence_ms,
                self._last_threshold, self._last_no_diarization,
                self._last_disfluency_removal, self._last_language
            )

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
                    enable_disfluency_removal = message.get("enable_disfluency_removal", False)
                    language = message.get("language", "zh")
                    # Commit strategy overrides from frontend (0 = use default)
                    commit_overrides = {}
                    for key in ('commit_strong_min', 'commit_weak_min', 'commit_force_len',
                                'commit_buffer_is_end', 'commit_sil_timeout', 'commit_max_pending'):
                        val = message.get(key, 0)
                        if val:
                            commit_overrides[key] = val

                    if not api_key:
                        send_stdout_message({"type": "error", "message": "API密钥未提供"})
                        continue

                    service.initialize(api_key, model_name, noise_threshold,
                                       turn_detection_silence_duration_ms,
                                       turn_detection_threshold,
                                       disable_speaker_diarization,
                                       enable_disfluency_removal,
                                       language,
                                       commit_overrides=commit_overrides)

                elif msg_type == "update_params":
                    # Hot-reload commit params during active transcription
                    cb = getattr(service, 'callback', None)
                    if cb:
                        if 'commit_strong_min' in message and message['commit_strong_min']:
                            cb.p['strong_min'] = message['commit_strong_min']
                        if 'commit_weak_min' in message and message['commit_weak_min']:
                            cb.p['weak_min'] = message['commit_weak_min']
                        if 'commit_force_len' in message and message['commit_force_len']:
                            cb.p['force_len'] = message['commit_force_len']
                        if 'commit_buffer_is_end' in message and message['commit_buffer_is_end']:
                            cb.p['buffer_is_end'] = message['commit_buffer_is_end']
                        if 'commit_sil_timeout' in message and message['commit_sil_timeout']:
                            cb._sil_timeout_override = message['commit_sil_timeout']
                        if 'commit_max_pending' in message and message['commit_max_pending']:
                            cb.p['max_pending'] = message['commit_max_pending']
                        print(f"DEBUG: Hot-reload commit params: {cb.p}, sil_timeout={cb._sil_timeout_override}", file=sys.stderr)
                        send_stdout_message({"type": "status", "message": f"Commit params updated: {cb.p}"})
                    else:
                        print("WARN: No callback to update params on", file=sys.stderr)

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
