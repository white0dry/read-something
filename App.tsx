import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { BookOpen, PieChart, Settings as SettingsIcon, LayoutGrid, Sparkles, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import Library from './components/Library';
import Reader from './components/Reader';
import Stats from './components/Stats';
import StudyHub from './components/StudyHub';
import Settings from './components/Settings';
import { AppView, Book, Chapter, ApiConfig, ApiPreset, ApiProvider, AppSettings, ReaderSessionSnapshot, RagPreset } from './types';
import { Persona, Character, WorldBookEntry } from './components/settings/types';
import { deleteImageByRef, migrateDataUrlToImageRef } from './utils/imageStorage';
import { compactBookForState, deleteBookContent, getBookContent, migrateInlineBookContent, saveBookContent } from './utils/bookContentStorage';
import { buildConversationKey, readConversationBucket, persistConversationBucket } from './utils/readerChatRuntime';
import { BUILT_IN_TUTORIAL_BOOK_ID, BUILT_IN_TUTORIAL_VERSION, createBuiltInTutorialBook, migrateTutorialImages, isBuiltInBook, markTutorialUnread, clearTutorialUnread } from './utils/builtInTutorialBook';
import { buildCharacterWorldBookSections, buildReadingContextSnapshot, runConversationGeneration } from './utils/readerAiEngine';
import {
  DEFAULT_NEUMORPHISM_BUBBLE_CSS_PRESET_ID,
  DEFAULT_NEUMORPHISM_BUBBLE_CSS,
  LEGACY_DEFAULT_NEUMORPHISM_BUBBLE_CSS,
  DEFAULT_READER_BUBBLE_CSS_PRESETS,
  normalizeReaderBubbleCssPresets,
} from './utils/readerBubbleCssPresets';

interface Notification {
  show: boolean;
  message: string;
  type: 'success' | 'error';
}

interface RagWarmupState {
  active: boolean;
  stage: 'model' | 'index';
  progress: number;
  bookTitle?: string;
}

const DEFAULT_API_CONFIG: ApiConfig = {
  provider: 'OPENAI',
  endpoint: 'https://api.openai.com/v1',
  apiKey: '',
  model: ''
};

const DEFAULT_PRESETS: ApiPreset[] = [];

// Default Rose Color
const DEFAULT_THEME_COLOR = '#e28a9d';
const FONT_BASELINE_MULTIPLIER = 1.2; // Old 120% is the new 100%
const SAFE_AREA_DEFAULT_MIGRATION_KEY = 'app_safe_area_default_v2';
const DAILY_READING_MS_STORAGE_KEY = 'app_daily_reading_ms';
const COMPLETED_BOOK_IDS_STORAGE_KEY = 'app_completed_book_ids';
const COMPLETED_BOOK_REACHED_AT_STORAGE_KEY = 'app_completed_book_reached_at';
const READING_MS_BY_BOOK_ID_STORAGE_KEY = 'app_reading_ms_by_book_id';
const PROACTIVE_DELAY_TOLERANCE_MS = 3000;
const KEEP_ALIVE_SILENT_AUDIO_URL = 'https://files.catbox.moe/qx14i5.mp3';
const FIXED_MESSAGE_TIME_GAP_MINUTES = 60;
const RAG_WARMUP_RETRY_BASE_MS = 1500;
const RAG_WARMUP_RETRY_MAX_MS = 15000;
const RAG_LOCAL_WARMUP_MAX_RETRIES = 3;
const RAG_PRESETS_STORAGE_KEY = 'app_rag_presets';
const ACTIVE_RAG_PRESET_ID_STORAGE_KEY = 'app_active_rag_preset_id';
const DEFAULT_RAG_PRESET_ID = '__default_rag_preset__';
const DEFAULT_READER_MORE_SETTINGS = {
  appearance: {
    bubbleFontSizeScale: 1,
    chatBackgroundImage: '',
    showMessageTime: false,
    timeGapMinutes: FIXED_MESSAGE_TIME_GAP_MINUTES,
    bubbleCssDraft: DEFAULT_NEUMORPHISM_BUBBLE_CSS,
    bubbleCssApplied: '',
    bubbleCssPresets: DEFAULT_READER_BUBBLE_CSS_PRESETS.map((item) => ({ ...item })),
    selectedBubbleCssPresetId: DEFAULT_NEUMORPHISM_BUBBLE_CSS_PRESET_ID as string | null,
  },
  feature: {
    readingExcerptCharCount: 800,
    memoryBubbleCount: 100,
    replyBubbleMin: 3,
    replyBubbleMax: 8,
    autoChatSummaryEnabled: false,
    autoChatSummaryTriggerCount: 500,
    autoBookSummaryEnabled: false,
    autoBookSummaryTriggerChars: 5000,
    summaryApiEnabled: false,
    summaryApiPresetId: null as string | null,
    summaryApi: {
      provider: 'OPENAI' as ApiProvider,
      endpoint: 'https://api.openai.com/v1',
      apiKey: '',
      model: '',
    },
  },
};

const DEFAULT_APP_SETTINGS: AppSettings = {
  activeCommentsEnabled: false,
  aiProactiveUnderlineEnabled: false,
  aiProactiveUnderlineProbability: 35,
  commentInterval: 30,
  commentProbability: 50,
  themeColor: DEFAULT_THEME_COLOR,
  fontSizeScale: 1.0,
  safeAreaTop: 0,
  safeAreaBottom: 0,
  readerMore: DEFAULT_READER_MORE_SETTINGS,
};
const normalizeBubbleCssSignature = (css: string) => css.replace(/\s+/g, ' ').trim();
const LEGACY_DEFAULT_NEUMORPHISM_BUBBLE_CSS_SIGNATURE = normalizeBubbleCssSignature(LEGACY_DEFAULT_NEUMORPHISM_BUBBLE_CSS);
const migrateLegacyDefaultBubbleCss = (css: string) =>
  normalizeBubbleCssSignature(css) === LEGACY_DEFAULT_NEUMORPHISM_BUBBLE_CSS_SIGNATURE
    ? DEFAULT_NEUMORPHISM_BUBBLE_CSS
    : css;

const normalizeAppSettings = (raw: unknown): AppSettings => {
  const source =
    raw && typeof raw === 'object'
      ? (raw as Partial<AppSettings> & { autoParseEnabled?: boolean })
      : {};

  const activeCommentsEnabled =
    typeof source.activeCommentsEnabled === 'boolean'
      ? source.activeCommentsEnabled
      : DEFAULT_APP_SETTINGS.activeCommentsEnabled;
  const aiProactiveUnderlineEnabled =
    typeof source.aiProactiveUnderlineEnabled === 'boolean'
      ? source.aiProactiveUnderlineEnabled
      : typeof source.autoParseEnabled === 'boolean'
        ? source.autoParseEnabled
        : DEFAULT_APP_SETTINGS.aiProactiveUnderlineEnabled;
  const aiProactiveUnderlineProbabilityRaw = source.aiProactiveUnderlineProbability;
  const aiProactiveUnderlineProbability =
    typeof aiProactiveUnderlineProbabilityRaw === 'number' && Number.isFinite(aiProactiveUnderlineProbabilityRaw)
      ? Math.min(100, Math.max(0, Math.round(aiProactiveUnderlineProbabilityRaw)))
      : DEFAULT_APP_SETTINGS.aiProactiveUnderlineProbability;
  const commentIntervalRaw = source.commentInterval;
  const commentInterval =
    typeof commentIntervalRaw === 'number' && Number.isFinite(commentIntervalRaw)
      ? Math.min(600, Math.max(10, Math.round(commentIntervalRaw)))
      : DEFAULT_APP_SETTINGS.commentInterval;
  const commentProbabilityRaw = source.commentProbability;
  const commentProbability =
    typeof commentProbabilityRaw === 'number' && Number.isFinite(commentProbabilityRaw)
      ? Math.min(100, Math.max(0, Math.round(commentProbabilityRaw)))
      : DEFAULT_APP_SETTINGS.commentProbability;
  const themeColor =
    typeof source.themeColor === 'string' && source.themeColor.trim()
      ? source.themeColor
      : DEFAULT_APP_SETTINGS.themeColor;
  const fontSizeScale =
    typeof source.fontSizeScale === 'number' && Number.isFinite(source.fontSizeScale)
      ? source.fontSizeScale
      : DEFAULT_APP_SETTINGS.fontSizeScale;
  const safeAreaTopRaw = source.safeAreaTop;
  const safeAreaTop =
    typeof safeAreaTopRaw === 'number' && Number.isFinite(safeAreaTopRaw)
      ? Math.max(0, Math.round(safeAreaTopRaw))
      : DEFAULT_APP_SETTINGS.safeAreaTop;
  const safeAreaBottomRaw = source.safeAreaBottom;
  const safeAreaBottom =
    typeof safeAreaBottomRaw === 'number' && Number.isFinite(safeAreaBottomRaw)
      ? Math.max(0, Math.round(safeAreaBottomRaw))
      : DEFAULT_APP_SETTINGS.safeAreaBottom;
  const readerMoreSource =
    source.readerMore && typeof source.readerMore === 'object'
      ? (source.readerMore as Partial<AppSettings['readerMore']>)
      : {};
  const appearanceSource =
    readerMoreSource.appearance && typeof readerMoreSource.appearance === 'object'
      ? (readerMoreSource.appearance as Partial<AppSettings['readerMore']['appearance']>)
      : {};
  const featureSource =
    readerMoreSource.feature && typeof readerMoreSource.feature === 'object'
      ? (readerMoreSource.feature as Partial<AppSettings['readerMore']['feature']>)
      : {};
  const summaryApiSource =
    featureSource.summaryApi && typeof featureSource.summaryApi === 'object'
      ? (featureSource.summaryApi as Partial<AppSettings['readerMore']['feature']['summaryApi']>)
      : {};
  const summaryApiPresetIdRaw =
    typeof featureSource.summaryApiPresetId === 'string'
      ? featureSource.summaryApiPresetId.trim()
      : '';
  const summaryApiPresetId = summaryApiPresetIdRaw || null;
  const normalizedBubbleCssPresets = normalizeReaderBubbleCssPresets(appearanceSource.bubbleCssPresets);
  const selectedBubbleCssPresetIdRaw =
    typeof appearanceSource.selectedBubbleCssPresetId === 'string'
      ? appearanceSource.selectedBubbleCssPresetId.trim()
      : null;
  const selectedBubbleCssPresetId =
    selectedBubbleCssPresetIdRaw && normalizedBubbleCssPresets.some((item) => item.id === selectedBubbleCssPresetIdRaw)
      ? selectedBubbleCssPresetIdRaw
      : DEFAULT_NEUMORPHISM_BUBBLE_CSS_PRESET_ID;
  const bubbleCssDraftRaw =
    typeof appearanceSource.bubbleCssDraft === 'string'
      ? appearanceSource.bubbleCssDraft
      : DEFAULT_READER_MORE_SETTINGS.appearance.bubbleCssDraft;
  const bubbleCssDraft = migrateLegacyDefaultBubbleCss(
    bubbleCssDraftRaw.length > 0
      ? bubbleCssDraftRaw
      : DEFAULT_NEUMORPHISM_BUBBLE_CSS
  );
  const bubbleCssAppliedRaw =
    typeof appearanceSource.bubbleCssApplied === 'string'
      ? appearanceSource.bubbleCssApplied
      : DEFAULT_READER_MORE_SETTINGS.appearance.bubbleCssApplied;
  const bubbleCssApplied = bubbleCssAppliedRaw
    ? migrateLegacyDefaultBubbleCss(bubbleCssAppliedRaw)
    : bubbleCssAppliedRaw;
  const readerMore = {
    appearance: {
      bubbleFontSizeScale:
        typeof appearanceSource.bubbleFontSizeScale === 'number' && Number.isFinite(appearanceSource.bubbleFontSizeScale)
          ? Math.min(2.5, Math.max(0.7, appearanceSource.bubbleFontSizeScale))
          : DEFAULT_READER_MORE_SETTINGS.appearance.bubbleFontSizeScale,
      chatBackgroundImage:
        typeof appearanceSource.chatBackgroundImage === 'string'
          ? appearanceSource.chatBackgroundImage.trim()
          : DEFAULT_READER_MORE_SETTINGS.appearance.chatBackgroundImage,
      showMessageTime:
        typeof appearanceSource.showMessageTime === 'boolean'
          ? appearanceSource.showMessageTime
          : DEFAULT_READER_MORE_SETTINGS.appearance.showMessageTime,
      timeGapMinutes: FIXED_MESSAGE_TIME_GAP_MINUTES,
      bubbleCssDraft,
      bubbleCssApplied,
      bubbleCssPresets: normalizedBubbleCssPresets,
      selectedBubbleCssPresetId,
    },
    feature: {
      readingExcerptCharCount:
        typeof featureSource.readingExcerptCharCount === 'number' && Number.isFinite(featureSource.readingExcerptCharCount)
          ? Math.round(featureSource.readingExcerptCharCount)
          : DEFAULT_READER_MORE_SETTINGS.feature.readingExcerptCharCount,
      memoryBubbleCount:
        typeof featureSource.memoryBubbleCount === 'number' && Number.isFinite(featureSource.memoryBubbleCount)
          ? Math.round(featureSource.memoryBubbleCount)
          : DEFAULT_READER_MORE_SETTINGS.feature.memoryBubbleCount,
      replyBubbleMin:
        typeof featureSource.replyBubbleMin === 'number' && Number.isFinite(featureSource.replyBubbleMin)
          ? Math.round(featureSource.replyBubbleMin)
          : DEFAULT_READER_MORE_SETTINGS.feature.replyBubbleMin,
      replyBubbleMax:
        typeof featureSource.replyBubbleMax === 'number' && Number.isFinite(featureSource.replyBubbleMax)
          ? Math.round(featureSource.replyBubbleMax)
          : DEFAULT_READER_MORE_SETTINGS.feature.replyBubbleMax,
      autoChatSummaryEnabled:
        typeof featureSource.autoChatSummaryEnabled === 'boolean'
          ? featureSource.autoChatSummaryEnabled
          : DEFAULT_READER_MORE_SETTINGS.feature.autoChatSummaryEnabled,
      autoChatSummaryTriggerCount:
        typeof featureSource.autoChatSummaryTriggerCount === 'number' && Number.isFinite(featureSource.autoChatSummaryTriggerCount)
          ? Math.round(featureSource.autoChatSummaryTriggerCount)
          : DEFAULT_READER_MORE_SETTINGS.feature.autoChatSummaryTriggerCount,
      autoBookSummaryEnabled:
        typeof featureSource.autoBookSummaryEnabled === 'boolean'
          ? featureSource.autoBookSummaryEnabled
          : DEFAULT_READER_MORE_SETTINGS.feature.autoBookSummaryEnabled,
      autoBookSummaryTriggerChars:
        typeof featureSource.autoBookSummaryTriggerChars === 'number' && Number.isFinite(featureSource.autoBookSummaryTriggerChars)
          ? Math.round(featureSource.autoBookSummaryTriggerChars)
          : DEFAULT_READER_MORE_SETTINGS.feature.autoBookSummaryTriggerChars,
      summaryApiEnabled:
        typeof featureSource.summaryApiEnabled === 'boolean'
          ? featureSource.summaryApiEnabled
          : DEFAULT_READER_MORE_SETTINGS.feature.summaryApiEnabled,
      summaryApiPresetId,
      summaryApi: {
        provider:
          summaryApiSource.provider === 'OPENAI' ||
          summaryApiSource.provider === 'DEEPSEEK' ||
          summaryApiSource.provider === 'GEMINI' ||
          summaryApiSource.provider === 'CLAUDE' ||
          summaryApiSource.provider === 'CUSTOM'
            ? summaryApiSource.provider
            : DEFAULT_READER_MORE_SETTINGS.feature.summaryApi.provider,
        endpoint:
          typeof summaryApiSource.endpoint === 'string'
            ? summaryApiSource.endpoint
            : DEFAULT_READER_MORE_SETTINGS.feature.summaryApi.endpoint,
        apiKey:
          typeof summaryApiSource.apiKey === 'string'
            ? summaryApiSource.apiKey
            : DEFAULT_READER_MORE_SETTINGS.feature.summaryApi.apiKey,
        model:
          typeof summaryApiSource.model === 'string'
            ? summaryApiSource.model
            : DEFAULT_READER_MORE_SETTINGS.feature.summaryApi.model,
      },
    },
  };
  return {
    activeCommentsEnabled,
    aiProactiveUnderlineEnabled,
    aiProactiveUnderlineProbability,
    commentInterval,
    commentProbability,
    themeColor,
    fontSizeScale,
    safeAreaTop,
    safeAreaBottom,
    readerMore,
  };
};

const BUILT_IN_SAMPLE_COVER_URLS = new Set([
  'https://picsum.photos/150/220?random=1',
  'https://picsum.photos/150/220?random=2',
  'https://picsum.photos/150/220?random=3',
  'https://picsum.photos/150/220?random=4',
]);

const stripBuiltInSampleBooks = (books: Book[]): Book[] => {
  return books.filter(book => {
    const isLegacySampleId = ['1', '2', '3', '4'].includes(book.id);
    const isLegacySampleCover = BUILT_IN_SAMPLE_COVER_URLS.has(book.coverUrl);
    return !(isLegacySampleId && isLegacySampleCover);
  });
};

// Helper to convert hex to RGB values for CSS variables
const hexToRgbValues = (hex: string) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? 
    `${parseInt(result[1], 16)} ${parseInt(result[2], 16)} ${parseInt(result[3], 16)}` 
    : '226 138 157'; // Default Rose-400
};

// Helper to generate a rough palette (lighter/darker) from base color
// This is a simplified approximation to avoid heavy color libraries
const adjustColor = (hex: string, percent: number) => {
    // strip the leading # if it's there
    hex = hex.replace(/^\s*#|\s*$/g, '');

    // convert 3 char codes --> 6, e.g. `E0F` --> `EE00FF`
    if (hex.length === 3) {
        hex = hex.replace(/(.)/g, '$1$1');
    }

    var r = parseInt(hex.substr(0, 2), 16),
        g = parseInt(hex.substr(2, 2), 16),
        b = parseInt(hex.substr(4, 2), 16);

    return '#' +
       ((0|(1<<8) + r + (256 - r) * percent / 100).toString(16)).substr(1) +
       ((0|(1<<8) + g + (256 - g) * percent / 100).toString(16)).substr(1) +
       ((0|(1<<8) + b + (256 - b) * percent / 100).toString(16)).substr(1);
}

const darkenColor = (hex: string, percent: number) => {
    hex = hex.replace(/^\s*#|\s*$/g, '');
    if (hex.length === 3) hex = hex.replace(/(.)/g, '$1$1');
    var r = parseInt(hex.substr(0, 2), 16),
        g = parseInt(hex.substr(2, 2), 16),
        b = parseInt(hex.substr(4, 2), 16);

    return '#' +
       ((0|(1<<8) + r * (100 - percent) / 100).toString(16)).substr(1) +
       ((0|(1<<8) + g * (100 - percent) / 100).toString(16)).substr(1) +
       ((0|(1<<8) + b * (100 - percent) / 100).toString(16)).substr(1);
}

const formatBookLastRead = (timestamp: number) => {
  const now = Date.now();
  const diffMs = Math.max(0, now - timestamp);
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 60) return `${Math.max(1, diffMinutes)}分钟前`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}小时前`;

  const date = new Date(timestamp);
  const pad = (value: number) => value.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const formatLocalDateKey = (timestamp: number) => {
  const date = new Date(timestamp);
  const pad = (value: number) => value.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const getNextDayStartTimestamp = (timestamp: number) => {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
};

const appendReadingDurationByDay = (
  source: Record<string, number>,
  startedAt: number,
  endedAt: number
) => {
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt <= startedAt) {
    return source;
  }

  const next = { ...source };
  let cursor = startedAt;

  while (cursor < endedAt) {
    const nextDayStart = getNextDayStartTimestamp(cursor);
    const segmentEnd = Math.min(endedAt, nextDayStart);
    const dateKey = formatLocalDateKey(cursor);
    next[dateKey] = (next[dateKey] || 0) + (segmentEnd - cursor);
    cursor = segmentEnd;
  }

  return next;
};

const appendReadingDurationForBook = (
  source: Record<string, number>,
  bookId: string | null,
  durationMs: number
) => {
  if (!bookId || !Number.isFinite(durationMs) || durationMs <= 0) {
    return source;
  }
  return {
    ...source,
    [bookId]: Math.max(0, source[bookId] || 0) + durationMs,
  };
};

const getMostRecentBook = (books: Book[]) => {
  const candidates = books.filter((book) => typeof book.lastReadAt === 'number' && book.lastReadAt > 0);
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => (b.lastReadAt || 0) - (a.lastReadAt || 0))[0] || null;
};

const isApiConfigReadyForChat = (apiConfig: ApiConfig) => {
  const apiKey = (apiConfig.apiKey || '').trim();
  const model = (apiConfig.model || '').trim();
  const endpoint = (apiConfig.endpoint || '').trim();
  if (!apiKey || !model) return false;
  if (apiConfig.provider !== 'GEMINI' && !endpoint) return false;
  return true;
};

const App: React.FC = () => {
  const VIEW_TRANSITION_MS = 260;
  const [currentView, setCurrentView] = useState<AppView>(AppView.LIBRARY);
  const [activeBook, setActiveBook] = useState<Book | null>(null);
  const [viewAnimationClass, setViewAnimationClass] = useState('app-view-enter-left');
  const [isViewTransitioning, setIsViewTransitioning] = useState(false);
  const viewTransitionTimerRef = useRef<number | null>(null);
  const viewTransitionUnlockTimerRef = useRef<number | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    try {
      const saved = localStorage.getItem('app_dark_mode');
      return saved ? JSON.parse(saved) : false;
    } catch { return false; }
  });
  
  // Global Notification State
  const [notification, setNotification] = useState<Notification>({ show: false, message: '', type: 'success' });
  const [ragWarmupByBookId, setRagWarmupByBookId] = useState<Record<string, RagWarmupState>>({});
  const [ragErrorToast, setRagErrorToast] = useState<{ show: boolean; message: string }>({ show: false, message: '' });
  const [systemSafeAreaBottom, setSystemSafeAreaBottom] = useState(0);
  const [dailyReadingMsByDate, setDailyReadingMsByDate] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem(DAILY_READING_MS_STORAGE_KEY);
      if (!saved) return {};
      const parsed = JSON.parse(saved);
      if (!parsed || typeof parsed !== 'object') return {};
      const normalized: Record<string, number> = {};
      Object.entries(parsed).forEach(([key, value]) => {
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
          normalized[key] = value;
        }
      });
      return normalized;
    } catch {
      return {};
    }
  });
  const [completedBookIds, setCompletedBookIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(COMPLETED_BOOK_IDS_STORAGE_KEY);
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return [];

      const uniqueIds = new Set<string>();
      parsed.forEach((item) => {
        if (typeof item === 'string' && item.trim()) {
          uniqueIds.add(item);
        }
      });
      return Array.from(uniqueIds);
    } catch {
      return [];
    }
  });
  const [completedAtByBookId, setCompletedAtByBookId] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem(COMPLETED_BOOK_REACHED_AT_STORAGE_KEY);
      if (!saved) return {};
      const parsed = JSON.parse(saved);
      if (!parsed || typeof parsed !== 'object') return {};

      const normalized: Record<string, number> = {};
      Object.entries(parsed).forEach(([key, value]) => {
        if (typeof key === 'string' && key.trim() && typeof value === 'number' && Number.isFinite(value) && value > 0) {
          normalized[key] = value;
        }
      });
      return normalized;
    } catch {
      return {};
    }
  });
  const [readingMsByBookId, setReadingMsByBookId] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem(READING_MS_BY_BOOK_ID_STORAGE_KEY);
      if (!saved) return {};
      const parsed = JSON.parse(saved);
      if (!parsed || typeof parsed !== 'object') return {};

      const normalized: Record<string, number> = {};
      Object.entries(parsed).forEach(([key, value]) => {
        if (typeof key === 'string' && key.trim() && typeof value === 'number' && Number.isFinite(value) && value > 0) {
          normalized[key] = value;
        }
      });
      return normalized;
    } catch {
      return {};
    }
  });
  const readingSessionStartedAtRef = useRef<number | null>(null);
  const readingSessionBookIdRef = useRef<string | null>(null);
  const dailyReadingMsByDateRef = useRef<Record<string, number>>(dailyReadingMsByDate);
  const readingMsByBookIdRef = useRef<Record<string, number>>(readingMsByBookId);
  const proactiveTimerRef = useRef<number | null>(null);
  const proactiveNextPlannedAtRef = useRef<number | null>(null);
  const keepAliveAudioRef = useRef<HTMLAudioElement | null>(null);
  const keepAliveUnlockCleanupRef = useRef<(() => void) | null>(null);
  const activeCommentsEnabledRef = useRef(false);
  const proactiveLoopTokenRef = useRef(0);
  const ragGlobalWarmupBookIdRef = useRef<string | null>(null);
  const ragWarmupTokenByBookRef = useRef<Record<string, number>>({});
  const ragWarmupLockByBookRef = useRef<Record<string, boolean>>({});
  const ragApiFailedBookIdsRef = useRef<Set<string>>(new Set());
  const ragResumeScanInProgressRef = useRef(false);
  const ragResumeLastScanAtRef = useRef(0);

  // --- PERSISTENT STATE ---

  // Books
  const [books, setBooks] = useState<Book[]>(() => {
    let initial: Book[] = [];
    try {
      const saved = localStorage.getItem('app_books');
      if (saved) {
        const parsed = JSON.parse(saved);
        initial = Array.isArray(parsed) ? stripBuiltInSampleBooks(parsed) : [];
      }
    } catch { /* no-op */ }
    const versionKey = '__built_in_tutorial_version__';
    const storedVersion = (() => { try { return Number(localStorage.getItem(versionKey)) || 0; } catch { return 0; } })();
    const tutorialIdx = initial.findIndex(b => b.id === BUILT_IN_TUTORIAL_BOOK_ID);
    if (tutorialIdx === -1 || storedVersion < BUILT_IN_TUTORIAL_VERSION) {
      const tutorial = createBuiltInTutorialBook();
      // 先用原始章节（含 data-URL）同步保存以确保书籍立即可用，
      // 再异步将图片迁移为 idb:// Blob 引用并重新保存。
      saveBookContent(tutorial.id, tutorial.fullText || '', tutorial.chapters || []);
      migrateTutorialImages(tutorial.chapters || []).then((migratedChapters) => {
        saveBookContent(tutorial.id, tutorial.fullText || '', migratedChapters);
      }).catch(() => { /* 迁移失败则保留 data-URL 作为 fallback */ });
      if (tutorialIdx === -1) {
        initial.push(compactBookForState(tutorial));
      } else {
        initial[tutorialIdx] = compactBookForState(tutorial);
      }
      try { localStorage.setItem(versionKey, String(BUILT_IN_TUTORIAL_VERSION)); } catch { /* no-op */ }
      if (storedVersion > 0) markTutorialUnread();
    }
    return initial;
  });

  // API Config
  const [apiConfig, setApiConfig] = useState<ApiConfig>(() => {
    try {
      const saved = localStorage.getItem('app_api_config');
      return saved ? JSON.parse(saved) : DEFAULT_API_CONFIG;
    } catch { return DEFAULT_API_CONFIG; }
  });

  // API Presets
  const [apiPresets, setApiPresets] = useState<ApiPreset[]>(() => {
    try {
      const saved = localStorage.getItem('app_api_presets');
      return saved ? JSON.parse(saved) : DEFAULT_PRESETS;
    } catch { return DEFAULT_PRESETS; }
  });

  // RAG Presets
  const [ragPresets, setRagPresets] = useState<RagPreset[]>(() => {
    try {
      const saved = localStorage.getItem(RAG_PRESETS_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [activeRagPresetId, setActiveRagPresetId] = useState<string>(() =>
    localStorage.getItem(ACTIVE_RAG_PRESET_ID_STORAGE_KEY) || DEFAULT_RAG_PRESET_ID
  );

  // General App Settings (Automation, Appearance)
  const [appSettings, setAppSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem('app_settings');
      return saved ? normalizeAppSettings(JSON.parse(saved)) : DEFAULT_APP_SETTINGS;
    } catch { return DEFAULT_APP_SETTINGS; }
  });

  // Personas - Init empty if not found
  const [personas, setPersonas] = useState<Persona[]>(() => {
    try {
      const saved = localStorage.getItem('app_personas');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  // Characters - Init empty if not found
  const [characters, setCharacters] = useState<Character[]>(() => {
    try {
      const saved = localStorage.getItem('app_characters');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  // World Book - Init empty if not found
  const [worldBookEntries, setWorldBookEntries] = useState<WorldBookEntry[]>(() => {
    try {
      const saved = localStorage.getItem('app_worldbook');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const [wbCategories, setWbCategories] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('app_wb_categories');
      return saved ? JSON.parse(saved) : ['Uncategorized'];
    } catch { return ['Uncategorized']; }
  });

  // Library User Profile State
  const [userSignature, setUserSignature] = useState(() => {
    // Check for null strictly so we allow empty string as a valid signature
    const saved = localStorage.getItem('app_user_signature');
    return saved !== null ? saved : "黑夜无论怎样漫长 白昼总会到来";
  });
  
  const [activePersonaId, setActivePersonaId] = useState<string | null>(() => {
     return localStorage.getItem('app_active_persona_id') || null;
  });

  const [activeCharacterId, setActiveCharacterId] = useState<string | null>(() => {
    return localStorage.getItem('app_active_character_id') || null;
  });

  const safeSetStorageItem = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (error) {
      console.error(`Failed to persist key "${key}"`, error);
      return false;
    }
  };

  // --- EFFECTS FOR PERSISTENCE ---

  useEffect(() => { safeSetStorageItem('app_dark_mode', JSON.stringify(isDarkMode)); }, [isDarkMode]);
  useEffect(() => {
    dailyReadingMsByDateRef.current = dailyReadingMsByDate;
  }, [dailyReadingMsByDate]);
  useEffect(() => {
    readingMsByBookIdRef.current = readingMsByBookId;
  }, [readingMsByBookId]);
  useEffect(() => {
    safeSetStorageItem(DAILY_READING_MS_STORAGE_KEY, JSON.stringify(dailyReadingMsByDate));
  }, [dailyReadingMsByDate]);
  useEffect(() => {
    safeSetStorageItem(COMPLETED_BOOK_IDS_STORAGE_KEY, JSON.stringify(completedBookIds));
  }, [completedBookIds]);
  useEffect(() => {
    safeSetStorageItem(COMPLETED_BOOK_REACHED_AT_STORAGE_KEY, JSON.stringify(completedAtByBookId));
  }, [completedAtByBookId]);
  useEffect(() => {
    safeSetStorageItem(READING_MS_BY_BOOK_ID_STORAGE_KEY, JSON.stringify(readingMsByBookId));
  }, [readingMsByBookId]);
  useEffect(() => {
    if (books.length === 0) return;
    setCompletedBookIds((prev) => {
      const next = new Set(prev);
      books.forEach((book) => {
        if (book.progress >= 100) {
          next.add(book.id);
        }
      });
      return next.size === prev.length ? prev : Array.from(next);
    });
    setCompletedAtByBookId((prev) => {
      const validBookIds = new Set(books.map((book) => book.id));
      let changed = false;
      const next: Record<string, number> = {};

      Object.entries(prev).forEach(([bookId, reachedAt]) => {
        if (!validBookIds.has(bookId)) {
          changed = true;
          return;
        }
        if (typeof reachedAt !== 'number' || !Number.isFinite(reachedAt) || reachedAt <= 0) {
          changed = true;
          return;
        }
        next[bookId] = reachedAt;
      });

      books.forEach((book) => {
        if (book.progress < 100 || next[book.id]) return;
        if (typeof book.lastReadAt === 'number' && Number.isFinite(book.lastReadAt) && book.lastReadAt > 0) {
          next[book.id] = book.lastReadAt;
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [books]);
  useEffect(() => {
    const flushReadingSession = () => {
      const openedAt = readingSessionStartedAtRef.current;
      const closedAt = Date.now();
      if (!openedAt || closedAt <= openedAt) return;

      const sessionBookId = readingSessionBookIdRef.current;
      const next = appendReadingDurationByDay(dailyReadingMsByDateRef.current, openedAt, closedAt);
      const nextByBook = appendReadingDurationForBook(readingMsByBookIdRef.current, sessionBookId, closedAt - openedAt);
      readingSessionStartedAtRef.current = null;
      readingSessionBookIdRef.current = null;
      dailyReadingMsByDateRef.current = next;
      readingMsByBookIdRef.current = nextByBook;
      setDailyReadingMsByDate(next);
      setReadingMsByBookId(nextByBook);
      safeSetStorageItem(DAILY_READING_MS_STORAGE_KEY, JSON.stringify(next));
      safeSetStorageItem(READING_MS_BY_BOOK_ID_STORAGE_KEY, JSON.stringify(nextByBook));
    };

    window.addEventListener('pagehide', flushReadingSession);
    window.addEventListener('beforeunload', flushReadingSession);

    return () => {
      window.removeEventListener('pagehide', flushReadingSession);
      window.removeEventListener('beforeunload', flushReadingSession);
    };
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const openedAt = readingSessionStartedAtRef.current;
      if (!openedAt) return;

      const now = Date.now();
      let cursor = openedAt;
      let next = dailyReadingMsByDateRef.current;
      let changed = false;

      while (cursor < now && formatLocalDateKey(cursor) !== formatLocalDateKey(now)) {
        const boundary = getNextDayStartTimestamp(cursor);
        const segmentEnd = Math.min(boundary, now);
        next = appendReadingDurationByDay(next, cursor, segmentEnd);
        cursor = segmentEnd;
        changed = true;
      }

      if (changed) {
        dailyReadingMsByDateRef.current = next;
        setDailyReadingMsByDate(next);
        const sessionBookId = readingSessionBookIdRef.current;
        const nextByBook = appendReadingDurationForBook(readingMsByBookIdRef.current, sessionBookId, cursor - openedAt);
        readingMsByBookIdRef.current = nextByBook;
        setReadingMsByBookId(nextByBook);
      }

      readingSessionStartedAtRef.current = cursor;
    }, 15000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('dark-mode', isDarkMode);
    document.body.classList.toggle('dark-mode', isDarkMode);
  }, [isDarkMode]);
  useEffect(() => {
    if (!document.body) return;

    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.position = 'fixed';
    probe.style.left = '0';
    probe.style.bottom = '0';
    probe.style.width = '0';
    probe.style.height = '0';
    probe.style.paddingBottom = 'env(safe-area-inset-bottom)';
    probe.style.pointerEvents = 'none';
    probe.style.visibility = 'hidden';
    probe.style.zIndex = '-1';
    document.body.appendChild(probe);

    const syncSafeAreaBottom = () => {
      const style = window.getComputedStyle(probe);
      const bottom = Math.max(0, Math.round(parseFloat(style.paddingBottom || '0') || 0));
      setSystemSafeAreaBottom((prev) => (prev === bottom ? prev : bottom));
      document.documentElement.style.setProperty('--app-safe-area-bottom-px', `${bottom}px`);
    };

    syncSafeAreaBottom();
    window.addEventListener('resize', syncSafeAreaBottom);
    window.addEventListener('orientationchange', syncSafeAreaBottom);
    window.visualViewport?.addEventListener('resize', syncSafeAreaBottom);

    return () => {
      window.removeEventListener('resize', syncSafeAreaBottom);
      window.removeEventListener('orientationchange', syncSafeAreaBottom);
      window.visualViewport?.removeEventListener('resize', syncSafeAreaBottom);
      probe.remove();
    };
  }, []);
  useEffect(() => {
    const syncAppScreenHeight = () => {
      const visualHeight = window.visualViewport?.height ?? 0;
      const innerHeight = window.innerHeight || 0;
      const clientHeight = document.documentElement.clientHeight || 0;
      const measuredHeight = visualHeight > 0 ? visualHeight : Math.max(innerHeight, clientHeight);
      const safeBottomInset = Math.max(0, systemSafeAreaBottom || 0);
      const screenDims = [window.screen?.height || 0, window.screen?.width || 0].filter((v) => v > 0);
      const isPortrait = window.matchMedia('(orientation: portrait)').matches;
      const screenHeight =
        screenDims.length === 0
          ? 0
          : (isPortrait ? Math.max(...screenDims) : Math.min(...screenDims));

      let totalHeight = measuredHeight + safeBottomInset;
      if (screenHeight > 0) {
        totalHeight = Math.min(totalHeight, screenHeight);
      }
      const nextHeight = Math.max(0, totalHeight - safeBottomInset);
      document.documentElement.style.setProperty('--app-screen-height', `${Math.round(nextHeight)}px`);
    };

    syncAppScreenHeight();
    window.addEventListener('resize', syncAppScreenHeight);
    window.addEventListener('orientationchange', syncAppScreenHeight);
    window.visualViewport?.addEventListener('resize', syncAppScreenHeight);

    return () => {
      window.removeEventListener('resize', syncAppScreenHeight);
      window.removeEventListener('orientationchange', syncAppScreenHeight);
      window.visualViewport?.removeEventListener('resize', syncAppScreenHeight);
    };
  }, [systemSafeAreaBottom]);
  useEffect(() => {
    try {
      if (localStorage.getItem(SAFE_AREA_DEFAULT_MIGRATION_KEY)) return;
      setAppSettings(prev => {
        const top = prev.safeAreaTop || 0;
        const bottom = prev.safeAreaBottom || 0;
        if (top === 0 && bottom === 10) {
          return { ...prev, safeAreaBottom: 0 };
        }
        return prev;
      });
      localStorage.setItem(SAFE_AREA_DEFAULT_MIGRATION_KEY, '1');
    } catch {
      // no-op: localStorage might be unavailable in private contexts
    }
  }, []);
  useEffect(() => {
    const compactedBooks = books.map(compactBookForState);
    safeSetStorageItem('app_books', JSON.stringify(compactedBooks));
  }, [books]);
  useEffect(() => { safeSetStorageItem('app_api_config', JSON.stringify(apiConfig)); }, [apiConfig]);
  useEffect(() => { safeSetStorageItem('app_api_presets', JSON.stringify(apiPresets)); }, [apiPresets]);
  useEffect(() => { safeSetStorageItem('app_settings', JSON.stringify(appSettings)); }, [appSettings]);
  useEffect(() => { safeSetStorageItem('app_personas', JSON.stringify(personas)); }, [personas]);
  useEffect(() => { safeSetStorageItem('app_characters', JSON.stringify(characters)); }, [characters]);
  useEffect(() => { safeSetStorageItem('app_worldbook', JSON.stringify(worldBookEntries)); }, [worldBookEntries]);
  useEffect(() => { safeSetStorageItem('app_wb_categories', JSON.stringify(wbCategories)); }, [wbCategories]);
  
  // New persistence
  useEffect(() => { safeSetStorageItem('app_user_signature', userSignature); }, [userSignature]);
  useEffect(() => { safeSetStorageItem('app_active_persona_id', activePersonaId || ''); }, [activePersonaId]);
  useEffect(() => { safeSetStorageItem('app_active_character_id', activeCharacterId || ''); }, [activeCharacterId]);
  useEffect(() => { safeSetStorageItem(RAG_PRESETS_STORAGE_KEY, JSON.stringify(ragPresets)); }, [ragPresets]);
  useEffect(() => { safeSetStorageItem(ACTIVE_RAG_PRESET_ID_STORAGE_KEY, activeRagPresetId || ''); }, [activeRagPresetId]);

  // Derived: effective RAG presets list (always includes default)
  const effectiveRagPresets = useMemo<RagPreset[]>(() => [
    { id: DEFAULT_RAG_PRESET_ID, name: '默认（当前API配置）', config: { ...apiConfig }, isDefault: true },
    ...ragPresets.filter(p => p.id !== DEFAULT_RAG_PRESET_ID),
  ], [apiConfig, ragPresets]);

  // Resolve a RAG preset ID to its ApiConfig (undefined = local model)
  const resolveRagApiConfig = useCallback((presetId: string | undefined): ApiConfig | undefined => {
    if (!presetId || presetId === DEFAULT_RAG_PRESET_ID) return undefined;
    const preset = effectiveRagPresets.find(p => p.id === presetId);
    return preset?.config;
  }, [effectiveRagPresets]);

  // RAG model mismatch dialog
  const [ragMismatchDialog, setRagMismatchDialog] = useState<{
    show: boolean;
    bookId: string;
    bookTitle: string;
    oldPresetId: string;
    newPresetId: string;
    resolve: ((action: 'rebuild' | 'keep') => void) | null;
  } | null>(null);

  // One-time migration: move old inline images/text out of localStorage into IndexedDB.
  useEffect(() => {
    let cancelled = false;

    const migrateStateData = async () => {
      try {
        const migratedPersonas = await Promise.all(
          personas.map(async (persona) => {
            if (!persona.avatar || !persona.avatar.startsWith('data:image/')) return persona;
            try {
              const avatarRef = await migrateDataUrlToImageRef(persona.avatar);
              return { ...persona, avatar: avatarRef };
            } catch {
              return persona;
            }
          })
        );

        const migratedCharacters = await Promise.all(
          characters.map(async (character) => {
            if (!character.avatar || !character.avatar.startsWith('data:image/')) return character;
            try {
              const avatarRef = await migrateDataUrlToImageRef(character.avatar);
              return { ...character, avatar: avatarRef };
            } catch {
              return character;
            }
          })
        );

        const booksWithMigratedCover = await Promise.all(
          books.map(async (book) => {
            if (!book.coverUrl || !book.coverUrl.startsWith('data:image/')) return book;
            try {
              const coverRef = await migrateDataUrlToImageRef(book.coverUrl);
              return { ...book, coverUrl: coverRef };
            } catch {
              return book;
            }
          })
        );
        const migratedBooks = await migrateInlineBookContent(booksWithMigratedCover);

        if (cancelled) return;

        const personasChanged = migratedPersonas.some((p, idx) => p.avatar !== personas[idx]?.avatar);
        const charactersChanged = migratedCharacters.some((c, idx) => c.avatar !== characters[idx]?.avatar);
        const booksChanged = migratedBooks.some((book, idx) => {
          const original = books[idx];
          if (!original) return true;
          return (
            book.coverUrl !== original.coverUrl ||
            (book.fullText || '') !== (original.fullText || '') ||
            (book.fullTextLength || 0) !== (original.fullTextLength || 0) ||
            (book.chapterCount || 0) !== (original.chapterCount || 0) ||
            (book.chapters?.length || 0) !== (original.chapters?.length || 0)
          );
        });

        if (personasChanged) setPersonas(migratedPersonas);
        if (charactersChanged) setCharacters(migratedCharacters);
        if (booksChanged) setBooks(migratedBooks);
      } catch (error) {
        console.error('State migration failed:', error);
      }
    };

    migrateStateData();
    return () => { cancelled = true; };
  }, []);

  // --- THEME & FONT SIZE APPLICATION ---

  useEffect(() => {
    const effectiveFontScale = appSettings.fontSizeScale * FONT_BASELINE_MULTIPLIER;

    // Apply Font Size Global Scale
    document.documentElement.style.fontSize = `${effectiveFontScale * 90}%`;

    // Calculate Colors
    const baseColor = appSettings.themeColor;
    
    // Generate Palette (Approximate)
    const c50 = adjustColor(baseColor, 95);
    const c100 = adjustColor(baseColor, 90);
    const c200 = adjustColor(baseColor, 75);
    const c300 = adjustColor(baseColor, 60);
    const c400 = baseColor; // Main
    const c500 = darkenColor(baseColor, 10);
    const c600 = darkenColor(baseColor, 20);
    const c700 = darkenColor(baseColor, 30);
    const c800 = darkenColor(baseColor, 40);
    const c900 = darkenColor(baseColor, 50);

    // Apply CSS Variables to Root
    const root = document.documentElement;
    root.style.setProperty('--app-font-scale', `${effectiveFontScale}`);
    root.style.setProperty('--theme-50', hexToRgbValues(c50));
    root.style.setProperty('--theme-100', hexToRgbValues(c100));
    root.style.setProperty('--theme-200', hexToRgbValues(c200));
    root.style.setProperty('--theme-300', hexToRgbValues(c300));
    root.style.setProperty('--theme-400', hexToRgbValues(c400));
    root.style.setProperty('--theme-500', hexToRgbValues(c500));
    root.style.setProperty('--theme-600', hexToRgbValues(c600));
    root.style.setProperty('--theme-700', hexToRgbValues(c700));
    root.style.setProperty('--theme-800', hexToRgbValues(c800));
    root.style.setProperty('--theme-900', hexToRgbValues(c900));

    // Update Neumorphic Highlight
    root.style.setProperty('--neu-highlight', isDarkMode ? c300 : c400);

  }, [appSettings.themeColor, appSettings.fontSizeScale, isDarkMode]);


  // Auto-Fetch / Check Connection on App Launch
  useEffect(() => {
    const checkConnection = async () => {
      if (!apiConfig.apiKey) return;
      try {
        const endpoint = apiConfig.endpoint.replace(/\/+$/, '');
        let response;
        if (apiConfig.provider === 'GEMINI') {
          response = await fetch(`${endpoint}/models?key=${apiConfig.apiKey}`);
        } else if (apiConfig.provider === 'CLAUDE') {
           response = await fetch(`${endpoint}/v1/models`, {
             headers: { 'x-api-key': apiConfig.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
          });
        } else {
          response = await fetch(`${endpoint}/models`, {
             headers: { 'Authorization': `Bearer ${apiConfig.apiKey}`, 'Content-Type': 'application/json' }
          });
        }
        if (response && response.ok) {
          showNotification('\u62c9\u53d6\u6a21\u578b\u6210\u529f', 'success');
        } else {
          showNotification('\u62c9\u53d6\u6a21\u578b\u5931\u8d25', 'error');
        }
      } catch (error) { 
        console.error("Auto-fetch failed", error);
        showNotification('\u62c9\u53d6\u6a21\u578b\u5931\u8d25', 'error');
      }
    };
    checkConnection();
  }, []); 

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ show: true, message, type });
    setTimeout(() => {
      setNotification(prev => ({ ...prev, show: false }));
    }, 3000);
  };

  const showRagErrorToast = (message: string) => {
    setRagErrorToast({ show: true, message });
    setTimeout(() => setRagErrorToast({ show: false, message: '' }), 6000);
  };

  const getActiveRagWarmupBookId = (): string | null => {
    const byRef = ragGlobalWarmupBookIdRef.current;
    if (byRef) return byRef;

    const activeEntry = Object.entries(ragWarmupByBookId).find(
      (entry): entry is [string, RagWarmupState] => {
        const state = entry[1];
        return Boolean(state && typeof state === 'object' && (state as RagWarmupState).active);
      },
    );
    return activeEntry?.[0] || null;
  };

  const getBookDisplayTitleById = (bookId: string | null): string => {
    if (!bookId) return '当前书籍';
    const warmupTitle = ragWarmupByBookId[bookId]?.bookTitle;
    if (warmupTitle && warmupTitle.trim()) return warmupTitle;
    const book = books.find((item) => item.id === bookId);
    if (book?.title?.trim()) return book.title;
    return '当前书籍';
  };

  const getRagBlockingBook = (targetBookId?: string): { id: string; title: string } | null => {
    const activeBookId = getActiveRagWarmupBookId();
    if (!activeBookId) return null;
    if (targetBookId && activeBookId === targetBookId) return null;
    return {
      id: activeBookId,
      title: getBookDisplayTitleById(activeBookId),
    };
  };

  useEffect(() => {
    activeCommentsEnabledRef.current = appSettings.activeCommentsEnabled;
  }, [appSettings.activeCommentsEnabled]);

  useEffect(() => {
    const clearUnlockListeners = () => {
      if (!keepAliveUnlockCleanupRef.current) return;
      keepAliveUnlockCleanupRef.current();
      keepAliveUnlockCleanupRef.current = null;
    };

    const ensureAudioReady = () => {
      let audio = keepAliveAudioRef.current;
      if (!audio) {
        audio = new Audio(KEEP_ALIVE_SILENT_AUDIO_URL);
        keepAliveAudioRef.current = audio;
      }
      if (!audio.src || !audio.src.includes(KEEP_ALIVE_SILENT_AUDIO_URL)) {
        audio.src = KEEP_ALIVE_SILENT_AUDIO_URL;
      }
      audio.loop = true;
      audio.preload = 'auto';
      audio.playsInline = true;
      return audio;
    };

    const tryPlayAudio = () => {
      const currentAudio = ensureAudioReady();
      if (!currentAudio) return;
      const playPromise = currentAudio.play();
      if (!playPromise || typeof playPromise.catch !== 'function') return;
      playPromise.catch(() => {
        if (keepAliveUnlockCleanupRef.current) return;
        const unlockEvents: Array<keyof WindowEventMap> = ['pointerdown', 'touchstart', 'click', 'keydown'];
        const onFirstInteraction = () => {
          const targetAudio = keepAliveAudioRef.current;
          if (targetAudio) {
            targetAudio.play().catch(() => undefined);
          }
          clearUnlockListeners();
        };
        unlockEvents.forEach((eventName) => {
          window.addEventListener(eventName, onFirstInteraction, { once: true, passive: true, capture: true });
        });
        keepAliveUnlockCleanupRef.current = () => {
          unlockEvents.forEach((eventName) => {
            window.removeEventListener(eventName, onFirstInteraction, true);
          });
        };
      });
    };

    const handleVisibilityResume = () => {
      if (document.visibilityState !== 'visible') return;
      tryPlayAudio();
    };

    const handleWindowFocus = () => {
      tryPlayAudio();
    };

    tryPlayAudio();
    document.addEventListener('visibilitychange', handleVisibilityResume);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('pageshow', handleWindowFocus);

    return () => {
      clearUnlockListeners();
      document.removeEventListener('visibilitychange', handleVisibilityResume);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('pageshow', handleWindowFocus);
      const audio = keepAliveAudioRef.current;
      if (!audio) return;
      audio.pause();
      audio.currentTime = 0;
    };
  }, []);

  useEffect(() => {
    activeCommentsEnabledRef.current = appSettings.activeCommentsEnabled;
    const loopToken = proactiveLoopTokenRef.current + 1;
    proactiveLoopTokenRef.current = loopToken;

    const isLoopActive = () =>
      proactiveLoopTokenRef.current === loopToken && activeCommentsEnabledRef.current;

    const clearProactiveTimer = () => {
      if (proactiveTimerRef.current) {
        window.clearTimeout(proactiveTimerRef.current);
        proactiveTimerRef.current = null;
      }
      proactiveNextPlannedAtRef.current = null;
    };

    const intervalMs = Math.max(10000, Math.round(appSettings.commentInterval * 1000));
    const probability = Math.min(100, Math.max(0, Math.round(appSettings.commentProbability)));

    const scheduleNextCheck = () => {
      if (!isLoopActive()) return;
      clearProactiveTimer();
      const plannedAt = Date.now() + intervalMs;
      proactiveNextPlannedAtRef.current = plannedAt;
      proactiveTimerRef.current = window.setTimeout(() => {
        if (!isLoopActive()) return;
        void runProactiveCheck(plannedAt);
      }, intervalMs);
    };

    const runProactiveCheck = async (plannedAt: number) => {
      proactiveTimerRef.current = null;
      proactiveNextPlannedAtRef.current = null;

      try {
        if (!isLoopActive()) return;

        const delayMs = Date.now() - plannedAt;
        const maxAcceptedDelay = Math.max(PROACTIVE_DELAY_TOLERANCE_MS, Math.floor(intervalMs * 0.5));
        if (delayMs > maxAcceptedDelay) return;

        if (Math.random() * 100 >= probability) return;

        if (!activePersonaId || !activeCharacterId) return;
        if (!isApiConfigReadyForChat(apiConfig)) return;

        const targetBook =
          currentView === AppView.READER && activeBook?.id
            ? activeBook
            : getMostRecentBook(books);
        if (!targetBook?.id) return;

        const activePersona = personas.find((persona) => persona.id === activePersonaId) || null;
        const activeCharacter = characters.find((character) => character.id === activeCharacterId) || null;
        if (!activePersona || !activeCharacter) return;

        const content = await getBookContent(targetBook.id).catch(() => null);
        if (!isLoopActive()) return;
        const readerState = content?.readerState;
        const readingContext = buildReadingContextSnapshot({
          chapters: content?.chapters || [],
          bookText: content?.fullText || '',
          highlightRangesByChapter: readerState?.highlightsByChapter || {},
          readingPosition: readerState?.readingPosition || null,
          visibleRatio: 0,
          excerptCharCount: appSettings.readerMore.feature.readingExcerptCharCount,
        });

        const conversationKey = buildConversationKey(targetBook.id, activePersonaId, activeCharacterId);
        const bucket = readConversationBucket(conversationKey);

        // RAG: 检索相关书籍片段（proactive模式用最近对话内容）
        let ragContext = '';
        try {
          const recentText = bucket.messages.slice(-3).map((m) => m.content).join(' ');
          if (recentText) {
            const { retrieveRelevantChunks, estimateRagSafeOffset } = await import('./utils/ragEngine');
            const safeOffset = estimateRagSafeOffset(
              content?.chapters || [],
              readerState?.readingPosition || null,
              readingContext.excerptEnd || 0,
            );
            const chunks = await retrieveRelevantChunks(
              recentText,
              { [targetBook.id]: safeOffset },
              { topK: 3, perBookTopK: 3 },
              resolveRagApiConfig,
            );
            if (chunks.length > 0) ragContext = chunks.slice(0, 3).map((c) => c.text).join('\n---\n');
          }
        } catch { /* RAG 静默失败 */ }

        const result = await runConversationGeneration({
          mode: 'proactive',
          conversationKey,
          sourceMessages: bucket.messages,
          apiConfig,
          userRealName: activePersona.name?.trim() || 'User',
          userNickname: activePersona.userNickname?.trim() || activePersona.name?.trim() || 'User',
          userDescription: activePersona.description?.trim() || '（暂无用户人设）',
          characterRealName: activeCharacter.name?.trim() || 'Char',
          characterNickname: activeCharacter.nickname?.trim() || activeCharacter.name?.trim() || 'Char',
          characterDescription: activeCharacter.description?.trim() || '（暂无角色人设）',
          characterWorldBookEntries: buildCharacterWorldBookSections(activeCharacter, worldBookEntries),
          activeBookId: targetBook.id,
          activeBookTitle: targetBook.title || '未选择书籍',
          chatHistorySummary: bucket.chatHistorySummary || '',
          readingPrefixSummaryByBookId: bucket.readingPrefixSummaryByBookId || {},
          readingContext,
          aiProactiveUnderlineEnabled: appSettings.aiProactiveUnderlineEnabled,
          aiProactiveUnderlineProbability: appSettings.aiProactiveUnderlineProbability,
          memoryBubbleCount: appSettings.readerMore.feature.memoryBubbleCount,
          replyBubbleMin: appSettings.readerMore.feature.replyBubbleMin,
          replyBubbleMax: appSettings.readerMore.feature.replyBubbleMax,
          allowEmptyPending: true,
          ragContext,
        });
        if (!isLoopActive()) return;
        if (result.status !== 'ok') return;

        persistConversationBucket(
          conversationKey,
          (existing) => ({
            ...existing,
            messages: [...result.baseMessages, ...result.aiMessages],
          }),
          'app-proactive'
        );
      } finally {
        if (isLoopActive()) {
          scheduleNextCheck();
        }
      }
    };

    const handleVisibilityChange = () => {
      if (!isLoopActive()) return;
      if (document.visibilityState !== 'visible') return;
      scheduleNextCheck();
    };

    clearProactiveTimer();
    if (isLoopActive()) {
      scheduleNextCheck();
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      if (proactiveLoopTokenRef.current === loopToken) {
        proactiveLoopTokenRef.current += 1;
      }
      clearProactiveTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [
    appSettings.activeCommentsEnabled,
    appSettings.commentInterval,
    appSettings.commentProbability,
    appSettings.aiProactiveUnderlineEnabled,
    appSettings.aiProactiveUnderlineProbability,
    appSettings.readerMore.feature.readingExcerptCharCount,
    appSettings.readerMore.feature.memoryBubbleCount,
    appSettings.readerMore.feature.replyBubbleMin,
    appSettings.readerMore.feature.replyBubbleMax,
    currentView,
    activeBook,
    books,
    activePersonaId,
    activeCharacterId,
    personas,
    characters,
    worldBookEntries,
    apiConfig,
  ]);

  useEffect(() => {
    return () => {
      if (viewTransitionTimerRef.current) window.clearTimeout(viewTransitionTimerRef.current);
      if (viewTransitionUnlockTimerRef.current) window.clearTimeout(viewTransitionUnlockTimerRef.current);
      if (proactiveTimerRef.current) window.clearTimeout(proactiveTimerRef.current);
      if (keepAliveUnlockCleanupRef.current) {
        keepAliveUnlockCleanupRef.current();
        keepAliveUnlockCleanupRef.current = null;
      }
      if (keepAliveAudioRef.current) {
        keepAliveAudioRef.current.pause();
        keepAliveAudioRef.current.currentTime = 0;
      }
    };
  }, []);

  const transitionToView = (nextView: AppView, nextBook: Book | null = null) => {
    if (isViewTransitioning) return;
    if (nextView === currentView && nextView !== AppView.READER) return;

    setIsViewTransitioning(true);
    setViewAnimationClass('app-view-exit-right');

    if (viewTransitionTimerRef.current) window.clearTimeout(viewTransitionTimerRef.current);
    if (viewTransitionUnlockTimerRef.current) window.clearTimeout(viewTransitionUnlockTimerRef.current);

    viewTransitionTimerRef.current = window.setTimeout(() => {
      if (nextView === AppView.READER && nextBook) {
        readingSessionStartedAtRef.current = Date.now();
        readingSessionBookIdRef.current = nextBook.id;
      } else if (nextView !== AppView.READER) {
        readingSessionBookIdRef.current = null;
      }
      setActiveBook(nextView === AppView.READER ? nextBook : null);
      setCurrentView(nextView);
      setViewAnimationClass('app-view-enter-left');

      viewTransitionUnlockTimerRef.current = window.setTimeout(() => {
        setIsViewTransitioning(false);
      }, VIEW_TRANSITION_MS);
    }, VIEW_TRANSITION_MS);
  };

  const checkRagModelMismatch = async (book: Book): Promise<'rebuild' | 'keep'> => {
    if (!book.ragEnabled) return 'keep';
    try {
      const { getBookMeta } = await import('./utils/ragEngine');
      const meta = await getBookMeta(book.id);
      if (!meta) return 'keep';
      // Old indexes without ragModelPresetId are treated as built with default preset
      const existingPresetId = meta.ragModelPresetId || DEFAULT_RAG_PRESET_ID;
      const desiredPresetId = book.ragModelPresetId || activeRagPresetId;
      if (existingPresetId === desiredPresetId) return 'keep';
      // Model mismatch detected — show confirm dialog
      return new Promise<'rebuild' | 'keep'>((resolve) => {
        setRagMismatchDialog({
          show: true,
          bookId: book.id,
          bookTitle: book.title,
          oldPresetId: existingPresetId,
          newPresetId: desiredPresetId,
          resolve: (action: 'rebuild' | 'keep') => {
            setRagMismatchDialog(null);
            if (action === 'keep') {
              setActiveRagPresetId(existingPresetId);
            }
            resolve(action);
          },
        });
      });
    } catch {
      return 'keep';
    }
  };

  const handleOpenBook = (book: Book) => {
    if (isBuiltInBook(book.id)) clearTutorialUnread();
    const blockingWarmup = getRagBlockingBook(book.id);
    if (blockingWarmup) {
      showNotification(`《${blockingWarmup.title}》RAG索引构建中，暂时无法打开其他书籍`, 'error');
      return;
    }

    const openedAt = Date.now();
    setBooks(prev =>
      prev.map(item =>
        item.id === book.id
          ? {
              ...item,
              lastReadAt: openedAt,
              lastRead: formatBookLastRead(openedAt),
            }
          : item
      )
    );
    if (book.ragEnabled) {
      void checkRagModelMismatch(book).then((action) => {
        if (action === 'rebuild') {
          const desiredPresetId = book.ragModelPresetId || activeRagPresetId;
          const updatedBook = { ...book, ragModelPresetId: desiredPresetId };
          setBooks(prev => prev.map(b => b.id === book.id ? { ...b, ragModelPresetId: desiredPresetId } : b));
          warmupRagForBook(updatedBook, 'open');
        } else {
          warmupRagForBook(book, 'open');
        }
        transitionToView(AppView.READER, book);
      });
    } else {
      transitionToView(AppView.READER, book);
    }
  };

  const handleBackToLibrary = (snapshot?: ReaderSessionSnapshot) => {
    const closedAt = snapshot?.lastReadAt || Date.now();
    const openedAt = readingSessionStartedAtRef.current;
    const sessionBookId = snapshot?.bookId || readingSessionBookIdRef.current;
    if (openedAt && closedAt > openedAt) {
      const next = appendReadingDurationByDay(dailyReadingMsByDateRef.current, openedAt, closedAt);
      const nextByBook = appendReadingDurationForBook(readingMsByBookIdRef.current, sessionBookId, closedAt - openedAt);
      dailyReadingMsByDateRef.current = next;
      readingMsByBookIdRef.current = nextByBook;
      setDailyReadingMsByDate(next);
      setReadingMsByBookId(nextByBook);
    }
    readingSessionStartedAtRef.current = null;
    readingSessionBookIdRef.current = null;

    if (snapshot) {
      const previousBook = books.find((book) => book.id === snapshot.bookId);
      const reached100Now = snapshot.progress >= 100 && (previousBook?.progress || 0) < 100;

      setBooks(prev =>
        prev.map(book =>
          book.id === snapshot.bookId
            ? {
                ...book,
                progress: snapshot.progress,
                lastReadAt: snapshot.lastReadAt,
                lastRead: formatBookLastRead(snapshot.lastReadAt),
              }
            : book
        )
      );
      if (snapshot.progress >= 100) {
        setCompletedBookIds(prev => (prev.includes(snapshot.bookId) ? prev : [...prev, snapshot.bookId]));
        if (reached100Now) {
          setCompletedAtByBookId((prev) => ({
            ...prev,
            [snapshot.bookId]: snapshot.lastReadAt,
          }));
        }
      }
    }
    transitionToView(AppView.LIBRARY);
  };

  const collectChapterImageRefs = (chapters: Chapter[] | undefined) => {
    const imageRefs = new Set<string>();
    if (!Array.isArray(chapters)) return imageRefs;
    chapters.forEach((chapter) => {
      if (!Array.isArray(chapter.blocks)) return;
      chapter.blocks.forEach((block) => {
        if (block.type !== 'image' || !block.imageRef) return;
        imageRefs.add(block.imageRef);
      });
    });
    return imageRefs;
  };

  const deleteImageRefsBatch = (imageRefs: Iterable<string>, reason: string) => {
    Array.from(imageRefs).forEach((imageRef) => {
      if (!imageRef) return;
      deleteImageByRef(imageRef).catch((error) => {
        console.error(`${reason}:`, error);
      });
    });
  };

  const warmupRagForBook = (book: Book, source: 'upload' | 'open' | 'resume') => {
    if (!book?.id) return;
    if (!book.ragEnabled) return;
    const globalWarmupBookId = ragGlobalWarmupBookIdRef.current;
    if (globalWarmupBookId && globalWarmupBookId !== book.id) return;
    if (ragWarmupLockByBookRef.current[book.id]) return;
    // 用户主动触发（open/upload）时清除失败标记，允许重试
    if (source !== 'resume') ragApiFailedBookIdsRef.current.delete(book.id);
    ragGlobalWarmupBookIdRef.current = book.id;
    ragWarmupLockByBookRef.current[book.id] = true;

    const token = Date.now();
    ragWarmupTokenByBookRef.current[book.id] = token;
    const setWarmupState = (next: Partial<RagWarmupState>) => {
      if (ragWarmupTokenByBookRef.current[book.id] !== token) return;
      setRagWarmupByBookId((prev) => ({
        ...prev,
        [book.id]: {
          active: true,
          stage: 'model',
          progress: 0,
          bookTitle: book.title || '未命名书籍',
          ...(prev[book.id] || {}),
          ...next,
        },
      }));
    };
    const clearWarmupState = (delayMs: number = 0) => {
      window.setTimeout(() => {
        if (ragWarmupTokenByBookRef.current[book.id] !== token) return;
        setRagWarmupByBookId((prev) => {
          if (!(book.id in prev)) return prev;
          const next = { ...prev };
          delete next[book.id];
          return next;
        });
        delete ragWarmupLockByBookRef.current[book.id];
        delete ragWarmupTokenByBookRef.current[book.id];
        if (ragGlobalWarmupBookIdRef.current === book.id) {
          ragGlobalWarmupBookIdRef.current = null;
        }
      }, delayMs);
    };
    const releaseWarmupLock = () => {
      if (ragWarmupTokenByBookRef.current[book.id] !== token) return;
      delete ragWarmupLockByBookRef.current[book.id];
      delete ragWarmupTokenByBookRef.current[book.id];
      if (ragGlobalWarmupBookIdRef.current === book.id) {
        ragGlobalWarmupBookIdRef.current = null;
      }
    };

    const startDelayMs = source === 'open' ? 500 : source === 'resume' ? 80 : 150;
    window.setTimeout(() => {
      let retryCount = 0;
      const runWarmup = async (): Promise<void> => {
        try {
          const {
            warmupRagModel,
            ensureBookIndexedUpTo,
            getBookIndexedUpTo,
            estimateRagSafeOffset,
          } = await import('./utils/ragEngine');

          const stored = await getBookContent(book.id).catch(() => null);
          const chapters = stored?.chapters || [];
          if (chapters.length === 0) {
            clearWarmupState(300);
            return;
          }

          const fullIndexTargetOffset = estimateRagSafeOffset(
            chapters,
            null,
            Number.MAX_SAFE_INTEGER,
          );
          if (fullIndexTargetOffset <= 0) {
            clearWarmupState(300);
            return;
          }

          const indexedUpTo = await getBookIndexedUpTo(book.id);
          if (indexedUpTo >= fullIndexTargetOffset) {
            releaseWarmupLock();
            return;
          }

          const ragApiCfg = resolveRagApiConfig(book.ragModelPresetId);
          const usesLocalEmbedModel = !ragApiCfg;

          // 使用 API embedding 时跳过本地模型预热
          if (usesLocalEmbedModel) {
            setWarmupState({ active: true, stage: 'model', progress: 0.02 });
            setWarmupState({ active: true, stage: 'model', progress: 0.08 });
            await warmupRagModel();
          }
          setWarmupState({ active: true, stage: 'index', progress: 0.12 });
          await ensureBookIndexedUpTo(
            book.id,
            chapters,
            fullIndexTargetOffset,
            (pct) => {
              const safePct = Math.max(0, Math.min(1, Number.isFinite(pct) ? pct : 0));
              setWarmupState({
                active: true,
                stage: 'index',
                progress: 0.12 + safePct * 0.88,
              });
            },
            book.ragModelPresetId,
            ragApiCfg,
          );
          setWarmupState({ active: true, stage: 'index', progress: 1 });
          clearWarmupState(900);
        } catch (error) {
          if (ragWarmupTokenByBookRef.current[book.id] !== token) return;

          // 使用 API embedding 时任何错误都不重试，直接报错
          if (resolveRagApiConfig(book.ragModelPresetId)) {
            const msg = error instanceof Error ? error.message : String(error);
            showRagErrorToast(`RAG索引失败: ${msg}`);
            ragApiFailedBookIdsRef.current.add(book.id);
            clearWarmupState(0);
            return;
          }

          retryCount += 1;
          if (retryCount >= RAG_LOCAL_WARMUP_MAX_RETRIES) {
            const msg = error instanceof Error ? error.message : String(error);
            console.warn(
              `[RAG] Local model warmup failed after ${retryCount} attempts for book ${book.id}:`,
              error,
            );
            showRagErrorToast(`RAG模型加载失败（已重试${RAG_LOCAL_WARMUP_MAX_RETRIES}次）: ${msg}`);
            ragApiFailedBookIdsRef.current.add(book.id);
            clearWarmupState(0);
            return;
          }

          const retryDelayMs = Math.min(
            RAG_WARMUP_RETRY_MAX_MS,
            RAG_WARMUP_RETRY_BASE_MS * Math.max(1, 2 ** (retryCount - 1)),
          );
          setWarmupState({ active: true, stage: 'model', progress: 0.08 });
          console.warn(
            `[RAG] Background warmup failed (${source}) for book ${book.id}, retry #${retryCount} in ${retryDelayMs}ms:`,
            error,
          );
          window.setTimeout(() => {
            if (ragWarmupTokenByBookRef.current[book.id] !== token) return;
            void runWarmup();
          }, retryDelayMs);
        }
      };
      void runWarmup();
    }, startDelayMs);
  };

  const resumeIncompleteRagIndexing = useCallback((trigger: 'foreground' | 'books-sync') => {
    if (ragResumeScanInProgressRef.current) return;
    if (ragGlobalWarmupBookIdRef.current) return;

    const now = Date.now();
    const minIntervalMs = trigger === 'foreground' ? 2000 : 8000;
    if (now - ragResumeLastScanAtRef.current < minIntervalMs) return;

    ragResumeScanInProgressRef.current = true;
    ragResumeLastScanAtRef.current = now;

    void (async () => {
      try {
        if (books.length === 0) return;
        const { getBookIndexedUpTo, estimateRagSafeOffset } = await import('./utils/ragEngine');

        const orderedBooks = activeBook
          ? [
              activeBook,
              ...books
                .filter((book) => book.id !== activeBook.id)
                .sort((a, b) => (b.lastReadAt || 0) - (a.lastReadAt || 0)),
            ]
          : [...books].sort((a, b) => (b.lastReadAt || 0) - (a.lastReadAt || 0));
        for (const book of orderedBooks) {
          if (!book?.id) continue;
          if (!book.ragEnabled) continue;
          if (ragWarmupLockByBookRef.current[book.id]) continue;
          if (ragApiFailedBookIdsRef.current.has(book.id)) continue;

          const stored = await getBookContent(book.id).catch(() => null);
          const chapters = stored?.chapters || [];
          if (chapters.length === 0) continue;

          const fullIndexTargetOffset = estimateRagSafeOffset(chapters, null, Number.MAX_SAFE_INTEGER);
          if (fullIndexTargetOffset <= 0) continue;

          const indexedUpTo = await getBookIndexedUpTo(book.id);
          if (indexedUpTo >= fullIndexTargetOffset) continue;

          warmupRagForBook(book, 'resume');
          break;
        }
      } catch (error) {
        console.warn(`[RAG] Resume scan failed (${trigger}):`, error);
      } finally {
        ragResumeScanInProgressRef.current = false;
      }
    })();
  }, [books, activeBook]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      resumeIncompleteRagIndexing('foreground');
    };
    const handleFocus = () => {
      resumeIncompleteRagIndexing('foreground');
    };
    const handlePageShow = () => {
      resumeIncompleteRagIndexing('foreground');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('pageshow', handlePageShow);

    resumeIncompleteRagIndexing('books-sync');

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [resumeIncompleteRagIndexing]);

  const handleAddBook = async (newBook: Book): Promise<boolean> => {
    const blockingWarmup = getRagBlockingBook();
    if (blockingWarmup) {
      showNotification(`《${blockingWarmup.title}》RAG索引构建中，请稍后再导入新书`, 'error');
      return false;
    }

    const fullText = newBook.fullText || '';
    const chapters = newBook.chapters || [];

    try {
      await saveBookContent(newBook.id, fullText, chapters);
      const compacted = compactBookForState({ ...newBook, fullText, chapters });
      setBooks(prev => [compacted, ...prev]);
      if (compacted.ragEnabled) {
        warmupRagForBook(compacted, 'upload');
      }
      if (newBook.progress >= 100) {
        setCompletedBookIds(prev => (prev.includes(newBook.id) ? prev : [...prev, newBook.id]));
        const reachedAt = typeof newBook.lastReadAt === 'number' && newBook.lastReadAt > 0
          ? newBook.lastReadAt
          : Date.now();
        setCompletedAtByBookId((prev) => ({ ...prev, [newBook.id]: reachedAt }));
      }
      showNotification('成功导入');
      return true;
    } catch (error) {
      console.error('Failed to persist new book content:', error);
      showNotification('Failed to save book content', 'error');
      return false;
    }
  };

  const handleRequestImportBook = (): boolean => {
    const blockingWarmup = getRagBlockingBook();
    if (!blockingWarmup) return true;
    showNotification(`《${blockingWarmup.title}》RAG索引构建中，请稍后再导入新书`, 'error');
    return false;
  };

  const handleUpdateBook = async (updatedBook: Book) => {
    const fullText = updatedBook.fullText || '';
    const chapters = updatedBook.chapters || [];
    const previousBook = books.find((book) => book.id === updatedBook.id);
    const reached100Now = updatedBook.progress >= 100 && (previousBook?.progress || 0) < 100;
    const previousStoredContent = await getBookContent(updatedBook.id).catch(() => null);
    const previousImageRefs = new Set<string>();
    const nextImageRefs = new Set<string>();

    if (previousBook?.coverUrl) previousImageRefs.add(previousBook.coverUrl);
    collectChapterImageRefs(previousStoredContent?.chapters || previousBook?.chapters || []).forEach((ref) =>
      previousImageRefs.add(ref)
    );

    if (updatedBook.coverUrl) nextImageRefs.add(updatedBook.coverUrl);
    collectChapterImageRefs(chapters).forEach((ref) => nextImageRefs.add(ref));

    try {
      await saveBookContent(updatedBook.id, fullText, chapters);
      const compacted = compactBookForState({ ...updatedBook, fullText, chapters });
      setBooks(prev => prev.map(b => (b.id === updatedBook.id ? compacted : b)));
      if (updatedBook.progress >= 100) {
        setCompletedBookIds(prev => (prev.includes(updatedBook.id) ? prev : [...prev, updatedBook.id]));
        if (reached100Now) {
          const reachedAt = typeof updatedBook.lastReadAt === 'number' && updatedBook.lastReadAt > 0
            ? updatedBook.lastReadAt
            : Date.now();
          setCompletedAtByBookId((prev) => ({ ...prev, [updatedBook.id]: reachedAt }));
        }
      }

      const staleImageRefs = Array.from(previousImageRefs).filter((ref) => !nextImageRefs.has(ref));
      deleteImageRefsBatch(staleImageRefs, 'Failed to delete stale updated-book image');
      showNotification('书本信息已更新');
    } catch (error) {
      console.error('Failed to persist updated book content:', error);
      showNotification('Failed to save changes', 'error');
    }
  };

  const handleDeleteBook = async (bookId: string) => {
    if (isBuiltInBook(bookId)) return;
    const targetBook = books.find(b => b.id === bookId);
    const storedContent = await getBookContent(bookId).catch(() => null);
    const imageRefs = new Set<string>();
    if (targetBook?.coverUrl) imageRefs.add(targetBook.coverUrl);
    collectChapterImageRefs(storedContent?.chapters || targetBook?.chapters || []).forEach((ref) => imageRefs.add(ref));

    deleteBookContent(bookId).catch(err => console.error('Failed to delete deleted-book text content:', err));
    deleteImageRefsBatch(imageRefs, 'Failed to delete deleted-book image');

    setBooks(prev => prev.filter(b => b.id !== bookId));
    setCompletedBookIds(prev => prev.filter(id => id !== bookId));
    setCompletedAtByBookId((prev) => {
      if (!(bookId in prev)) return prev;
      const next = { ...prev };
      delete next[bookId];
      return next;
    });
    setReadingMsByBookId((prev) => {
      if (!(bookId in prev)) return prev;
      const next = { ...prev };
      delete next[bookId];
      return next;
    });
    setRagWarmupByBookId((prev) => {
      if (!(bookId in prev)) return prev;
      const next = { ...prev };
      delete next[bookId];
      return next;
    });
    delete ragWarmupTokenByBookRef.current[bookId];
    delete ragWarmupLockByBookRef.current[bookId];
    ragApiFailedBookIdsRef.current.delete(bookId);
    if (ragGlobalWarmupBookIdRef.current === bookId) {
      ragGlobalWarmupBookIdRef.current = null;
    }
    showNotification('书本已删除');
  };

  const activeCharacterNickname = (() => {
    const activeCharacter = characters.find((item) => item.id === activeCharacterId);
    if (!activeCharacter) return '\u89d2\u8272';
    return activeCharacter.nickname || activeCharacter.name || '\u89d2\u8272';
  })();

  const manualSafeAreaTop = Math.max(0, appSettings.safeAreaTop || 0);
  const manualSafeAreaBottom = Math.max(0, appSettings.safeAreaBottom || 0);
  const resolvedSafeAreaTop = manualSafeAreaTop;
  const resolvedSafeAreaBottom = manualSafeAreaBottom;
  const appViewportHeight = 'calc(var(--app-screen-height) + var(--app-safe-area-bottom-px))';
  const appWrapperClass = `relative flex flex-col h-full font-sans overflow-hidden transition-colors duration-300 ${isDarkMode ? 'dark-mode bg-[#2d3748] text-slate-200' : 'bg-[#e0e5ec] text-slate-600'}`;
  const appWrapperStyle: React.CSSProperties = {
    minHeight: appViewportHeight,
    height: appViewportHeight,
    paddingTop: `${resolvedSafeAreaTop}px`,
    boxSizing: 'border-box',
  };
  const activeRagWarmupEntries = Object.entries(ragWarmupByBookId).filter(
    (entry): entry is [string, RagWarmupState] => {
      const state = entry[1];
      return Boolean(state && typeof state === 'object' && (state as RagWarmupState).active);
    },
  );
  const primaryRagWarmupEntry = activeRagWarmupEntries[0] || null;
  const primaryRagWarmupState = primaryRagWarmupEntry?.[1] || null;
  const primaryRagWarmupBookId = primaryRagWarmupEntry?.[0] || '';
  const primaryRagWarmupBookTitle = primaryRagWarmupState?.bookTitle
    || books.find((item) => item.id === primaryRagWarmupBookId)?.title
    || '当前书籍';
  const primaryRagWarmupPercent = primaryRagWarmupState
    ? Math.max(0, Math.min(100, Math.round((Number.isFinite(primaryRagWarmupState.progress) ? primaryRagWarmupState.progress : 0) * 100)))
    : 0;
  const primaryRagWarmupStageLabel = !primaryRagWarmupState
    ? '空闲'
    : (primaryRagWarmupState.stage === 'model' ? '模型加载中' : '索引构建中');
  const hasMultipleRagWarmups = activeRagWarmupEntries.length > 1;

  const globalToastsJsx = (
    <>
      {/* Global Notification */}
      <div
        className={`fixed left-1/2 -translate-x-1/2 z-[110] transition-all duration-500 ease-out transform ${notification.show ? 'translate-y-0 opacity-100' : '-translate-y-20 opacity-0 pointer-events-none'}`}
        style={{ top: `${resolvedSafeAreaTop + 24}px` }}
      >
        <div className={`w-[min(94vw,760px)] px-8 py-4 rounded-[28px] flex items-center gap-4 border backdrop-blur-md ${isDarkMode ? 'bg-[#2d3748] text-slate-200 border-slate-700/70 shadow-[8px_8px_16px_#232b39,-8px_-8px_16px_#374357]' : 'bg-[#e0e5ec] text-slate-600 border-white/20 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.8)]'}`}>
          {notification.type === 'success' ? <CheckCircle2 size={28} className="text-emerald-500 flex-shrink-0" /> : <AlertCircle size={28} className="text-rose-500 flex-shrink-0" />}
          <span className="font-bold text-xs sm:text-sm leading-snug">{notification.message}</span>
        </div>
      </div>
      {/* RAG Warmup Progress */}
      {primaryRagWarmupState && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[110] pointer-events-none transition-all duration-300"
          style={{ top: `${resolvedSafeAreaTop + (notification.show ? 122 : 24)}px` }}
        >
          <div className={`w-[min(94vw,760px)] px-8 py-4 rounded-[28px] flex items-center gap-4 border backdrop-blur-md ${isDarkMode ? 'bg-[#2d3748]/95 text-slate-200 border-slate-700/70 shadow-[8px_8px_16px_#232b39,-8px_-8px_16px_#374357]' : 'bg-[#e0e5ec]/95 text-slate-600 border-white/20 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.8)]'}`}>
            <Loader2 size={28} className="animate-spin text-rose-400 flex-shrink-0" />
            <span className="font-bold text-xs sm:text-sm leading-snug">
              {`RAG ${primaryRagWarmupStageLabel} ${primaryRagWarmupPercent}% · ${primaryRagWarmupBookTitle}${hasMultipleRagWarmups ? ` 等${activeRagWarmupEntries.length}本` : ''}`}
            </span>
          </div>
        </div>
      )}
      {/* RAG Error Toast */}
      {ragErrorToast.show && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[110] pointer-events-none transition-all duration-300"
          style={{ top: `${resolvedSafeAreaTop + (notification.show ? 122 : 24) + (primaryRagWarmupState ? 72 : 0)}px` }}
        >
          <div className={`w-[min(94vw,760px)] px-8 py-4 rounded-[28px] flex items-center gap-4 border backdrop-blur-md ${isDarkMode ? 'bg-[#2d3748]/95 text-slate-200 border-slate-700/70 shadow-[8px_8px_16px_#232b39,-8px_-8px_16px_#374357]' : 'bg-[#e0e5ec]/95 text-slate-600 border-white/20 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.8)]'}`}>
            <AlertCircle size={28} className="text-rose-400 flex-shrink-0" />
            <span className="font-bold text-xs sm:text-sm leading-snug">
              {ragErrorToast.message}
            </span>
          </div>
        </div>
      )}
    </>
  );

  // If in Reader mode
  if (currentView === AppView.READER) {
    const readerWrapperStyle: React.CSSProperties = {
      minHeight: appViewportHeight,
      height: appViewportHeight,
      boxSizing: 'border-box',
    };
    return (
      <div 
        className={appWrapperClass}
        style={readerWrapperStyle}
      >
        <div className={`flex-1 flex flex-col overflow-hidden ${viewAnimationClass}`}>
          <Reader
            onBack={handleBackToLibrary}
            isDarkMode={isDarkMode}
            activeBook={activeBook}
            ragIndexingState={activeBook ? (ragWarmupByBookId[activeBook.id] || null) : null}
            appSettings={appSettings}
            setAppSettings={setAppSettings}
            safeAreaTop={resolvedSafeAreaTop}
            safeAreaBottom={resolvedSafeAreaBottom}
            apiConfig={apiConfig}
            apiPresets={apiPresets}
            personas={personas}
            activePersonaId={activePersonaId}
            onSelectPersona={setActivePersonaId}
            characters={characters}
            activeCharacterId={activeCharacterId}
            onSelectCharacter={setActiveCharacterId}
            worldBookEntries={worldBookEntries}
            ragApiConfigResolver={resolveRagApiConfig}
          />
        </div>
        {/* Global toasts (shared across all views) */}
        {globalToastsJsx}
      </div>
    );
  }

  return (
    <div
      className={appWrapperClass}
      style={appWrapperStyle}
    >

      {/* Global toasts */}
      {globalToastsJsx}

      {/* RAG Model Mismatch Dialog */}
      {ragMismatchDialog?.show && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-6 bg-slate-500/20 backdrop-blur-sm animate-fade-in">
          <div className={`w-full max-w-sm rounded-2xl p-6 shadow-2xl border relative ${isDarkMode ? 'bg-[#2d3748] border-slate-600 text-slate-200' : 'bg-[#e0e5ec] border-white/50 text-slate-600'}`}>
            <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 ${isDarkMode ? 'bg-amber-500/20' : 'bg-amber-100'}`}>
              <AlertCircle size={24} className="text-amber-500" />
            </div>
            <h3 className={`text-lg font-bold mb-2 text-center ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>
              RAG模型已变更
            </h3>
            <p className={`text-sm text-center mb-6 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
              《{ragMismatchDialog.bookTitle}》的RAG索引使用的模型预设与当前选择的不同。是否用新模型重新构建索引库？
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => ragMismatchDialog.resolve?.('keep')}
                className={`flex-1 py-3 rounded-full text-sm font-bold ${isDarkMode ? 'bg-[#2d3748] shadow-[5px_5px_10px_#232b39,-5px_-5px_10px_#374357] text-slate-300' : 'neu-btn text-slate-500'}`}
              >
                使用原配置
              </button>
              <button
                onClick={async () => {
                  try {
                    const { deleteEmbeddingsByBook } = await import('./utils/ragEngine');
                    await deleteEmbeddingsByBook(ragMismatchDialog.bookId);
                  } catch {}
                  ragMismatchDialog.resolve?.('rebuild');
                }}
                className="flex-1 py-3 rounded-full text-white bg-rose-400 shadow-lg hover:bg-rose-500 active:scale-95 transition-all font-bold text-sm"
              >
                确认重建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className={`flex-1 flex flex-col overflow-hidden relative ${viewAnimationClass}`}>
        {currentView === AppView.LIBRARY && (
          <Library
            books={books}
            onOpenBook={handleOpenBook} 
            onAddBook={handleAddBook}
            onRequestImportBook={handleRequestImportBook}
            onUpdateBook={handleUpdateBook} 
            onDeleteBook={handleDeleteBook}
            isDarkMode={isDarkMode} 
            userSignature={userSignature}
            onUpdateSignature={setUserSignature}
            personas={personas}
            activePersonaId={activePersonaId}
            onSelectPersona={setActivePersonaId}
            characters={characters}
            activeCharacterId={activeCharacterId}
            onSelectCharacter={setActiveCharacterId}
            apiConfig={apiConfig}
            ragPresets={effectiveRagPresets}
            activeRagPresetId={activeRagPresetId}
          />
        )}
        {currentView === AppView.STATS && (
          <Stats
            isDarkMode={isDarkMode}
            dailyReadingMsByDate={dailyReadingMsByDate}
            themeColor={appSettings.themeColor}
            completedBookCount={completedBookIds.length}
            completedBookIds={completedBookIds}
            completedAtByBookId={completedAtByBookId}
            readingMsByBookId={readingMsByBookId}
            activeCharacterNickname={activeCharacterNickname}
            books={books}
            apiConfig={apiConfig}
            personas={personas}
            activePersonaId={activePersonaId}
            characters={characters}
            activeCharacterId={activeCharacterId}
            worldBookEntries={worldBookEntries}
          />
        )}
        <div className={`flex-1 flex flex-col overflow-hidden ${currentView === AppView.STUDY_HUB ? '' : 'hidden'}`}>
          <StudyHub
            isDarkMode={isDarkMode}
            books={books}
            personas={personas}
            activePersonaId={activePersonaId}
            characters={characters}
            activeCharacterId={activeCharacterId}
            worldBookEntries={worldBookEntries}
            apiConfig={apiConfig}
            readingExcerptCharCount={appSettings.readerMore.feature.readingExcerptCharCount}
            showNotification={showNotification}
            ragApiConfigResolver={resolveRagApiConfig}
          />
        </div>
        {currentView === AppView.SETTINGS && (
          <Settings
            isDarkMode={isDarkMode}
            onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}

            // API
            apiConfig={apiConfig}
            setApiConfig={setApiConfig}
            apiPresets={apiPresets}
            setApiPresets={setApiPresets}

            // Global App Settings
            appSettings={appSettings}
            setAppSettings={setAppSettings}

            // Data
            personas={personas}
            setPersonas={setPersonas}
            characters={characters}
            setCharacters={setCharacters}
            worldBookEntries={worldBookEntries}
            setWorldBookEntries={setWorldBookEntries}
            wbCategories={wbCategories}
            setWbCategories={setWbCategories}

            // RAG Presets
            ragPresets={ragPresets}
            setRagPresets={setRagPresets}
            activeRagPresetId={activeRagPresetId}
            setActiveRagPresetId={setActiveRagPresetId}
          />
        )}
      </div>

      {/* Bottom Navigation */}
      <nav 
        className="absolute left-0 right-0 z-40 px-6 pointer-events-none"
        style={{ bottom: `${resolvedSafeAreaBottom + 8}px` }}
      >
        <div className={`flex w-full justify-around items-center py-3 px-2 rounded-2xl pointer-events-auto ${isDarkMode ? 'bg-[#2d3748] shadow-[5px_5px_10px_#232b39,-5px_-5px_10px_#374357]' : 'neu-flat'}`}>
          <button 
            onClick={() => transitionToView(AppView.LIBRARY)}
            disabled={isViewTransitioning}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${currentView === AppView.LIBRARY ? 'text-rose-400 shadow-[inset_3px_3px_6px_rgba(0,0,0,0.2),inset_-3px_-3px_6px_rgba(255,255,255,0.1)]' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <LayoutGrid size={22} strokeWidth={currentView === AppView.LIBRARY ? 2.5 : 2} />
          </button>
          
          <button
            onClick={() => transitionToView(AppView.STATS)}
            disabled={isViewTransitioning}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${currentView === AppView.STATS ? 'text-rose-400 shadow-[inset_3px_3px_6px_rgba(0,0,0,0.2),inset_-3px_-3px_6px_rgba(255,255,255,0.1)]' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <PieChart size={22} strokeWidth={currentView === AppView.STATS ? 2.5 : 2} />
          </button>

          <button
            onClick={() => transitionToView(AppView.STUDY_HUB)}
            disabled={isViewTransitioning}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${currentView === AppView.STUDY_HUB ? 'text-rose-400 shadow-[inset_3px_3px_6px_rgba(0,0,0,0.2),inset_-3px_-3px_6px_rgba(255,255,255,0.1)]' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <Sparkles size={22} strokeWidth={currentView === AppView.STUDY_HUB ? 2.5 : 2} />
          </button>

          <button
            onClick={() => transitionToView(AppView.SETTINGS)}
            disabled={isViewTransitioning}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${currentView === AppView.SETTINGS ? 'text-rose-400 shadow-[inset_3px_3px_6px_rgba(0,0,0,0.2),inset_-3px_-3px_6px_rgba(255,255,255,0.1)]' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <SettingsIcon size={22} strokeWidth={currentView === AppView.SETTINGS ? 2.5 : 2} />
          </button>
        </div>
      </nav>
    </div>
  );
};

export default App;

