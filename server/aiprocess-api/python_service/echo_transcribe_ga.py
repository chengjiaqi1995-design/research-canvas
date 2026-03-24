#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Echo Transcribe GA (Global Accelerator) 实时语音转录服务
基于 echo-transcribe 项目，配置阿里云 GA 加速（新加坡 → 华东1-杭州）
通过 stdin/stdout 与 Node.js 后端通信
"""

import sys
import json
import struct
import math
import time
import re
import io
import os
from typing import Optional, Dict, Any

# 修复 Windows 编码问题：强制使用 UTF-8
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=True)
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace', line_buffering=True)
    sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8', errors='replace')

try:
    import dashscope
    from dashscope.audio.asr import Recognition, RecognitionCallback, RecognitionResult
except ImportError as e:
    print(json.dumps({"type": "error", "message": f"缺少依赖库 dashscope，请运行: pip install dashscope"}))
    sys.exit(1)


# ========== GA (Global Accelerator) 配置 ==========
# 配置 DashScope API 使用 GA endpoint
# 方式1: 通过环境变量配置（推荐，在部署时配置）
# 方式2: 通过 dashscope.api_base 配置（在代码中配置）

# 获取 GA endpoint（从环境变量或默认值）
GA_ENDPOINT = os.getenv('DASHSCOPE_GA_ENDPOINT', None)
if GA_ENDPOINT:
    # 如果设置了 GA endpoint，使用 GA 加速
    dashscope.api_base = GA_ENDPOINT
    print(f"🌐 [GA] 使用 Global Accelerator endpoint: {GA_ENDPOINT}", file=sys.stderr)
else:
    # 默认使用标准 endpoint（用于对比测试）
    # 通常 DashScope 默认 endpoint 是: https://dashscope.aliyuncs.com
    print(f"⚠️ [GA] 未配置 DASHSCOPE_GA_ENDPOINT，使用默认 endpoint", file=sys.stderr)
# ===============================================


def calculate_rms(data: bytes) -> int:
    """计算音频 RMS 值（与 echo-transcribe 完全一致）"""
    count = len(data) // 2
    if count == 0:
        return 0
    try:
        shorts = struct.unpack(f"<{count}h", data)
    except Exception:
        return 0
    sum_squares = sum(s * s for s in shorts)
    return int(math.sqrt(sum_squares / count))


class EchoTranscribeGACallback(RecognitionCallback):
    """Echo Transcribe GA 回调处理器 - 复现三层漏斗策略（带 GA 标记）"""
    
    def __init__(self, service):
        self.service = service
        self.current_sentence_id = None
        self.committed_offset = 0
        self.last_text_content = ""
        self.last_text_change_time = time.time()
        self.sentence_id_to_speaker = {}  # 用于跟踪 sentence_id 到 speaker_id 的映射
        self.last_commit_time = time.time()  # 上次 commit 的时间
        self.last_speaker_id = None  # 上次的 speaker_id
        self.silence_threshold = 1.5  # 静音阈值（秒），超过这个时间可能表示说话人切换
        # GA 标记：用于区分不同版本
        self.ga_enabled = GA_ENDPOINT is not None
    
    def on_open(self):
        """连接建立"""
        ga_status = "🌐 [GA] " if self.ga_enabled else ""
        self._send_message({"type": "status", "message": f"{ga_status}✅ 连接建立（GA版本），正在转录..."})
    
    def on_close(self):
        """连接关闭"""
        self._send_message({"type": "status", "message": "⏹️ 连接断开"})
    
    def on_error(self, error: Exception):
        """错误处理"""
        self._send_message({
            "type": "error",
            "message": f"错误: {str(error)}"
        })
    
    def on_event(self, result: RecognitionResult):
        """处理识别结果 - 复现 echo-transcribe 的三层漏斗策略"""
        try:
            if not result or not result.output or not result.output.sentence:
                return
            
            sentence = result.output.sentence
            text = sentence.get('text', '')
            is_end = str(sentence.get('is_sentence_end', '')).lower() == 'true'
            sid = sentence.get('sentence_id')
            
            # ✅ 修复：尝试多种方式获取 speaker_id
            spk_id = None
            if 'speaker_id' in sentence:
                spk_id = sentence.get('speaker_id')
            elif 'spk_id' in sentence:
                spk_id = sentence.get('spk_id')
            elif 'speaker' in sentence:
                spk_id = sentence.get('speaker')
            
            # 如果 speaker_id 为 None 或空，尝试从 words 中获取
            if (spk_id is None or spk_id == '') and 'words' in sentence:
                words = sentence.get('words', [])
                if words and isinstance(words, list) and len(words) > 0:
                    first_word = words[0] if isinstance(words[0], dict) else {}
                    spk_id = first_word.get('speaker_id') or first_word.get('spk_id') or first_word.get('speaker')
            
            # 如果还是没有，使用基于 sentence_id 变化的智能分配
            if spk_id is None or spk_id == '':
                if sid is not None:
                    if sid not in self.sentence_id_to_speaker:
                        if self.current_sentence_id is not None and sid != self.current_sentence_id:
                            if len(self.sentence_id_to_speaker) == 0:
                                self.sentence_id_to_speaker[sid] = 1
                            else:
                                # ✅ 修复：支持多个说话人，分配下一个可用的 speaker_id
                                existing_speakers = set(self.sentence_id_to_speaker.values())
                                next_speaker_id = 1
                                while next_speaker_id in existing_speakers:
                                    next_speaker_id += 1
                                self.sentence_id_to_speaker[sid] = next_speaker_id
                        else:
                            self.sentence_id_to_speaker[sid] = 1
                    spk_id = self.sentence_id_to_speaker[sid]
                else:
                    spk_id = 1
            else:
                try:
                    spk_id = int(spk_id)
                    if sid is not None:
                        self.sentence_id_to_speaker[sid] = spk_id
                except (ValueError, TypeError):
                    if sid is not None and sid not in self.sentence_id_to_speaker:
                        self.sentence_id_to_speaker[sid] = 1
                    spk_id = self.sentence_id_to_speaker.get(sid, 1) if sid is not None else 1
            
            # --- 三层漏斗策略（与 echo-transcribe 完全一致）---
            current_time = time.time()
            
            # 更新文本变化时间
            if text != self.last_text_content:
                self.last_text_change_time = current_time
                self.last_text_content = text
            
            # 计算逻辑静音时间
            logic_sil = current_time - self.last_text_change_time
            
            should_commit = False
            split_idx = -1
            
            # 重置 committed_offset 如果文本变短了
            if len(text) < self.committed_offset:
                self.committed_offset = 0
            
            display_text = text[self.committed_offset:]
            
            if not display_text:
                return
            
            # 1. 服务端信号（is_end）
            if is_end:
                should_commit = True
                split_idx = len(text)
            
            # 2. 强标点（检测到句号、问号、感叹号）
            elif not should_commit:
                match = re.search(r'([。？！])', display_text)
                if match and len(display_text) > 2:
                    split_idx = self.committed_offset + match.end()
                    should_commit = True
            
            # 3. 超时（使用配置的 commit_timeout）
            if not should_commit and logic_sil > self.service.commit_timeout:
                should_commit = True
                split_idx = len(text)
            
            # ID 变化处理 - ✅ 修复：结合多个信号判断说话人变化（更敏感）
            time_since_last_commit = current_time - self.last_commit_time
            
            if self.current_sentence_id is not None and sid != self.current_sentence_id:
                old_sid = self.current_sentence_id
                self.current_sentence_id = sid
                self.committed_offset = 0
                display_text = text
                
                if sid is not None and sid not in self.sentence_id_to_speaker:
                    existing_speakers = set(self.sentence_id_to_speaker.values())
                    if len(existing_speakers) == 0:
                        self.sentence_id_to_speaker[sid] = 1
                    else:
                        # ✅ 修复：支持多个说话人，分配下一个可用的 speaker_id
                        next_speaker_id = 1
                        while next_speaker_id in existing_speakers:
                            next_speaker_id += 1
                        self.sentence_id_to_speaker[sid] = next_speaker_id
                    spk_id = self.sentence_id_to_speaker[sid]
                elif sid is not None and sid in self.sentence_id_to_speaker:
                    spk_id = self.sentence_id_to_speaker[sid]
            elif self.current_sentence_id is not None and sid == self.current_sentence_id:
                # ✅ 修复：即使 sentence_id 相同，如果静音时间较长，也可能是新说话人
                if time_since_last_commit > self.silence_threshold and sid is not None:
                    if sid not in self.sentence_id_to_speaker:
                        existing_speakers = set(self.sentence_id_to_speaker.values())
                        next_speaker_id = 1
                        while next_speaker_id in existing_speakers:
                            next_speaker_id += 1
                        self.sentence_id_to_speaker[sid] = next_speaker_id
                        spk_id = next_speaker_id
                    else:
                        current_spk = self.sentence_id_to_speaker[sid]
                        if time_since_last_commit > 2.0 and current_spk == self.last_speaker_id:
                            existing_speakers = set(self.sentence_id_to_speaker.values())
                            next_speaker_id = 1
                            while next_speaker_id in existing_speakers:
                                next_speaker_id += 1
                            self.sentence_id_to_speaker[sid] = next_speaker_id
                            spk_id = next_speaker_id
                        else:
                            spk_id = current_spk
            
            if self.current_sentence_id is None:
                self.current_sentence_id = sid
                if sid is not None and sid not in self.sentence_id_to_speaker:
                    self.sentence_id_to_speaker[sid] = 1
                    spk_id = 1
            
            # 推送数据（添加 GA 标记用于对比）
            if should_commit:
                commit_chunk = text[self.committed_offset:split_idx]
                self.committed_offset = split_idx
                
                if commit_chunk.strip():
                    # ✅ 更新最后 commit 时间和 speaker_id
                    self.last_commit_time = current_time
                    self.last_speaker_id = spk_id
                    
                    self._send_message({
                        "type": "commit",
                        "speaker_id": spk_id,
                        "text": commit_chunk.strip(),
                        "ga_enabled": self.ga_enabled,  # 标记是否使用 GA
                    })
                
                # 发送剩余部分作为 partial
                rem = ""
                if self.committed_offset < len(text):
                    rem = text[self.committed_offset:]
                
                if rem:
                    self._send_message({
                        "type": "partial",
                        "speaker_id": spk_id,
                        "text": rem,
                        "ga_enabled": self.ga_enabled,
                    })
                
                self.last_text_change_time = current_time
            else:
                # 发送临时文本
                self._send_message({
                    "type": "partial",
                    "speaker_id": spk_id,
                    "text": display_text,
                    "ga_enabled": self.ga_enabled,
                })
                
        except Exception as e:
            self._send_message({
                "type": "error",
                "message": f"处理结果失败: {str(e)}"
            })
    
    def _send_message(self, message: Dict[str, Any]):
        """发送消息到 stdout"""
        try:
            message["serverTime"] = int(time.time() * 1000)
            print(json.dumps(message, ensure_ascii=False))
            sys.stdout.flush()
        except Exception as e:
            print(json.dumps({"type": "error", "message": f"发送消息失败: {e}"}), file=sys.stderr)


class EchoTranscribeGAService:
    """Echo Transcribe GA 实时转录服务 - 配置 Global Accelerator"""
    
    def __init__(self):
        self.recognizer: Optional[Recognition] = None
        self.callback: Optional[EchoTranscribeGACallback] = None
        self.api_key: Optional[str] = None
        self.model_name: str = "fun-asr-realtime-2025-11-07"  # echo-transcribe 默认模型
        self.noise_threshold: int = 500  # echo-transcribe 默认噪音阈值
        self.initialized: bool = False
        self.audio_packet_count = 0
        self.phy_silence_start: Optional[float] = None
        self.ga_enabled = GA_ENDPOINT is not None
    
    def initialize(self, api_key: str, model_name: str, noise_threshold: int = 500,
                   commit_timeout: float = 1.2, silence_threshold: float = 1.5,
                   turn_detection_silence_duration_ms: int = 800, turn_detection_threshold: float = 0.35):
        """初始化识别器 - 使用 echo-transcribe 的配置 + GA endpoint"""
        if self.initialized:
            return
        
        self.api_key = api_key
        self.model_name = model_name
        self.noise_threshold = noise_threshold
        # Echo Transcribe 专用参数
        self.commit_timeout = commit_timeout
        self.turn_detection_silence_duration_ms = turn_detection_silence_duration_ms
        self.turn_detection_threshold = turn_detection_threshold
        
        dashscope.api_key = api_key
        
        # 如果有 GA endpoint，再次确认配置（防止被重置）
        if GA_ENDPOINT:
            dashscope.api_base = GA_ENDPOINT
            print(f"🌐 [GA] 已配置 Global Accelerator endpoint: {GA_ENDPOINT}", file=sys.stderr)
        
        self.callback = EchoTranscribeGACallback(self)
        # 设置 callback 的 silence_threshold
        self.callback.silence_threshold = silence_threshold
        
        try:
            # 创建识别器，使用 echo-transcribe 的配置
            self.recognizer = Recognition(
                model=self.model_name,
                format='pcm',
                sample_rate=16000,  # echo-transcribe 固定使用 16kHz
                callback=self.callback,
                enable_turn_detection=True,  # echo-transcribe 开启轮换检测
                turn_detection_threshold=self.turn_detection_threshold,  # 使用配置的阈值
                turn_detection_silence_duration_ms=self.turn_detection_silence_duration_ms,  # 使用配置的静音时长
                disabling_speaker_diarization=False  # echo-transcribe 开启说话人分离
            )
            
            # 关键：必须调用 start() 方法启动识别器（与 echo-transcribe 完全一致）
            self.recognizer.start()
            self.initialized = True
            
            ga_status = "🌐 [GA] " if self.ga_enabled else ""
            print(f"{ga_status}SDK Started (GA Version)", file=sys.stderr)
            
            self._send_message({
                "type": "status",
                "message": f"{ga_status}✅ 已初始化（GA版本），模型: {self.model_name}, GA: {'已启用' if self.ga_enabled else '未启用（使用默认endpoint）'}"
            })
        except Exception as e:
            self._send_message({
                "type": "error",
                "message": f"初始化失败: {str(e)}"
            })
            print(f"SDK Error: {e}", file=sys.stderr)
            raise
    
    def send_audio_frame(self, pcm_data: bytes):
        """发送音频帧 - 复现 echo-transcribe 的噪音过滤逻辑"""
        if not self.initialized or not self.recognizer:
            return
        
        # 计算 RMS 值
        rms = calculate_rms(pcm_data)
        
        # echo-transcribe 的噪音过滤逻辑
        if rms < self.noise_threshold:
            # 噪音太小，处理静音
            if self.phy_silence_start is None:
                self.phy_silence_start = time.time()
            
            # 如果静音超过 0.5 秒，发送静音帧
            if (time.time() - self.phy_silence_start) > 0.5:
                try:
                    self.recognizer.send_audio_frame(b'\x00' * len(pcm_data))
                except Exception:
                    pass
            else:
                # 静音时间较短，仍然发送原始数据
                try:
                    self.recognizer.send_audio_frame(pcm_data)
                except Exception:
                    pass
        else:
            # 有声音，重置静音计时器并发送音频
            self.phy_silence_start = None
            try:
                self.recognizer.send_audio_frame(pcm_data)
            except Exception:
                pass
    
    def stop(self):
        """停止识别器"""
        if self.recognizer:
            try:
                self.recognizer.stop()
            except Exception:
                pass
        self.initialized = False
        self._send_message({"type": "status", "message": "⏹️ 已停止"})
    
    def _send_message(self, message: Dict[str, Any]):
        """发送消息"""
        try:
            print(json.dumps(message, ensure_ascii=False))
            sys.stdout.flush()
        except Exception as e:
            print(json.dumps({"type": "error", "message": f"发送消息失败: {e}"}), file=sys.stderr)


def main():
    """主函数 - 通过 stdin/stdout 与 Node.js 通信"""
    service = EchoTranscribeGAService()
    
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
                    model_name = message.get("model_name", "fun-asr-realtime-2025-11-07")
                    noise_threshold = message.get("noise_threshold", 500)
                    # Echo Transcribe 专用参数
                    commit_timeout = message.get("commit_timeout", 1.2)
                    silence_threshold = message.get("silence_threshold", 1.5)
                    turn_detection_silence_duration_ms = message.get("turn_detection_silence_duration_ms", 800)
                    turn_detection_threshold = message.get("turn_detection_threshold", 0.35)
                    
                    if not api_key:
                        service._send_message({"type": "error", "message": "API密钥未提供"})
                        continue
                    
                    service.initialize(api_key, model_name, noise_threshold,
                                    commit_timeout, silence_threshold,
                                    turn_detection_silence_duration_ms, turn_detection_threshold)
                
                elif msg_type == "audio":
                    # 接收音频数据（base64编码的PCM数据）
                    import base64
                    audio_data_b64 = message.get("data", "")
                    if audio_data_b64:
                        pcm_data = base64.b64decode(audio_data_b64)
                        service.send_audio_frame(pcm_data)
                
                elif msg_type == "stop":
                    # 停止识别
                    service.stop()
                    break
                    
            except json.JSONDecodeError as e:
                service._send_message({
                    "type": "error",
                    "message": f"JSON解析错误: {str(e)}"
                })
            except Exception as e:
                service._send_message({
                    "type": "error",
                    "message": f"处理消息失败: {str(e)}"
                })
    
    except KeyboardInterrupt:
        service.stop()
    except Exception as e:
        service._send_message({
            "type": "error",
            "message": f"服务异常: {str(e)}"
        })


if __name__ == "__main__":
    main()
