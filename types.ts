export interface Chapter {
  title: string;
  content: string;
}

export interface ReaderHighlightRange {
  start: number;
  end: number;
  color: string;
}

export interface ReaderAiUnderlineRange {
  start: number;
  end: number;
  generationId?: string;
}

export interface ReaderTypographyState {
  fontSizePx: number;
  lineHeight: number;
  textColor: string;
  backgroundColor: string;
  textAlign?: 'left' | 'center' | 'justify';
}

export type ReaderFontSourceType = 'css' | 'font';

export interface ReaderFontState {
  id: string;
  label: string;
  family: string;
  sourceType: ReaderFontSourceType;
  sourceUrl: string;
}

export interface ReaderPositionState {
  chapterIndex: number | null;
  chapterCharOffset: number;
  globalCharOffset: number;
  scrollRatio: number;
  totalLength: number;
  updatedAt: number;
}

export interface ReaderSessionSnapshot {
  bookId: string;
  progress: number;
  lastReadAt: number;
  readingPosition: ReaderPositionState;
}

export interface ReaderBookState {
  highlightColor?: string;
  highlightsByChapter?: Record<string, ReaderHighlightRange[]>;
  aiUnderlinesByChapter?: Record<string, ReaderAiUnderlineRange[]>;
  typographyStyle?: ReaderTypographyState;
  fontOptions?: ReaderFontState[];
  selectedFontId?: string;
  readingPosition?: ReaderPositionState;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  coverUrl: string;
  progress: number; // 0-100
  lastRead: string;
  lastReadAt?: number;
  tags: string[];
  fullText?: string; // The raw content of the book
  chapters?: Chapter[]; // Parsed chapters
  chapterRegex?: string; // The regex used to parse
  fullTextLength?: number; // Cached text length for lightweight listing/sorting
  chapterCount?: number; // Cached chapter count for lightweight listing/sorting
}

export interface Message {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  timestamp: Date;
  isThinking?: boolean;
}

export interface AICharacter {
  id: string;
  name: string;
  nickname: string; // Display name in chat
  avatarUrl: string;
  description: string; // Personality/System Prompt
}

export enum AppView {
  LIBRARY = 'LIBRARY',
  READER = 'READER',
  STATS = 'STATS',
  SETTINGS = 'SETTINGS'
}

export type ApiProvider = 'OPENAI' | 'DEEPSEEK' | 'GEMINI' | 'CLAUDE' | 'CUSTOM';

export interface ApiConfig {
  provider: ApiProvider;
  endpoint: string;
  apiKey: string;
  model: string;
}

export interface ApiPreset {
  id: string;
  name: string;
  config: ApiConfig;
}

export interface ReaderCssPreset {
  id: string;
  name: string;
  css: string;
}

export interface ReaderSummaryCard {
  id: string;
  content: string;
  start: number;
  end: number;
  createdAt: number;
  updatedAt: number;
}

export interface ReaderMoreAppearanceSettings {
  bubbleFontSizeScale: number;
  chatBackgroundImage: string;
  showMessageTime: boolean;
  timeGapMinutes: number;
  bubbleCssDraft: string;
  bubbleCssApplied: string;
  bubbleCssPresets: ReaderCssPreset[];
  selectedBubbleCssPresetId: string | null;
}

export interface ReaderSummaryApiSettings {
  provider: ApiProvider;
  endpoint: string;
  apiKey: string;
  model: string;
}

export interface ReaderMoreFeatureSettings {
  memoryBubbleCount: number;
  replyBubbleMin: number;
  replyBubbleMax: number;
  autoChatSummaryEnabled: boolean;
  autoChatSummaryTriggerCount: number;
  autoBookSummaryEnabled: boolean;
  autoBookSummaryTriggerChars: number;
  summaryApiEnabled: boolean;
  summaryApi: ReaderSummaryApiSettings;
}

export interface ReaderMoreSettings {
  appearance: ReaderMoreAppearanceSettings;
  feature: ReaderMoreFeatureSettings;
}

export interface AppSettings {
  activeCommentsEnabled: boolean;
  aiProactiveUnderlineEnabled: boolean;
  aiProactiveUnderlineProbability: number;
  commentInterval: number;
  commentProbability: number;
  themeColor: string; // Hex code
  fontSizeScale: number; // 0.8 - 1.2
  safeAreaTop: number; // px
  safeAreaBottom: number; // px
  readerMore: ReaderMoreSettings;
}
