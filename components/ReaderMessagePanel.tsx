import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  MessagesSquare,
  Pencil,
  Quote,
  RotateCcw,
  Send,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { ApiConfig, ApiPreset, AppSettings, Book, Chapter, RagApiConfigResolver, ReaderSummaryCard, ReaderHighlightRange, ReaderPositionState } from '../types';
import { Character, Persona, WorldBookEntry } from './settings/types';
import ResolvedImage from './ResolvedImage';
import ReaderMoreSettingsPanel, { ReaderArchiveOption } from './ReaderMoreSettingsPanel';
import { deleteImageByRef, saveImageFile } from '../utils/imageStorage';
import { getBookContent, saveBookSummaryState } from '../utils/bookContentStorage';
import {
  abortConversationGeneration,
  buildCharacterPromptRecord,
  buildConversationKey,
  buildUserPromptRecord,
  ChatBubble,
  ChatSender,
  ChatQuotePayload,
  clamp,
  compactText,
  deleteConversationBucket,
  ensureConversationBucket,
  formatTimestampMinute,
  GenerationMode,
  getConversationGenerationStatus,
  onChatStoreUpdated,
  onGenerationStatusChanged,
  persistConversationBucket,
  persistConversationMessages,
  readChatStore,
  saveChatStore,
} from '../utils/readerChatRuntime';
import {
  buildCharacterWorldBookSections,
  buildReadingContextSnapshot,
  estimateConversationPromptTokens,
  ReadingContextSnapshot,
  runConversationGeneration,
  sanitizeTextForAiPrompt,
} from '../utils/readerAiEngine';
import type { PromptTokenEstimate } from '../utils/readerAiEngine';
import { estimateRagSafeOffset, retrieveRelevantChunks } from '../utils/ragEngine';
import {
  DEFAULT_NEUMORPHISM_BUBBLE_CSS,
  LEGACY_DEFAULT_NEUMORPHISM_BUBBLE_CSS,
  DEFAULT_NEUMORPHISM_BUBBLE_CSS_PRESET_ID,
  DEFAULT_READER_BUBBLE_CSS_PRESETS,
  normalizeReaderBubbleCssPresets,
} from '../utils/readerBubbleCssPresets';

interface ReaderMessagePanelProps {
  isDarkMode: boolean;
  apiConfig: ApiConfig;
  apiPresets: ApiPreset[];
  safeAreaTop: number;
  safeAreaBottom: number;
  activeBook: Book | null;
  appSettings: AppSettings;
  setAppSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  aiProactiveUnderlineEnabled: boolean;
  aiProactiveUnderlineProbability: number;
  personas: Persona[];
  activePersonaId: string | null;
  onSelectPersona: (personaId: string | null) => void;
  characters: Character[];
  activeCharacterId: string | null;
  onSelectCharacter: (characterId: string | null) => void;
  worldBookEntries: WorldBookEntry[];
  chapters: Chapter[];
  bookText: string;
  highlightRangesByChapter: Record<string, ReaderHighlightRange[]>;
  onAddAiUnderlineRange: (payload: { start: number; end: number; generationId: string }) => void;
  onRollbackAiUnderlineGeneration: (generationId: string) => void;
  readerContentRef: React.RefObject<HTMLDivElement>;
  getLatestReadingPosition: () => ReaderPositionState | null;
  isMoreSettingsOpen: boolean;
  onCloseMoreSettings: () => void;
  ragApiConfigResolver?: RagApiConfigResolver;
}

interface ContextMenuState {
  bubbleId: string;
  x: number;
  y: number;
}

interface PanelBounds {
  min: number;
  max: number;
}

const getTailAppendedMessages = (prev: ChatBubble[], next: ChatBubble[]) => {
  if (next.length <= prev.length) return [];
  for (let index = 0; index < prev.length; index += 1) {
    if (prev[index]?.id !== next[index]?.id) return [];
  }
  return next.slice(prev.length);
};

const AI_PANEL_HEIGHT_STORAGE_KEY = 'app_reader_ai_panel_height_v1';
const AI_FAB_OPEN_DELAY_MS = 120;
const AI_REPLY_FIRST_BUBBLE_DELAY_MS = 420;
const AI_REPLY_BUBBLE_INTERVAL_MS = 1500;
const MIN_PANEL_HEIGHT_RATIO = 0.4;
const MAX_PANEL_HEIGHT_RATIO = 0.8;
const LONG_PRESS_MS = 420;
const CONTEXT_MENU_MARGIN = 8;
const DEFAULT_CHAR_IMG = 'https://i.postimg.cc/ZY3jJTK4/56163534-p0.jpg';
const DEFAULT_USER_NAME = 'User';
const DEFAULT_CHAR_NAME = 'Char';
const SUMMARY_MODEL_CACHE_STORAGE_KEY = 'app_summary_api_models_cache_v1';
const SUMMARY_TASK_DEBOUNCE_MS = 3000;
const SUMMARY_CHAT_PRIORITY = 2;
const SUMMARY_BOOK_PRIORITY = 1;
const SUMMARY_MANUAL_BOOST = 10;
const MESSAGE_TIME_GAP_MS = 60 * 60 * 1000;
const FIXED_MESSAGE_TIME_GAP_MINUTES = 60;
const DEFAULT_READER_MORE_APPEARANCE: AppSettings['readerMore']['appearance'] = {
  bubbleFontSizeScale: 1,
  chatBackgroundImage: '',
  showMessageTime: false,
  timeGapMinutes: FIXED_MESSAGE_TIME_GAP_MINUTES,
  bubbleCssDraft: DEFAULT_NEUMORPHISM_BUBBLE_CSS,
  bubbleCssApplied: '',
  bubbleCssPresets: DEFAULT_READER_BUBBLE_CSS_PRESETS.map((item) => ({ ...item })),
  selectedBubbleCssPresetId: DEFAULT_NEUMORPHISM_BUBBLE_CSS_PRESET_ID,
};
const DEFAULT_READER_MORE_FEATURE: AppSettings['readerMore']['feature'] = {
  readingExcerptCharCount: 800,
  memoryBubbleCount: 100,
  replyBubbleMin: 3,
  replyBubbleMax: 8,
  autoChatSummaryEnabled: false,
  autoChatSummaryTriggerCount: 500,
  autoBookSummaryEnabled: false,
  autoBookSummaryTriggerChars: 5000,
  summaryApiEnabled: false,
  summaryApiPresetId: null,
  summaryApi: {
    provider: 'OPENAI',
    endpoint: 'https://api.openai.com/v1',
    apiKey: '',
    model: '',
  },
};
const normalizeLooseInt = (value: number) => (Number.isFinite(value) ? Math.round(value) : 0);
const normalizeBubbleCssSignature = (css: string) => css.replace(/\s+/g, ' ').trim();
const LEGACY_DEFAULT_NEUMORPHISM_BUBBLE_CSS_SIGNATURE = normalizeBubbleCssSignature(LEGACY_DEFAULT_NEUMORPHISM_BUBBLE_CSS);
const isLegacyDefaultNeumorphismBubbleCss = (css: string) =>
  normalizeBubbleCssSignature(css) === LEGACY_DEFAULT_NEUMORPHISM_BUBBLE_CSS_SIGNATURE;

type SummaryTaskKind = 'chat' | 'book';
type SummaryTriggerKind = 'auto' | 'manual';

interface SummaryTask {
  id: string;
  kind: SummaryTaskKind;
  trigger: SummaryTriggerKind;
  start: number;
  end: number;
  conversationKey: string;
  createdAt: number;
}

interface SummaryApiCacheEntry {
  models: string[];
  updatedAt: number;
}

type SummaryApiCacheStore = Record<string, SummaryApiCacheEntry>;
type FetchState = 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const getViewportHeight = () => {
  if (typeof window === 'undefined') return 800;
  return Math.max(1, window.innerHeight || 800);
};

const FeatherIcon = ({ size = 16, className = '' }: { size?: number; className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    fill="currentColor"
    className={`bi bi-feather ${className}`}
    viewBox="0 0 16 16"
  >
    <path d="M15.807.531c-.174-.177-.41-.289-.64-.363a3.8 3.8 0 0 0-.833-.15c-.62-.049-1.394 0-2.252.175C10.365.545 8.264 1.415 6.315 3.1S3.147 6.824 2.557 8.523c-.294.847-.44 1.634-.429 2.268.005.316.05.62.154.88q.025.061.056.122A68 68 0 0 0 .08 15.198a.53.53 0 0 0 .157.72.504.504 0 0 0 .705-.16 68 68 0 0 1 2.158-3.26c.285.141.616.195.958.182.513-.02 1.098-.188 1.723-.49 1.25-.605 2.744-1.787 4.303-3.642l1.518-1.55a.53.53 0 0 0 0-.739l-.729-.744 1.311.209a.5.5 0 0 0 .443-.15l.663-.684c.663-.68 1.292-1.325 1.763-1.892.314-.378.585-.752.754-1.107.163-.345.278-.773.112-1.188a.5.5 0 0 0-.112-.172M3.733 11.62C5.385 9.374 7.24 7.215 9.309 5.394l1.21 1.234-1.171 1.196-.027.03c-1.5 1.789-2.891 2.867-3.977 3.393-.544.263-.99.378-1.324.39a1.3 1.3 0 0 1-.287-.018Zm6.769-7.22c1.31-1.028 2.7-1.914 4.172-2.6a7 7 0 0 1-.4.523c-.442.533-1.028 1.134-1.681 1.804l-.51.524zm3.346-3.357C9.594 3.147 6.045 6.8 3.149 10.678c.007-.464.121-1.086.37-1.806.533-1.535 1.65-3.415 3.455-4.976 1.807-1.561 3.746-2.36 5.31-2.68a8 8 0 0 1 1.564-.173" />
  </svg>
);

const formatBubbleClock = (timestamp: number) =>
  new Date(timestamp)
    .toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    .replace(' ', '');
const formatSummaryPromptTime = (timestamp: number) => {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '1970/01/01 00:00';
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hour = `${date.getHours()}`.padStart(2, '0');
  const minute = `${date.getMinutes()}`.padStart(2, '0');
  return `${year}/${month}/${day} ${hour}:${minute}`;
};

const aggregateSummaryCardsText = (cards: ReaderSummaryCard[]) =>
  cards
    .slice()
    .sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      if (a.end !== b.end) return a.end - b.end;
      return a.createdAt - b.createdAt;
    })
    .map((card) => card.content.trim())
    .filter(Boolean)
    .join('\n');

const sortSummaryCardsByRange = (left: ReaderSummaryCard, right: ReaderSummaryCard) => {
  if (left.start !== right.start) return left.start - right.start;
  if (left.end !== right.end) return left.end - right.end;
  return left.createdAt - right.createdAt;
};

const mergeSummaryCardsByIds = (cards: ReaderSummaryCard[], cardIds: string[]): ReaderSummaryCard[] | null => {
  const targetIds = new Set(cardIds.filter(Boolean));
  if (targetIds.size < 2) return null;
  const selected = cards.filter((card) => targetIds.has(card.id));
  if (selected.length < 2) return null;
  const mergedContent = selected
    .slice()
    .sort(sortSummaryCardsByRange)
    .map((card) => card.content.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
  if (!mergedContent) return null;

  const now = Date.now();
  const mergedCard: ReaderSummaryCard = {
    id: `summary-merge-${now}-${Math.random().toString(36).slice(2, 8)}`,
    content: mergedContent,
    start: Math.min(...selected.map((card) => card.start)),
    end: Math.max(...selected.map((card) => card.end)),
    createdAt: now,
    updatedAt: now,
  };

  return [...cards.filter((card) => !targetIds.has(card.id)), mergedCard].sort(sortSummaryCardsByRange);
};

const fingerprintText = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const normalizeEndpoint = (value: string) => value.trim().replace(/\/+$/, '');

const buildSummaryModelCacheKey = (config: ApiConfig) => {
  const endpoint = normalizeEndpoint(config.endpoint || '') || 'default';
  const apiKey = (config.apiKey || '').trim();
  if (!apiKey) return '';
  return `${config.provider}::${endpoint}::${fingerprintText(apiKey)}`;
};

const safeReadSummaryModelCache = (): SummaryApiCacheStore => {
  try {
    const raw = localStorage.getItem(SUMMARY_MODEL_CACHE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return {};
    const next: SummaryApiCacheStore = {};
    Object.entries(parsed).forEach(([key, value]) => {
      if (!value || typeof value !== 'object') return;
      const source = value as Partial<SummaryApiCacheEntry>;
      const models = Array.isArray(source.models)
        ? Array.from(new Set(source.models.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)))
        : [];
      if (models.length === 0) return;
      next[key] = {
        models,
        updatedAt: Number.isFinite(Number(source.updatedAt)) ? Number(source.updatedAt) : Date.now(),
      };
    });
    return next;
  } catch {
    return {};
  }
};

const safeSaveSummaryModelCache = (store: SummaryApiCacheStore) => {
  try {
    localStorage.setItem(SUMMARY_MODEL_CACHE_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore
  }
};

const isSameApiConfig = (left: ApiConfig, right: ApiConfig) =>
  left.provider === right.provider &&
  normalizeEndpoint(left.endpoint || '') === normalizeEndpoint(right.endpoint || '') &&
  (left.apiKey || '').trim() === (right.apiKey || '').trim() &&
  (left.model || '').trim() === (right.model || '').trim();

const parseConversationKey = (key: string) => {
  const matched = key.match(/^book:(.+?)::persona:(.+?)::character:(.+)$/);
  if (!matched) return null;
  return {
    bookId: matched[1] === 'none' ? null : matched[1],
    personaId: matched[2] === 'none' ? null : matched[2],
    characterId: matched[3] === 'none' ? null : matched[3],
  };
};

const normalizeArchiveIdentityValue = (value: string) => compactText(value || '').toLowerCase();

const buildArchiveIdentityKey = (bookId: string | null, personaName: string, characterName: string) => {
  const normalizedPersonaName = normalizeArchiveIdentityValue(personaName);
  const normalizedCharacterName = normalizeArchiveIdentityValue(characterName);
  if (!normalizedPersonaName || !normalizedCharacterName) return '';
  return `book:${bookId || 'none'}::persona-name:${normalizedPersonaName}::character-name:${normalizedCharacterName}`;
};

const extractSenderNameFromPromptRecord = (promptRecord: string) => {
  const source = (promptRecord || '').trim();
  if (!source) return '';
  const directMatched = source.match(/发送者[:：]\s*([^\]]+)/);
  if (directMatched?.[1]) return compactText(directMatched[1]);
  const englishMatched = source.match(/sender[:：]\s*([^\]]+)/i);
  if (englishMatched?.[1]) return compactText(englishMatched[1]);
  const secondBracket = source.match(/\[[^\]]+\]\[([^\]]+)\]/);
  if (!secondBracket?.[1]) return '';
  const segment = secondBracket[1];
  const segmentMatched = segment.match(/[:：]\s*(.+)$/);
  if (segmentMatched?.[1]) return compactText(segmentMatched[1]);
  return '';
};

const inferArchivedNameFromMessages = (messages: ChatBubble[], sender: ChatSender) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.sender !== sender) continue;
    const inferred = extractSenderNameFromPromptRecord(message.promptRecord || '');
    if (inferred) return inferred;
  }
  return '';
};

const callSummaryModel = async (prompt: string, config: ApiConfig) => {
  const provider = config.provider;
  const endpoint = normalizeEndpoint(config.endpoint || '');
  const apiKey = (config.apiKey || '').trim();
  const model = (config.model || '').trim();
  if (!apiKey) throw new Error('请先设置总结 API Key');
  if (!model) throw new Error('请先设置总结模型');
  if (provider !== 'GEMINI' && !endpoint) throw new Error('请先设置总结 API 地址');

  if (provider === 'GEMINI') {
    const response = await fetch(
      `${endpoint}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4 },
        }),
      }
    );
    if (!response.ok) throw new Error(`总结请求失败(${response.status})`);
    const data = await response.json();
    return (
      data?.candidates?.[0]?.content?.parts
        ?.map((part: { text?: string }) => part.text || '')
        .join('')
        .trim() || ''
    );
  }

  if (provider === 'CLAUDE') {
    const response = await fetch(`${endpoint}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 320,
        temperature: 0.4,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) throw new Error(`总结请求失败(${response.status})`);
    const data = await response.json();
    return (
      data?.content
        ?.map((item: { text?: string }) => item.text || '')
        .join('')
        .trim() || ''
    );
  }

  const response = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.45,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!response.ok) throw new Error(`总结请求失败(${response.status})`);
  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || '';
};

const ReaderMessagePanel: React.FC<ReaderMessagePanelProps> = ({
  isDarkMode,
  apiConfig,
  apiPresets,
  safeAreaTop,
  safeAreaBottom,
  activeBook,
  appSettings,
  setAppSettings,
  aiProactiveUnderlineEnabled,
  aiProactiveUnderlineProbability,
  personas,
  activePersonaId,
  onSelectPersona,
  characters,
  activeCharacterId,
  onSelectCharacter,
  worldBookEntries,
  chapters,
  bookText,
  highlightRangesByChapter,
  onAddAiUnderlineRange,
  onRollbackAiUnderlineGeneration,
  readerContentRef,
  getLatestReadingPosition,
  isMoreSettingsOpen,
  onCloseMoreSettings,
  ragApiConfigResolver,
}) => {
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(true);
  const [isAiFabOpening, setIsAiFabOpening] = useState(false);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  const [messages, setMessages] = useState<ChatBubble[]>([]);
  const [inputText, setInputText] = useState('');
  const [activeGenerationMode, setActiveGenerationMode] = useState<GenerationMode | null>(null);
  const [toast, setToast] = useState<{ text: string; type: 'error' | 'info' } | null>(null);
  const [hiddenBubbleIds, setHiddenBubbleIds] = useState<string[]>([]);
  const [panelBounds, setPanelBounds] = useState<PanelBounds>(() => {
    const vh = getViewportHeight();
    const min = Math.round(vh * MIN_PANEL_HEIGHT_RATIO);
    const max = Math.max(min, Math.round(vh * MAX_PANEL_HEIGHT_RATIO));
    return { min, max };
  });
  const [panelHeightPx, setPanelHeightPx] = useState<number>(() => {
    const fallback = Math.round(getViewportHeight() * MIN_PANEL_HEIGHT_RATIO);
    if (typeof window === 'undefined') return fallback;
    try {
      const raw = localStorage.getItem(AI_PANEL_HEIGHT_STORAGE_KEY);
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    } catch {
      return fallback;
    }
  });
  const [isPanelDragging, setIsPanelDragging] = useState(false);
  const [isConversationHydrated, setIsConversationHydrated] = useState(false);
  const [isBookSummaryHydrated, setIsBookSummaryHydrated] = useState(false);
  const [fabBottomPx, setFabBottomPx] = useState(24);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [contextMenuLayout, setContextMenuLayout] = useState<{ left: number; top: number } | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [quotedMessageId, setQuotedMessageId] = useState<string | null>(null);
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [selectedDeleteIds, setSelectedDeleteIds] = useState<string[]>([]);
  const [chatHistorySummary, setChatHistorySummary] = useState('');
  const [readingPrefixSummaryByBookId, setReadingPrefixSummaryByBookId] = useState<Record<string, string>>({});
  const [chatSummaryCards, setChatSummaryCards] = useState<ReaderSummaryCard[]>([]);
  const [chatAutoSummaryLastEnd, setChatAutoSummaryLastEnd] = useState(0);
  const [bookSummaryCards, setBookSummaryCards] = useState<ReaderSummaryCard[]>([]);
  const [bookAutoSummaryLastEnd, setBookAutoSummaryLastEnd] = useState(0);
  const [summaryTaskQueue, setSummaryTaskQueue] = useState<SummaryTask[]>([]);
  const [summaryTaskRunning, setSummaryTaskRunning] = useState(false);
  const [summaryApiModels, setSummaryApiModels] = useState<string[]>([]);
  const [summaryApiFetchState, setSummaryApiFetchState] = useState<FetchState>('IDLE');
  const [summaryApiFetchError, setSummaryApiFetchError] = useState('');
  const [archiveVersion, setArchiveVersion] = useState(0);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isAiPanelOpenRef = useRef(isAiPanelOpen);
  const aiFabOpenTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const dragRafRef = useRef<number | null>(null);
  const pendingDragHeightRef = useRef<number | null>(null);
  const keepBottomRafRef = useRef<number | null>(null);
  const scrollDistFromBottomRef = useRef<number | null>(null);
  const releaseScrollDistLockAfterLayoutRef = useRef(false);
  const isMountedRef = useRef(true);
  const bubbleRevealSequenceRef = useRef(0);
  const messagesRef = useRef<ChatBubble[]>([]);
  const hiddenBubbleIdsRef = useRef<string[]>([]);
  const pendingGenerationRef = useRef<{
    conversationKey: string;
    committedMessages: ChatBubble[];
    remainingMessages: ChatBubble[];
  } | null>(null);
  const summaryTaskDebounceRef = useRef<Record<string, number>>({});
  const activeSummaryTaskRef = useRef<SummaryTask | null>(null);
  const summaryTaskQueueRef = useRef<SummaryTask[]>([]);
  const chatSummaryCardsRef = useRef<ReaderSummaryCard[]>([]);
  const bookSummaryCardsRef = useRef<ReaderSummaryCard[]>([]);
  const chatAutoSummaryLastEndRef = useRef(0);
  const bookAutoSummaryLastEndRef = useRef(0);
  const prevAutoChatSummaryEnabledRef = useRef(false);
  const prevAutoBookSummaryEnabledRef = useRef(false);
  const conversationProfileValidRef = useRef(true);
  const lockToastAtRef = useRef(0);
  const deletedConversationKeyRef = useRef<string | null>(null);
  const longPressMetaRef = useRef<{ bubbleId: string | null; x: number; y: number }>({
    bubbleId: null,
    x: 0,
    y: 0,
  });
  const dragStateRef = useRef<{ active: boolean; pointerId: number | null; startY: number; startHeight: number; moved: boolean }>(
    { active: false, pointerId: null, startY: 0, startHeight: 0, moved: false }
  );

  const activePersona = useMemo(
    () => personas.find((persona) => persona.id === activePersonaId) || null,
    [personas, activePersonaId]
  );
  const activeCharacter = useMemo(
    () => characters.find((character) => character.id === activeCharacterId) || null,
    [characters, activeCharacterId]
  );
  const hasDefaultConversationParticipant = !activePersonaId || !activeCharacterId;
  const isConversationProfileValid = Boolean(activePersona && activeCharacter);
  const conversationLockMessage = hasDefaultConversationParticipant
    ? '请先在设置中添加用户和角色'
    : !activePersona && !activeCharacter
      ? '该会话关联的用户和角色人设已被删除'
      : !activePersona
        ? '该会话关联的用户人设已被删除'
        : '该会话关联的角色人设已被删除';

  const userRealName = activePersona?.name?.trim() || DEFAULT_USER_NAME;
  const userNickname = activePersona?.userNickname?.trim() || userRealName;
  const userDescription = activePersona?.description?.trim() || '（暂无用户人设）';
  const characterRealName = activeCharacter?.name?.trim() || DEFAULT_CHAR_NAME;
  const characterNickname = activeCharacter?.nickname?.trim() || characterRealName;
  const characterDescription = activeCharacter?.description?.trim() || '（暂无角色人设）';
  const activeBookTitle = activeBook?.title || '未选择书籍';
  const activeBookSummary = activeBook?.id ? readingPrefixSummaryByBookId[activeBook.id] || '' : '';

  const conversationKey = useMemo(
    () => buildConversationKey(activeBook?.id || null, activePersonaId, activeCharacterId),
    [activeBook?.id, activePersonaId, activeCharacterId]
  );
  const legacyConversationKey = useMemo(
    () => `persona:${activePersonaId || 'none'}::character:${activeCharacterId || 'none'}`,
    [activePersonaId, activeCharacterId]
  );
  const lastSyncedConversationKeyRef = useRef<string>(conversationKey);

  const characterWorldBookEntries = useMemo(
    () => buildCharacterWorldBookSections(activeCharacter, worldBookEntries),
    [activeCharacter, worldBookEntries]
  );

  const canSendToAi = useMemo(() => {
    const last = messages[messages.length - 1];
    return Boolean(last && last.sender === 'user');
  }, [messages]);

  const quotedMessage = useMemo(
    () => messages.find((message) => message.id === quotedMessageId) || null,
    [messages, quotedMessageId]
  );

  const isAiLoading = activeGenerationMode !== null;
  const isManualLoading = activeGenerationMode === 'manual';
  const selectedDeleteIdSet = useMemo(() => new Set(selectedDeleteIds), [selectedDeleteIds]);
  const hiddenBubbleIdSet = useMemo(() => new Set(hiddenBubbleIds), [hiddenBubbleIds]);
  const readerMoreAppearance = appSettings.readerMore.appearance;
  const readerMoreFeature = appSettings.readerMore.feature;
  const selectedSummaryApiPreset = useMemo(
    () => apiPresets.find((preset) => preset.id === readerMoreFeature.summaryApiPresetId) || null,
    [apiPresets, readerMoreFeature.summaryApiPresetId]
  );
  const summaryApiConfig: ApiConfig = useMemo(
    () =>
      readerMoreFeature.summaryApiEnabled
        ? selectedSummaryApiPreset
          ? {
              ...selectedSummaryApiPreset.config,
            }
          : {
              provider: readerMoreFeature.summaryApi.provider,
              endpoint: readerMoreFeature.summaryApi.endpoint,
              apiKey: readerMoreFeature.summaryApi.apiKey,
              model: readerMoreFeature.summaryApi.model,
            }
        : apiConfig,
    [
      selectedSummaryApiPreset,
      readerMoreFeature.summaryApiEnabled,
      readerMoreFeature.summaryApi.provider,
      readerMoreFeature.summaryApi.endpoint,
      readerMoreFeature.summaryApi.apiKey,
      readerMoreFeature.summaryApi.model,
      apiConfig,
    ]
  );
  const summaryApiCacheKey = useMemo(() => buildSummaryModelCacheKey(summaryApiConfig), [summaryApiConfig]);
  const visibleMessages = useMemo(
    () => (hiddenBubbleIds.length === 0 ? messages : messages.filter((message) => !hiddenBubbleIdSet.has(message.id))),
    [messages, hiddenBubbleIds.length, hiddenBubbleIdSet]
  );
  const messageTimeline = useMemo(() => {
    const items: Array<
      | { type: 'time'; id: string; timestamp: number }
      | { type: 'message'; id: string; message: ChatBubble }
    > = [];
    const showMessageTime = readerMoreAppearance.showMessageTime;
    const gapMs = Math.max(MESSAGE_TIME_GAP_MS, (readerMoreAppearance.timeGapMinutes || 60) * 60 * 1000);
    let prevTimestamp = 0;
    visibleMessages.forEach((message) => {
      if (showMessageTime && prevTimestamp > 0 && message.timestamp - prevTimestamp >= gapMs) {
        items.push({
          type: 'time',
          id: `sep-${message.id}`,
          timestamp: message.timestamp,
        });
      }
      items.push({
        type: 'message',
        id: message.id,
        message,
      });
      prevTimestamp = message.timestamp;
    });
    return items;
  }, [visibleMessages, readerMoreAppearance.showMessageTime, readerMoreAppearance.timeGapMinutes]);
  const resolvedPanelHeight = clamp(panelHeightPx, panelBounds.min, panelBounds.max);
  const safeBottomInset = Math.max(0, safeAreaBottom || 0);
  const resolvedPanelVisualHeight = resolvedPanelHeight + safeBottomInset;

  const updateHiddenBubbleIds = useCallback((updater: (prev: string[]) => string[]) => {
    const prev = hiddenBubbleIdsRef.current;
    const next = updater(prev);
    hiddenBubbleIdsRef.current = next;
    setHiddenBubbleIds(next);
  }, []);

  const updateReaderMoreAppearanceSettings = useCallback(
    (updater: Partial<AppSettings['readerMore']['appearance']>) => {
      setAppSettings((prev) => ({
        ...prev,
        readerMore: {
          ...prev.readerMore,
          appearance: {
            ...prev.readerMore.appearance,
            ...updater,
          },
        },
      }));
    },
    [setAppSettings]
  );

  const updateReaderMoreFeatureSettings = useCallback(
    (updater: Partial<AppSettings['readerMore']['feature']>) => {
      setAppSettings((prev) => ({
        ...prev,
        readerMore: {
          ...prev.readerMore,
          feature: {
            ...prev.readerMore.feature,
            ...updater,
          },
        },
      }));
    },
    [setAppSettings]
  );

  useEffect(() => {
    const currentPresets = appSettings.readerMore.appearance.bubbleCssPresets;
    const normalizedPresets = normalizeReaderBubbleCssPresets(currentPresets);
    const isSame =
      normalizedPresets.length === currentPresets.length
      && normalizedPresets.every((preset, index) => {
        const current = currentPresets[index];
        return !!current
          && current.id === preset.id
          && current.name === preset.name
          && current.css === preset.css;
      });
    if (isSame) return;

    const currentSelectedPresetId = appSettings.readerMore.appearance.selectedBubbleCssPresetId;
    const nextSelectedPresetId =
      currentSelectedPresetId && normalizedPresets.some((item) => item.id === currentSelectedPresetId)
        ? currentSelectedPresetId
        : DEFAULT_NEUMORPHISM_BUBBLE_CSS_PRESET_ID;
    updateReaderMoreAppearanceSettings({
      bubbleCssPresets: normalizedPresets,
      selectedBubbleCssPresetId: nextSelectedPresetId,
    });
  }, [
    appSettings.readerMore.appearance.bubbleCssPresets,
    appSettings.readerMore.appearance.selectedBubbleCssPresetId,
    updateReaderMoreAppearanceSettings,
  ]);
  useEffect(() => {
    const { bubbleCssDraft, bubbleCssApplied } = appSettings.readerMore.appearance;
    const nextUpdater: Partial<AppSettings['readerMore']['appearance']> = {};
    let hasUpdate = false;
    if (bubbleCssDraft && isLegacyDefaultNeumorphismBubbleCss(bubbleCssDraft)) {
      nextUpdater.bubbleCssDraft = DEFAULT_NEUMORPHISM_BUBBLE_CSS;
      hasUpdate = true;
    }
    if (bubbleCssApplied && isLegacyDefaultNeumorphismBubbleCss(bubbleCssApplied)) {
      nextUpdater.bubbleCssApplied = DEFAULT_NEUMORPHISM_BUBBLE_CSS;
      hasUpdate = true;
    }
    if (!hasUpdate) return;
    updateReaderMoreAppearanceSettings(nextUpdater);
  }, [
    appSettings.readerMore.appearance.bubbleCssApplied,
    appSettings.readerMore.appearance.bubbleCssDraft,
    updateReaderMoreAppearanceSettings,
  ]);

  const updateSummaryApiSettings = useCallback(
    (updater: Partial<AppSettings['readerMore']['feature']['summaryApi']>) => {
      setAppSettings((prev) => ({
        ...prev,
        readerMore: {
          ...prev.readerMore,
          feature: {
            ...prev.readerMore.feature,
            summaryApi: {
              ...prev.readerMore.feature.summaryApi,
              ...updater,
            },
          },
        },
      }));
    },
    [setAppSettings]
  );

  const showToast = useCallback((text: string, type: 'error' | 'info' = 'info') => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast({ text, type });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 1800);
  }, []);
  const showConversationLockedToast = useCallback(() => {
    const now = Date.now();
    if (now - lockToastAtRef.current < 1000) return;
    lockToastAtRef.current = now;
    showToast(`${conversationLockMessage}，无法继续聊天`, 'error');
  }, [conversationLockMessage, showToast]);

  const applyChatSummaryCards = useCallback(
    (nextCards: ReaderSummaryCard[]) => {
      const safeCards = nextCards
        .map((card) => {
          const safeStart = normalizeLooseInt(card.start);
          const safeEnd = normalizeLooseInt(card.end);
          return {
            ...card,
            start: Math.min(safeStart, safeEnd),
            end: Math.max(safeStart, safeEnd),
            content: card.content.trim(),
            updatedAt: Number.isFinite(card.updatedAt) ? card.updatedAt : Date.now(),
            createdAt: Number.isFinite(card.createdAt) ? card.createdAt : Date.now(),
          };
        })
        .filter((card) => card.content);
      const summaryText = aggregateSummaryCardsText(safeCards);
      setChatSummaryCards(safeCards);
      setChatHistorySummary(summaryText);
    },
    []
  );

  const applyBookSummaryCards = useCallback(
    (nextCards: ReaderSummaryCard[]) => {
      const safeCards = nextCards
        .map((card) => {
          const safeStart = normalizeLooseInt(card.start);
          const safeEnd = normalizeLooseInt(card.end);
          return {
            ...card,
            start: Math.min(safeStart, safeEnd),
            end: Math.max(safeStart, safeEnd),
            content: card.content.trim(),
            updatedAt: Number.isFinite(card.updatedAt) ? card.updatedAt : Date.now(),
            createdAt: Number.isFinite(card.createdAt) ? card.createdAt : Date.now(),
          };
        })
        .filter((card) => card.content);
      setBookSummaryCards(safeCards);
      if (!activeBook?.id) return;
      const summaryText = aggregateSummaryCardsText(safeCards);
      setReadingPrefixSummaryByBookId((prev) => ({
        ...prev,
        [activeBook.id]: summaryText,
      }));
    },
    [activeBook?.id]
  );

  const persistBookSummaryLocal = useCallback(
    (payload: { cards?: ReaderSummaryCard[]; autoLastEnd?: number }) => {
      if (!activeBook?.id) return;
      saveBookSummaryState(activeBook.id, {
        bookSummaryCards: payload.cards,
        bookAutoSummaryLastEnd: payload.autoLastEnd,
      }).catch((error) => {
        console.error('Failed to persist book summary state', error);
      });
    },
    [activeBook?.id]
  );

  const handleUploadChatBackgroundImage = useCallback(
    async (file: File) => {
      try {
        const imageRef = await saveImageFile(file);
        const previousRef = appSettings.readerMore.appearance.chatBackgroundImage;
        updateReaderMoreAppearanceSettings({ chatBackgroundImage: imageRef });
        if (previousRef && previousRef !== imageRef) {
          void deleteImageByRef(previousRef).catch(() => undefined);
        }
      } catch (error) {
        console.error('Failed to save chat background image', error);
        showToast('背景图片保存失败', 'error');
      }
    },
    [appSettings.readerMore.appearance.chatBackgroundImage, updateReaderMoreAppearanceSettings, showToast]
  );

  const handleSetChatBackgroundFromUrl = useCallback(
    (url: string) => {
      updateReaderMoreAppearanceSettings({ chatBackgroundImage: url });
    },
    [updateReaderMoreAppearanceSettings]
  );

  const handleClearChatBackground = useCallback(() => {
    const previousRef = appSettings.readerMore.appearance.chatBackgroundImage;
    updateReaderMoreAppearanceSettings({ chatBackgroundImage: '' });
    if (previousRef) {
      void deleteImageByRef(previousRef).catch(() => undefined);
    }
  }, [appSettings.readerMore.appearance.chatBackgroundImage, updateReaderMoreAppearanceSettings]);

  const handleApplyBubbleCssDraft = useCallback(() => {
    updateReaderMoreAppearanceSettings({
      bubbleCssApplied: appSettings.readerMore.appearance.bubbleCssDraft,
    });
  }, [appSettings.readerMore.appearance.bubbleCssDraft, updateReaderMoreAppearanceSettings]);

  const handleSaveBubbleCssPreset = useCallback(
    (name: string) => {
      const safeName = name.trim();
      if (!safeName) {
        showToast('请输入预设名称', 'info');
        return;
      }
      const nextId = `css-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      updateReaderMoreAppearanceSettings({
        bubbleCssPresets: [
          ...appSettings.readerMore.appearance.bubbleCssPresets,
          {
            id: nextId,
            name: safeName,
            css: appSettings.readerMore.appearance.bubbleCssDraft,
          },
        ],
        selectedBubbleCssPresetId: nextId,
      });
    },
    [appSettings.readerMore.appearance.bubbleCssDraft, appSettings.readerMore.appearance.bubbleCssPresets, updateReaderMoreAppearanceSettings, showToast]
  );

  const handleDeleteBubbleCssPreset = useCallback(
    (presetId: string) => {
      if (presetId === DEFAULT_NEUMORPHISM_BUBBLE_CSS_PRESET_ID) {
        showToast('默认预设不可删除', 'info');
        return;
      }
      const next = appSettings.readerMore.appearance.bubbleCssPresets.filter((item) => item.id !== presetId);
      updateReaderMoreAppearanceSettings({
        bubbleCssPresets: next,
        selectedBubbleCssPresetId:
          appSettings.readerMore.appearance.selectedBubbleCssPresetId === presetId
            ? DEFAULT_NEUMORPHISM_BUBBLE_CSS_PRESET_ID
            : appSettings.readerMore.appearance.selectedBubbleCssPresetId,
      });
    },
    [
      appSettings.readerMore.appearance.bubbleCssPresets,
      appSettings.readerMore.appearance.selectedBubbleCssPresetId,
      updateReaderMoreAppearanceSettings,
      showToast,
    ]
  );

  const handleRenameBubbleCssPreset = useCallback(
    (presetId: string, name: string) => {
      if (presetId === DEFAULT_NEUMORPHISM_BUBBLE_CSS_PRESET_ID) {
        showToast('默认预设不可重命名', 'info');
        return;
      }
      const safeName = name.trim();
      if (!safeName) {
        showToast('请输入新的预设名称', 'info');
        return;
      }
      updateReaderMoreAppearanceSettings({
        bubbleCssPresets: appSettings.readerMore.appearance.bubbleCssPresets.map((item) =>
          item.id === presetId
            ? {
                ...item,
                name: safeName,
              }
            : item
        ),
      });
    },
    [appSettings.readerMore.appearance.bubbleCssPresets, updateReaderMoreAppearanceSettings, showToast]
  );

  const handleSelectBubbleCssPreset = useCallback(
    (presetId: string | null) => {
      const targetPresetId = presetId || DEFAULT_NEUMORPHISM_BUBBLE_CSS_PRESET_ID;
      const builtinPreset = DEFAULT_READER_BUBBLE_CSS_PRESETS.find((item) => item.id === targetPresetId) || null;
      const preset = builtinPreset || appSettings.readerMore.appearance.bubbleCssPresets.find((item) => item.id === targetPresetId);
      if (!preset) return;
      const nextPresetList = (() => {
        if (!builtinPreset) return appSettings.readerMore.appearance.bubbleCssPresets;
        const source = appSettings.readerMore.appearance.bubbleCssPresets;
        const hasBuiltin = source.some((item) => item.id === builtinPreset.id);
        if (!hasBuiltin) return [...source, { ...builtinPreset }];
        return source.map((item) =>
          item.id === builtinPreset.id
            ? {
                ...item,
                name: builtinPreset.name,
                css: builtinPreset.css,
              }
            : item
        );
      })();
      updateReaderMoreAppearanceSettings({
        selectedBubbleCssPresetId: targetPresetId,
        bubbleCssDraft: preset.css,
        ...(builtinPreset ? { bubbleCssPresets: nextPresetList } : {}),
      });
    },
    [appSettings.readerMore.appearance.bubbleCssPresets, updateReaderMoreAppearanceSettings]
  );
  const handleResetAppearanceSettings = useCallback(() => {
    setAppSettings((prev) => ({
      ...prev,
      readerMore: {
        ...prev.readerMore,
        appearance: {
          ...DEFAULT_READER_MORE_APPEARANCE,
        },
      },
    }));
  }, [setAppSettings]);
  const handleResetFeatureSettings = useCallback(() => {
    setAppSettings((prev) => ({
      ...prev,
      readerMore: {
        ...prev.readerMore,
        feature: {
          ...DEFAULT_READER_MORE_FEATURE,
          summaryApiEnabled: false,
          summaryApiPresetId: prev.readerMore.feature.summaryApiPresetId || null,
          summaryApi: {
            ...prev.readerMore.feature.summaryApi,
          },
        },
      },
    }));
    setSummaryTaskQueue((prev) => prev.filter((task) => task.trigger === 'manual'));
  }, [setAppSettings]);

  const fetchSummaryApiModels = useCallback(async () => {
    const config = summaryApiConfig;
    const apiKey = (config.apiKey || '').trim();
    const endpoint = normalizeEndpoint(config.endpoint || '');
    if (!apiKey) {
      setSummaryApiFetchState('ERROR');
      setSummaryApiFetchError('请先输入总结 API Key');
      return;
    }

    setSummaryApiFetchState('LOADING');
    setSummaryApiFetchError('');
    try {
      let models: string[] = [];
      if (config.provider === 'GEMINI') {
        const response = await fetch(`${endpoint}/models?key=${encodeURIComponent(apiKey)}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (Array.isArray(data?.models)) {
          models = data.models
            .map((item: { name?: string }) => (item.name || '').replace('models/', '').trim())
            .filter(Boolean);
        }
      } else if (config.provider === 'CLAUDE') {
        const response = await fetch(`${endpoint}/v1/models`, {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (Array.isArray(data?.data)) {
          models = data.data.map((item: { id?: string }) => (item.id || '').trim()).filter(Boolean);
        }
      } else {
        const response = await fetch(`${endpoint}/models`, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (Array.isArray(data?.data)) {
          models = data.data.map((item: { id?: string }) => (item.id || '').trim()).filter(Boolean);
        }
      }

      const normalizedModels = Array.from(new Set(models.filter(Boolean)));
      if (normalizedModels.length === 0) throw new Error('未获取到可用模型');
      setSummaryApiModels(normalizedModels);
      setSummaryApiFetchState('SUCCESS');
      if (summaryApiCacheKey) {
        const cacheStore = safeReadSummaryModelCache();
        cacheStore[summaryApiCacheKey] = {
          models: normalizedModels,
          updatedAt: Date.now(),
        };
        safeSaveSummaryModelCache(cacheStore);
      }
      if (!config.model) {
        updateSummaryApiSettings({ model: normalizedModels[0] });
      }
    } catch (error) {
      console.error('Failed to fetch summary models', error);
      setSummaryApiFetchState('ERROR');
      setSummaryApiFetchError(error instanceof Error ? error.message : '模型拉取失败');
    }
  }, [summaryApiConfig, summaryApiCacheKey, updateSummaryApiSettings]);

  const queueSummaryTask = useCallback((task: Omit<SummaryTask, 'id' | 'createdAt'>) => {
    const normalizedTask = {
      ...task,
      start: normalizeLooseInt(task.start),
      end: normalizeLooseInt(task.end),
    };
    if (normalizedTask.trigger === 'auto' && !conversationProfileValidRef.current) return;
    const key = `${normalizedTask.conversationKey}::${normalizedTask.kind}::${normalizedTask.trigger}::${normalizedTask.start}-${normalizedTask.end}`;
    const now = Date.now();
    if (normalizedTask.trigger === 'auto') {
      const lastQueuedAt = summaryTaskDebounceRef.current[key] || 0;
      if (now - lastQueuedAt < SUMMARY_TASK_DEBOUNCE_MS) return;
      summaryTaskDebounceRef.current[key] = now;
    }

    setSummaryTaskQueue((prev) => {
      const baseQueue =
        normalizedTask.trigger === 'manual'
          ? prev.filter(
              (item) =>
                !(
                  item.conversationKey === normalizedTask.conversationKey &&
                  item.kind === normalizedTask.kind &&
                  item.trigger === 'auto'
                )
            )
          : prev;
      if (
        baseQueue.some(
          (item) =>
            item.conversationKey === normalizedTask.conversationKey &&
            item.kind === normalizedTask.kind &&
            item.trigger === normalizedTask.trigger &&
            item.start === normalizedTask.start &&
            item.end === normalizedTask.end
        )
      ) {
        return baseQueue;
      }
      return [
        ...baseQueue,
        {
          ...normalizedTask,
          id: `sum-${now}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: now,
        },
      ];
    });
  }, []);

  const selectNextSummaryTask = useCallback((queue: SummaryTask[]) => {
    if (queue.length === 0) return null;
    const scored = queue
      .map((task) => {
        let score = task.kind === 'chat' ? SUMMARY_CHAT_PRIORITY : SUMMARY_BOOK_PRIORITY;
        if (task.trigger === 'manual') score += SUMMARY_MANUAL_BOOST;
        return { task, score };
      })
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.task.createdAt - right.task.createdAt;
      });
    return scored[0]?.task || null;
  }, []);

  useEffect(() => {
    if (summaryTaskRunning) return;
    if (!isConversationProfileValid) return;
    const nextTask = selectNextSummaryTask(
      summaryTaskQueue.filter((task) => task.conversationKey === conversationKey)
    );
    if (!nextTask) return;
    if (readerMoreFeature.summaryApiEnabled && !selectedSummaryApiPreset) {
      if (nextTask.trigger === 'manual') {
        showToast('请先在 API 设置中保存并选择总结副 API 预设', 'error');
      }
      setSummaryTaskQueue((prev) => prev.filter((task) => task.id !== nextTask.id));
      return;
    }

    const isChatBusy = activeGenerationMode !== null;
    if (isChatBusy && isSameApiConfig(summaryApiConfig, apiConfig)) {
      return;
    }

    setSummaryTaskRunning(true);
    activeSummaryTaskRef.current = nextTask;
    const runTask = async () => {
      try {
        const timestamp = Date.now();
        const taskStart = Math.min(nextTask.start, nextTask.end);
        const taskEnd = Math.max(nextTask.start, nextTask.end);
        const buildPrompt = () => {
          const sliceStart = Math.max(0, taskStart - 1);
          const sliceEnd = Math.max(sliceStart, taskEnd);
          if (nextTask.kind === 'chat') {
            const messageSlice = messagesRef.current
              .slice(sliceStart, sliceEnd)
              .map((item) => {
                const roleLabel = item.sender === 'user' ? userNickname : characterRealName;
                return `[${formatSummaryPromptTime(item.timestamp)}][${roleLabel}] ${sanitizeTextForAiPrompt(item.content || '')}`;
              })
              .join('\n');
            return [
              `你是${characterRealName}，正在回顾和${userNickname}的聊天。`,
              '',
              '【任务】用你自己的视角，把下面这段聊天记录浓缩成一小段回忆。',
              '',
              '【格式要求】',
              '- 开头固定写：[YYYY/MM/DD HH:mm - YYYY/MM/DD HH:mm],',
              '- 紧接一段 100-150 字的中文总结。',
              `- 用「我」指代自己，用「${userNickname}」指代对方。`,
              '- 写成一段连贯的话，不要用列表、编号或分点。',
              '- 只写聊天里真实出现过的内容，禁止编造事实妄加揣测。',
              '',
              '【以下为聊天记录】',
              messageSlice || '（空）',
            ].join('\n');
          }
          const fullBookText = sanitizeTextForAiPrompt(
            chapters.length > 0 ? chapters.map((chapter) => chapter.content || '').join('') : (bookText || '')
          );
          const excerpt = fullBookText.slice(sliceStart, sliceEnd);
          return [
            '【任务】将以下书籍片段按内容分段总结。',
            '',
            '【格式要求】',
            '- 每段总结前用【】包裹简短的段落标题（2-8个字）。',
            '- 每段总结100-150字中文，语言凝练，省略不必要的细节修饰。',
            '- 严格基于原文，禁止虚构或补充原文没有的内容，禁止涉及本片段之外的后续情节。',
            '',
            '【总结要素指引】',
            '根据内容类型灵活侧重，不需要每项都写，挑最能概括这段内容的要素：',
            '- 叙事类（小说、传记、历史）：涉及谁、什么时候、发生了什么、为什么、结果如何。',
            '- 观点类（议论文、评论、随笔）：作者提出了什么看法、依据是什么、得出了什么结论。',
            '- 知识类（科普、论文、教材）：讲了什么概念或现象、核心原理是什么、有什么关键数据或例子。',
            '- 实用类（方法论、指南、工具书）：教了什么方法、适用于什么场景、关键步骤或要点是什么。',
            '',
            '【输出示例】',
            '【初到小镇】',
            '主角李明在九月初独自搬到海边小镇，起因是公司裁员后想换个环境。他在码头附近租了间旧屋，遇到房东老陈，对方提到这里冬天几乎没人住。李明嘴上说只是过渡，但内心已经有了长住的念头。',
            '',
            '【记忆的可塑性】',
            '作者引用Loftus的经典实验，说明人的记忆并非像录像带一样忠实回放，而是每次回忆都在无意识中重新建构。实验中通过引导性提问，约30%的被试"记住"了从未发生的细节。作者据此论证，目击证词的可靠性被严重高估。',
            '',
            '【以下是需要总结的书籍片段】',
            excerpt || '（空）',
          ].join('\n');
        };

        const summaryPrompt = buildPrompt();
        console.log(
          `[SummaryPrompt] trigger=${nextTask.trigger} kind=${nextTask.kind} range=${taskStart}-${taskEnd}\n${summaryPrompt}`
        );
        const summaryTextRaw = await callSummaryModel(summaryPrompt, summaryApiConfig);
        const hasPendingManualOverride =
          nextTask.trigger === 'auto' &&
          summaryTaskQueueRef.current.some(
            (item) =>
              item.conversationKey === nextTask.conversationKey &&
              item.kind === nextTask.kind &&
              item.trigger === 'manual'
          );
        if (hasPendingManualOverride || !conversationProfileValidRef.current) return;
        const summaryText = summaryTextRaw.trim();
        if (!summaryText) throw new Error('总结结果为空');

        const card: ReaderSummaryCard = {
          id: `card-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
          content: summaryText,
          start: taskStart,
          end: taskEnd,
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        if (nextTask.kind === 'chat') {
          applyChatSummaryCards([...chatSummaryCardsRef.current, card]);
          if (nextTask.trigger === 'auto') {
            setChatAutoSummaryLastEnd((prev) => Math.max(prev, taskEnd));
          }
        } else {
          const nextCards = [...bookSummaryCardsRef.current, card];
          applyBookSummaryCards(nextCards);
          persistBookSummaryLocal({
            cards: nextCards,
            autoLastEnd:
              nextTask.trigger === 'auto'
                ? Math.max(bookAutoSummaryLastEndRef.current, taskEnd)
                : bookAutoSummaryLastEndRef.current,
          });
          if (nextTask.trigger === 'auto') {
            setBookAutoSummaryLastEnd((prev) => Math.max(prev, taskEnd));
          }
        }
      } catch (error) {
        console.error('Summary task failed', error);
        if (nextTask.trigger === 'manual') {
          showToast(error instanceof Error ? error.message : '总结失败', 'error');
        }
      } finally {
        setSummaryTaskQueue((prev) => prev.filter((item) => item.id !== nextTask.id));
        activeSummaryTaskRef.current = null;
        setSummaryTaskRunning(false);
      }
    };
    void runTask();
  }, [
    summaryTaskQueue,
    summaryTaskRunning,
    conversationKey,
    isConversationProfileValid,
    readerMoreFeature.summaryApiEnabled,
    selectedSummaryApiPreset,
    activeGenerationMode,
    summaryApiConfig,
    apiConfig,
    chapters,
    bookText,
    selectNextSummaryTask,
    applyChatSummaryCards,
    applyBookSummaryCards,
    persistBookSummaryLocal,
    showToast,
  ]);

  useEffect(() => {
    conversationProfileValidRef.current = isConversationProfileValid;
  }, [isConversationProfileValid]);

  useEffect(() => {
    if (isConversationProfileValid) return;
    abortConversationGeneration(conversationKey, 'invalid-persona-or-character');
    setActiveGenerationMode(null);
    setSummaryTaskQueue((prev) =>
      prev.filter((task) => task.conversationKey !== conversationKey)
    );
  }, [conversationKey, isConversationProfileValid]);

  useEffect(() => {
    const enabled = readerMoreFeature.autoChatSummaryEnabled;
    if (enabled && !prevAutoChatSummaryEnabledRef.current) {
      const baseline = Math.max(0, messagesRef.current.length);
      setChatAutoSummaryLastEnd(baseline);
    }
    prevAutoChatSummaryEnabledRef.current = enabled;
  }, [readerMoreFeature.autoChatSummaryEnabled, conversationKey]);

  useEffect(() => {
    if (readerMoreFeature.autoChatSummaryEnabled) return;
    setSummaryTaskQueue((prev) =>
      prev.filter(
        (task) =>
          !(
            task.conversationKey === conversationKey &&
            task.kind === 'chat' &&
            task.trigger === 'auto'
          )
      )
    );
  }, [readerMoreFeature.autoChatSummaryEnabled, conversationKey]);

  useEffect(() => {
    const enabled = readerMoreFeature.autoBookSummaryEnabled;
    if (enabled && !prevAutoBookSummaryEnabledRef.current) {
      const baseline = Math.max(0, normalizeLooseInt(getLatestReadingPosition()?.globalCharOffset || 0));
      setBookAutoSummaryLastEnd(baseline);
    }
    prevAutoBookSummaryEnabledRef.current = enabled;
  }, [readerMoreFeature.autoBookSummaryEnabled, conversationKey, activeBook?.id, getLatestReadingPosition]);

  useEffect(() => {
    if (readerMoreFeature.autoBookSummaryEnabled) return;
    setSummaryTaskQueue((prev) =>
      prev.filter(
        (task) =>
          !(
            task.conversationKey === conversationKey &&
            task.kind === 'book' &&
            task.trigger === 'auto'
          )
      )
    );
  }, [readerMoreFeature.autoBookSummaryEnabled, conversationKey]);

  useEffect(() => {
    if (!isConversationHydrated) return;
    if (!readerMoreFeature.autoChatSummaryEnabled) return;
    if (!isConversationProfileValid) return;
    const triggerCount = normalizeLooseInt(readerMoreFeature.autoChatSummaryTriggerCount);
    if (triggerCount <= 0) return;
    const total = messages.length;
    let cursor = Math.max(0, chatAutoSummaryLastEndRef.current);
    while (total - cursor >= triggerCount) {
      const start = cursor + 1;
      const end = cursor + triggerCount;
      queueSummaryTask({
        kind: 'chat',
        trigger: 'auto',
        start,
        end,
        conversationKey,
      });
      cursor = end;
    }
  }, [
    isConversationHydrated,
    isConversationProfileValid,
    readerMoreFeature.autoChatSummaryEnabled,
    readerMoreFeature.autoChatSummaryTriggerCount,
    messages.length,
    queueSummaryTask,
    conversationKey,
  ]);

  useEffect(() => {
    if (!readerMoreFeature.autoBookSummaryEnabled) return;
    if (!activeBook?.id) return;
    if (!isConversationProfileValid) return;
    const triggerChars = normalizeLooseInt(readerMoreFeature.autoBookSummaryTriggerChars);
    if (triggerChars <= 0) return;
    const interval = window.setInterval(() => {
      const position = getLatestReadingPosition();
      const totalRead = Math.max(0, normalizeLooseInt(position?.globalCharOffset || 0));
      let cursor = Math.max(0, bookAutoSummaryLastEndRef.current);
      while (totalRead - cursor >= triggerChars) {
        const start = cursor + 1;
        const end = cursor + triggerChars;
        queueSummaryTask({
          kind: 'book',
          trigger: 'auto',
          start,
          end,
          conversationKey,
        });
        cursor = end;
      }
    }, 3000);
    return () => window.clearInterval(interval);
  }, [
    isConversationProfileValid,
    readerMoreFeature.autoBookSummaryEnabled,
    readerMoreFeature.autoBookSummaryTriggerChars,
    activeBook?.id,
    getLatestReadingPosition,
    queueSummaryTask,
    conversationKey,
  ]);

  useEffect(() => {
    if (!activeBook?.id) return;
    const store = readChatStore();
    let changed = false;
    Object.entries(store).forEach(([key, bucket]) => {
      const parsed = parseConversationKey(key);
      if (!parsed || parsed.bookId !== activeBook.id) return;
      if (!parsed.personaId && !parsed.characterId) return;
      const persona = personas.find((item) => item.id === parsed.personaId) || null;
      const character = characters.find((item) => item.id === parsed.characterId) || null;
      const personaName = persona?.name?.trim() || '';
      const characterName = character?.name?.trim() || '';
      const nextPersonaName = bucket.personaName || '';
      const nextCharacterName = bucket.characterName || '';
      if ((personaName && nextPersonaName !== personaName) || (characterName && nextCharacterName !== characterName)) {
        store[key] = {
          ...bucket,
          personaName: personaName || nextPersonaName,
          characterName: characterName || nextCharacterName,
        };
        changed = true;
      }
    });
    if (!changed) return;
    saveChatStore(store, conversationKey);
    setArchiveVersion((prev) => prev + 1);
  }, [activeBook?.id, personas, characters, conversationKey]);

  const archiveOptions = useMemo<ReaderArchiveOption[]>(() => {
    const store = readChatStore();
    const rawOptions = Object.entries(store)
      .map(([key, bucket]) => {
        const parsed = parseConversationKey(key);
        if (!parsed) return null;
        if (parsed.bookId !== (activeBook?.id || null)) return null;
        if (!Array.isArray(bucket.messages) || bucket.messages.length === 0) return null;
        const persona = personas.find((item) => item.id === parsed.personaId) || null;
        const character = characters.find((item) => item.id === parsed.characterId) || null;
        const isValid = Boolean(persona && character);
        const archivedPersonaName =
          bucket.personaName ||
          inferArchivedNameFromMessages(bucket.messages || [], 'user') ||
          '';
        const archivedCharacterName =
          bucket.characterName ||
          inferArchivedNameFromMessages(bucket.messages || [], 'character') ||
          '';
        const resolvedPersonaName = persona?.name || archivedPersonaName || '已失效用户人设';
        const resolvedCharacterName = character?.name || archivedCharacterName || '已失效角色人设';
        return {
          conversationKey: key,
          personaId: parsed.personaId,
          personaName: resolvedPersonaName,
          characterId: parsed.characterId,
          characterName: resolvedCharacterName,
          updatedAt: bucket.updatedAt || 0,
          isValid,
          isCurrent: key === conversationKey,
          dedupeIdentity: buildArchiveIdentityKey(parsed.bookId, resolvedPersonaName, resolvedCharacterName),
        };
      })
      .filter((item): item is ReaderArchiveOption & { dedupeIdentity: string } => Boolean(item));

    const dedupedByIdentity = new Map<string, ReaderArchiveOption & { dedupeIdentity: string }>();
    rawOptions.forEach((option) => {
      const identity = option.dedupeIdentity || `key:${option.conversationKey}`;
      const existing = dedupedByIdentity.get(identity);
      if (!existing) {
        dedupedByIdentity.set(identity, option);
        return;
      }
      const shouldReplace =
        option.isCurrent ||
        (!existing.isCurrent && option.updatedAt > existing.updatedAt);
      if (shouldReplace) {
        dedupedByIdentity.set(identity, option);
      }
    });

    const options: ReaderArchiveOption[] = [];
    dedupedByIdentity.forEach((option) => {
      options.push({
        conversationKey: option.conversationKey,
        personaId: option.personaId,
        personaName: option.personaName,
        characterId: option.characterId,
        characterName: option.characterName,
        updatedAt: option.updatedAt,
        isValid: option.isValid,
        isCurrent: option.isCurrent,
      });
    });

    return options
      .sort((left, right) => {
        if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;
        return right.updatedAt - left.updatedAt;
      });
  }, [activeBook?.id, characters, personas, conversationKey, messages.length, archiveVersion]);

  const handleSelectArchive = useCallback(
    (archive: ReaderArchiveOption) => {
      if (archive.isCurrent) return;
      onSelectPersona(archive.personaId);
      onSelectCharacter(archive.characterId);
      onCloseMoreSettings();
    },
    [onSelectPersona, onSelectCharacter, onCloseMoreSettings]
  );
  const handleDeleteArchive = useCallback(
    (targetConversationKey: string) => {
      if (!deleteConversationBucket(targetConversationKey, 'panel-delete-archive')) return;
      if (targetConversationKey === conversationKey) {
        deletedConversationKeyRef.current = targetConversationKey;
        setMessages([]);
        messagesRef.current = [];
        setChatHistorySummary('');
        setReadingPrefixSummaryByBookId({});
        setChatSummaryCards([]);
        setChatAutoSummaryLastEnd(0);
        setSummaryTaskQueue((prev) => prev.filter((task) => task.conversationKey !== targetConversationKey));
      }
      setArchiveVersion((prev) => prev + 1);
      showToast('会话存档已删除');
    },
    [conversationKey, showToast]
  );

  const handleRequestManualChatSummary = useCallback(
    (start: number, end: number) => {
      if (!isConversationProfileValid) {
        showConversationLockedToast();
        return;
      }
      const safeStart = Math.min(normalizeLooseInt(start), normalizeLooseInt(end));
      const safeEnd = Math.max(normalizeLooseInt(start), normalizeLooseInt(end));
      queueSummaryTask({
        kind: 'chat',
        trigger: 'manual',
        start: safeStart,
        end: safeEnd,
        conversationKey,
      });
    },
    [queueSummaryTask, conversationKey, isConversationProfileValid, showConversationLockedToast]
  );

  const handleRequestManualBookSummary = useCallback(
    (start: number, end: number) => {
      if (!isConversationProfileValid) {
        showConversationLockedToast();
        return;
      }
      const safeStart = Math.min(normalizeLooseInt(start), normalizeLooseInt(end));
      const safeEnd = Math.max(normalizeLooseInt(start), normalizeLooseInt(end));
      queueSummaryTask({
        kind: 'book',
        trigger: 'manual',
        start: safeStart,
        end: safeEnd,
        conversationKey,
      });
    },
    [queueSummaryTask, conversationKey, isConversationProfileValid, showConversationLockedToast]
  );

  const handleEditChatSummaryCard = useCallback(
    (cardId: string, content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      const now = Date.now();
      const nextCards = chatSummaryCardsRef.current.map((card) =>
        card.id === cardId
          ? {
              ...card,
              content: trimmed,
              updatedAt: now,
            }
          : card
      );
      applyChatSummaryCards(nextCards);
    },
    [applyChatSummaryCards]
  );

  const handleDeleteChatSummaryCard = useCallback(
    (cardId: string) => {
      const nextCards = chatSummaryCardsRef.current.filter((card) => card.id !== cardId);
      applyChatSummaryCards(nextCards);
    },
    [applyChatSummaryCards]
  );

  const handleEditBookSummaryCard = useCallback(
    (cardId: string, content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      const now = Date.now();
      const nextCards = bookSummaryCardsRef.current.map((card) =>
        card.id === cardId
          ? {
              ...card,
              content: trimmed,
              updatedAt: now,
            }
          : card
      );
      applyBookSummaryCards(nextCards);
      persistBookSummaryLocal({
        cards: nextCards,
        autoLastEnd: bookAutoSummaryLastEndRef.current,
      });
    },
    [applyBookSummaryCards, persistBookSummaryLocal]
  );

  const handleDeleteBookSummaryCard = useCallback(
    (cardId: string) => {
      const nextCards = bookSummaryCardsRef.current.filter((card) => card.id !== cardId);
      applyBookSummaryCards(nextCards);
      persistBookSummaryLocal({
        cards: nextCards,
        autoLastEnd: bookAutoSummaryLastEndRef.current,
      });
    },
    [applyBookSummaryCards, persistBookSummaryLocal]
  );

  const handleMergeChatSummaryCards = useCallback(
    (cardIds: string[]) => {
      const nextCards = mergeSummaryCardsByIds(chatSummaryCardsRef.current, cardIds);
      if (!nextCards) {
        showToast('请至少选择两张总结卡片', 'info');
        return;
      }
      applyChatSummaryCards(nextCards);
    },
    [applyChatSummaryCards, showToast]
  );

  const handleMergeBookSummaryCards = useCallback(
    (cardIds: string[]) => {
      const nextCards = mergeSummaryCardsByIds(bookSummaryCardsRef.current, cardIds);
      if (!nextCards) {
        showToast('请至少选择两张总结卡片', 'info');
        return;
      }
      applyBookSummaryCards(nextCards);
      persistBookSummaryLocal({
        cards: nextCards,
        autoLastEnd: bookAutoSummaryLastEndRef.current,
      });
    },
    [applyBookSummaryCards, persistBookSummaryLocal, showToast]
  );

  const scrollMessagesToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    if (!messagesContainerRef.current) return;
    messagesContainerRef.current.scrollTo({
      top: messagesContainerRef.current.scrollHeight,
      behavior,
    });
  }, []);

  const queueKeepLastMessageVisible = useCallback(() => {
    if (keepBottomRafRef.current) return;
    keepBottomRafRef.current = window.requestAnimationFrame(() => {
      keepBottomRafRef.current = null;
      scrollMessagesToBottom('auto');
    });
  }, [scrollMessagesToBottom]);

  const startBubbleRevealSequence = useCallback(
    (bubbleIds: string[]) => {
      if (bubbleIds.length === 0) return;
      const sequenceId = bubbleRevealSequenceRef.current + 1;
      bubbleRevealSequenceRef.current = sequenceId;
      void (async () => {
        for (let index = 0; index < bubbleIds.length; index += 1) {
          await sleep(index === 0 ? AI_REPLY_FIRST_BUBBLE_DELAY_MS : AI_REPLY_BUBBLE_INTERVAL_MS);
          if (!isMountedRef.current || bubbleRevealSequenceRef.current !== sequenceId) return;
          const bubbleId = bubbleIds[index];
          updateHiddenBubbleIds((prev) => {
            if (!prev.includes(bubbleId)) return prev;
            return prev.filter((id) => id !== bubbleId);
          });
          queueKeepLastMessageVisible();
        }
      })();
    },
    [queueKeepLastMessageVisible, updateHiddenBubbleIds]
  );

  const captureScrollDistFromBottom = useCallback(() => {
    const scroller = messagesContainerRef.current;
    if (!scroller) {
      scrollDistFromBottomRef.current = null;
      return;
    }
    scrollDistFromBottomRef.current = Math.max(0, scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight);
  }, []);

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const resetLongPressMeta = () => {
    longPressMetaRef.current = { bubbleId: null, x: 0, y: 0 };
  };

  const clearDragState = () => {
    dragStateRef.current = { active: false, pointerId: null, startY: 0, startHeight: 0, moved: false };
    pendingDragHeightRef.current = null;
  };

  useEffect(() => {
    const prevKey = lastSyncedConversationKeyRef.current;
    if (prevKey && prevKey !== conversationKey) {
      persistConversationBucket(
        prevKey,
        (existing) => ({
          ...existing,
          messages: messagesRef.current,
        }),
        'pre-switch-flush'
      );
    }
    bubbleRevealSequenceRef.current += 1;
    hiddenBubbleIdsRef.current = [];
    setHiddenBubbleIds([]);
    setIsConversationHydrated(false);
    setIsBookSummaryHydrated(false);
    deletedConversationKeyRef.current = null;
    prevAutoChatSummaryEnabledRef.current = false;
    prevAutoBookSummaryEnabledRef.current = false;
    const bucket = ensureConversationBucket(conversationKey, legacyConversationKey);
    const status = getConversationGenerationStatus(conversationKey);
    setMessages(bucket.messages);
    messagesRef.current = bucket.messages;
    setChatHistorySummary(bucket.chatHistorySummary || '');
    setReadingPrefixSummaryByBookId(bucket.readingPrefixSummaryByBookId || {});
    setChatSummaryCards(bucket.chatSummaryCards || []);
    setChatAutoSummaryLastEnd(
      readerMoreFeature.autoChatSummaryEnabled
        ? Math.max(0, bucket.messages.length)
        : Math.max(0, bucket.chatAutoSummaryLastEnd || 0)
    );
    setActiveGenerationMode(status.isLoading ? status.mode : null);
    setInputText('');
    setQuotedMessageId(null);
    setEditingMessageId(null);
    setIsDeleteMode(false);
    setSelectedDeleteIds([]);
    setContextMenu(null);
    setIsConversationHydrated(true);

    if (!activeBook?.id) {
      setBookSummaryCards([]);
      setBookAutoSummaryLastEnd(0);
      setIsBookSummaryHydrated(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      const content = await getBookContent(activeBook.id).catch(() => null);
      if (cancelled) return;
      setBookSummaryCards(content?.bookSummaryCards || []);
      if (readerMoreFeature.autoBookSummaryEnabled) {
        const baseline = Math.max(0, normalizeLooseInt(getLatestReadingPosition()?.globalCharOffset || 0));
        setBookAutoSummaryLastEnd(baseline);
      } else {
        setBookAutoSummaryLastEnd(Math.max(0, content?.bookAutoSummaryLastEnd || 0));
      }
      setIsBookSummaryHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationKey, legacyConversationKey, activeBook?.id]);

  useEffect(() => {
    if (!isConversationHydrated) return;
    if (deletedConversationKeyRef.current === conversationKey) return;
    if (lastSyncedConversationKeyRef.current !== conversationKey) {
      lastSyncedConversationKeyRef.current = conversationKey;
      return;
    }
    if (messages.length === 0 && !readChatStore()[conversationKey]) return;
    const personaName = activePersona?.name?.trim() || '';
    const characterName = activeCharacter?.name?.trim() || '';
    persistConversationBucket(
      conversationKey,
      (existing) => ({
        ...existing,
        personaName: personaName || existing.personaName || '',
        characterName: characterName || existing.characterName || '',
        messages,
        chatHistorySummary,
        readingPrefixSummaryByBookId,
        chatSummaryCards,
        chatAutoSummaryLastEnd,
      }),
      'panel-local-sync'
    );
  }, [
    conversationKey,
    messages,
    chatHistorySummary,
    readingPrefixSummaryByBookId,
    chatSummaryCards,
    chatAutoSummaryLastEnd,
    isConversationHydrated,
    activePersona?.name,
    activeCharacter?.name,
  ]);

  useEffect(() => {
    const pending = pendingGenerationRef.current;
    if (!pending || pending.conversationKey === conversationKey) return;
    persistConversationMessages(pending.conversationKey, [
      ...pending.committedMessages,
      ...pending.remainingMessages,
    ], 'panel-pending-flush');
    pendingGenerationRef.current = null;
  }, [conversationKey]);

  useEffect(() => {
    const status = getConversationGenerationStatus(conversationKey);
    setActiveGenerationMode(status.isLoading ? status.mode : null);
  }, [conversationKey]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    chatSummaryCardsRef.current = chatSummaryCards;
  }, [chatSummaryCards]);

  useEffect(() => {
    bookSummaryCardsRef.current = bookSummaryCards;
  }, [bookSummaryCards]);

  useEffect(() => {
    chatAutoSummaryLastEndRef.current = chatAutoSummaryLastEnd;
  }, [chatAutoSummaryLastEnd]);

  useEffect(() => {
    bookAutoSummaryLastEndRef.current = bookAutoSummaryLastEnd;
  }, [bookAutoSummaryLastEnd]);

  useEffect(() => {
    summaryTaskQueueRef.current = summaryTaskQueue;
  }, [summaryTaskQueue]);

  useEffect(() => {
    if (!activeBook?.id) return;
    setReadingPrefixSummaryByBookId((prev) => ({
      ...prev,
      [activeBook.id]: aggregateSummaryCardsText(bookSummaryCards),
    }));
  }, [activeBook?.id, bookSummaryCards]);

  useEffect(() => {
    if (!activeBook?.id || !isBookSummaryHydrated) return;
    persistBookSummaryLocal({
      cards: bookSummaryCards,
      autoLastEnd: bookAutoSummaryLastEnd,
    });
  }, [activeBook?.id, bookSummaryCards, bookAutoSummaryLastEnd, persistBookSummaryLocal, isBookSummaryHydrated]);

  useEffect(() => {
    if (!summaryApiCacheKey) {
      setSummaryApiModels([]);
      setSummaryApiFetchState('IDLE');
      setSummaryApiFetchError('');
      return;
    }
    const cacheEntry = safeReadSummaryModelCache()[summaryApiCacheKey];
    if (!cacheEntry || cacheEntry.models.length === 0) {
      setSummaryApiModels([]);
      setSummaryApiFetchState('IDLE');
      setSummaryApiFetchError('');
      return;
    }
    setSummaryApiModels(cacheEntry.models);
    setSummaryApiFetchState('SUCCESS');
    setSummaryApiFetchError('');
  }, [summaryApiCacheKey]);

  useEffect(() => {
    hiddenBubbleIdsRef.current = hiddenBubbleIds;
  }, [hiddenBubbleIds]);

  useEffect(() => {
    updateHiddenBubbleIds((prev) => {
      if (prev.length === 0) return prev;
      const messageIdSet = new Set(messages.map((message) => message.id));
      const next = prev.filter((id) => messageIdSet.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [messages, updateHiddenBubbleIds]);

  useEffect(() => {
    const offStoreUpdated = onChatStoreUpdated((detail) => {
      if (detail.conversationKey !== conversationKey) return;
      if (detail.reason === 'panel-local-sync') return;
      const incoming = detail.bucket;
      const prevMessages = messagesRef.current;

      if (!isAiPanelOpenRef.current && incoming.messages.length > prevMessages.length) {
        const diff = incoming.messages.length - prevMessages.length;
        if (diff > 0) {
          setUnreadMessageCount((count) => Math.min(99, count + diff));
        }
      }

      const appended = detail.reason === 'app-proactive' ? getTailAppendedMessages(prevMessages, incoming.messages) : [];
      const canRevealSequentially = appended.length > 0 && appended.every((message) => message.sender === 'character');

      if (canRevealSequentially) {
        const incomingIdSet = new Set(incoming.messages.map((message) => message.id));
        const hiddenSet = new Set(hiddenBubbleIdsRef.current.filter((id) => incomingIdSet.has(id)));
        appended.forEach((message) => hiddenSet.add(message.id));
        const revealOrder = incoming.messages.map((message) => message.id).filter((id) => hiddenSet.has(id));
        updateHiddenBubbleIds(() => revealOrder);
        startBubbleRevealSequence(revealOrder);
      } else {
        bubbleRevealSequenceRef.current += 1;
        updateHiddenBubbleIds((prev) => {
          if (prev.length === 0) return prev;
          const incomingIdSet = new Set(incoming.messages.map((message) => message.id));
          const next = prev.filter((id) => incomingIdSet.has(id));
          return next.length === prev.length ? prev : next;
        });
      }

      setMessages(incoming.messages);
      messagesRef.current = incoming.messages;
      setChatHistorySummary(incoming.chatHistorySummary || '');
      setReadingPrefixSummaryByBookId(incoming.readingPrefixSummaryByBookId || {});
      setChatSummaryCards(incoming.chatSummaryCards || []);
      setChatAutoSummaryLastEnd(Math.max(0, incoming.chatAutoSummaryLastEnd || 0));
    });

    const offGenerationStatus = onGenerationStatusChanged((detail) => {
      if (detail.conversationKey !== conversationKey) return;
      setActiveGenerationMode(detail.isLoading ? detail.mode : null);
    });

    return () => {
      offStoreUpdated();
      offGenerationStatus();
    };
  }, [conversationKey]);

  useEffect(() => {
    if (!isAiLoading) return;
    const syncFromStore = () => {
      const storeBucket = readChatStore()[conversationKey];
      const storeMessages = Array.isArray(storeBucket?.messages) ? storeBucket.messages : [];
      if (storeMessages.length > 0) {
        setMessages((prev) => {
          if (storeMessages.length <= prev.length) return prev;
          const prevLastId = prev.length > 0 ? prev[prev.length - 1].id : '';
          if (prevLastId && !storeMessages.some((item) => item.id === prevLastId)) return prev;
          return storeMessages;
        });
      }
    };

    syncFromStore();
    const timer = window.setInterval(syncFromStore, 350);
    return () => window.clearInterval(timer);
  }, [conversationKey, isAiLoading]);

  const measurePanelBounds = useCallback(() => {
    const vh = getViewportHeight();
    const minHeight = Math.round(vh * MIN_PANEL_HEIGHT_RATIO);
    const measuredReaderHeight = readerContentRef.current?.getBoundingClientRect().height || 0;
    const readerHeight = measuredReaderHeight > 0 ? measuredReaderHeight : vh;
    const maxHeight = Math.max(minHeight, Math.round(readerHeight * MAX_PANEL_HEIGHT_RATIO));
    setPanelBounds((prev) => {
      if (prev.min === minHeight && prev.max === maxHeight) return prev;
      return { min: minHeight, max: maxHeight };
    });
  }, [readerContentRef]);

  const measureFabBottom = useCallback(() => {
    const readerRect = readerContentRef.current?.getBoundingClientRect();
    if (!readerRect) {
      setFabBottomPx(24);
      return;
    }
    const viewportBottomGap = Math.max(0, window.innerHeight - readerRect.bottom);
    const nextBottom = Math.max(16, Math.round(viewportBottomGap + 10));
    setFabBottomPx(nextBottom);
  }, [readerContentRef]);

  useEffect(() => {
    measurePanelBounds();
    measureFabBottom();
    const resizeHandler = () => measurePanelBounds();
    const resizeFabHandler = () => measureFabBottom();
    window.addEventListener('resize', resizeHandler);
    window.addEventListener('resize', resizeFabHandler);

    const observed = readerContentRef.current;
    const observer =
      typeof ResizeObserver !== 'undefined' && observed
        ? new ResizeObserver(() => {
            measurePanelBounds();
            measureFabBottom();
          })
        : null;
    observer?.observe(observed);

    return () => {
      window.removeEventListener('resize', resizeHandler);
      window.removeEventListener('resize', resizeFabHandler);
      observer?.disconnect();
    };
  }, [measurePanelBounds, measureFabBottom, readerContentRef]);

  useEffect(() => {
    setPanelHeightPx((prev) => clamp(prev, panelBounds.min, panelBounds.max));
  }, [panelBounds]);

  useEffect(() => {
    try {
      localStorage.setItem(AI_PANEL_HEIGHT_STORAGE_KEY, `${Math.round(panelHeightPx)}`);
    } catch {
      // ignore localStorage failures
    }
  }, [panelHeightPx]);

  useEffect(() => {
    isAiPanelOpenRef.current = isAiPanelOpen;
    if (isAiPanelOpen) {
      setUnreadMessageCount(0);
      setIsAiFabOpening(false);
    }
  }, [isAiPanelOpen]);

  useEffect(() => {
    if (!isAiPanelOpen) return;
    const rafId = window.requestAnimationFrame(() => {
      scrollMessagesToBottom('smooth');
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [messages, isAiPanelOpen, isAiLoading, scrollMessagesToBottom]);

  useLayoutEffect(() => {
    const dist = scrollDistFromBottomRef.current;
    if (!Number.isFinite(dist)) return;
    const scroller = messagesContainerRef.current;
    if (!scroller) {
      scrollDistFromBottomRef.current = null;
      releaseScrollDistLockAfterLayoutRef.current = false;
      return;
    }
    const nextTop = scroller.scrollHeight - scroller.clientHeight - (dist as number);
    scroller.scrollTop = Math.max(0, nextTop);
    if (releaseScrollDistLockAfterLayoutRef.current) {
      scrollDistFromBottomRef.current = null;
      releaseScrollDistLockAfterLayoutRef.current = false;
    }
  }, [resolvedPanelHeight]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      const pending = pendingGenerationRef.current;
      if (pending) {
        persistConversationMessages(pending.conversationKey, [
          ...pending.committedMessages,
          ...pending.remainingMessages,
        ], 'panel-unmount-flush');
        pendingGenerationRef.current = null;
      }
      if (aiFabOpenTimerRef.current) {
        window.clearTimeout(aiFabOpenTimerRef.current);
      }
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      if (dragRafRef.current) {
        window.cancelAnimationFrame(dragRafRef.current);
      }
      if (keepBottomRafRef.current) {
        window.cancelAnimationFrame(keepBottomRafRef.current);
      }
      bubbleRevealSequenceRef.current += 1;
      clearLongPressTimer();
    };
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const handleOutside = (event: PointerEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) return;
      setContextMenu(null);
    };
    window.addEventListener('pointerdown', handleOutside);
    return () => window.removeEventListener('pointerdown', handleOutside);
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu) {
      setContextMenuLayout(null);
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      const menu = contextMenuRef.current;
      if (!menu) return;

      const rect = menu.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let left = contextMenu.x + CONTEXT_MENU_MARGIN;
      let top = contextMenu.y - rect.height - CONTEXT_MENU_MARGIN;

      if (left + rect.width + CONTEXT_MENU_MARGIN > viewportWidth) {
        left = viewportWidth - rect.width - CONTEXT_MENU_MARGIN;
      }
      if (left < CONTEXT_MENU_MARGIN) {
        left = CONTEXT_MENU_MARGIN;
      }

      if (top < CONTEXT_MENU_MARGIN) {
        top = contextMenu.y + CONTEXT_MENU_MARGIN;
      }
      if (top + rect.height + CONTEXT_MENU_MARGIN > viewportHeight) {
        top = viewportHeight - rect.height - CONTEXT_MENU_MARGIN;
      }
      if (top < CONTEXT_MENU_MARGIN) {
        top = CONTEXT_MENU_MARGIN;
      }

      setContextMenuLayout({ left, top });
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [contextMenu]);

  const handleOpenAiPanelFromFab = () => {
    if (isAiPanelOpen || isAiFabOpening) return;
    setIsAiFabOpening(true);
    if (aiFabOpenTimerRef.current) {
      window.clearTimeout(aiFabOpenTimerRef.current);
    }
    aiFabOpenTimerRef.current = window.setTimeout(() => {
      setIsAiPanelOpen(true);
      setIsAiFabOpening(false);
      aiFabOpenTimerRef.current = null;
    }, AI_FAB_OPEN_DELAY_MS);
  };

  const handlePanelGripPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch' && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const target = event.currentTarget;
    if (typeof target.setPointerCapture === 'function') {
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        // ignore capture failures
      }
    }

    dragStateRef.current = {
      active: true,
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: resolvedPanelHeight,
      moved: false,
    };
    releaseScrollDistLockAfterLayoutRef.current = false;
    captureScrollDistFromBottom();
    setIsPanelDragging(true);
  };

  const handlePanelGripPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    event.preventDefault();

    const deltaY = drag.startY - event.clientY;
    if (Math.abs(deltaY) > 4) {
      drag.moved = true;
    }

    const nextHeight = clamp(drag.startHeight + deltaY, panelBounds.min, panelBounds.max);

    pendingDragHeightRef.current = nextHeight;
    if (dragRafRef.current) return;

    dragRafRef.current = window.requestAnimationFrame(() => {
      dragRafRef.current = null;
      const next = pendingDragHeightRef.current;
      if (!Number.isFinite(next)) return;
      setPanelHeightPx(next as number);
    });
  };

  const handlePanelGripPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;

    const target = event.currentTarget;
    if (typeof target.releasePointerCapture === 'function') {
      try {
        target.releasePointerCapture(event.pointerId);
      } catch {
        // ignore release failures
      }
    }

    const shouldCollapse = !drag.moved;
    if (Number.isFinite(pendingDragHeightRef.current)) {
      const next = pendingDragHeightRef.current as number;
      releaseScrollDistLockAfterLayoutRef.current = true;
      setPanelHeightPx((prev) => {
        if (prev === next) {
          releaseScrollDistLockAfterLayoutRef.current = false;
          scrollDistFromBottomRef.current = null;
          return prev;
        }
        return next;
      });
      pendingDragHeightRef.current = null;
    } else {
      scrollDistFromBottomRef.current = null;
      releaseScrollDistLockAfterLayoutRef.current = false;
    }
    if (dragRafRef.current) {
      window.cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    clearDragState();
    setIsPanelDragging(false);
    if (shouldCollapse) {
      setIsAiPanelOpen(false);
    }
  };

  const handlePanelGripPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    if (typeof target.releasePointerCapture === 'function') {
      try {
        target.releasePointerCapture(event.pointerId);
      } catch {
        // ignore release failures
      }
    }

    if (Number.isFinite(pendingDragHeightRef.current)) {
      const next = pendingDragHeightRef.current as number;
      releaseScrollDistLockAfterLayoutRef.current = true;
      setPanelHeightPx((prev) => {
        if (prev === next) {
          releaseScrollDistLockAfterLayoutRef.current = false;
          scrollDistFromBottomRef.current = null;
          return prev;
        }
        return next;
      });
      pendingDragHeightRef.current = null;
    } else {
      scrollDistFromBottomRef.current = null;
      releaseScrollDistLockAfterLayoutRef.current = false;
    }
    if (dragRafRef.current) {
      window.cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    clearDragState();
    setIsPanelDragging(false);
  };

  const getBubbleDisplayName = (sender: ChatSender) => (sender === 'user' ? userRealName : characterRealName);

  const buildReadingContext = (): ReadingContextSnapshot => {
    const readingPosition = getLatestReadingPosition();
    const scroller = readerContentRef.current;
    const visibleRatio =
      scroller && scroller.scrollHeight > 1
        ? clamp(scroller.clientHeight / scroller.scrollHeight, 0, 1)
        : 0;
    return buildReadingContextSnapshot({
      chapters,
      bookText,
      highlightRangesByChapter,
      readingPosition,
      visibleRatio,
      excerptCharCount: appSettings.readerMore.feature.readingExcerptCharCount,
    });
  };
  const sessionPromptTokenEstimate: PromptTokenEstimate = useMemo(() => {
    const readingContext = buildReadingContext();
    return estimateConversationPromptTokens({
      mode: 'manual',
      sourceMessages: messages,
      readingContext,
      allowAiUnderlineInThisReply:
        aiProactiveUnderlineEnabled && Math.max(0, normalizeLooseInt(aiProactiveUnderlineProbability)) > 0,
      characterWorldBookEntries,
      userRealName,
      userNickname,
      userDescription,
      characterRealName,
      characterNickname,
      characterDescription,
      activeBookTitle,
      activeBookSummary,
      chatHistorySummary,
      memoryBubbleCount: readerMoreFeature.memoryBubbleCount,
      replyBubbleMin: readerMoreFeature.replyBubbleMin,
      replyBubbleMax: readerMoreFeature.replyBubbleMax,
    });
  }, [
    messages,
    aiProactiveUnderlineEnabled,
    aiProactiveUnderlineProbability,
    characterWorldBookEntries,
    userRealName,
    userNickname,
    userDescription,
    characterRealName,
    characterNickname,
    characterDescription,
    activeBookTitle,
    activeBookSummary,
    chatHistorySummary,
    readerMoreFeature.memoryBubbleCount,
    readerMoreFeature.replyBubbleMin,
    readerMoreFeature.replyBubbleMax,
    chapters,
    bookText,
    highlightRangesByChapter,
    appSettings.readerMore.feature.readingExcerptCharCount,
    getLatestReadingPosition,
    readerContentRef,
  ]);

  const requestAiReply = async (sourceMessages: ChatBubble[]) => {
    if (isManualLoading) return;
    if (!isConversationProfileValid) {
      showConversationLockedToast();
      return;
    }
    const readingContext = buildReadingContext();
    const requestConversationKey = conversationKey;
    setContextMenu(null);

    // RAG: 检索相关书籍片段
    let ragContext = '';
    if (activeBook?.id) {
      try {
        const pendingUserText = sourceMessages
          .filter((m) => m.sender === 'user' && !m.sentToAi)
          .map((m) => m.content)
          .join(' ');
        const recentContextText = sourceMessages
          .slice(-6)
          .map((m) => m.content)
          .join(' ');
        const primaryQuery = sanitizeTextForAiPrompt(pendingUserText);
        const fallbackQuery = sanitizeTextForAiPrompt(recentContextText);
        const ragQuery = (primaryQuery || fallbackQuery).slice(-1200);

        if (ragQuery) {
          const readingPosition = getLatestReadingPosition();
          const safeOffset = estimateRagSafeOffset(chapters, readingPosition, readingContext.excerptEnd || 0);

          // 先拿全书候选，再按阅读进度做程序过滤，尽量减少“每次都同一段/全被过滤为空”。
          const candidateChunks = await retrieveRelevantChunks(
            ragQuery,
            { [activeBook.id]: Number.MAX_SAFE_INTEGER },
            { topK: 18, perBookTopK: 18 },
            ragApiConfigResolver,
          );

          const picked: typeof candidateChunks = [];
          const seenChunkId = new Set<string>();
          for (const chunk of candidateChunks) {
            if (chunk.endOffset > safeOffset) continue;
            if (seenChunkId.has(chunk.id)) continue;
            seenChunkId.add(chunk.id);
            picked.push(chunk);
            if (picked.length >= 3) break;
          }

          // 保底：如果全书候选被进度过滤后不足3段，再从“进度内”直接补齐。
          if (picked.length < 3 && safeOffset > 0) {
            const fallbackChunks = await retrieveRelevantChunks(
              ragQuery,
              { [activeBook.id]: safeOffset },
              { topK: 3, perBookTopK: 3 },
              ragApiConfigResolver,
            );
            for (const chunk of fallbackChunks) {
              if (seenChunkId.has(chunk.id)) continue;
              seenChunkId.add(chunk.id);
              picked.push(chunk);
              if (picked.length >= 3) break;
            }
          }

          if (picked.length > 0) {
            ragContext = picked.slice(0, 3).map((c) => c.text).join('\n---\n');
          }
        }
      } catch { /* RAG 静默失败 */ }
    }

    try {
      const result = await runConversationGeneration({
        mode: 'manual',
        conversationKey: requestConversationKey,
        sourceMessages,
        apiConfig,
        userRealName,
        userNickname,
        userDescription,
        characterRealName,
        characterNickname,
        characterDescription,
        characterWorldBookEntries,
        activeBookId: activeBook?.id || null,
        activeBookTitle,
        chatHistorySummary,
        readingPrefixSummaryByBookId,
        readingContext,
        aiProactiveUnderlineEnabled,
        aiProactiveUnderlineProbability,
        memoryBubbleCount: appSettings.readerMore.feature.memoryBubbleCount,
        replyBubbleMin: appSettings.readerMore.feature.replyBubbleMin,
        replyBubbleMax: appSettings.readerMore.feature.replyBubbleMax,
        allowEmptyPending: false,
        onAddAiUnderlineRange,
        ragContext,
      });

      if (result.status === 'skip') {
        if (!result.silent) {
          if (result.reason === 'error') {
            showToast(result.message || '发送失败', 'error');
          } else if (result.message) {
            showToast(result.message, 'info');
          }
        }
        return;
      }

      const baseMessages = result.baseMessages;
      const aiMessages = result.aiMessages;
      pendingGenerationRef.current = {
        conversationKey: requestConversationKey,
        committedMessages: baseMessages,
        remainingMessages: [...aiMessages],
      };
      if (!isMountedRef.current) {
        const pendingGeneration = pendingGenerationRef.current;
        if (pendingGeneration) {
          persistConversationMessages(pendingGeneration.conversationKey, [
            ...pendingGeneration.committedMessages,
            ...pendingGeneration.remainingMessages,
          ], 'panel-manual-unmounted');
          pendingGenerationRef.current = null;
        }
        return;
      }
      setMessages(baseMessages);
      queueKeepLastMessageVisible();

      for (let index = 0; index < aiMessages.length; index += 1) {
        await sleep(index === 0 ? AI_REPLY_FIRST_BUBBLE_DELAY_MS : AI_REPLY_BUBBLE_INTERVAL_MS);
        if (!isMountedRef.current) {
          const pendingGeneration = pendingGenerationRef.current;
          if (pendingGeneration) {
            persistConversationMessages(pendingGeneration.conversationKey, [
              ...pendingGeneration.committedMessages,
              ...pendingGeneration.remainingMessages,
            ], 'panel-manual-unmounted');
            pendingGenerationRef.current = null;
          }
          return;
        }
        const aiMessage = aiMessages[index];
        const pendingGeneration = pendingGenerationRef.current;
        if (pendingGeneration) {
          pendingGeneration.remainingMessages.shift();
          pendingGeneration.committedMessages = [...pendingGeneration.committedMessages, aiMessage];
        }
        setMessages((prev) => [...prev, aiMessage]);
        queueKeepLastMessageVisible();
        if (!isAiPanelOpenRef.current) {
          setUnreadMessageCount((prev) => Math.min(99, prev + 1));
        }
      }
      pendingGenerationRef.current = null;
    } catch (error) {
      pendingGenerationRef.current = null;
      const message = error instanceof Error ? error.message : '发送失败';
      showToast(message, 'error');
    }
  };

  const handleQueueUserBubble = () => {
    if (isManualLoading || isDeleteMode) return;
    if (!isConversationProfileValid) {
      showConversationLockedToast();
      return;
    }
    const text = compactText(inputText);
    if (!text) return;

    const now = Date.now();
    const quotePayload =
      quotedMessage && quotedMessage.content
        ? {
            sourceMessageId: quotedMessage.id,
            sender: quotedMessage.sender,
            senderName: getBubbleDisplayName(quotedMessage.sender),
            content: quotedMessage.content,
            timestamp: quotedMessage.timestamp,
          }
        : undefined;

    const newMessage: ChatBubble = {
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      sender: 'user',
      content: text,
      timestamp: now,
      sentToAi: false,
      quote: quotePayload,
      promptRecord: buildUserPromptRecord(userRealName, text, now, quotePayload),
    };

    setMessages((prev) => [...prev, newMessage]);
    setInputText('');
    setQuotedMessageId(null);
    setContextMenu(null);
  };

  const applyEditMessage = () => {
    if (!editingMessageId) return;
    const text = compactText(inputText);
    if (!text) {
      showToast('编辑内容不能为空', 'info');
      return;
    }
    setMessages((prev) =>
      prev.map((message) => {
        if (message.id !== editingMessageId) return message;
        const promptRecord =
          message.sender === 'user'
            ? buildUserPromptRecord(userRealName, text, message.timestamp, message.quote)
            : buildCharacterPromptRecord(characterRealName, text, message.timestamp);
        return {
          ...message,
          content: text,
          promptRecord,
          editedAt: Date.now(),
        };
      })
    );
    setEditingMessageId(null);
    setInputText('');
    setContextMenu(null);
  };

  const cancelEditMessage = () => {
    setEditingMessageId(null);
    setInputText('');
  };

  const startDeleteMode = (bubbleId: string) => {
    setIsDeleteMode(true);
    setSelectedDeleteIds([bubbleId]);
    setContextMenu(null);
    setEditingMessageId(null);
    setQuotedMessageId(null);
  };

  const confirmDeleteMessages = () => {
    if (selectedDeleteIds.length === 0) {
      setIsDeleteMode(false);
      return;
    }
    const deleteSet = new Set(selectedDeleteIds);
    setMessages((prev) => prev.filter((message) => !deleteSet.has(message.id)));
    if (editingMessageId && deleteSet.has(editingMessageId)) {
      setEditingMessageId(null);
      setInputText('');
    }
    if (quotedMessageId && deleteSet.has(quotedMessageId)) {
      setQuotedMessageId(null);
    }
    setIsDeleteMode(false);
    setSelectedDeleteIds([]);
  };

  const cancelDeleteMode = () => {
    setIsDeleteMode(false);
    setSelectedDeleteIds([]);
  };

  const openEditFromContext = (bubbleId: string) => {
    const target = messages.find((message) => message.id === bubbleId);
    if (!target) return;
    setEditingMessageId(bubbleId);
    setInputText(target.content);
    setIsDeleteMode(false);
    setSelectedDeleteIds([]);
    setQuotedMessageId(null);
    setContextMenu(null);
  };

  const openQuoteFromContext = (bubbleId: string) => {
    const target = messages.find((message) => message.id === bubbleId);
    if (!target) return;
    setQuotedMessageId(bubbleId);
    setEditingMessageId(null);
    setContextMenu(null);
  };

  const removeLastAiGeneration = (sourceMessages: ChatBubble[]) => {
    if (sourceMessages.length === 0) return null;
    const last = sourceMessages[sourceMessages.length - 1];
    if (last.sender !== 'character') return null;
    const generationId = last.generationId || null;

    const deleteIds = new Set<string>();
    if (generationId) {
      for (let index = sourceMessages.length - 1; index >= 0; index -= 1) {
        const message = sourceMessages[index];
        if (message.sender === 'character' && message.generationId === generationId) {
          deleteIds.add(message.id);
          continue;
        }
        break;
      }
    } else {
      for (let index = sourceMessages.length - 1; index >= 0; index -= 1) {
        const message = sourceMessages[index];
        if (message.sender === 'character') {
          deleteIds.add(message.id);
          continue;
        }
        break;
      }
    }

    if (deleteIds.size === 0) return null;
    return {
      strippedMessages: sourceMessages.filter((message) => !deleteIds.has(message.id)),
      generationId,
    };
  };

  const handleRefreshReply = async () => {
    if (isManualLoading) return;
    if (!isConversationProfileValid) {
      showConversationLockedToast();
      return;
    }
    if (messages.length === 0 || messages[messages.length - 1].sender !== 'character') {
      showToast('目前没有可以重答的回复', 'info');
      return;
    }
    const removed = removeLastAiGeneration(messages);
    if (!removed) {
      showToast('目前没有可以重答的回复', 'info');
      return;
    }
    setMessages(removed.strippedMessages);
    if (removed.generationId) {
      onRollbackAiUnderlineGeneration(removed.generationId);
    }
    await requestAiReply(removed.strippedMessages);
  };

  const handleBubblePointerDown = (event: React.PointerEvent<HTMLDivElement>, bubbleId: string) => {
    if (isDeleteMode) return;
    if (event.pointerType !== 'touch' && event.button !== 0) return;
    clearLongPressTimer();
    longPressMetaRef.current = { bubbleId, x: event.clientX, y: event.clientY };
    longPressTimerRef.current = window.setTimeout(() => {
      const meta = longPressMetaRef.current;
      if (!meta.bubbleId) return;
      setContextMenu({
        bubbleId: meta.bubbleId,
        x: meta.x,
        y: meta.y,
      });
    }, LONG_PRESS_MS);
  };

  const handleBubblePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const meta = longPressMetaRef.current;
    if (!meta.bubbleId) return;
    const moved = Math.abs(event.clientX - meta.x) + Math.abs(event.clientY - meta.y);
    if (moved > 12) {
      clearLongPressTimer();
      resetLongPressMeta();
    }
  };

  const handleBubblePointerEnd = () => {
    clearLongPressTimer();
    resetLongPressMeta();
  };

  const handleBubbleContextMenu = (event: React.MouseEvent<HTMLDivElement>, bubbleId: string) => {
    event.preventDefault();
    if (isDeleteMode) return;
    setContextMenu({ bubbleId, x: event.clientX, y: event.clientY });
  };

  const handleBubbleClick = (bubbleId: string) => {
    if (!isDeleteMode) return;
    setSelectedDeleteIds((prev) =>
      prev.includes(bubbleId) ? prev.filter((id) => id !== bubbleId) : [...prev, bubbleId]
    );
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (editingMessageId) {
      applyEditMessage();
      return;
    }
    handleQueueUserBubble();
  };

  const renderCharacterAvatar = () => {
    if (!activeCharacterId) {
      return <ResolvedImage src={DEFAULT_CHAR_IMG} alt="Default Char" className="w-full h-full object-cover" />;
    }
    if (activeCharacter?.avatar) {
      return <ResolvedImage src={activeCharacter.avatar} alt={characterRealName} className="w-full h-full object-cover" />;
    }
    return <FeatherIcon size={28} className="text-slate-300" />;
  };

  return (
    <>
      {readerMoreAppearance.bubbleCssApplied && <style>{readerMoreAppearance.bubbleCssApplied}</style>}
      {!isAiPanelOpen && (
        <button
          onClick={handleOpenAiPanelFromFab}
          className={`reader-ai-fab absolute right-6 w-12 h-12 neu-btn rounded-full z-20 ${
            isAiFabOpening ? 'neu-btn-active' : ''
          }`}
          style={{ bottom: `${fabBottomPx}px`, color: 'rgb(var(--theme-400) / 1)' }}
        >
          <MessagesSquare size={20} />
          <span
            className={`reader-ai-fab-badge absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full text-[10px] leading-none font-bold flex items-center justify-center ${
              unreadMessageCount > 0 ? 'opacity-100 scale-100' : 'opacity-0 scale-50'
            } ${isDarkMode ? 'border border-slate-700 text-white' : 'border border-white/70 text-white'}`}
            style={{ backgroundColor: 'rgb(var(--theme-500) / 1)' }}
            aria-hidden={unreadMessageCount <= 0}
          >
            {unreadMessageCount > 0 ? unreadMessageCount : ''}
          </span>
        </button>
      )}

      <div
        className={`absolute bottom-0 left-0 right-0 transition-[transform,opacity] ${isPanelDragging ? 'duration-75' : 'duration-500'} ease-in-out z-30 pointer-events-none ${
          isAiPanelOpen ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'
        }`}
        style={{
          height: `${resolvedPanelVisualHeight}px`,
        }}
      >
        <div
          className={`rm-panel absolute bottom-0 left-0 right-0 pointer-events-auto overflow-hidden ${
            isDarkMode ? 'bg-[#2d3748] rounded-t-3xl rounded-b-none shadow-[0_-5px_20px_rgba(0,0,0,0.4)]' : 'neu-flat rounded-t-3xl rounded-b-none'
          }`}
          style={{
            height: `${resolvedPanelVisualHeight}px`,
            boxShadow: isDarkMode ? '' : '0 -10px 20px -5px rgba(163,177,198, 0.4)',
          }}
        >
          <div
            className="h-8 flex items-center justify-center cursor-pointer opacity-60 hover:opacity-100 touch-none"
            onPointerDown={handlePanelGripPointerDown}
            onPointerMove={handlePanelGripPointerMove}
            onPointerUp={handlePanelGripPointerUp}
            onPointerCancel={handlePanelGripPointerCancel}
          >
            <div className={`w-12 h-1.5 rounded-full ${isDarkMode ? 'bg-slate-600' : 'bg-slate-300'}`} />
          </div>

          <div className="flex flex-col h-[calc(100%-2rem)] min-h-0">
          <div className="rm-header px-6 pb-2 flex items-center">
            <div className="flex items-center gap-2 min-w-0">
              <div
                className={`rm-avatar w-10 h-10 rounded-full overflow-hidden flex items-center justify-center border-2 border-transparent ${
                  isDarkMode ? 'bg-[#1a202c]' : 'neu-pressed'
                }`}
              >
                {renderCharacterAvatar()}
              </div>
              <span className={`rm-char-name text-sm font-bold truncate ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
                {characterNickname}
              </span>
            </div>
          </div>

          <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
          {readerMoreAppearance.chatBackgroundImage && (
            <div className="absolute inset-0 pointer-events-none z-0">
              <ResolvedImage
                src={readerMoreAppearance.chatBackgroundImage}
                alt="chat-background"
                className="w-full h-full object-cover"
              />
              <div className={`absolute inset-0 ${isDarkMode ? 'bg-black/35' : 'bg-white/25'}`} />
            </div>
          )}
          <div
            ref={messagesContainerRef}
            className={`rm-messages reader-scroll-panel reader-message-scroll flex-1 min-h-0 overflow-y-auto p-4 px-6 transition-transform duration-200 ${
              isAiLoading ? '-translate-y-1' : 'translate-y-0'
            }`}
            style={{ overflowAnchor: 'none', zIndex: 1 }}
          >
            <div className="min-h-full flex flex-col justify-end space-y-4">
            {messages.length === 0 && (
              <div className={`text-xs text-center pt-8 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                暂无聊天消息
              </div>
            )}

            {messageTimeline.map((item) => {
              if (item.type === 'time') {
                return (
                  <div key={item.id} className="flex justify-center">
                    <div
                      className={`rm-time-tag px-3 py-1 rounded-full text-[11px] ${
                        isDarkMode ? 'bg-[#1a202c] text-slate-400' : 'bg-white/70 text-slate-500'
                      }`}
                    >
                      {formatBubbleClock(item.timestamp)}
                    </div>
                  </div>
                );
              }
              const message = item.message;
              const isUser = message.sender === 'user';
              const isSelectedForDelete = selectedDeleteIdSet.has(message.id);
              const isEditingTarget = editingMessageId === message.id;

              return (
                <div
                  key={message.id}
                  className={`flex ${isUser ? 'justify-end' : 'justify-start'} ${isDeleteMode ? 'cursor-pointer' : ''}`}
                  onClick={() => handleBubbleClick(message.id)}
                >
                  <div className={`max-w-[88%] flex items-end gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                    {isDeleteMode && (
                      <button
                        type="button"
                        className={`w-5 h-5 rounded-full flex items-center justify-center ${
                          isSelectedForDelete
                            ? 'text-rose-400'
                            : isDarkMode
                            ? 'text-slate-500'
                            : 'text-slate-400'
                        }`}
                        aria-label="select-message"
                      >
                        {isSelectedForDelete ? <Check size={15} /> : <Square size={15} />}
                      </button>
                    )}

                    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
                      {readerMoreAppearance.showMessageTime && (
                        <div className={`rm-msg-time text-[11px] mb-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                          {formatBubbleClock(message.timestamp)}
                        </div>
                      )}

                      <div
                        className={`rm-bubble ${isUser ? 'rm-bubble-user' : 'rm-bubble-ai'} px-5 py-3 text-sm leading-relaxed transition-colors border-none ${
                          isUser
                            ? isDarkMode
                              ? 'bg-[rgb(var(--theme-500)_/_1)] text-white rounded-2xl rounded-br shadow-md'
                              : 'bg-[rgb(var(--theme-400)_/_1)] text-white rounded-2xl rounded-br shadow-[5px_5px_10px_#d1d5db,-5px_-5px_10px_#ffffff]'
                            : isDarkMode
                            ? 'bg-[#1a202c] text-slate-300 rounded-2xl rounded-bl shadow-md'
                            : 'neu-flat text-slate-700 rounded-2xl rounded-bl'
                         } ${isUser ? 'reader-bubble-enter-right' : 'reader-bubble-enter-left'} ${
                           isEditingTarget ? 'ring-2 ring-rose-300' : ''
                         }`}
                        style={{ fontSize: `${14 * readerMoreAppearance.bubbleFontSizeScale}px` }}
                        onPointerDown={(event) => handleBubblePointerDown(event, message.id)}
                        onPointerMove={handleBubblePointerMove}
                        onPointerUp={handleBubblePointerEnd}
                        onPointerCancel={handleBubblePointerEnd}
                        onContextMenu={(event) => handleBubbleContextMenu(event, message.id)}
                      >
                        {message.quote && (
                          <div
                            className={`mb-2 px-2 py-1 rounded-lg text-[11px] leading-snug border ${
                              isUser
                                ? 'border-white/35 bg-white/15'
                                : isDarkMode
                                ? 'border-slate-600 bg-slate-700/30'
                                : 'border-slate-200 bg-white/55'
                            }`}
                          >
                            <div className="font-semibold opacity-90">
                              {message.quote.senderName} · {formatTimestampMinute(message.quote.timestamp).slice(11)}
                            </div>
                            <div className="opacity-80 break-all">{message.quote.content}</div>
                          </div>
                        )}
                        <div className="break-words">{message.content}</div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            </div>
          </div>

          <div className="rm-input-area p-4 pb-6 relative z-10" style={{ paddingBottom: `${24 + safeBottomInset}px` }}>
            {toast && (
              <div
                className={`absolute z-20 left-1/2 -translate-x-1/2 -top-8 px-6 py-2 rounded-full flex items-center gap-2 border backdrop-blur-md text-xs font-bold ${
                  isDarkMode
                    ? 'bg-[#2d3748] border-slate-700/70 shadow-[6px_6px_12px_#232b39,-6px_-6px_12px_#374357]'
                    : 'bg-[#e0e5ec] border-white/20 shadow-[6px_6px_12px_rgba(0,0,0,0.1),-6px_-6px_12px_rgba(255,255,255,0.8)]'
                } ${toast.type === 'error' ? 'text-rose-400' : isDarkMode ? 'text-slate-200' : 'text-slate-600'}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${toast.type === 'error' ? 'bg-rose-400' : 'bg-emerald-500'}`} />
                {toast.text}
              </div>
            )}

            {isDeleteMode && (
              <div className="mb-2 px-3 py-2 rounded-xl flex items-center justify-between text-xs bg-rose-400/10 text-rose-500">
                <span>已选中 {selectedDeleteIds.length} 条消息</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={confirmDeleteMessages}
                    className={`px-3 py-1 rounded-full ${isDarkMode ? 'bg-rose-500 text-white' : 'neu-flat'}`}
                  >
                    删除
                  </button>
                  <button
                    onClick={cancelDeleteMode}
                    className={`px-3 py-1 rounded-full ${isDarkMode ? 'bg-slate-600 text-slate-100' : 'neu-flat'}`}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}

            {isAiLoading && (
              <div
                className={`rm-typing mb-2 px-3 text-xs reader-typing-breath ${
                  isDarkMode ? 'text-slate-400' : 'text-slate-500'
                }`}
              >
                <span className="rm-typing-name">{characterNickname}</span>{' '}
                <span className="rm-typing-text">正在输入中...</span>
              </div>
            )}

            {quotedMessage && !editingMessageId && (
              <div className={`mb-2 px-3 py-2 rounded-xl text-xs ${isDarkMode ? 'bg-slate-700/40 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate">
                    引用 {getBubbleDisplayName(quotedMessage.sender)}: {quotedMessage.content}
                  </div>
                  <button onClick={() => setQuotedMessageId(null)} className="opacity-70 hover:opacity-100">
                    <X size={14} />
                  </button>
                </div>
              </div>
            )}

            <div className={`rm-input-wrap flex items-center gap-3 rounded-full px-2 py-2 ${isDarkMode ? 'bg-[#1a202c] shadow-inner' : 'neu-pressed'}`}>
              <input
                type="text"
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder=""
                disabled={isManualLoading || isDeleteMode}
                className={`rm-input flex-1 bg-transparent outline-none text-sm min-w-0 px-4 ${
                  isDarkMode ? 'text-slate-200 placeholder-slate-600' : 'text-slate-700'
                } ${isManualLoading || isDeleteMode ? 'opacity-60 cursor-not-allowed' : ''}`}
              />

              {editingMessageId ? (
                <>
                  <button
                    onClick={applyEditMessage}
                    disabled={!compactText(inputText)}
                    className={`p-2 rounded-full transition-all ${
                      compactText(inputText)
                        ? isDarkMode
                          ? 'bg-emerald-500 text-white'
                          : 'neu-flat text-emerald-500 active:scale-95'
                        : 'text-slate-400 opacity-50'
                    }`}
                    aria-label="confirm-edit-message"
                  >
                    <Check size={18} />
                  </button>
                  <button
                    onClick={cancelEditMessage}
                    className={`p-2 rounded-full transition-all ${
                      isDarkMode ? 'bg-slate-600 text-slate-100' : 'neu-flat text-slate-500 active:scale-95'
                    }`}
                    aria-label="cancel-edit-message"
                  >
                    <X size={18} />
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => void requestAiReply(messages)}
                    disabled={isManualLoading || !canSendToAi}
                    className={`rm-send-btn p-2 rounded-full transition-all ${
                      !isManualLoading && canSendToAi
                        ? isDarkMode
                          ? 'bg-rose-400 text-white'
                          : 'neu-flat text-rose-400 active:scale-95'
                        : 'text-slate-400 opacity-50'
                    }`}
                    aria-label="send-to-ai"
                  >
                    <Send size={18} />
                  </button>
                  <button
                    onClick={() => void handleRefreshReply()}
                    disabled={isManualLoading}
                    className={`rm-retry-btn p-2 rounded-full transition-all ${
                      isManualLoading
                        ? 'text-slate-400 opacity-50'
                        : isDarkMode
                          ? 'bg-[#334155] text-slate-200'
                          : 'neu-flat text-slate-500 active:scale-95'
                    }`}
                    aria-label="refresh-last-ai-reply"
                  >
                    <RotateCcw size={18} />
                  </button>
                </>
              )}
            </div>
          </div>
            </div>
          </div>
        </div>
      </div>

      <ReaderMoreSettingsPanel
        isDarkMode={isDarkMode}
        isOpen={isMoreSettingsOpen}
        onClose={onCloseMoreSettings}
        safeAreaTop={Math.max(0, safeAreaTop || 0)}
        safeAreaBottom={Math.max(0, safeAreaBottom || 0)}
        appearanceSettings={readerMoreAppearance}
        featureSettings={readerMoreFeature}
        apiPresets={apiPresets}
        onUpdateAppearanceSettings={updateReaderMoreAppearanceSettings}
        onUpdateFeatureSettings={updateReaderMoreFeatureSettings}
        onUploadChatBackgroundImage={handleUploadChatBackgroundImage}
        onSetChatBackgroundImageFromUrl={handleSetChatBackgroundFromUrl}
        onClearChatBackgroundImage={handleClearChatBackground}
        onApplyBubbleCssDraft={handleApplyBubbleCssDraft}
        onSaveBubbleCssPreset={handleSaveBubbleCssPreset}
        onDeleteBubbleCssPreset={handleDeleteBubbleCssPreset}
        onRenameBubbleCssPreset={handleRenameBubbleCssPreset}
        onSelectBubbleCssPreset={handleSelectBubbleCssPreset}
        onClearBubbleCssDraft={() =>
          updateReaderMoreAppearanceSettings({
            bubbleCssDraft: DEFAULT_NEUMORPHISM_BUBBLE_CSS,
            selectedBubbleCssPresetId: DEFAULT_NEUMORPHISM_BUBBLE_CSS_PRESET_ID,
          })
        }
        onResetAppearanceSettings={handleResetAppearanceSettings}
        onResetFeatureSettings={handleResetFeatureSettings}
        archiveOptions={archiveOptions}
        onSelectArchive={handleSelectArchive}
        onDeleteArchive={handleDeleteArchive}
        bookSummaryCards={bookSummaryCards}
        chatSummaryCards={chatSummaryCards}
        onEditBookSummaryCard={handleEditBookSummaryCard}
        onDeleteBookSummaryCard={handleDeleteBookSummaryCard}
        onEditChatSummaryCard={handleEditChatSummaryCard}
        onDeleteChatSummaryCard={handleDeleteChatSummaryCard}
        onMergeBookSummaryCards={handleMergeBookSummaryCards}
        onMergeChatSummaryCards={handleMergeChatSummaryCards}
        onRequestManualBookSummary={handleRequestManualBookSummary}
        onRequestManualChatSummary={handleRequestManualChatSummary}
        currentReadCharOffset={Math.max(0, getLatestReadingPosition()?.globalCharOffset || 0)}
        totalBookChars={bookText.length}
        totalMessages={messages.length}
        summaryTaskRunning={summaryTaskRunning}
        sessionPromptTokenEstimate={sessionPromptTokenEstimate}
      />

      {contextMenu && !isDeleteMode && (
        <div
          ref={contextMenuRef}
          className={`fixed z-50 rounded-xl p-2 shadow-xl border ${
            isDarkMode ? 'bg-[#1f2937] border-slate-600' : 'bg-[#e0e5ec] border-white/60'
          }`}
          style={{
            left: `${contextMenuLayout?.left ?? contextMenu.x}px`,
            top: `${contextMenuLayout?.top ?? contextMenu.y}px`,
            transform: 'none',
            visibility: contextMenuLayout ? 'visible' : 'hidden',
          }}
        >
          <div className="flex items-center gap-1">
            <button
              onClick={() => openEditFromContext(contextMenu.bubbleId)}
              className={`w-8 h-8 rounded-full flex items-center justify-center ${
                isDarkMode ? 'hover:bg-slate-700 text-slate-200' : 'hover:bg-slate-200 text-slate-600'
              }`}
              title="编辑"
              aria-label="edit-message"
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={() => startDeleteMode(contextMenu.bubbleId)}
              className={`w-8 h-8 rounded-full flex items-center justify-center ${
                isDarkMode ? 'hover:bg-slate-700 text-slate-200' : 'hover:bg-slate-200 text-slate-600'
              }`}
              title="删除"
              aria-label="delete-message"
            >
              <Trash2 size={14} />
            </button>
            <button
              onClick={() => openQuoteFromContext(contextMenu.bubbleId)}
              className={`w-8 h-8 rounded-full flex items-center justify-center ${
                isDarkMode ? 'hover:bg-slate-700 text-slate-200' : 'hover:bg-slate-200 text-slate-600'
              }`}
              title="引用"
              aria-label="quote-message"
            >
              <Quote size={14} />
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default ReaderMessagePanel;

