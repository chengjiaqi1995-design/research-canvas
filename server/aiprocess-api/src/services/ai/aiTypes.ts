export interface TranscriptionResult {
  text: string;
  segments?: Array<{
    text: string;
    speakerId: number;
    startTime?: number;
    endTime?: number;
  }>;
}

export interface TitleAndTopics {
  title: string; // 格式：主题---参会人员---日期
  topics: string[]; // 5个相关主题
}

/**
 * 元数据提取结果
 */
export interface ExtractedMetadata {
  topic: string;        // 主题
  organization: string; // 涉及的主要公司
  speaker: string;      // 演讲人/嘉宾名称
  intermediary: string; // 中介机构
  industry: string;     // 行业
  country: string;      // 国家
  participants: string; // 参与人类型
  eventDate: string;    // 发生时间
  relatedTopics: string[]; // 相关主题标签
}
