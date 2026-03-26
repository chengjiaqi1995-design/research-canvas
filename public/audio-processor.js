// 诊断版音频处理器
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 1024;
    this.outputBuffer = new Int16Array(this.bufferSize);
    this.outputIdx = 0;
    this.packetCount = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0];
    // 这里简化处理，假设输入已经是 16kHz 或者在主线程处理采样率
    // 实际项目中这里会有下采样逻辑
    for (let i = 0; i < channelData.length; i++) {
      const s = Math.max(-1, Math.min(1, channelData[i]));
      this.outputBuffer[this.outputIdx++] = s < 0 ? s * 0x8000 : s * 0x7FFF;

      if (this.outputIdx >= this.bufferSize) {
        this.packetCount++;
        const bufferToTransfer = this.outputBuffer.buffer.slice(0);
        
        // 发送数据并附带采集时间戳 T1（精确到毫秒）
        const captureTime = Date.now();
        this.port.postMessage({
          type: 'audioData',
          data: bufferToTransfer,
          timestamp: captureTime,
          t1Capture: captureTime, // 明确的字段名
          packetId: this.packetCount
        }, [bufferToTransfer]);
        
        this.outputIdx = 0;
      }
    }
    return true;
  }
}

registerProcessor('recorder-worklet', RecorderProcessor);
