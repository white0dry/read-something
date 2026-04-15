export interface ReaderContentTextBlock {
  type: 'text';
  text: string;
}

export interface ReaderContentImageBlock {
  type: 'image';
  imageRef: string;
  alt?: string;
  title?: string;
  width?: number;
  height?: number;
}

export type ReaderContentBlock = ReaderContentTextBlock | ReaderContentImageBlock;

export interface Chapter {
  title: string;
  content: string;
  blocks?: ReaderContentBlock[];
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

export interface ReaderBookmarkState {
  id: string;
  name: string;
  readingPosition: ReaderPositionState;
  createdAt: number;
}

export interface ReaderVocabularyEntry {
  id: string;
  term: string;
  normalizedTerm: string;
}

export interface VocabularyLexiconEntry {
  id: string; // normalizedTerm
  term: string;
  normalizedTerm: string;
  phonetic?: string;
  posTags?: string[];
  meanings?: string[];
  examples?: string[];
  source: 'book' | 'api' | 'manual' | 'mixed';
  bookIds?: string[];
  createdAt: number;
  updatedAt: number;
  dueAt: number;
  sm2Ease: number;
  sm2Repetitions: number;
  sm2IntervalDays: number;
  reviewCount: number;
  failCount: number;
  lastReviewedAt?: number;
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
  bookmarks?: ReaderBookmarkState[];
  vocabularyEntries?: ReaderVocabularyEntry[];
  typographyStyle?: ReaderTypographyState;
  fontOptions?: ReaderFontState[];
  selectedFontId?: string;
  readingPosition?: ReaderPositionState;
  visibleRatio?: number;
  activeChapterRenderedText?: string;
  visibleTextRange?: { start: number; end: number };
  ttsResumePosition?: {
    chapterIndex: number;
    startParagraphIndex: number;
  };
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
  chapterCharCount?: number; // Target chars per chapter (fixed-length splitting)
  fullTextLength?: number; // Cached text length for lightweight listing/sorting
  chapterCount?: number; // Cached chapter count for lightweight listing/sorting
  ragEnabled?: boolean; // Whether RAG index is enabled for this book
  ragModelPresetId?: string; // Which RAG model preset was used / selected
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
  STUDY_HUB = 'STUDY_HUB',
  SETTINGS = 'SETTINGS'
}

// ─── 共读集：读书笔记 ───

export interface StudyNoteCommentMessage {
  id: string;
  role: 'ai' | 'user';
  content: string;
  createdAt: number;
}

export interface StudyNoteCommentThread {
  id: string;
  characterId: string;
  characterName: string;
  characterAvatar: string;
  messages: StudyNoteCommentMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface StudyNote {
  id: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  commentThreads: StudyNoteCommentThread[];
}

export interface Notebook {
  id: string;
  title: string;
  personaId: string;
  boundBookIds: string[];
  coverUrl?: string;
  paperBgUrl?: string;
  paperCssDraft?: string;
  paperCssApplied?: string;
  paperCssPresets?: ReaderCssPreset[];
  selectedPaperCssPresetId?: string | null;
  notes: StudyNote[];
  createdAt: number;
  updatedAt: number;
}

// ─── 共读集：内容问答 ───

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctAnswerIndices: number[];
  type: 'single' | 'multiple' | 'truefalse';
  explanation: string;
}

export interface QuizConfig {
  bookIds: string[];
  questionCount: number;
  questionType: 'single' | 'multiple' | 'truefalse';
  optionCount: number;
  customPrompt: string;
}

export interface QuizSession {
  id: string;
  config: QuizConfig;
  questions: QuizQuestion[];
  userAnswers: Record<string, number[]>;
  characterId: string;
  characterName: string;
  overallComment: string;
  createdAt: number;
  completedAt?: number;
}

// ─── 共读集：收藏消息 ───

export interface FavoriteQuote {
  id: string;
  content: string;
  sender: 'user' | 'character';
  senderName: string;
  characterId: string;
  characterName: string;
  characterAvatar: string;
  personaId: string;
  personaName: string;
  bookId: string | null;
  bookTitle: string;
  conversationKey: string;
  sourceMessageId: string;
  sourceMessageTimestamp: number;
  createdAt: number;
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

export interface RagPreset {
  id: string;
  name: string;
  config: ApiConfig;
  isDefault?: boolean;
}

/** 根据预设ID解析出ApiConfig。返回 undefined 表示使用本地模型。 */
export type RagApiConfigResolver = (presetId: string | undefined) => ApiConfig | undefined;

// ─── TTS (Text-to-Speech) ───

export type TtsProvider = 'OPENAI_TTS' | 'MINIMAX_T2A' | 'ELEVENLABS' | 'CUSTOM_TTS';

export type MiniMaxRegion = 'cn' | 'intl';

export interface TtsConfig {
  provider: TtsProvider;
  endpoint: string;
  apiKey: string;
  model: string;
  voiceId: string;
  speed: number;
  chunkSize: number;
  groupId?: string;
  minimaxRegion?: MiniMaxRegion;
  language?: string;
}

export interface TtsPreset {
  id: string;
  name: string;
  config: TtsConfig;
}

export interface TtsChunk {
  id: string;
  text: string;
  paragraphIndices: number[];
  chapterIndex: number | null;
  charStart: number;
  charEnd: number;
  status: 'pending' | 'fetching' | 'ready' | 'playing' | 'played' | 'error';
  audioBlob?: Blob;
  error?: string;
}

export interface TtsPlaybackState {
  isActive: boolean;
  isPlaying: boolean;
  isPaused: boolean;
  currentChunkIndex: number;
  currentParagraphIndex: number;
  chunks: TtsChunk[];
  chapterIndex: number | null;
  speed: number;
  error: string | null;
  cachedParagraphIndices: number[];
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
  readingExcerptCharCount: number;
  memoryBubbleCount: number;
  replyBubbleMin: number;
  replyBubbleMax: number;
  autoChatSummaryEnabled: boolean;
  autoChatSummaryTriggerCount: number;
  autoBookSummaryEnabled: boolean;
  autoBookSummaryTriggerChars: number;
  readingContextIgnorePanelClip: boolean;
  summaryApiEnabled: boolean;
  summaryApiPresetId: string | null;
  summaryApi: ReaderSummaryApiSettings;
}

export interface ReaderMoreSettings {
  appearance: ReaderMoreAppearanceSettings;
  feature: ReaderMoreFeatureSettings;
}

export interface AppSettings {
  activeCommentsEnabled: boolean;
  activeSignatureUpdateEnabled: boolean;
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
