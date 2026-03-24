// Facade: re-export everything from the ai/ module for backward compatibility
export {
  transcribeAudio,
  generateSummary,
  generateTitleAndTopics,
  extractMetadata,
  getMetadataExtractionPromptTemplate,
  compressAudio,
} from './ai';
export type { TranscriptionResult, TitleAndTopics, ExtractedMetadata } from './ai';
