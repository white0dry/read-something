import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Cell, LabelList } from 'recharts';
import { Flame, Clock, BookOpen, Calendar, Search, Check, X, RotateCcw } from 'lucide-react';
import { GoogleGenAI } from '@google/genai';
import ModalPortal from './ModalPortal';
import ResolvedImage from './ResolvedImage';
import { ApiConfig, Book } from '../types';
import { Character, Persona, WorldBookEntry } from './settings/types';

type StatsBook = Pick<Book, 'id' | 'title' | 'author' | 'coverUrl' | 'tags' | 'progress' | 'lastReadAt'>;

interface StatsProps {
  isDarkMode?: boolean;
  dailyReadingMsByDate?: Record<string, number>;
  themeColor?: string;
  completedBookCount?: number;
  completedBookIds?: string[];
  completedAtByBookId?: Record<string, number>;
  readingMsByBookId?: Record<string, number>;
  activeCharacterNickname?: string;
  books?: StatsBook[];
  apiConfig: ApiConfig;
  personas: Persona[];
  activePersonaId: string | null;
  characters: Character[];
  activeCharacterId: string | null;
  worldBookEntries: WorldBookEntry[];
}

const HOURS_CAP = 8;
const DEFAULT_THEME_COLOR = '#e28a9d';
const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const CALENDAR_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type ReadingTier = 0 | 1 | 2 | 3;

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface TouchGestureState {
  x: number;
  y: number;
  axis: 'x' | 'y' | null;
}

const SWIPE_DECISION_THRESHOLD = 10;
const SWIPE_TRIGGER_THRESHOLD = 42;
const CARD_TAP_THRESHOLD = 10;
const GOAL_BOOK_IDS_STORAGE_KEY = 'app_stats_goal_book_ids';
const STATS_NOTE_CACHE_STORAGE_KEY = 'app_stats_sticky_note_cache_v1';
const STATS_NOTE_HISTORY_STORAGE_KEY = 'app_stats_note_history_v1';
const DEFAULT_CHARACTER_NICKNAME = '\u89d2\u8272';
const NOTE_RESPONSE_START = '<sticky_note>';
const NOTE_RESPONSE_END = '</sticky_note>';

type SummaryCardKey = 'streak' | 'duration' | 'completed' | 'goal';

interface StickyNoteCacheEntry {
  content: string;
  updatedAt: number;
}

type StickyNoteCacheStore = Record<string, StickyNoteCacheEntry>;

interface StickyNoteHistoryMessage {
  id: string;
  sender: 'user' | 'character';
  content: string;
  timestamp: number;
}

interface StickyNoteHistoryBucket {
  updatedAt: number;
  messages: StickyNoteHistoryMessage[];
}

type StickyNoteHistoryStore = Record<string, StickyNoteHistoryBucket>;

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

const normalizeHexColor = (value?: string) => {
  if (!value) return DEFAULT_THEME_COLOR;
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const chars = trimmed.slice(1).split('');
    return `#${chars.map(char => `${char}${char}`).join('')}`;
  }
  return DEFAULT_THEME_COLOR;
};

const hexToRgb = (hexColor: string): RgbColor => {
  const normalized = normalizeHexColor(hexColor).replace('#', '');
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
};

const mixRgb = (source: RgbColor, target: RgbColor, ratio: number): RgbColor => ({
  r: clampByte(source.r + (target.r - source.r) * ratio),
  g: clampByte(source.g + (target.g - source.g) * ratio),
  b: clampByte(source.b + (target.b - source.b) * ratio),
});

const rgbToCss = ({ r, g, b }: RgbColor) => `rgb(${r}, ${g}, ${b})`;
const rgbToRgba = ({ r, g, b }: RgbColor, alpha: number) => `rgba(${r}, ${g}, ${b}, ${alpha})`;

const parseRgbCss = (value: string): RgbColor | null => {
  const match = value.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (!match) return null;
  return {
    r: clampByte(Number(match[1])),
    g: clampByte(Number(match[2])),
    b: clampByte(Number(match[3])),
  };
};

const resolveModeAccentColor = (hexColor: string, isDarkMode?: boolean) => {
  const base = hexToRgb(hexColor);
  const adjusted = isDarkMode
    ? mixRgb(base, { r: 255, g: 255, b: 255 }, 0.16)
    : mixRgb(base, { r: 0, g: 0, b: 0 }, 0.08);
  return rgbToCss(adjusted);
};

const formatDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getDateStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const addDays = (date: Date, amount: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);

const addMonths = (date: Date, amount: number) =>
  new Date(date.getFullYear(), date.getMonth() + amount, 1);

const getWeekStartMonday = (date: Date) => {
  const dayStart = getDateStart(date);
  const offset = (dayStart.getDay() + 6) % 7;
  return addDays(dayStart, -offset);
};

const getReadingTier = (hours: number): ReadingTier => {
  if (hours <= 0) return 0;
  if (hours < 1) return 1;
  if (hours <= 3) return 2;
  return 3;
};

const getMonthlyCells = (monthStart: Date, dailyReadingMsByDate: Record<string, number>) => {
  const firstWeekday = monthStart.getDay();
  const totalDays = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  const cells: Array<{ day: number; tier: ReadingTier } | null> = [];

  for (let i = 0; i < firstWeekday; i += 1) {
    cells.push(null);
  }

  for (let day = 1; day <= totalDays; day += 1) {
    const date = new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
    const key = formatDateKey(date);
    const hours = Math.max(0, (dailyReadingMsByDate[key] || 0) / (1000 * 60 * 60));
    cells.push({ day, tier: getReadingTier(hours) });
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return cells;
};

const formatMonthDay = (date: Date) =>
  `${`${date.getMonth() + 1}`.padStart(2, '0')}/${`${date.getDate()}`.padStart(2, '0')}`;

const formatDateText = (timestamp: number) => {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatChineseDate = (date: Date) => `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;

const buildStickyNoteHistoryKey = (personaId: string | null, characterId: string | null) =>
  `persona:${personaId || 'none'}::character:${characterId || 'none'}`;

const buildStickyNoteCacheKey = (historyKey: string, dateKey: string) => `${historyKey}::${dateKey}`;

const getWorldBookOrderCode = (entry: WorldBookEntry) => {
  const match = `${entry.title || ''} ${entry.content || ''}`.match(/(\d+(?:\.\d+)?)/);
  if (!match) return Number.POSITIVE_INFINITY;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
};

const sortWorldBookEntriesByCode = (entries: WorldBookEntry[]) =>
  entries
    .map((entry, index) => ({ entry, index, code: getWorldBookOrderCode(entry) }))
    .sort((left, right) => {
      if (left.code !== right.code) return left.code - right.code;
      return left.index - right.index;
    })
    .map((item) => item.entry);

const getStickyNoteCacheStore = (): StickyNoteCacheStore => {
  try {
    const saved = localStorage.getItem(STATS_NOTE_CACHE_STORAGE_KEY);
    if (!saved) return {};
    const parsed = JSON.parse(saved);
    if (!parsed || typeof parsed !== 'object') return {};

    const normalized: StickyNoteCacheStore = {};
    Object.entries(parsed).forEach(([key, value]) => {
      if (!key || !value || typeof value !== 'object') return;
      const content = typeof (value as StickyNoteCacheEntry).content === 'string'
        ? (value as StickyNoteCacheEntry).content.trim()
        : '';
      const updatedAt = Number((value as StickyNoteCacheEntry).updatedAt);
      if (!content) return;
      normalized[key] = {
        content,
        updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
      };
    });
    return normalized;
  } catch {
    return {};
  }
};

const saveStickyNoteCacheStore = (store: StickyNoteCacheStore) => {
  try {
    localStorage.setItem(STATS_NOTE_CACHE_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // no-op: localStorage can fail in private contexts.
  }
};

const getStickyNoteHistoryStore = (): StickyNoteHistoryStore => {
  try {
    const saved = localStorage.getItem(STATS_NOTE_HISTORY_STORAGE_KEY);
    if (!saved) return {};
    const parsed = JSON.parse(saved);
    if (!parsed || typeof parsed !== 'object') return {};

    const normalized: StickyNoteHistoryStore = {};
    Object.entries(parsed).forEach(([key, value]) => {
      if (!key || !value || typeof value !== 'object') return;
      const sourceMessages = Array.isArray((value as StickyNoteHistoryBucket).messages)
        ? (value as StickyNoteHistoryBucket).messages
        : [];
      const messages = sourceMessages
        .map((message) => {
          const sender = message?.sender === 'character' ? 'character' : message?.sender === 'user' ? 'user' : null;
          const content = typeof message?.content === 'string' ? message.content.trim() : '';
          const timestamp = Number(message?.timestamp);
          if (!sender || !content) return null;
          return {
            id: typeof message?.id === 'string' && message.id.trim() ? message.id : `${Date.now()}-${Math.random()}`,
            sender,
            content,
            timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
          };
        })
        .filter((item): item is StickyNoteHistoryMessage => Boolean(item));
      const updatedAt = Number((value as StickyNoteHistoryBucket).updatedAt);
      normalized[key] = {
        updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
        messages,
      };
    });
    return normalized;
  } catch {
    return {};
  }
};

const saveStickyNoteHistoryStore = (store: StickyNoteHistoryStore) => {
  try {
    localStorage.setItem(STATS_NOTE_HISTORY_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // no-op: localStorage can fail in private contexts.
  }
};

const extractStickyNoteContent = (raw: string) => {
  const text = raw.trim();
  if (!text) return '';

  const wrappedMatch = text.match(/<sticky_note>([\s\S]*?)<\/sticky_note>/i);
  if (wrappedMatch?.[1]) return wrappedMatch[1].trim();

  const fencedMatch = text.match(/```(?:text|markdown)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) return fencedMatch[1].trim();

  return text;
};

const normalizeStickyNoteText = (value: string) =>
  value
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const Stats: React.FC<StatsProps> = ({
  isDarkMode,
  dailyReadingMsByDate = {},
  themeColor,
  completedBookCount = 0,
  completedBookIds = [],
  completedAtByBookId = {},
  readingMsByBookId = {},
  activeCharacterNickname = DEFAULT_CHARACTER_NICKNAME,
  books = [],
  apiConfig,
  personas = [],
  activePersonaId = null,
  characters = [],
  activeCharacterId = null,
  worldBookEntries = [],
}) => {
  const containerClass = isDarkMode ? 'bg-[#2d3748] text-slate-200' : 'neu-bg text-slate-600';
  const cardClass = isDarkMode ? 'bg-[#2d3748] shadow-[6px_6px_12px_#232b39,-6px_-6px_12px_#374357]' : 'neu-flat';
  const pressedClass = isDarkMode ? 'bg-[#2d3748] shadow-[inset_3px_3px_6px_#232b39,inset_-3px_-3px_6px_#374357]' : 'neu-pressed';
  const goalSearchInputClass = isDarkMode
    ? 'bg-[#2d3748] shadow-[inset_3px_3px_6px_#232b39,inset_-3px_-3px_6px_#374357]'
    : 'neu-pressed';
  const btnClass = isDarkMode
    ? 'bg-[#2d3748] shadow-[5px_5px_10px_#232b39,-5px_-5px_10px_#374357] text-slate-200'
    : 'neu-btn';
  const headingClass = isDarkMode ? 'text-slate-200' : 'text-slate-700';
  const axisTextColor = isDarkMode ? '#94a3b8' : '#64748b';
  const [weekOffset, setWeekOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  const [chartWidth, setChartWidth] = useState(0);
  const [weekSlideClass, setWeekSlideClass] = useState('');
  const [monthSlideClass, setMonthSlideClass] = useState('');
  const [pressedCard, setPressedCard] = useState<SummaryCardKey | null>(null);
  const [openCardModal, setOpenCardModal] = useState<SummaryCardKey | null>(null);
  const [goalBookSearchKeyword, setGoalBookSearchKeyword] = useState('');
  const [stickyNoteContent, setStickyNoteContent] = useState('');
  const [isStickyNoteLoading, setIsStickyNoteLoading] = useState(false);
  const [stickyNoteError, setStickyNoteError] = useState('');
  const [stickyNoteDate, setStickyNoteDate] = useState(() => new Date());
  const [stickyNoteReloadNonce, setStickyNoteReloadNonce] = useState(0);
  const [goalBookIds, setGoalBookIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(GOAL_BOOK_IDS_STORAGE_KEY);
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return [];
      const unique = new Set<string>();
      parsed.forEach((item) => {
        if (typeof item === 'string' && item.trim()) unique.add(item);
      });
      return Array.from(unique);
    } catch {
      return [];
    }
  });
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const weekPointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const monthPointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const cardTouchStartRef = useRef<{ cardKey: SummaryCardKey; x: number; y: number } | null>(null);
  const weekTouchGestureRef = useRef<TouchGestureState | null>(null);
  const monthTouchGestureRef = useRef<TouchGestureState | null>(null);
  const stickyNoteRequestRef = useRef(0);
  const handledStickyNoteReloadNonceRef = useRef(0);
  const now = useMemo(() => new Date(), []);
  const todayDateKey = useMemo(() => formatDateKey(now), [now]);
  const durationAccentColor = useMemo(() => resolveModeAccentColor('#7DA0F2', isDarkMode), [isDarkMode]);
  const completedAccentColor = useMemo(() => resolveModeAccentColor('#A7DCBD', isDarkMode), [isDarkMode]);
  const goalAccentColor = useMemo(() => resolveModeAccentColor('#8B7AB8', isDarkMode), [isDarkMode]);
  const modalMetaAccentColor = useMemo(
    () => resolveModeAccentColor(normalizeHexColor(themeColor), isDarkMode),
    [themeColor, isDarkMode]
  );
  const totalCompletedBookCount = useMemo(
    () => Math.max(completedBookCount, completedBookIds.length),
    [completedBookCount, completedBookIds]
  );
  const normalizedCharacterNickname = activeCharacterNickname.trim() || DEFAULT_CHARACTER_NICKNAME;
  const activePersona = useMemo(
    () => personas.find((persona) => persona.id === activePersonaId) || null,
    [personas, activePersonaId]
  );
  const activeCharacter = useMemo(
    () => characters.find((character) => character.id === activeCharacterId) || null,
    [characters, activeCharacterId]
  );
  const stickyNoteHistoryKey = useMemo(
    () => buildStickyNoteHistoryKey(activePersonaId, activeCharacterId),
    [activePersonaId, activeCharacterId]
  );
  const stickyNoteDateKey = useMemo(() => formatDateKey(stickyNoteDate), [stickyNoteDate]);
  const stickyNoteDateText = useMemo(() => formatChineseDate(stickyNoteDate), [stickyNoteDate]);
  const stickyNoteCacheKey = useMemo(
    () => buildStickyNoteCacheKey(stickyNoteHistoryKey, stickyNoteDateKey),
    [stickyNoteHistoryKey, stickyNoteDateKey]
  );
  const characterWorldBookEntries = useMemo(() => {
    const boundCategories = new Set(
      (activeCharacter?.boundWorldBookCategories || [])
        .map((category) => category.trim())
        .filter(Boolean)
    );

    if (boundCategories.size === 0) {
      return { before: [] as WorldBookEntry[], after: [] as WorldBookEntry[] };
    }

    const scopedEntries = worldBookEntries.filter((entry) => boundCategories.has(entry.category));
    return {
      before: sortWorldBookEntriesByCode(scopedEntries.filter((entry) => entry.insertPosition === 'BEFORE')),
      after: sortWorldBookEntriesByCode(scopedEntries.filter((entry) => entry.insertPosition === 'AFTER')),
    };
  }, [activeCharacter, worldBookEntries]);
  const booksById = useMemo(() => {
    const next = new Map<string, StatsBook>();
    books.forEach((book) => {
      next.set(book.id, book);
    });
    return next;
  }, [books]);

  useEffect(() => {
    const historyStore = getStickyNoteHistoryStore();
    if (historyStore[stickyNoteHistoryKey]) return;

    historyStore[stickyNoteHistoryKey] = {
      updatedAt: Date.now(),
      messages: [],
    };
    saveStickyNoteHistoryStore(historyStore);
  }, [stickyNoteHistoryKey]);

  useEffect(() => {
    try {
      localStorage.setItem(GOAL_BOOK_IDS_STORAGE_KEY, JSON.stringify(goalBookIds));
    } catch {
      // no-op: localStorage may be unavailable in some contexts.
    }
  }, [goalBookIds]);

  useEffect(() => {
    if (books.length === 0) {
      setGoalBookIds((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    const validBookIds = new Set(books.map((book) => book.id));
    setGoalBookIds((prev) => {
      const next = prev.filter((id) => validBookIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [books]);

  useEffect(() => {
    const element = chartContainerRef.current;
    if (!element) return;

    const measure = () => {
      const nextWidth = Math.floor(element.clientWidth);
      setChartWidth(nextWidth > 0 ? nextWidth : 0);
    };

    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    window.addEventListener('resize', measure);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const baseColor = useMemo(() => hexToRgb(normalizeHexColor(themeColor)), [themeColor]);
  const colorPalette = useMemo(() => {
    const tier1 = isDarkMode ? mixRgb(baseColor, { r: 255, g: 255, b: 255 }, 0.45) : mixRgb(baseColor, { r: 255, g: 255, b: 255 }, 0.72);
    const tier2 = isDarkMode ? mixRgb(baseColor, { r: 255, g: 255, b: 255 }, 0.2) : mixRgb(baseColor, { r: 255, g: 255, b: 255 }, 0.46);
    const tier3 = isDarkMode ? mixRgb(baseColor, { r: 0, g: 0, b: 0 }, 0.08) : baseColor;
    return {
      tier1: rgbToCss(tier1),
      tier2: rgbToCss(tier2),
      tier3: rgbToCss(tier3),
    };
  }, [baseColor, isDarkMode]);

  const resolveTierColor = (tier: ReadingTier) => {
    if (tier === 1) return colorPalette.tier1;
    if (tier === 2) return colorPalette.tier2;
    if (tier === 3) return colorPalette.tier3;
    return 'transparent';
  };

  const resolveCalendarCellStyle = (tier: ReadingTier): React.CSSProperties | undefined => {
    if (tier === 0) return undefined;

    const baseColor = resolveTierColor(tier);
    const parsedColor = parseRgbCss(baseColor);
    if (!parsedColor) return { backgroundColor: baseColor };

    const shadowLight = mixRgb(parsedColor, { r: 255, g: 255, b: 255 }, isDarkMode ? 0.14 : 0.5);
    const shadowDark = mixRgb(parsedColor, { r: 0, g: 0, b: 0 }, isDarkMode ? 0.44 : 0.26);
    const darkAlpha = isDarkMode ? 0.92 : 0.46;
    const lightAlpha = isDarkMode ? 0.52 : 0.84;

    return {
      backgroundColor: baseColor,
      // Keep the same recessed geometry, with mode-tuned tinted shadows for natural neumorphism.
      boxShadow: `inset 3px 3px 6px ${rgbToRgba(shadowDark, darkAlpha)}, inset -3px -3px 6px ${rgbToRgba(shadowLight, lightAlpha)}`,
    };
  };

  const weekStart = useMemo(() => addDays(getWeekStartMonday(now), weekOffset * 7), [now, weekOffset]);
  const goalBookLabelById = useMemo(() => {
    const next = new Map<string, string>();
    const duplicateCounter = new Map<string, number>();

    books.forEach((book) => {
      const baseLabel = (book.title || 'Untitled Book').trim() || 'Untitled Book';
      const duplicateCount = duplicateCounter.get(baseLabel) || 0;
      duplicateCounter.set(baseLabel, duplicateCount + 1);
      const displayLabel = duplicateCount === 0 ? baseLabel : `${baseLabel} (${book.id.slice(-4)})`;
      next.set(book.id, displayLabel);
    });

    return next;
  }, [books]);
  const goalBookItems = useMemo(
    () =>
      books.map((book) => ({
        id: book.id,
        label: goalBookLabelById.get(book.id) || 'Untitled Book',
        title: (book.title || '').trim(),
        author: (book.author || '').trim(),
        tags: Array.isArray(book.tags) ? book.tags : [],
      })),
    [books, goalBookLabelById]
  );
  const normalizedGoalBookSearch = goalBookSearchKeyword.trim().toLowerCase();
  const filteredGoalBookItems = useMemo(() => {
    if (!normalizedGoalBookSearch) return goalBookItems;
    return goalBookItems.filter((book) => {
      const searchableText = [book.label, book.title, book.author, book.tags.join(' ')].join(' ').toLowerCase();
      return searchableText.includes(normalizedGoalBookSearch);
    });
  }, [goalBookItems, normalizedGoalBookSearch]);
  const toggleGoalBookSelection = (bookId: string) => {
    setGoalBookIds((prev) => (prev.includes(bookId) ? prev.filter((id) => id !== bookId) : [...prev, bookId]));
  };
  const completedBookIdSet = useMemo(() => new Set(completedBookIds), [completedBookIds]);
  const goalCompletedCount = useMemo(
    () => goalBookIds.filter((id) => completedBookIdSet.has(id)).length,
    [goalBookIds, completedBookIdSet]
  );
  const goalTotalCount = goalBookIds.length;
  const goalProgressPercent = goalTotalCount > 0 ? (goalCompletedCount / goalTotalCount) * 100 : 0;
  const recentCompletedBooks = useMemo(() => {
    const completedIdSet = new Set(completedBookIds);
    return books
      .map((book) => {
        if (!completedIdSet.has(book.id) && book.progress < 100) return null;
        const fallbackReachedAt =
          book.progress >= 100 && typeof book.lastReadAt === 'number' && Number.isFinite(book.lastReadAt)
            ? book.lastReadAt
            : 0;
        const reachedAt = completedAtByBookId[book.id] || fallbackReachedAt;
        if (!reachedAt || !Number.isFinite(reachedAt) || reachedAt <= 0) return null;
        return { book, reachedAt };
      })
      .filter((item): item is { book: StatsBook; reachedAt: number } => Boolean(item))
      .sort((a, b) => b.reachedAt - a.reachedAt)
      .slice(0, 5);
  }, [books, completedBookIds, completedAtByBookId]);
  const longestReadingBooks = useMemo(() => {
    return Object.entries(readingMsByBookId)
      .map(([bookId, readingMs]) => {
        const book = booksById.get(bookId);
        if (!book) return null;
        if (typeof readingMs !== 'number' || !Number.isFinite(readingMs) || readingMs <= 0) return null;
        return { book, readingMs };
      })
      .filter((item): item is { book: StatsBook; readingMs: number } => Boolean(item))
      .sort((a, b) => b.readingMs - a.readingMs)
      .slice(0, 5);
  }, [booksById, readingMsByBookId]);
  const modalTitleMap: Record<SummaryCardKey, string> = {
    streak: `${normalizedCharacterNickname}的便签`,
    duration: '阅读最多',
    completed: '最近读完',
    goal: '设定目标',
  };
  const consecutiveReadingDays = useMemo(() => {
    let streak = 0;
    let cursor = getDateStart(now);

    while (true) {
      const key = formatDateKey(cursor);
      const durationMs = dailyReadingMsByDate[key] || 0;
      if (durationMs <= 0) break;
      streak += 1;
      cursor = addDays(cursor, -1);
    }

    return streak;
  }, [dailyReadingMsByDate, now]);
  const cumulativeReadingHours = useMemo(() => {
    const totalMs = Object.values(dailyReadingMsByDate).reduce<number>((sum, value) => {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return sum;
      }
      return sum + value;
    }, 0);
    return totalMs / (1000 * 60 * 60);
  }, [dailyReadingMsByDate]);

  const callStickyNoteModel = async (prompt: string) => {
    const provider = apiConfig.provider;
    const endpoint = (apiConfig.endpoint || '').trim().replace(/\/+$/, '');
    const apiKey = (apiConfig.apiKey || '').trim();
    const model = (apiConfig.model || '').trim();

    if (!apiKey) {
      throw new Error('Please set API Key first.');
    }
    if (!endpoint) {
      throw new Error('Please set API Endpoint first.');
    }
    if (!model) {
      throw new Error('Please select a model first.');
    }

    if (provider === 'GEMINI') {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
      });
      return response.text || '';
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
          max_tokens: 512,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!response.ok) {
        throw new Error(`Claude API Error: ${response.status}`);
      }
      const data = await response.json();
      return data.content?.[0]?.text || '';
    }

    const response = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
      }),
    });
    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  };

  const buildStickyNotePrompt = (historyMessages: StickyNoteHistoryMessage[]) => {
    const personaName = activePersona?.name?.trim() || '未设定用户';
    const personaDescription = activePersona?.description?.trim() || '';
    const characterName = activeCharacter?.name?.trim() || '未设定角色';
    const characterDescription = activeCharacter?.description?.trim() || '（暂无角色人设描述）';

    const formatWorldBookSection = (entries: WorldBookEntry[]) => {
      if (entries.length === 0) return '';
      return entries
        .map((entry, index) => {
          const title = entry.title?.trim() || `条目 ${index + 1}`;
          const content = entry.content?.trim() || '（空）';
          const code = getWorldBookOrderCode(entry);
          const codeText = Number.isFinite(code) ? code.toString() : '-';
          return `[世界书-${index + 1} | 编码:${codeText} | 分类:${entry.category}] ${title}\n${content}`;
        })
        .join('\n\n');
    };

    const historyText = historyMessages.length === 0
      ? '（暂无可用历史消息；消息分桶框架已建立，后续可接入真实消息流）'
      : historyMessages
          .slice(-12)
          .map((message) => {
            const roleText = message.sender === 'user' ? personaName : characterName;
            return `[${roleText}] ${message.content}`;
          })
          .join('\n');

    return [
      `现在是${stickyNoteDateText}。`,
      `你是${characterName}。`,
      '',
      // 世界观与自我认知
      formatWorldBookSection(characterWorldBookEntries.before),
      characterDescription,
      formatWorldBookSection(characterWorldBookEntries.after),
      '',
      `你在意的人叫${personaName}。`,
      personaDescription ? `关于ta：${personaDescription}` : '',
      '',
      '你们最近的对话：',
      historyText,
      '',
      '---',
      '',
      `今天是${stickyNoteDateText}，你想给${personaName}留一张小便签。`,
      '像平时说话一样，随手写下你此刻最想对ta说的话——',
      '可以是惦记、叮嘱、吐槽、撒娇，什么都好。',
      '',
      '要求：',
      '- 50到100字之间',
      '- 可以分几个短句，每行一句',
      '- 只写便签本身的内容，不要加任何多余的话',
      `- 用 ${NOTE_RESPONSE_START} 和 ${NOTE_RESPONSE_END} 包裹`,
      '',
      `${NOTE_RESPONSE_START}`,
      `${NOTE_RESPONSE_END}`,
    ].filter(Boolean).join('\n');
  };

  useEffect(() => {
    if (openCardModal !== 'streak') return;
    setStickyNoteDate(new Date());
    const timer = window.setInterval(() => {
      setStickyNoteDate(new Date());
    }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, [openCardModal]);

  useEffect(() => {
    if (openCardModal !== 'streak') return;

    let cancelled = false;
    const requestId = ++stickyNoteRequestRef.current;
    const forceRegenerate = stickyNoteReloadNonce !== handledStickyNoteReloadNonceRef.current;
    handledStickyNoteReloadNonceRef.current = stickyNoteReloadNonce;

    const run = async () => {
      setIsStickyNoteLoading(true);
      setStickyNoteError('');

      const cacheStore = getStickyNoteCacheStore();
      if (!forceRegenerate) {
        const cached = cacheStore[stickyNoteCacheKey];
        if (cached?.content) {
          if (!cancelled && requestId === stickyNoteRequestRef.current) {
            setStickyNoteContent(cached.content);
            setIsStickyNoteLoading(false);
          }
          return;
        }
      }

      try {
        const historyStore = getStickyNoteHistoryStore();
        const historyBucket = historyStore[stickyNoteHistoryKey] || { updatedAt: Date.now(), messages: [] };
        if (!historyStore[stickyNoteHistoryKey]) {
          historyStore[stickyNoteHistoryKey] = historyBucket;
          saveStickyNoteHistoryStore(historyStore);
        }

        const prompt = buildStickyNotePrompt(historyBucket.messages);
        const raw = await callStickyNoteModel(prompt);
        const parsedContent = normalizeStickyNoteText(extractStickyNoteContent(raw));
        if (!parsedContent) {
          throw new Error('AI returned empty or invalid sticky-note content.');
        }

        const nextCache = { ...cacheStore, [stickyNoteCacheKey]: { content: parsedContent, updatedAt: Date.now() } };
        saveStickyNoteCacheStore(nextCache);

        if (!cancelled && requestId === stickyNoteRequestRef.current) {
          setStickyNoteContent(parsedContent);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to generate sticky note.';
        if (!cancelled && requestId === stickyNoteRequestRef.current) {
          setStickyNoteError(message);
          setStickyNoteContent('');
        }
      } finally {
        if (!cancelled && requestId === stickyNoteRequestRef.current) {
          setIsStickyNoteLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [
    openCardModal,
    stickyNoteCacheKey,
    stickyNoteHistoryKey,
    apiConfig,
    activePersona,
    activeCharacter,
    characterWorldBookEntries,
    stickyNoteDateText,
    stickyNoteReloadNonce,
  ]);

  const handleResetStickyNote = () => {
    const cacheStore = getStickyNoteCacheStore();
    if (cacheStore[stickyNoteCacheKey]) {
      const nextCacheStore = { ...cacheStore };
      delete nextCacheStore[stickyNoteCacheKey];
      saveStickyNoteCacheStore(nextCacheStore);
    }
    setStickyNoteContent('');
    setStickyNoteError('');
    setIsStickyNoteLoading(true);
    setStickyNoteReloadNonce((prev) => prev + 1);
  };

  const closeCardModal = () => {
    setOpenCardModal(null);
    setGoalBookSearchKeyword('');
    setStickyNoteError('');
  };
  const releaseCardPress = (cardKey: SummaryCardKey) => {
    setPressedCard((prev) => (prev === cardKey ? null : prev));
  };
  const getCardClassName = (cardKey: SummaryCardKey) => {
    return `${pressedCard === cardKey ? pressedClass : cardClass} p-4 flex flex-col justify-between h-28 rounded-2xl transition-all duration-100 active:scale-[0.98] border-none text-left`;
  };
  const getCardEvents = (cardKey: SummaryCardKey) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType === 'touch') return;
      setPressedCard(cardKey);
    },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType === 'touch') return;
      releaseCardPress(cardKey);
    },
    onPointerCancel: () => releaseCardPress(cardKey),
    onPointerLeave: () => releaseCardPress(cardKey),
    onTouchStart: (event: React.TouchEvent<HTMLButtonElement>) => {
      const point = event.touches[0];
      if (!point) return;
      cardTouchStartRef.current = { cardKey, x: point.clientX, y: point.clientY };
      setPressedCard(cardKey);
    },
    onTouchMove: (event: React.TouchEvent<HTMLButtonElement>) => {
      const start = cardTouchStartRef.current;
      const point = event.touches[0];
      if (!start || !point || start.cardKey !== cardKey) return;
      const movedTooFar =
        Math.abs(point.clientX - start.x) > CARD_TAP_THRESHOLD ||
        Math.abs(point.clientY - start.y) > CARD_TAP_THRESHOLD;
      if (movedTooFar) {
        cardTouchStartRef.current = null;
        releaseCardPress(cardKey);
      }
    },
    onTouchEnd: (event: React.TouchEvent<HTMLButtonElement>) => {
      const start = cardTouchStartRef.current;
      cardTouchStartRef.current = null;
      releaseCardPress(cardKey);

      const point = event.changedTouches[0];
      if (!start || !point || start.cardKey !== cardKey) return;

      const isTap =
        Math.abs(point.clientX - start.x) <= CARD_TAP_THRESHOLD &&
        Math.abs(point.clientY - start.y) <= CARD_TAP_THRESHOLD;
      if (!isTap) return;

      event.preventDefault();
      setOpenCardModal(cardKey);
    },
    onTouchCancel: () => {
      cardTouchStartRef.current = null;
      releaseCardPress(cardKey);
    },
    onClick: () => setOpenCardModal(cardKey),
  });
  const weekData = useMemo(() => {
    return WEEKDAY_LABELS.map((label, index) => {
      const date = addDays(weekStart, index);
      const key = formatDateKey(date);
      const hours = Math.max(0, (dailyReadingMsByDate[key] || 0) / (1000 * 60 * 60));
      const tier = getReadingTier(hours);
      return {
        label,
        hours,
        hoursCapped: Math.min(hours, HOURS_CAP),
        tier,
      };
    });
  }, [dailyReadingMsByDate, weekStart]);

  const weekRangeText = `${formatMonthDay(weekStart)} - ${formatMonthDay(addDays(weekStart, 6))}`;
  const monthStart = useMemo(() => addMonths(new Date(now.getFullYear(), now.getMonth(), 1), monthOffset), [monthOffset, now]);
  const monthTitle = `${monthStart.getFullYear()}年${monthStart.getMonth() + 1}月`;
  const monthCells = useMemo(() => getMonthlyCells(monthStart, dailyReadingMsByDate), [dailyReadingMsByDate, monthStart]);

  const resolveSwipe = (
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    onLeft: () => void,
    onRight: () => void
  ) => {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    if (Math.abs(deltaX) < SWIPE_TRIGGER_THRESHOLD || Math.abs(deltaX) <= Math.abs(deltaY)) return false;
    if (deltaX < 0) onLeft();
    if (deltaX > 0) onRight();
    return true;
  };

  const restartSlideAnimation = (
    setClassName: React.Dispatch<React.SetStateAction<string>>,
    className: string
  ) => {
    setClassName('');
    window.requestAnimationFrame(() => {
      setClassName(className);
    });
  };

  const shiftWeek = (direction: 'left' | 'right') => {
    if (direction === 'left') {
      setWeekOffset(prev => {
        const next = Math.min(0, prev + 1);
        if (next !== prev) restartSlideAnimation(setWeekSlideClass, 'stats-slide-left');
        return next;
      });
      return;
    }

    setWeekOffset(prev => {
      const next = prev - 1;
      restartSlideAnimation(setWeekSlideClass, 'stats-slide-right');
      return next;
    });
  };

  const shiftMonth = (direction: 'left' | 'right') => {
    if (direction === 'left') {
      setMonthOffset(prev => {
        const next = Math.min(0, prev + 1);
        if (next !== prev) restartSlideAnimation(setMonthSlideClass, 'stats-slide-left');
        return next;
      });
      return;
    }

    setMonthOffset(prev => {
      const next = prev - 1;
      restartSlideAnimation(setMonthSlideClass, 'stats-slide-right');
      return next;
    });
  };

  const beginTouchGesture = (
    touchRef: React.MutableRefObject<TouchGestureState | null>,
    event: React.TouchEvent<HTMLDivElement>
  ) => {
    const point = event.touches[0];
    if (!point) return;
    touchRef.current = { x: point.clientX, y: point.clientY, axis: null };
  };

  const moveTouchGesture = (
    touchRef: React.MutableRefObject<TouchGestureState | null>,
    event: React.TouchEvent<HTMLDivElement>
  ) => {
    const touchState = touchRef.current;
    const point = event.touches[0];
    if (!touchState || !point) return;

    const deltaX = point.clientX - touchState.x;
    const deltaY = point.clientY - touchState.y;

    if (!touchState.axis) {
      if (Math.abs(deltaX) < SWIPE_DECISION_THRESHOLD && Math.abs(deltaY) < SWIPE_DECISION_THRESHOLD) return;
      touchState.axis = Math.abs(deltaX) > Math.abs(deltaY) ? 'x' : 'y';
    }

    // Lock to horizontal swipe once determined, preventing parent vertical scrolling.
    if (touchState.axis === 'x' && event.cancelable) {
      event.preventDefault();
    }
  };

  const endTouchGesture = (
    touchRef: React.MutableRefObject<TouchGestureState | null>,
    event: React.TouchEvent<HTMLDivElement>,
    onLeft: () => void,
    onRight: () => void
  ) => {
    const touchState = touchRef.current;
    touchRef.current = null;
    if (!touchState || touchState.axis !== 'x') return;

    const point = event.changedTouches[0];
    if (!point) return;
    resolveSwipe(touchState.x, touchState.y, point.clientX, point.clientY, onLeft, onRight);
  };

  return (
    <div className={`flex-1 flex flex-col p-6 pb-28 overflow-y-auto no-scrollbar ${containerClass}`}>
      <header className="mb-6 pt-2">
        <h1 className={`text-2xl font-bold ${headingClass}`}>阅读统计</h1>
      </header>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-5 mb-8">
        <button type="button" className={getCardClassName('streak')} {...getCardEvents('streak')}>
           <div className="flex items-center gap-2 text-rose-400">
             <Flame size={20} />
             <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">连续阅读</span>
           </div>
           <div className={`text-2xl font-black ${headingClass}`}>{consecutiveReadingDays} <span className="text-sm font-normal text-slate-400">天</span></div>
        </button>
        <button type="button" className={getCardClassName('duration')} {...getCardEvents('duration')}>
           <div className="flex items-center gap-2" style={{ color: durationAccentColor }}>
             <Clock size={20} />
             <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">累计时长</span>
           </div>
           <div className={`text-2xl font-black ${headingClass}`}>{cumulativeReadingHours.toFixed(1)} <span className="text-sm font-normal text-slate-400">h</span></div>
        </button>
        <button type="button" className={getCardClassName('completed')} {...getCardEvents('completed')}>
           <div className="flex items-center gap-2" style={{ color: completedAccentColor }}>
             <BookOpen size={20} />
             <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">累计读完</span>
           </div>
           <div className={`text-2xl font-black ${headingClass}`}>{totalCompletedBookCount} <span className="text-sm font-normal text-slate-400">本</span></div>
        </button>
        <button type="button" className={getCardClassName('goal')} {...getCardEvents('goal')}>
           <div className="flex items-center gap-2" style={{ color: goalAccentColor }}>
             <Calendar size={20} />
             <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">设定目标</span>
           </div>
           <div className="mt-1 flex justify-end">
             <span className="text-sm font-normal text-slate-400">{goalCompletedCount}/{goalTotalCount}</span>
           </div>
           <div className={`w-full h-3 rounded-full overflow-hidden p-[3px] mt-2 ${pressedClass}`}>
              <div className="h-full rounded-full" style={{ backgroundColor: goalAccentColor, width: `${goalProgressPercent}%` }} />
           </div>
        </button>
      </div>

      {openCardModal && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center p-6 bg-slate-500/20 backdrop-blur-sm animate-fade-in"
            onClick={closeCardModal}
          >
            <div
              className={`${isDarkMode ? 'bg-[#2d3748] border-slate-600' : 'neu-bg border-white/50'} w-full max-w-sm h-[20rem] rounded-2xl p-6 border relative flex flex-col`}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={closeCardModal}
                className={`absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 ${btnClass}`}
              >
                <X size={16} />
              </button>

              <h3 className={`text-lg font-bold mb-5 text-center ${headingClass}`}>{modalTitleMap[openCardModal]}</h3>

              {openCardModal === 'streak' ? (
                <div className="flex-1 min-h-0 flex flex-col">
                  <div className="flex-1 min-h-0 flex items-center justify-center">
                    <div className="stats-note-wrap">
                      <span className="stats-note-tape" aria-hidden />
                      <div className="stats-note-paper">
                        {isStickyNoteLoading ? (
                          <div className="stats-note-loading" role="status" aria-live="polite">
                            <span className="stats-note-loading-text">书写中</span>
                            <span className="stats-note-loading-quill" aria-hidden>
                              <svg viewBox="0 0 121.24 122.88" xmlns="http://www.w3.org/2000/svg">
                                <path
                                  className="stats-note-quill-path"
                                  d="M10.05,96.6C6.38,105.51,1.42,113.97,0,122.88l5.13-0.44c8.1-23.56,15.4-39.4,31.23-59.21
                                    C48.24,48.39,61.13,36.58,77.66,27.2c8.8-5,20.07-10.47,30.21-11.85c2.77-0.38,5.58-0.49,8.46-0.24
                                    c-31.4,7.19-56.26,23.84-76.12,48.8C32.1,74.09,25.05,85.4,18.57,97.32l11.94,2.18l-4.97-2.47l17.78-2.83
                                    c-6.6-2.33-13.12-1.55-15.21-4.06c18.3-0.83,33.34-4.78,43.9-12.45c-3.93-0.55-8.46-1.04-10.82-2.17
                                    c17.69-5.98,27.92-16.73,40.9-26.27c-16.87,3.54-32.48,2.96-37-0.25c29.77,2.21,49-6.02,55.59-26.77
                                    c0.57-2.24,0.73-4.5,0.37-6.78C118.74,0.62,92.49-4.39,83.95,7.77c-1.71,2.43-4.12,4.66-6.11,7.48L85.97,0
                                    c-21.88,7.39-23.68,15.54-35,40.09c0.9-7.47,2.97-14.24,5.66-20.63c-27.34,10.55-36.45,37.11-37.91,59.7
                                    c-0.79-7.88,0.67-17.78,3.49-28.9c-7.98,8-13.41,17.39-11.47,30.79l-3.65-1.63l1.92,7.19l-5.46-2.59L10.05,96.6
                                    L10.05,96.6z"
                                />
                              </svg>
                            </span>
                          </div>
                        ) : (
                          <div className="stats-note-content no-scrollbar">
                            <div className="stats-note-date">{stickyNoteDateText}</div>
                            <div className="stats-note-body">{stickyNoteContent || '（暂无便签内容）'}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="pt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={handleResetStickyNote}
                      disabled={isStickyNoteLoading}
                      className={`h-8 px-3 rounded-full text-[11px] font-bold flex items-center gap-1.5 transition-all active:scale-[0.98] disabled:opacity-55 disabled:cursor-not-allowed ${btnClass} ${isDarkMode ? 'text-slate-200 hover:text-rose-300' : 'text-slate-500 hover:text-rose-500'}`}
                    >
                      <RotateCcw size={12} />
                      <span>重置便签</span>
                    </button>
                  </div>
                </div>
              ) : openCardModal === 'goal' ? (
                <div className="flex-1 min-h-0 flex flex-col">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">目标书籍 (多选)</label>
                    <span className="text-[10px] text-slate-400">{goalBookIds.length}/{books.length}</span>
                  </div>

                  <div className={`mt-3 rounded-xl px-3 py-2 flex items-center gap-2 ${goalSearchInputClass}`}>
                    <Search size={14} className="text-slate-400 flex-shrink-0" />
                    <input
                      type="text"
                      value={goalBookSearchKeyword}
                      onChange={(event) => setGoalBookSearchKeyword(event.target.value)}
                      placeholder="搜索书名 / 作者 / 标签..."
                      className={`w-full bg-transparent outline-none text-sm ${isDarkMode ? 'text-slate-200 placeholder:text-slate-500' : 'text-slate-600 placeholder:text-slate-400'}`}
                    />
                    {goalBookSearchKeyword && (
                      <button
                        type="button"
                        onClick={() => setGoalBookSearchKeyword('')}
                        className="text-slate-400 hover:text-slate-500"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  <div className={`mt-3 flex-1 min-h-0 rounded-xl p-2 overflow-y-auto no-scrollbar ${isDarkMode ? 'bg-black/20' : 'bg-slate-100/50'}`}>
                    {filteredGoalBookItems.length > 0 ? (
                      <div className="space-y-1">
                        {filteredGoalBookItems.map((book) => {
                          const isSelected = goalBookIds.includes(book.id);
                          const metaText = [book.author, book.tags.join(' / ')].filter(Boolean).join(' · ');
                          return (
                            <button
                              key={book.id}
                              type="button"
                              onClick={() => toggleGoalBookSelection(book.id)}
                              className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm transition-colors ${
                                isSelected
                                  ? 'text-rose-400 font-bold bg-rose-400/10'
                                  : isDarkMode
                                    ? 'text-slate-300 hover:bg-slate-700/70'
                                    : 'text-slate-600 hover:bg-white/80'
                              }`}
                            >
                              <div className={`w-4 h-4 rounded border flex items-center justify-center ${isSelected ? 'bg-rose-400 border-rose-400' : 'border-slate-400'}`}>
                                {isSelected && <Check size={10} className="text-white" />}
                              </div>
                              <div className="min-w-0 flex-1 text-left">
                                <div className="truncate">{book.label}</div>
                                {metaText && <div className="truncate text-[10px] font-normal text-slate-400 mt-0.5">{metaText}</div>}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="h-full flex items-center justify-center text-xs text-slate-400">
                        {books.length === 0 ? '暂无书籍' : '无符合条件的书籍'}
                      </div>
                    )}
                  </div>
                </div>
              ) : openCardModal === 'completed' ? (
                <div className={`flex-1 min-h-0 rounded-xl p-2 overflow-y-auto no-scrollbar ${isDarkMode ? 'bg-black/20' : 'bg-slate-100/50'}`}>
                  {recentCompletedBooks.length > 0 ? (
                    <div className="space-y-2">
                      {recentCompletedBooks.map((item) => (
                        <div key={item.book.id} className={`flex items-center gap-3 rounded-xl p-2 ${isDarkMode ? 'hover:bg-slate-700/60' : 'hover:bg-white/80'}`}>
                          <div className={`w-10 h-14 rounded-md overflow-hidden flex-shrink-0 ${pressedClass}`}>
                            {item.book.coverUrl ? (
                              <ResolvedImage src={item.book.coverUrl} className="w-full h-full object-cover" alt={item.book.title} />
                            ) : (
                              <div className={`w-full h-full flex items-center justify-center ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}>
                                <BookOpen size={14} className="text-slate-400" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className={`truncate text-sm font-bold ${headingClass}`}>{item.book.title}</div>
                            <div className="truncate text-[11px] text-slate-400">{item.book.author?.trim() || '未知作者'}</div>
                            <div className="text-[10px] mt-0.5" style={{ color: modalMetaAccentColor }}>
                              达成日期 {formatDateText(item.reachedAt)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="h-full flex items-center justify-center text-xs text-slate-400">暂无读完记录</div>
                  )}
                </div>
              ) : openCardModal === 'duration' ? (
                <div className={`flex-1 min-h-0 rounded-xl p-2 overflow-y-auto no-scrollbar ${isDarkMode ? 'bg-black/20' : 'bg-slate-100/50'}`}>
                  {longestReadingBooks.length > 0 ? (
                    <div className="space-y-2">
                      {longestReadingBooks.map((item) => (
                        <div key={item.book.id} className={`flex items-center gap-3 rounded-xl p-2 ${isDarkMode ? 'hover:bg-slate-700/60' : 'hover:bg-white/80'}`}>
                          <div className={`w-10 h-14 rounded-md overflow-hidden flex-shrink-0 ${pressedClass}`}>
                            {item.book.coverUrl ? (
                              <ResolvedImage src={item.book.coverUrl} className="w-full h-full object-cover" alt={item.book.title} />
                            ) : (
                              <div className={`w-full h-full flex items-center justify-center ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}>
                                <BookOpen size={14} className="text-slate-400" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className={`truncate text-sm font-bold ${headingClass}`}>{item.book.title}</div>
                            <div className="truncate text-[11px] text-slate-400">{item.book.author?.trim() || '未知作者'}</div>
                            <div className="text-[10px] mt-0.5" style={{ color: modalMetaAccentColor }}>
                              累计阅读 {(item.readingMs / (1000 * 60 * 60)).toFixed(1)}h
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="h-full flex items-center justify-center text-xs text-slate-400">暂无阅读时长记录</div>
                  )}
                </div>
              ) : (
                <div className="flex-1" />
              )}
            </div>
          </div>
        </ModalPortal>
      )}

      {stickyNoteError && (
        <ModalPortal>
          <div className="fixed inset-0 z-[130] flex items-center justify-center p-6 bg-slate-900/35 backdrop-blur-sm">
            <div
              className={`${isDarkMode ? 'bg-[#2d3748] border-slate-600 text-slate-200' : 'bg-white border-slate-200 text-slate-700'} w-full max-w-xs rounded-2xl border p-5`}
            >
              <h4 className="text-sm font-bold mb-2">便签生成失败</h4>
              <p className="text-xs leading-relaxed text-slate-500 mb-4">{stickyNoteError}</p>
              <button
                type="button"
                onClick={() => setStickyNoteError('')}
                className="w-full h-9 rounded-full bg-rose-400 text-white text-sm font-bold hover:bg-rose-500 transition-colors"
              >
                我知道了
              </button>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Chart */}
      <div
        className={`${cardClass} p-6 mb-8 rounded-2xl touch-pan-y stats-swipe-surface`}
        onPointerDown={(event) => {
          if (event.pointerType === 'touch') return;
          weekPointerStartRef.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerCancel={() => {
          weekPointerStartRef.current = null;
          weekTouchGestureRef.current = null;
        }}
        onPointerUp={(event) => {
          if (event.pointerType === 'touch') return;
          const start = weekPointerStartRef.current;
          weekPointerStartRef.current = null;
          if (!start) return;
          resolveSwipe(start.x, start.y, event.clientX, event.clientY, () => shiftWeek('left'), () => shiftWeek('right'));
        }}
        onTouchStart={(event) => beginTouchGesture(weekTouchGestureRef, event)}
        onTouchMove={(event) => moveTouchGesture(weekTouchGestureRef, event)}
        onTouchEnd={(event) => endTouchGesture(weekTouchGestureRef, event, () => shiftWeek('left'), () => shiftWeek('right'))}
        onTouchCancel={() => {
          weekTouchGestureRef.current = null;
        }}
      >
        <div className={weekSlideClass} onAnimationEnd={() => setWeekSlideClass('')}>
          <div className="mb-6 flex items-center justify-between gap-3">
            <h3 className={`text-sm font-bold ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>本周阅读时长</h3>
            <span className={`text-xs font-semibold ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>{weekRangeText}</span>
          </div>
          <div ref={chartContainerRef} className="h-52 w-full min-w-0 stats-week-chart select-none">
            {chartWidth > 0 && (
              <BarChart
                width={chartWidth}
                height={208}
                data={weekData}
                margin={{ top: 24, right: 8, left: 8, bottom: 10 }}
                accessibilityLayer={false}
              >
                <YAxis hide domain={[0, HOURS_CAP]} />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: axisTextColor }}
                  dy={10}
                />
                <Bar dataKey="hoursCapped" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                  <LabelList
                    dataKey="hours"
                    position="top"
                    offset={8}
                    fill={axisTextColor}
                    fontSize={10}
                    formatter={(value: unknown) => (typeof value === 'number' ? value.toFixed(1) : '0.0')}
                  />
                  {weekData.map((entry, index) => (
                    <Cell key={`week-cell-${index}`} fill={resolveTierColor(entry.tier)} />
                  ))}
                </Bar>
              </BarChart>
            )}
          </div>
        </div>
      </div>

      {/* Calendar */}
      <div
        className={`${cardClass} p-6 rounded-2xl touch-pan-y stats-swipe-surface`}
        onPointerDown={(event) => {
          if (event.pointerType === 'touch') return;
          monthPointerStartRef.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerCancel={() => {
          monthPointerStartRef.current = null;
          monthTouchGestureRef.current = null;
        }}
        onPointerUp={(event) => {
          if (event.pointerType === 'touch') return;
          const start = monthPointerStartRef.current;
          monthPointerStartRef.current = null;
          if (!start) return;
          resolveSwipe(start.x, start.y, event.clientX, event.clientY, () => shiftMonth('left'), () => shiftMonth('right'));
        }}
        onTouchStart={(event) => beginTouchGesture(monthTouchGestureRef, event)}
        onTouchMove={(event) => moveTouchGesture(monthTouchGestureRef, event)}
        onTouchEnd={(event) => endTouchGesture(monthTouchGestureRef, event, () => shiftMonth('left'), () => shiftMonth('right'))}
        onTouchCancel={() => {
          monthTouchGestureRef.current = null;
        }}
      >
        <div className={monthSlideClass} onAnimationEnd={() => setMonthSlideClass('')}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className={`text-sm font-bold ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>本月阅读日历</h3>
            <span className={`text-xs font-semibold ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>{monthTitle}</span>
          </div>

          <div className="grid grid-cols-7 gap-2 mb-3">
            {CALENDAR_WEEKDAYS.map(day => (
              <div
                key={day}
                className="text-center text-[10px] font-normal leading-none"
                style={{ color: axisTextColor }}
              >
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-3">
            {monthCells.map((cell, index) => {
              if (!cell) {
                return <div key={`blank-${index}`} className="aspect-square" />;
              }

              const cellDateKey = formatDateKey(new Date(monthStart.getFullYear(), monthStart.getMonth(), cell.day));
              const isTodayCell = cellDateKey === todayDateKey;

              return (
                <div
                  key={`day-${index}`}
                  className={`aspect-square rounded-lg ${pressedClass} relative flex items-center justify-center`}
                  style={resolveCalendarCellStyle(cell.tier)}
                >
                  <span className="relative z-[1] inline-flex items-center justify-center text-[10px] font-normal leading-none" style={{ color: axisTextColor }}>
                    {cell.day}
                    {isTodayCell && (
                      <span
                        className="absolute left-1/2 top-full mt-[2px] -translate-x-1/2 block w-[3px] h-[3px] rounded-full"
                        style={{ backgroundColor: axisTextColor }}
                        aria-hidden
                      />
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Stats;


