export interface SubtitleMappingItem {
  id: string;
  index: number;
  startTime: string;
  endTime: string;
  originalText: string;
  translatedText?: string;
}

export interface StoryRow {
  id: string;
  originalIndex: number;
  chapter: string;
  content: string;
  charCount: number;
  startTime?: string;
  endTime?: string;
}

export interface BoundaryComparisonData {
  firstChinese: string;
  firstNewAi: string;
  firstPrevTranslation: string;
  firstSimilarity: number | null;
  firstAiSemanticScore?: number;
  firstAiNote?: string;
  lastChinese: string;
  lastNewAi: string;
  lastPrevTranslation: string;
  lastSimilarity: number | null;
  lastAiSemanticScore?: number;
  lastAiNote?: string;
  lastUpdated?: number;
}

export interface MergedChunk {
  id: string;
  chunkIndex: number;
  chapterLabel: string;
  startRowIndex: number;
  endRowIndex: number;
  content: string;
  charCount: number;
  subtitles?: SubtitleMappingItem[];
  translatedText?: string;
  audioParts?: AudioPart[];
  status: 'idle' | 'processing' | 'done' | 'error';
  errorMsg?: string;
  relevantCharactersCount?: number;
  matchedCharacterNames?: string[];
  boundaryComparison?: BoundaryComparisonData;
}

export interface AudioPart {
  partIndex: number;
  text: string;
  charCount: number;
}

export interface ApiKeyItem {
  id: string;
  key: string;
  maskedKey: string;
  usedToday: number;
  usedByModel?: Record<string, number>; // modelId -> usage count (e.g. 'gemini-3.5-flash': 1)
  modelStatus?: Record<string, 'ready' | 'active' | 'cooldown' | 'quota_exceeded' | 'error'>; // modelId -> status
  status: 'ready' | 'active' | 'cooldown' | 'quota_exceeded' | 'error';
  cooldownUntil?: number; // timestamp until when this key is cooling down from RPM
  lastUsedAt?: string;
  lastError?: string;
}

export interface GeminiModelOption {
  id: string;
  name: string;
  modelCode: string;
  dailyLimit: number;
  category: 'Flash Lite (500 lượt/ngày)' | 'Flash (20 lượt/ngày)' | string;
  description?: string;
}

export interface CharacterItem {
  id: string;
  stt: number;
  chinese: string;
  hanViet: string;
  gender?: string;
  note?: string;
}

export interface StoryProject {
  id: string;
  name: string;
  fileName: string;
  createdAt: number;
  lastUpdatedAt: number;
  maxCharsLimit: number;
  characters: CharacterItem[];
  originalRows: StoryRow[];
  mergedChunks: MergedChunk[];
  totalChunks: number;
  completedChunks: number;
}
