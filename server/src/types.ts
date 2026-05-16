export interface TranscriptionRecord {
  id: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  duration: number;
  aiProvider: string;
  status: 'processing' | 'completed' | 'failed';
  transcriptText: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TranscriptPayload {
  text: string;
  segments: Array<{
    text: string;
    speakerId?: number;
    timestamp: number;
  }>;
}

