#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Echo Transcribe 实时语音转录服务
基于 echo-transcribe 项目的实现，复现其三层漏斗策略和配置
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
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=True)
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace', line_buffering=True)
    sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8', errors='replace')

try:
    import dashscope
    from dashscope.audio.asr import Recognition, RecognitionCallback, RecognitionResult
except ImportError as e:
    print(json.dumps({"type": "error", "message": f"缺少依赖库 dashscope，请运行: pip install dashscope"}))
    sys.exit(1)


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


class EchoTranscribeCallback(RecognitionCallback):
    """Echo Transcribe 回调处理器 - 复现三层漏斗策略"""
    
    def __init__(self, service):
        self.service = service
        self.current_sentence_id = None
        self.committed_offset = 0
        self.last_text_content = ""
        self.last_text_change_time = time.time()
        self.sentence_id_to_speaker = {}  # 用于跟踪 sentence_id 到 speaker_id 的映射
        self.speaker_counter = 1  # 用于分配新的 speaker_id
        self.last_commit_time = time.time()  # 上次 commit 的时间
        self.last_speaker_id = None  # 上次的 speaker_id
        self.silence_threshold = 1.5  # 静音阈值（秒），超过这个时间可能表示说话人切换
        self.last_commit_time = time.time()  # 上次 commit 的时间
        self.last_speaker_id = None  # 上次的 speaker_id
        self.silence_threshold = 1.5  # 静音阈值（秒），超过这个时间可能表示说话人切换
    
    def on_open(self):
        """连接建立"""
        self._send_message({"type": "status", "message": "✅ 连接建立，正在转录..."})
    
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
            # ✅ 调试：打印完整的 sentence 数据（前几次）
            if text and self.service.audio_packet_count < 5:  # 只打印前几次，避免日志过多
                print(f"DEBUG: 完整 sentence 数据: {sentence}", file=sys.stderr)
            
            # ✅ 修复：尝试多种方式获取 speaker_id
            spk_id = None
            # 尝试不同的字段名
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
            
            # 如果还是没有，使用基于 sentence_id 变化的智能分配（临时方案）
            if spk_id is None or spk_id == '':
                # ✅ 修复：当 SDK 没有返回 speaker_id 时，使用 sentence_id 的变化来智能分配说话人
                # 当 sentence_id 变化时，可能表示说话人变化了
                if sid is not None:
                    # 如果这个 sentence_id 之前没有分配过 speaker_id，分配一个新的
                    if sid not in self.sentence_id_to_speaker:
                        # 如果当前有正在进行的 sentence_id，说明可能是新说话人
                        if self.current_sentence_id is not None and sid != self.current_sentence_id:
                            # sentence_id 变化，可能是新说话人，分配 speaker_id=2
                            # 否则分配 speaker_id=1
                            if len(self.sentence_id_to_speaker) == 0:
                                self.sentence_id_to_speaker[sid] = 1
                            else:
                                # ✅ 修复：支持多个说话人，分配下一个可用的 speaker_id
                                existing_speakers = set(self.sentence_id_to_speaker.values())
                                # 找到下一个可用的 speaker_id（从 1 开始递增）
                                next_speaker_id = 1
                                while next_speaker_id in existing_speakers:
                                    next_speaker_id += 1
                                self.sentence_id_to_speaker[sid] = next_speaker_id
                        else:
                            # 第一个 sentence_id，分配 speaker_id=1
                            self.sentence_id_to_speaker[sid] = 1
                    spk_id = self.sentence_id_to_speaker[sid]
                    if self.service.audio_packet_count < 5:
                        print(f"DEBUG: speaker_id 为空，基于 sentence_id={sid} 分配 speaker_id={spk_id}", file=sys.stderr)
                else:
                    spk_id = 1
            else:
                try:
                    spk_id = int(spk_id)  # 确保是整数
                    # 保存 SDK 返回的 speaker_id 到映射中
                    if sid is not None:
                        self.sentence_id_to_speaker[sid] = spk_id
                    if self.service.audio_packet_count < 5:
                        print(f"DEBUG: 使用 SDK 返回的 speaker_id={spk_id}", file=sys.stderr)
                except (ValueError, TypeError):
                    # 转换失败，使用基于 sentence_id 的分配
                    if sid is not None and sid not in self.sentence_id_to_speaker:
                        self.sentence_id_to_speaker[sid] = 1
                    spk_id = self.sentence_id_to_speaker.get(sid, 1) if sid is not None else 1
                    if self.service.audio_packet_count < 5:
                        print(f"DEBUG: speaker_id 转换失败，使用分配的 speaker_id={spk_id}", file=sys.stderr)
            
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
                # sentence_id 变化，可能是新说话人
                old_sid = self.current_sentence_id
                self.current_sentence_id = sid
                self.committed_offset = 0
                display_text = text
                
                # ✅ 修复：当 sentence_id 变化时，如果新的 sentence_id 还没有分配 speaker_id，现在分配
                if sid is not None and sid not in self.sentence_id_to_speaker:
                    existing_speakers = set(self.sentence_id_to_speaker.values())
                    if len(existing_speakers) == 0:
                        # 第一个 sentence_id，分配 speaker_id=1
                        self.sentence_id_to_speaker[sid] = 1
                    else:
                        # ✅ 修复：支持多个说话人，分配下一个可用的 speaker_id
                        # 找到下一个可用的 speaker_id（从 1 开始递增）
                        next_speaker_id = 1
                        while next_speaker_id in existing_speakers:
                            next_speaker_id += 1
                        self.sentence_id_to_speaker[sid] = next_speaker_id
                    # 更新当前使用的 spk_id
                    spk_id = self.sentence_id_to_speaker[sid]
                    if self.service.audio_packet_count < 10:
                        print(f"DEBUG: sentence_id 变化 ({old_sid} -> {sid})，分配 speaker_id={spk_id}", file=sys.stderr)
                elif sid is not None and sid in self.sentence_id_to_speaker:
                    # 如果这个 sentence_id 之前已经分配过 speaker_id，使用之前的
                    spk_id = self.sentence_id_to_speaker[sid]
            elif self.current_sentence_id is not None and sid == self.current_sentence_id:
                # ✅ 修复：即使 sentence_id 相同，如果静音时间较长，也可能是新说话人
                # 检查时间间隔，如果超过阈值，可能是说话人切换
                if time_since_last_commit > self.silence_threshold and sid is not None:
                    # 静音时间较长，可能是新说话人，但 sentence_id 还没变化
                    # 为当前 sentence_id 分配新的 speaker_id（如果还没有分配过）
                    if sid not in self.sentence_id_to_speaker:
                        existing_speakers = set(self.sentence_id_to_speaker.values())
                        next_speaker_id = 1
                        while next_speaker_id in existing_speakers:
                            next_speaker_id += 1
                        self.sentence_id_to_speaker[sid] = next_speaker_id
                        spk_id = next_speaker_id
                        if self.service.audio_packet_count < 10:
                            print(f"DEBUG: 长时间静音 ({time_since_last_commit:.2f}s)，为 sentence_id={sid} 分配新 speaker_id={spk_id}", file=sys.stderr)
                    else:
                        # 已经有 speaker_id，检查是否需要切换
                        current_spk = self.sentence_id_to_speaker[sid]
                        # 如果静音时间很长（>2秒），可能是新说话人，尝试分配新的 speaker_id
                        if time_since_last_commit > 2.0 and current_spk == self.last_speaker_id:
                            existing_speakers = set(self.sentence_id_to_speaker.values())
                            next_speaker_id = 1
                            while next_speaker_id in existing_speakers:
                                next_speaker_id += 1
                            # 为这个 sentence_id 分配新的 speaker_id
                            self.sentence_id_to_speaker[sid] = next_speaker_id
                            spk_id = next_speaker_id
                            if self.service.audio_packet_count < 10:
                                print(f"DEBUG: 超长静音 ({time_since_last_commit:.2f}s)，切换 speaker_id {current_spk} -> {spk_id}", file=sys.stderr)
                        else:
                            spk_id = current_spk
            
            if self.current_sentence_id is None:
                self.current_sentence_id = sid
                # 为第一个 sentence_id 分配 speaker_id=1
                if sid is not None and sid not in self.sentence_id_to_speaker:
                    self.sentence_id_to_speaker[sid] = 1
                    spk_id = 1
            
            # 推送数据
            if should_commit:
                commit_chunk = text[self.committed_offset:split_idx]
                self.committed_offset = split_idx
                
                if commit_chunk.strip():
                    # ✅ 更新最后 commit 时间和 speaker_id
                    self.last_commit_time = current_time
                    self.last_speaker_id = spk_id
                    
                    # ✅ 调试：打印 speaker_id 信息
                    print(f"DEBUG: 发送 commit, speaker_id={spk_id}, text={commit_chunk.strip()[:50]}", file=sys.stderr)
                    self._send_message({
                        "type": "commit",
                        "speaker_id": spk_id,
                        "text": commit_chunk.strip(),
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
                    })
                
                self.last_text_change_time = current_time
            else:
                # 发送临时文本
                self._send_message({
                    "type": "partial",
                    "speaker_id": spk_id,
                    "text": display_text,
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


class EchoTranscribeService:
    """Echo Transcribe 实时转录服务 - 复现 echo-transcribe 的配置"""
    
    def __init__(self):
        self.recognizer: Optional[Recognition] = None
        self.callback: Optional[EchoTranscribeCallback] = None
        self.api_key: Optional[str] = None
        self.model_name: str = "fun-asr-realtime-2025-11-07"  # echo-transcribe 默认模型
        self.noise_threshold: int = 500  # echo-transcribe 默认噪音阈值
        self.initialized: bool = False
        self.audio_packet_count = 0
        self.phy_silence_start: Optional[float] = None
    
    def initialize(self, api_key: str, model_name: str, noise_threshold: int = 500,
                   commit_timeout: float = 1.2, silence_threshold: float = 1.5,
                   turn_detection_silence_duration_ms: int = 800, turn_detection_threshold: float = 0.35):
        """初始化识别器 - 使用 echo-transcribe 的配置"""
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
        self.callback = EchoTranscribeCallback(self)
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
            
            print("SDK Started", file=sys.stderr)  # 与 echo-transcribe 一致
            
            self._send_message({
                "type": "status",
                "message": f"✅ 已初始化，模型: {self.model_name}"
            })
        except Exception as e:
            self._send_message({
                "type": "error",
                "message": f"初始化失败: {str(e)}"
            })
            print(f"SDK Error: {e}", file=sys.stderr)  # 与 echo-transcribe 一致
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
    service = EchoTranscribeService()
    
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
