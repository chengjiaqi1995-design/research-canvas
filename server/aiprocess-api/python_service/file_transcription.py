#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
文件音频转录 Python 服务
使用 DashScope SDK 进行文件音频转录
通过命令行参数接收文件路径，输出转录结果到 stdout
"""

import sys
import json
import io
import os
import time
import urllib.parse
import requests

# 修复 Windows 编码问题：强制使用 UTF-8
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=True)
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace', line_buffering=True)

try:
    import dashscope
    from dashscope.audio.asr import Transcription
    # 导入通义千问 ASR 专用 API（用于 qwen3-asr-flash-filetrans 模型）
    from dashscope.audio.qwen_asr import QwenTranscription
    print(f"✅ dashscope 导入成功", file=sys.stderr)
except ImportError as e:
    error_msg = f"缺少依赖库 dashscope，请运行: pip install dashscope。错误详情: {str(e)}"
    print(json.dumps({"type": "error", "message": error_msg}))
    print(f"❌ 导入错误: {str(e)}", file=sys.stderr)
    print(f"❌ Python 路径: {sys.executable}", file=sys.stderr)
    print(f"❌ Python 版本: {sys.version}", file=sys.stderr)
    print(f"❌ sys.path: {sys.path}", file=sys.stderr)
    sys.exit(1)


def transcribe_file(file_path: str, api_key: str, model: str = 'paraformer-realtime-v2') -> dict:
    """
    使用 DashScope 进行文件音频转录
    使用 Paraformer 实时模型（支持文件转录、说话人分离和时间戳）
    
    Args:
        file_path: 音频文件路径或URL
        api_key: DashScope API 密钥
        model: 模型名称，默认 paraformer-realtime-v2
              注意：文件转录使用实时模型
    
    Returns:
        转录文本和带时间戳的分段
    """
    try:
        # 设置 API 密钥
        dashscope.api_key = api_key
        
        # 检查文件路径类型
        is_http_url = file_path.startswith('http://') or file_path.startswith('https://')
        is_oss_url = file_path.startswith('oss://')  # 阿里云 OSS 协议
        
        if is_http_url:
            print(f"📁 检测到 HTTP/HTTPS URL: {file_path}", file=sys.stderr)
            # HTTP/HTTPS URL 不需要检查本地文件是否存在
        elif is_oss_url:
            print(f"📁 检测到 OSS 协议 URL: {file_path}", file=sys.stderr)
            # oss:// URL 由 DashScope 直接访问，不需要检查本地文件
        else:
            # 本地文件路径，检查文件是否存在
            if not os.path.exists(file_path):
                raise FileNotFoundError(f"文件不存在: {file_path}")
            print(f"📁 检测到本地文件路径: {file_path}", file=sys.stderr)
            print(f"📦 文件大小: {os.path.getsize(file_path)} bytes", file=sys.stderr)
        
        # 步骤2: 创建转录任务
        # 对于本地文件，使用阿里云OSS临时URL或直接上传文件内容
        print(f"🎤 正在创建转录任务，使用模型: {model}...", file=sys.stderr)
        
        # 检测是否使用通义千问 ASR 模型（需要使用不同的 API）
        is_qwen_asr_model = model.startswith('qwen3-asr') or model.startswith('qwen-audio-asr')
        
        if is_qwen_asr_model:
            print(f"🔧 检测到通义千问 ASR 模型，使用 QwenTranscription API", file=sys.stderr)
        
        try:
            # 根据文件路径类型选择不同的API调用方式
            if file_path.startswith('http://') or file_path.startswith('https://') or file_path.startswith('oss://'):
                # 如果是 HTTP/HTTPS/OSS URL
                url_type = "OSS" if file_path.startswith('oss://') else "HTTP/HTTPS"
                print(f"📂 使用 {url_type} URL 方式转录: {file_path}", file=sys.stderr)
                
                if is_qwen_asr_model:
                    # 使用通义千问 ASR 专用 API
                    print(f"🎯 使用 QwenTranscription.async_call...", file=sys.stderr)
                    task_response = QwenTranscription.async_call(
                        model=model,
                        file_url=file_path,  # 注意：QwenTranscription 使用 file_url（单个URL），不是 file_urls
                        enable_itn=False  # ITN（逆文本正则化）
                    )
                else:
                    # 使用 Paraformer/SenseVoice API
                    print(f"🎯 启用说话人分离和时间戳对齐...", file=sys.stderr)
                    task_response = Transcription.call(
                        model=model,
                        file_urls=[file_path],
                        language_hints=['zh', 'en'],  # 语言提示：中文和英文
                        diarization_enabled=True,  # 启用说话人分离
                        disfluency_removal_enabled=True,  # 移除口头禅
                        timestamp_alignment_enabled=True  # 时间戳对齐
                    )
            else:
                # 本地文件路径 - 需要上传到临时文件服务获取公开URL
                print(f"📂 本地文件转录: {file_path}", file=sys.stderr)
                print(f"📤 正在上传文件到临时服务器获取公开URL...", file=sys.stderr)
                
                # 上传到临时文件服务（file.io）获取公开URL
                try:
                    with open(file_path, 'rb') as f:
                        files = {'file': f}
                        # file.io: 上传后返回临时URL，有效期24小时或下载一次后失效
                        response = requests.post('https://file.io', files=files)
                        response.raise_for_status()
                        result = response.json()
                        
                        if not result.get('success'):
                            raise Exception(f"文件上传失败: {result.get('message', '未知错误')}")
                        
                        temp_url = result.get('link')
                        if not temp_url:
                            raise Exception("未能获取临时URL")
                        
                        print(f"✅ 文件已上传到临时服务器: {temp_url}", file=sys.stderr)
                        print(f"⏰ 临时URL有效期：24小时或单次下载", file=sys.stderr)
                        
                        # 使用临时URL进行转录
                        if is_qwen_asr_model:
                            # 使用通义千问 ASR 专用 API
                            print(f"🎯 使用 QwenTranscription.async_call...", file=sys.stderr)
                            task_response = QwenTranscription.async_call(
                                model=model,
                                file_url=temp_url,
                                enable_itn=False
                            )
                        else:
                            print(f"🎯 启用说话人分离和时间戳对齐...", file=sys.stderr)
                            task_response = Transcription.call(
                                model=model,
                                file_urls=[temp_url],
                                language_hints=['zh', 'en'],  # 语言提示：中文和英文
                                diarization_enabled=True,  # 启用说话人分离
                                disfluency_removal_enabled=True,  # 移除口头禅
                                timestamp_alignment_enabled=True  # 时间戳对齐
                            )
                        
                except FileNotFoundError:
                    raise Exception(f"文件不存在: {file_path}")
                except requests.exceptions.RequestException as e:
                    raise Exception(f"上传文件到临时服务器失败: {str(e)}")
                except Exception as e:
                    raise Exception(f"处理本地文件时出错: {str(e)}")
            
            print(f"📊 转录任务响应状态码: {task_response.status_code}", file=sys.stderr)
            print(f"📊 转录任务响应输出: {task_response.output if hasattr(task_response, 'output') else 'N/A'}", file=sys.stderr)
            
            if task_response.status_code != 200:
                error_msg = task_response.message if hasattr(task_response, 'message') else str(task_response)
                error_details = task_response.output if hasattr(task_response, 'output') else {}
                error_code = error_details.get('code', '') if isinstance(error_details, dict) else ''
                
                # 详细的错误信息输出
                print(f"❌ 错误代码: {error_code}", file=sys.stderr)
                print(f"❌ 错误消息: {error_msg}", file=sys.stderr)
                print(f"❌ 错误详情: {error_details}", file=sys.stderr)
                
                # 根据错误类型提供解决方案
                if 'DECODE_ERROR' in str(error_msg) or 'DECODE_ERROR' in str(error_code):
                    raise Exception(
                        f"音频解码失败。可能的原因：\n"
                        f"1. 音频格式不支持（建议使用 mp3, wav, m4a, flac）\n"
                        f"2. 文件损坏或不完整\n"
                        f"3. URL 无法访问（请确保GCS文件设置为公开访问）\n"
                        f"4. 文件大小超过限制\n\n"
                        f"文件URL: {file_path}\n"
                        f"错误详情: {error_msg}"
                    )
                elif 'url' in error_msg.lower() or error_code == 'InvalidParameter':
                    additional_info = ""
                    if not is_http_url:
                        additional_info = "\n\n提示：DashScope API 可能不支持本地文件的 file:// 协议。\n" \
                                         "请确保文件已上传到可访问的 HTTP/HTTPS URL（如 Google Cloud Storage）。"
                    raise Exception(f"创建转录任务失败 (状态码: {task_response.status_code}): {error_msg}\n" \
                                  f"使用的 URL: {file_path}{additional_info}\n" \
                                  f"详情: {error_details}")
                else:
                    raise Exception(f"创建转录任务失败 (状态码: {task_response.status_code}): {error_msg}。详情: {error_details}")
        except Exception as e:
            print(f"❌ 创建转录任务错误: {str(e)}", file=sys.stderr)
            raise
        
        task_id = task_response.output.get('task_id')
        if not task_id:
            # 如果直接返回结果（同步）
            result = task_response.output
            # 尝试多种可能的数据结构
            transcript_sentences = result.get('sentences', [])
            if not transcript_sentences:
                transcript_sentences = result.get('transcripts', [])
            if not transcript_sentences and 'results' in result:
                transcript_sentences = result.get('results', [])
            
            if not transcript_sentences:
                # 如果没有句子数组，尝试获取纯文本
                transcript_text = result.get('text', '')
                if isinstance(transcript_text, str):
                    # 返回简单的文本格式
                    return {
                        'text': transcript_text,
                        'segments': []
                    }
                else:
                    raise Exception("转录结果格式不正确")
            
            # 处理句子数组，提取说话人信息和时间戳
            segments = []
            full_text = ''
            for sentence in transcript_sentences:
                # 兼容多种数据结构
                text = sentence.get('text', '') or sentence.get('transcript', '') or sentence.get('content', '')
                text = text.strip()
                
                # 说话人ID（可能是 speaker_id, spk_id 或 speaker）
                speaker_id = sentence.get('speaker_id') or sentence.get('spk_id') or sentence.get('speaker', 0)
                
                # 时间戳（单位可能是毫秒或秒）
                start_time = sentence.get('start_time') or sentence.get('begin_time') or sentence.get('start', 0)
                end_time = sentence.get('end_time') or sentence.get('end', 0)
                
                # 如果时间戳是毫秒，转换为秒
                if start_time > 10000:  # 假设超过10000的是毫秒
                    start_time = start_time / 1000.0
                if end_time > 10000:
                    end_time = end_time / 1000.0
                
                if text:
                    segments.append({
                        'text': text,
                        'speakerId': int(speaker_id) if speaker_id is not None else 0,
                        'startTime': float(start_time),
                        'endTime': float(end_time)
                    })
                    full_text += text + ' '
            
            if not full_text.strip():
                raise Exception("转录文本为空")
            
            print(f"✅ 转录完成，文本长度: {len(full_text)} 字符，分段数: {len(segments)}", file=sys.stderr)
            return {
                'text': full_text.strip(),
                'segments': segments
            }
        
        # 步骤3: 等待异步任务完成
        print(f"✅ 转录任务已创建，任务ID: {task_id}", file=sys.stderr)
        print("⏳ 正在手动轮询转录进度(代替易崩溃的 SDK wait 方法)...", file=sys.stderr)
        
        wait_response = None
        consecutive_ssl_errors = 0
        max_ssl_errors = 30  # 容忍高达连续 30 次（约1分半钟）的短暂网络波动
        poll_interval = 3
        
        while True:
            try:
                if is_qwen_asr_model:
                    wait_response = QwenTranscription.fetch(task=task_id)
                else:
                    wait_response = Transcription.fetch(task=task_id)
                
                if wait_response and wait_response.status_code == 200:
                    # 成功连接到 API 获取状态
                    output = wait_response.output
                    status = output.get('task_status') or output.get('status')
                    
                    if status in ['SUCCEEDED', 'succeeded', 'FAILED', 'failed']:
                        break  # 任务达到终态，跳出死循环
                    
                    # 还在 RUNNING 或 PENDING，打印一句话证明还活着
                    print(f"🔄 任务仍在处理中 ({status})，继续等待...", file=sys.stderr)
                    # 通讯成功一次，清空连续网络报错的计数器
                    consecutive_ssl_errors = 0
                    time.sleep(poll_interval)
                else:
                    # 如果返回的 HTTP status code 不是 200，说明 API 级别拒绝（不是底层网络波动），跳出交由下文处理
                    break
                    
            except Exception as e:
                error_str = str(e)
                error_type = type(e).__name__
                
                # 检查是否是底层网络库的异常抖动
                is_ssl_error = (
                    'SSL' in error_str or 
                    'SSLError' in error_type or 
                    'SSLEOFError' in error_type or
                    'HTTPSConnectionPool' in error_str or
                    'EOF occurred in violation of protocol' in error_str or
                    'UNEXPECTED_EOF_WHILE_READING' in error_str or
                    'ConnectionError' in error_type or
                    'ConnectionResetError' in error_type
                )
                
                if is_ssl_error:
                    consecutive_ssl_errors += 1
                    if consecutive_ssl_errors < max_ssl_errors:
                        print(f"⚠️ 轮询时遇到短暂网络波动（{error_type}），任务在云端不受影响。忽略并继续等待 ({consecutive_ssl_errors}/{max_ssl_errors})...", file=sys.stderr)
                        time.sleep(poll_interval)
                        continue
                    else:
                        raise Exception(f"连续 {max_ssl_errors} 次网络连接断开，请检查网络环境。最后的错误: {error_str[:200]}")
                else:
                    # 非网络报错的其它问题，直接抛出
                    raise
        
        # 检查最终结果
        if not wait_response or wait_response.status_code != 200:
            error_msg = wait_response.message if wait_response and hasattr(wait_response, 'message') else str(wait_response) if wait_response else "未知错误"
            error_details = wait_response.output if wait_response and hasattr(wait_response, 'output') else {}
            raise Exception(f"等待任务完成失败 (状态码: {wait_response.status_code if wait_response else 'N/A'}): {error_msg}。详情: {error_details}")
        
        output = wait_response.output
        status = output.get('task_status') or output.get('status')
        
        if status == 'SUCCEEDED' or status == 'succeeded':
                # 检查是否有 results 数组（批量转录格式）
                if 'results' in output and isinstance(output['results'], list):
                    # 批量转录格式，每个文件有一个 transcription_url
                    print(f"📥 检测到批量转录格式，正在下载转录结果...", file=sys.stderr)
                    
                    for result_item in output['results']:
                        transcription_url = result_item.get('transcription_url')
                        if transcription_url:
                            print(f"📥 正在下载转录结果: {transcription_url}", file=sys.stderr)
                            try:
                                # 下载转录结果JSON
                                response = requests.get(transcription_url, timeout=30)
                                response.raise_for_status()
                                transcription_data = response.json()
                                print(f"✅ 转录结果下载成功", file=sys.stderr)
                                
                                # 打印结果结构（用于调试）
                                print(f"🔍 转录结果JSON结构: {list(transcription_data.keys())}", file=sys.stderr)
                                if 'transcripts' in transcription_data:
                                    print(f"🔍 transcripts 数量: {len(transcription_data.get('transcripts', []))}", file=sys.stderr)
                                    if transcription_data.get('transcripts'):
                                        first_item = transcription_data['transcripts'][0]
                                        print(f"🔍 第一个transcript字段: {list(first_item.keys())}", file=sys.stderr)
                                        print(f"🔍 是否有speaker_id: {'speaker_id' in first_item or 'spk_id' in first_item or 'speaker' in first_item}", file=sys.stderr)
                                
                                # 从下载的JSON中提取转录内容
                                result = transcription_data
                                break  # 只处理第一个文件
                            except Exception as download_error:
                                print(f"❌ 下载转录结果失败: {str(download_error)}", file=sys.stderr)
                                raise Exception(f"下载转录结果失败: {str(download_error)}")
                        else:
                            # 没有 transcription_url，尝试直接从 result_item 获取
                            result = result_item
                            break
                else:
                    # 单文件转录格式，直接从 output.result 获取
                    result = output.get('result', {})
                
                # 检查 result 是否直接包含 transcription_url（QwenTranscription 格式）
                if 'transcription_url' in result:
                    transcription_url = result.get('transcription_url')
                    print(f"📥 检测到 QwenTranscription 格式，正在下载转录结果: {transcription_url}", file=sys.stderr)
                    try:
                        response = requests.get(transcription_url, timeout=60)
                        response.raise_for_status()
                        transcription_data = response.json()
                        print(f"✅ 转录结果下载成功", file=sys.stderr)
                        print(f"🔍 转录结果JSON结构: {list(transcription_data.keys())}", file=sys.stderr)
                        result = transcription_data
                    except Exception as download_error:
                        print(f"❌ 下载转录结果失败: {str(download_error)}", file=sys.stderr)
                        raise Exception(f"下载转录结果失败: {str(download_error)}")
                
                # 尝试多种可能的数据结构
                transcript_sentences = []
                
                # 优先从 sentences 字段获取（直接格式）
                if 'sentences' in result:
                    transcript_sentences = result.get('sentences', [])
                    print(f"🔍 使用 sentences 字段，数量: {len(transcript_sentences)}", file=sys.stderr)
                # 从 transcripts 数组中提取 sentences（嵌套格式）
                elif 'transcripts' in result:
                    transcripts = result.get('transcripts', [])
                    print(f"🔍 使用 transcripts 字段，数量: {len(transcripts)}", file=sys.stderr)
                    for transcript in transcripts:
                        if isinstance(transcript, dict) and 'sentences' in transcript:
                            sentences_in_transcript = transcript.get('sentences', [])
                            print(f"🔍 从 transcript 中提取到 {len(sentences_in_transcript)} 个句子", file=sys.stderr)
                            transcript_sentences.extend(sentences_in_transcript)
                        elif isinstance(transcript, dict):
                            # 如果transcript本身就是句子格式
                            transcript_sentences.append(transcript)
                # 从 results 字段获取
                elif 'results' in result:
                    transcript_sentences = result.get('results', [])
                
                if not transcript_sentences:
                    # 如果没有句子数组，尝试获取纯文本
                    transcript_text = result.get('text', '')
                    if isinstance(transcript_text, str) and transcript_text:
                        return {
                            'text': transcript_text,
                            'segments': []
                        }
                    else:
                        print(f"❌ 转录结果格式不正确，无法找到转录内容", file=sys.stderr)
                        print(f"   结果结构: {list(result.keys())}", file=sys.stderr)
                        raise Exception("转录结果格式不正确，未找到句子数组或文本")
                
                # 处理句子数组，提取说话人信息和时间戳
                segments = []
                full_text = ''
                speaker_ids_found = set()
                
                for idx, sentence in enumerate(transcript_sentences):
                    # 兼容多种数据结构
                    text = sentence.get('text', '') or sentence.get('transcript', '') or sentence.get('content', '')
                    text = text.strip()
                    
                    # 说话人ID（可能是 speaker_id, spk_id 或 speaker）
                    speaker_id = sentence.get('speaker_id') or sentence.get('spk_id') or sentence.get('speaker', 0)
                    speaker_ids_found.add(speaker_id)
                    
                    # 打印前3个句子的详细信息（调试用）
                    if idx < 3:
                        print(f"🔍 句子{idx}字段: {list(sentence.keys())}", file=sys.stderr)
                        print(f"🔍 句子{idx}说话人ID: {speaker_id}", file=sys.stderr)
                    
                    # 时间戳（单位可能是毫秒或秒）
                    start_time = sentence.get('start_time') or sentence.get('begin_time') or sentence.get('start', 0)
                    end_time = sentence.get('end_time') or sentence.get('end', 0)
                    
                    # 如果时间戳是毫秒，转换为秒
                    if start_time > 10000:  # 假设超过10000的是毫秒
                        start_time = start_time / 1000.0
                    if end_time > 10000:
                        end_time = end_time / 1000.0
                    
                    if text:
                        segments.append({
                            'text': text,
                            'speakerId': int(speaker_id) if speaker_id is not None else 0,
                            'startTime': float(start_time),
                            'endTime': float(end_time)
                        })
                        full_text += text + ' '
                
                if not full_text.strip():
                    raise Exception("转录文本为空")
                
                print(f"✅ 原始转录完成，文本长度: {len(full_text)} 字符，分段数: {len(segments)}", file=sys.stderr)
                print(f"🎤 检测到的说话人数量: {len(speaker_ids_found)}，说话人ID: {sorted(speaker_ids_found)}", file=sys.stderr)
                
                # 检查是否只有一个说话人（不支持说话人分离的模型，如 qwen3-asr-flash-filetrans）
                only_one_speaker = len(speaker_ids_found) <= 1
                
                if only_one_speaker:
                    # 对于不支持说话人分离的模型，使用基于文本长度的分段策略
                    print(f"🔗 检测到单说话人模式，使用文本长度分段策略...", file=sys.stderr)
                    merged_segments = []
                    max_chars_per_segment = 400  # 每段最多 400 个字符
                    
                    for segment in segments:
                        if not merged_segments:
                            merged_segments.append(segment.copy())
                        else:
                            last_segment = merged_segments[-1]
                            # 如果当前段落文本长度 + 新句子长度 < 阈值，则合并
                            if len(last_segment['text']) + len(segment['text']) < max_chars_per_segment:
                                last_segment['text'] += ' ' + segment['text']
                                last_segment['endTime'] = segment['endTime']
                            else:
                                # 否则创建新段落
                                merged_segments.append(segment.copy())
                else:
                    # 对于支持说话人分离的模型，使用原有的合并逻辑
                    print(f"🔗 正在合并同一说话人的连续句子...", file=sys.stderr)
                    merged_segments = []
                    max_gap_seconds = 2.0  # 最大间隔时间（秒），超过此时间则不合并
                    
                    for segment in segments:
                        if not merged_segments:
                            merged_segments.append(segment)
                        else:
                            last_segment = merged_segments[-1]
                            time_gap = segment['startTime'] - last_segment['endTime']
                            if (segment['speakerId'] == last_segment['speakerId'] and 
                                time_gap <= max_gap_seconds):
                                last_segment['text'] += ' ' + segment['text']
                                last_segment['endTime'] = segment['endTime']
                            else:
                                merged_segments.append(segment)
                
                print(f"✅ 合并完成，分段数: {len(segments)} → {len(merged_segments)}", file=sys.stderr)
                
                return {
                    'text': full_text.strip(),
                    'segments': merged_segments
                }
                
        elif status == 'FAILED' or status == 'failed':
            error_msg = output.get('message', '转录任务失败')
            error_details = output.get('error', {})
            raise Exception(f"转录任务失败: {error_msg}。详情: {error_details}")
        else:
            raise Exception(f"未知的任务状态: {status}。详情: {output}")
    
    except Exception as e:
        error_msg = str(e)
        error_type = type(e).__name__
        print(f"❌ 转录错误 [{error_type}]: {error_msg}", file=sys.stderr)
        import traceback
        print(f"❌ 错误堆栈:\n{traceback.format_exc()}", file=sys.stderr)
        raise


def main():
    """主函数"""
    if len(sys.argv) < 3:
        print(json.dumps({
            "type": "error",
            "message": "参数不足，需要: python file_transcription.py <file_path> <api_key> [model]"
        }))
        sys.exit(1)
    
    file_path = sys.argv[1]
    api_key = sys.argv[2]
    model = sys.argv[3] if len(sys.argv) > 3 else 'paraformer-realtime-v2'
    
    try:
        transcript_result = transcribe_file(file_path, api_key, model)

        # 输出结果到 stdout（JSON格式）
        result = {
            "type": "success",
            "text": transcript_result.get('text', ''),
            "segments": transcript_result.get('segments', [])
        }
        print(json.dumps(result, ensure_ascii=False))
        
    except Exception as e:
        error_type = type(e).__name__
        error_msg = str(e)
        error_result = {
            "type": "error",
            "message": f"[{error_type}] {error_msg}"
        }
        print(json.dumps(error_result, ensure_ascii=False))
        # 同时输出到 stderr 以便调试
        print(f"❌ 主函数错误: {error_msg}", file=sys.stderr)
        import traceback
        print(f"❌ 错误堆栈:\n{traceback.format_exc()}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

