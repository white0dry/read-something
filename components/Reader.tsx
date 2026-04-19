import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlignCenter,
  AlignJustify,
  AlignLeft,
  ArrowLeft,
  Bookmark,
  Check,
  ChevronDown,
  Copy,
  Highlighter,
  List as ListIcon,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';
import {
  AppSettings,
  ApiConfig,
  ApiPreset,
  Book,
  Chapter,
  RagApiConfigResolver,
  ReaderAiUnderlineRange,
  ReaderBookmarkState,
  ReaderBookState,
  ReaderFontState,
  ReaderHighlightRange,
  ReaderPositionState,
  ReaderSessionSnapshot,
  ReaderVocabularyEntry,
  TtsConfig,
  TtsPlaybackState,
} from '../types';
import { Character, Persona, WorldBookEntry } from './settings/types';
import { TtsPlaybackController, TtsPlaybackCallbacks, buildTtsChunks } from '../utils/ttsPlaybackController';
import { validateTtsConfig } from '../utils/ttsEngine';
import { clearBookTtsAudio, deleteTtsAudio, getChapterCachedChunkTexts } from '../utils/ttsAudioStorage';
import { exportCachedTtsAudiobookZip } from '../utils/ttsAudiobookExport';
import type { TtsPreset, TtsChunk } from '../types';
import { getBookContent, saveBookReaderState } from '../utils/bookContentStorage';
import { buildConversationKey, persistConversationBucket, readConversationBucket } from '../utils/readerChatRuntime';
import { getImageBlobByRef, isImageRef } from '../utils/imageStorage';
import { resolveVisibleReaderTextRange, resolveFullViewportTextRange } from '../utils/readerVisibleRange';
import ReaderMessagePanel from './ReaderMessagePanel';
import ResolvedImage from './ResolvedImage';
import {
  splitReaderParagraphs,
  resolveLeadingDuplicateTitleParagraphCount,
  dropLeadingDuplicateTitleParagraph,
  normalizeReaderLayoutText,
} from '../utils/readerTextNormalize';
import { PRESET_HIGHLIGHT_COLORS, resolveHighlightItems, buildPositionFromHighlight } from '../utils/highlightUtils';
import type { ResolvedHighlightItem } from '../utils/highlightUtils';
import { ensureLexiconEntryFromReaderTerm, enrichLexiconEntry } from '../utils/vocabularyLexiconStorage';

interface ReaderProps {
  onBack: (snapshot?: ReaderSessionSnapshot) => void;
  isDarkMode: boolean;
  activeBook: Book | null;
  appSettings: AppSettings;
  setAppSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  apiConfig: ApiConfig;
  apiPresets: ApiPreset[];
  personas: Persona[];
  activePersonaId: string | null;
  onSelectPersona: (personaId: string | null) => void;
  characters: Character[];
  activeCharacterId: string | null;
  onSelectCharacter: (characterId: string | null) => void;
  worldBookEntries: WorldBookEntry[];
  safeAreaTop?: number;
  safeAreaBottom?: number;
  ragIndexingState?: {
    active: boolean;
    stage: 'model' | 'index';
    progress: number;
  } | null;
  ragApiConfigResolver?: RagApiConfigResolver;
  ttsConfig?: TtsConfig;
  ttsPresets?: TtsPreset[];
  setTtsConfig?: (config: TtsConfig) => void;
  pendingHighlightJump?: { bookId: string; chapterIndex: number | null; charOffset: number } | null;
  onClearPendingHighlightJump?: () => void;
}

type ScrollTarget = 'top' | 'bottom';
type ChapterSwitchDirection = 'next' | 'prev';
type FloatingPanel = 'none' | 'toc' | 'highlighter' | 'typography';
type TocPanelTab = 'toc' | 'bookmarks' | 'highlights';

interface RgbValue {
  r: number;
  g: number;
  b: number;
}

type TextHighlightRange = ReaderHighlightRange;
type TextAiUnderlineRange = ReaderAiUnderlineRange;
type ReaderBookmark = ReaderBookmarkState;
type ReaderVocabulary = ReaderVocabularyEntry;

interface ParagraphMeta {
  text: string;
  start: number;
  end: number;
}

interface ParagraphSegment {
  start: number;
  end: number;
  text: string;
  color?: string;
  hasAiUnderline?: boolean;
}

interface ReaderRenderParagraphItem {
  type: 'paragraph';
  key: string;
  paragraphIndex: number;
}

interface ReaderRenderImageItem {
  type: 'image';
  key: string;
  imageRef: string;
  alt?: string;
  title?: string;
  width?: number;
  height?: number;
}

type ReaderRenderItem = ReaderRenderParagraphItem | ReaderRenderImageItem;

interface ReaderTypographyStyle {
  fontSizePx: number;
  lineHeight: number;
  textColor: string;
  backgroundColor: string;
  textAlign: ReaderTextAlign;
}

interface ReaderFontOption {
  id: string;
  label: string;
  family: string;
  sourceType: 'default' | 'css' | 'font';
  sourceUrl?: string;
}

type TypographyColorKind = 'textColor' | 'backgroundColor';
type ReaderTextAlign = 'left' | 'center' | 'justify';

type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

const FLOATING_PANEL_TRANSITION_MS = 220;
const HIGHIGHTER_CLICK_DELAY_MS = 220;
const TYPOGRAPHY_COLOR_EDITOR_TRANSITION_MS = 180;
const READER_APPEARANCE_STORAGE_KEY = 'app_reader_appearance';
const READER_IMAGE_DIMENSION_CACHE_STORAGE_KEY = 'app_reader_image_dimension_cache_v1';
const DEFAULT_HIGHLIGHT_COLOR = '#FFE066';
// PRESET_HIGHLIGHT_COLORS is imported from ../utils/highlightUtils
const PRESET_TEXT_COLORS = ['#1E293B', '#334155', '#475569', '#0F172A', '#9F1239', '#164E63'];
const PRESET_BACKGROUND_COLORS = ['#F0F2F5', '#FFF7E8', '#F2FCEB', '#EAF5FF', '#1A202C', '#0F172A'];
const SYSTEM_READER_FONT_ID = 'reader-font-system-default';
const SERIF_READER_FONT_ID = 'reader-font-serif-default';
const DEFAULT_READER_FONT_ID = SYSTEM_READER_FONT_ID;
const BOOKMARK_NAME_MAX_LENGTH = 40;
const VOCAB_TERM_MAX_LENGTH = 80;
const VOCAB_TOAST_MS = 1800;
const RESTORE_LAYOUT_MIN_STABLE_TEXT_ONLY_MS = 420;
const RESTORE_LAYOUT_MIN_STABLE_WITH_MEDIA_MS = 900;
const RESTORE_TARGET_STABLE_PASSES_TEXT_ONLY = 2;
const RESTORE_TARGET_STABLE_PASSES_WITH_MEDIA = 3;
const RESTORE_SCROLL_HEIGHT_STABLE_PASSES_TEXT_ONLY = 2;
const RESTORE_SCROLL_HEIGHT_STABLE_PASSES_WITH_MEDIA = 4;
const RESTORE_MEDIA_SETTLE_DELAY_WITH_MEDIA_MS = 110;
const RESTORE_RETRY_INTERVAL_MS = 60;
const RESTORE_HARD_TIMEOUT_MS = 6200;
const RESTORE_MASK_VISUAL_READY_MAX_WAIT_MS = 2800;
const READER_TEXT_ALIGN_OPTIONS: Array<{ value: ReaderTextAlign; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { value: 'left', label: '\u5c45\u5de6', icon: AlignLeft },
  { value: 'center', label: '\u5c45\u4e2d', icon: AlignCenter },
  { value: 'justify', label: '\u4e24\u7aef', icon: AlignJustify },
];
const DEFAULT_READER_FONT_OPTIONS: ReaderFontOption[] = [
  {
    id: SYSTEM_READER_FONT_ID,
    label: '系统默认',
    family: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    sourceType: 'default',
  },
  {
    id: SERIF_READER_FONT_ID,
    label: '思源宋体（衬线）',
    family: '"Iowan Old Style", "Palatino Linotype", "Times New Roman", "Noto Serif CJK", serif',
    sourceType: 'css',
    sourceUrl: 'https://fontsapi.zeoseven.com/285/main/result.css',
  },
  {
    id: 'reader-font-sans-default',
    label: '思源黑体（无衬线）',
    family: '"Segoe UI", "Helvetica Neue", Arial, "Noto Sans CJK", sans-serif',
    sourceType: 'css',
    sourceUrl: 'https://fontsapi.zeoseven.com/69/main/result.css',
  },
  {
    id: 'reader-font-mono-default',
    label: 'JetBrains Maple Mono（等宽）',
    family: '"JetBrains Maple Mono", monospace',
    sourceType: 'css',
    sourceUrl: 'https://fontsapi.zeoseven.com/521/main/result.css',
  },
];
const BUILTIN_READER_FONT_ID_SET = new Set(DEFAULT_READER_FONT_OPTIONS.map((option) => option.id));
const IMAGE_DIMENSION_CACHE = new Map<string, { width: number; height: number }>();
const MAX_IMAGE_DIMENSION_CACHE_ENTRIES = 2000;

const hydrateImageDimensionCacheFromStorage = () => {
  try {
    const raw = localStorage.getItem(READER_IMAGE_DIMENSION_CACHE_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, { width?: unknown; height?: unknown }>;
    if (!parsed || typeof parsed !== 'object') return;
    Object.entries(parsed).forEach(([key, value]) => {
      if (!key) return;
      const width = Number(value?.width);
      const height = Number(value?.height);
      if (!Number.isFinite(width) || !Number.isFinite(height)) return;
      if (width <= 0 || height <= 0) return;
      IMAGE_DIMENSION_CACHE.set(key, { width: Math.round(width), height: Math.round(height) });
    });
  } catch {
    // Ignore malformed cache payload.
  }
};

const persistImageDimensionCacheToStorage = () => {
  try {
    const entries = Array.from(IMAGE_DIMENSION_CACHE.entries());
    const trimmed = entries.slice(Math.max(0, entries.length - MAX_IMAGE_DIMENSION_CACHE_ENTRIES));
    const payload = Object.fromEntries(trimmed);
    localStorage.setItem(READER_IMAGE_DIMENSION_CACHE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore quota/storage write failures.
  }
};

const isSameHexColor = (left: string, right: string) => left.trim().toUpperCase() === right.trim().toUpperCase();

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const ENGLISH_LETTER_REGEX = /[A-Za-z]/;
const WHITESPACE_REGEX = /\s/;
const isEnglishLetter = (char: string | undefined) => !!char && ENGLISH_LETTER_REGEX.test(char);
const isWhitespaceChar = (char: string | undefined) => !char || WHITESPACE_REGEX.test(char);
const isValidReaderTextAlign = (value: unknown): value is ReaderTextAlign =>
  value === 'left' || value === 'center' || value === 'justify';
const normalizeReaderTextAlign = (value: unknown, fallback: ReaderTextAlign): ReaderTextAlign => {
  if (isValidReaderTextAlign(value)) return value;
  if (value === 'right') return 'justify';
  return fallback;
};

const hexToRgb = (hex: string): RgbValue => {
  const normalized = hex.replace('#', '');
  if (!/^[\da-fA-F]{6}$/.test(normalized)) {
    return { r: 255, g: 224, b: 102 };
  }
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
};

const rgbToHex = ({ r, g, b }: RgbValue) =>
  `#${[r, g, b].map(v => clamp(v, 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

const resolveHighlightBackgroundColor = (hex: string, isDarkMode: boolean) => {
  if (!isDarkMode) return hex;
  const source = hexToRgb(hex);
  const darkBase: RgbValue = { r: 26, g: 32, b: 44 };

  const mixed: RgbValue = {
    r: Math.round(source.r * 0.38 + darkBase.r * 0.62),
    g: Math.round(source.g * 0.38 + darkBase.g * 0.62),
    b: Math.round(source.b * 0.38 + darkBase.b * 0.62),
  };

  const luminance = 0.2126 * mixed.r + 0.7152 * mixed.g + 0.0722 * mixed.b;
  const targetLuminance = 112;
  if (luminance > targetLuminance) {
    const factor = targetLuminance / luminance;
    mixed.r = Math.round(clamp(mixed.r * factor, 0, 255));
    mixed.g = Math.round(clamp(mixed.g * factor, 0, 255));
    mixed.b = Math.round(clamp(mixed.b * factor, 0, 255));
  }

  return `rgba(${mixed.r}, ${mixed.g}, ${mixed.b}, 0.86)`;
};

const normalizeHexInput = (raw: string) => {
  const cleaned = raw.replace(/[^#0-9a-fA-F]/g, '').replace(/#/g, '');
  return `#${cleaned.slice(0, 6).toUpperCase()}`;
};

const isValidHexColor = (value: string) => /^#[0-9A-F]{6}$/.test(value);

const getDefaultReaderTypography = (darkMode: boolean): ReaderTypographyStyle => ({
  fontSizePx: 19,
  lineHeight: 1.95,
  textColor: darkMode ? '#CBD5E1' : '#1E293B',
  backgroundColor: darkMode ? '#1A202C' : '#F0F2F5',
  textAlign: 'left',
});

const sanitizeFontFamily = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.replace(/["'`<>]/g, '').slice(0, 48);
};

const normalizeStoredFontFamily = (family: string) => {
  const cleaned = family.trim();
  if (!cleaned) return '';
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    return cleaned.slice(1, -1);
  }
  if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
    return cleaned.slice(1, -1);
  }
  return sanitizeFontFamily(cleaned.split(',')[0] || cleaned);
};

const isValidFontSourceType = (value: unknown): value is 'css' | 'font' => value === 'css' || value === 'font';

const normalizeReaderPosition = (value: ReaderBookState['readingPosition']): ReaderPositionState | null => {
  if (!value || typeof value !== 'object') return null;

  const chapterIndex =
    value.chapterIndex === null
      ? null
      : typeof value.chapterIndex === 'number' && Number.isFinite(value.chapterIndex)
      ? Math.max(0, Math.floor(value.chapterIndex))
      : null;

  return {
    chapterIndex,
    chapterCharOffset:
      typeof value.chapterCharOffset === 'number' && Number.isFinite(value.chapterCharOffset)
        ? Math.max(0, Math.floor(value.chapterCharOffset))
        : 0,
    globalCharOffset:
      typeof value.globalCharOffset === 'number' && Number.isFinite(value.globalCharOffset)
        ? Math.max(0, Math.floor(value.globalCharOffset))
        : 0,
    scrollRatio:
      typeof value.scrollRatio === 'number' && Number.isFinite(value.scrollRatio)
        ? clamp(value.scrollRatio, 0, 1)
        : 0,
    totalLength:
      typeof value.totalLength === 'number' && Number.isFinite(value.totalLength)
        ? Math.max(0, Math.floor(value.totalLength))
        : 0,
    updatedAt:
      typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? Math.floor(value.updatedAt) : Date.now(),
  };
};

const createReaderBookmarkId = () => `reader-bookmark-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const sanitizeBookmarkName = (raw: string, fallback: string) => {
  const compacted = raw.replace(/\s+/g, ' ').trim();
  const candidate = compacted || fallback;
  return candidate.slice(0, BOOKMARK_NAME_MAX_LENGTH);
};

const escapeRegExp = (raw: string) => raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const sortReaderBookmarks = (source: ReaderBookmark[]) =>
  [...source].sort((left, right) => {
    const leftOffset = left.readingPosition.globalCharOffset;
    const rightOffset = right.readingPosition.globalCharOffset;
    if (leftOffset !== rightOffset) return leftOffset - rightOffset;
    return left.createdAt - right.createdAt;
  });

const normalizeReaderBookmark = (value: unknown): ReaderBookmark | null => {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<ReaderBookmark>;
  const id = typeof source.id === 'string' ? source.id.trim() : '';
  const readingPosition = normalizeReaderPosition(source.readingPosition as ReaderBookState['readingPosition']);
  if (!id || !readingPosition) return null;
  const createdAtRaw = Number(source.createdAt);
  const createdAt =
    Number.isFinite(createdAtRaw) && createdAtRaw > 0 ? Math.floor(createdAtRaw) : Math.max(1, readingPosition.updatedAt || Date.now());
  const fallbackName = '\u672a\u547d\u540d\u4e66\u7b7e';
  const name = sanitizeBookmarkName(typeof source.name === 'string' ? source.name : '', fallbackName);
  return {
    id,
    name,
    readingPosition,
    createdAt,
  };
};

const normalizeReaderBookmarks = (value: ReaderBookState['bookmarks']): ReaderBookmark[] => {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map((item) => normalizeReaderBookmark(item))
    .filter((item): item is ReaderBookmark => Boolean(item));
  return sortReaderBookmarks(normalized);
};

const createReaderVocabularyId = () => `reader-vocab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const sanitizeVocabularyTerm = (raw: string) =>
  raw
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'“”‘’`~!@#$%^&*()_+\-=\[\]{};:,.<>/?|\\]+/, '')
    .replace(/[\s"'“”‘’`~!@#$%^&*()_+\-=\[\]{};:,.<>/?|\\]+$/, '')
    .trim()
    .slice(0, VOCAB_TERM_MAX_LENGTH);

const normalizeVocabularyKey = (raw: string) => sanitizeVocabularyTerm(raw).toLowerCase();

const normalizeReaderVocabularyEntry = (value: unknown): ReaderVocabulary | null => {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<ReaderVocabulary>;
  const term = sanitizeVocabularyTerm(typeof source.term === 'string' ? source.term : '');
  if (!term) return null;
  const normalizedTerm = normalizeVocabularyKey(source.normalizedTerm || term);
  const id = typeof source.id === 'string' && source.id.trim() ? source.id.trim() : createReaderVocabularyId();
  return {
    id,
    term,
    normalizedTerm,
  };
};

const normalizeReaderVocabularyEntries = (value: ReaderBookState['vocabularyEntries']): ReaderVocabulary[] => {
  if (!Array.isArray(value)) return [];
  const deduped: ReaderVocabulary[] = [];
  const seen = new Set<string>();
  value.forEach((item) => {
    const normalized = normalizeReaderVocabularyEntry(item);
    if (!normalized) return;
    if (seen.has(normalized.normalizedTerm)) return;
    seen.add(normalized.normalizedTerm);
    deduped.push(normalized);
  });
  return deduped;
};

const getTotalTextLength = (chapters: Chapter[], fallbackText: string) => {
  if (chapters.length > 0) {
    return chapters.reduce((total, chapter) => total + (chapter.content?.length || 0), 0);
  }
  return fallbackText.length;
};

const getChapterStartOffset = (chapters: Chapter[], chapterIndex: number) => {
  if (chapterIndex <= 0) return 0;
  return chapters.slice(0, chapterIndex).reduce((total, chapter) => total + (chapter.content?.length || 0), 0);
};

const resolveChapterPositionFromGlobalOffset = (chapters: Chapter[], globalOffset: number) => {
  const totalLength = getTotalTextLength(chapters, '');
  const clampedOffset = clamp(Math.round(globalOffset), 0, totalLength);
  if (chapters.length === 0) {
    return { chapterIndex: null as number | null, chapterCharOffset: clampedOffset };
  }

  let cursor = 0;
  for (let index = 0; index < chapters.length; index += 1) {
    const chapterLength = chapters[index].content?.length || 0;
    const nextCursor = cursor + chapterLength;
    if (clampedOffset <= nextCursor || index === chapters.length - 1) {
      return {
        chapterIndex: index,
        chapterCharOffset: clamp(clampedOffset - cursor, 0, chapterLength),
      };
    }
    cursor = nextCursor;
  }

  const fallbackIndex = Math.max(0, chapters.length - 1);
  const fallbackLength = chapters[fallbackIndex]?.content?.length || 0;
  return {
    chapterIndex: fallbackIndex,
    chapterCharOffset: fallbackLength,
  };
};

const mergeSortedHighlightRanges = (ranges: TextHighlightRange[]) => {
  const merged: TextHighlightRange[] = [];

  ranges.forEach(range => {
    if (range.end <= range.start) return;
    if (merged.length === 0) {
      merged.push({ ...range });
      return;
    }
    const last = merged[merged.length - 1];
    if (last.color === range.color && last.end >= range.start) {
      last.end = Math.max(last.end, range.end);
      return;
    }
    merged.push({ ...range });
  });

  return merged;
};

const applyHighlightStroke = (ranges: TextHighlightRange[], stroke: TextHighlightRange) => {
  const strokeStart = Math.min(stroke.start, stroke.end);
  const strokeEnd = Math.max(stroke.start, stroke.end);
  if (strokeEnd <= strokeStart) return ranges;

  const subtractStroke = (range: TextHighlightRange) => {
    if (range.end <= strokeStart || range.start >= strokeEnd) return [{ ...range }];
    const pieces: TextHighlightRange[] = [];
    if (range.start < strokeStart) {
      pieces.push({ ...range, end: strokeStart });
    }
    if (range.end > strokeEnd) {
      pieces.push({ ...range, start: strokeEnd });
    }
    return pieces;
  };

  const coveredSegments = ranges
    .map(range => ({
      start: Math.max(range.start, strokeStart),
      end: Math.min(range.end, strokeEnd),
    }))
    .filter(segment => segment.end > segment.start)
    .sort((a, b) => a.start - b.start);

  const mergedCovered = coveredSegments.reduce<Array<{ start: number; end: number }>>((acc, segment) => {
    if (acc.length === 0) {
      acc.push({ ...segment });
      return acc;
    }
    const last = acc[acc.length - 1];
    if (segment.start <= last.end) {
      last.end = Math.max(last.end, segment.end);
      return acc;
    }
    acc.push({ ...segment });
    return acc;
  }, []);

  const coveredLength = mergedCovered.reduce((sum, segment) => sum + (segment.end - segment.start), 0);
  const strokeLength = strokeEnd - strokeStart;
  const isEraseIntent = coveredLength >= strokeLength;

  const trimmed = ranges.flatMap(subtractStroke);
  if (isEraseIntent) {
    return mergeSortedHighlightRanges(trimmed.sort((a, b) => a.start - b.start));
  }

  const mergedInput = [...trimmed, { start: strokeStart, end: strokeEnd, color: stroke.color }].sort((a, b) => a.start - b.start);
  return mergeSortedHighlightRanges(mergedInput);
};

const buildParagraphSegments = (
  paragraph: ParagraphMeta,
  highlightRanges: TextHighlightRange[],
  aiUnderlineRanges: TextAiUnderlineRange[]
) => {
  const boundaries = new Set<number>([paragraph.start, paragraph.end]);

  highlightRanges.forEach((range) => {
    if (range.end <= paragraph.start || range.start >= paragraph.end) return;
    boundaries.add(Math.max(paragraph.start, range.start));
    boundaries.add(Math.min(paragraph.end, range.end));
  });
  aiUnderlineRanges.forEach((range) => {
    if (range.end <= paragraph.start || range.start >= paragraph.end) return;
    boundaries.add(Math.max(paragraph.start, range.start));
    boundaries.add(Math.min(paragraph.end, range.end));
  });

  const orderedBoundaries = Array.from(boundaries).sort((a, b) => a - b);
  const segments: ParagraphSegment[] = [];

  for (let i = 0; i < orderedBoundaries.length - 1; i += 1) {
    const start = orderedBoundaries[i];
    const end = orderedBoundaries[i + 1];
    if (end <= start) continue;

    const text = paragraph.text.slice(start - paragraph.start, end - paragraph.start);
    if (!text) continue;

    const highlight = highlightRanges.find((range) => range.start < end && range.end > start);
    const hasAiUnderline = aiUnderlineRanges.some((range) => range.start < end && range.end > start);

    segments.push({
      start,
      end,
      text,
      color: highlight?.color,
      hasAiUnderline,
    });
  }

  if (segments.length === 0) {
    segments.push({
      start: paragraph.start,
      end: paragraph.end,
      text: paragraph.text,
    });
  }

  return segments;
};

const resolveNodeOffsetToIndex = (node: Node, offset: number, totalLength: number) => {
  let segmentElement: HTMLElement | null = null;
  let resolvedOffset = 0;

  if (node.nodeType === Node.TEXT_NODE) {
    const textNode = node as Text;
    segmentElement = textNode.parentElement?.closest('[data-reader-segment="1"]') as HTMLElement | null;
    resolvedOffset = clamp(offset, 0, textNode.data.length);
  } else if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as HTMLElement;
    segmentElement = element.closest('[data-reader-segment="1"]') as HTMLElement | null;
    if (segmentElement) {
      const textLength = segmentElement.textContent?.length ?? 0;
      resolvedOffset = offset <= 0 ? 0 : textLength;
    }
  }

  if (!segmentElement) return null;
  const start = Number(segmentElement.dataset.start ?? Number.NaN);
  if (Number.isNaN(start)) return null;

  return clamp(start + resolvedOffset, 0, totalLength);
};

const resolveSegmentElementFromTarget = (target: EventTarget | null) => {
  if (!target) return null;
  if (target instanceof Text) {
    return target.parentElement?.closest('[data-reader-segment="1"]') as HTMLElement | null;
  }
  if (target instanceof HTMLElement) {
    return target.closest('[data-reader-segment="1"]') as HTMLElement | null;
  }
  return null;
};

const resolveSegmentStart = (segmentElement: HTMLElement | null) => {
  if (!segmentElement) return null;
  const start = Number(segmentElement.dataset.start ?? Number.NaN);
  if (Number.isNaN(start)) return null;
  return start;
};

type PointerCaptureElement = Element & {
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
  hasPointerCapture?: (pointerId: number) => boolean;
};

const safeSetPointerCapture = (element: PointerCaptureElement, pointerId: number) => {
  if (typeof element.setPointerCapture !== 'function') return false;
  try {
    element.setPointerCapture(pointerId);
    return true;
  } catch {
    return false;
  }
};

const safeReleasePointerCapture = (element: PointerCaptureElement, pointerId: number) => {
  if (typeof element.hasPointerCapture !== 'function' || typeof element.releasePointerCapture !== 'function') return false;
  try {
    if (element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
    return true;
  } catch {
    return false;
  }
};

const HighlightChapterDropdown = ({
  value,
  options,
  onChange,
  isDarkMode,
}: {
  value: string | null;
  options: { value: string; label: string }[];
  onChange: (val: string | null) => void;
  isDarkMode: boolean;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClose = () => {
    if (!isOpen || isClosing) return;
    setIsClosing(true);
    setTimeout(() => { setIsOpen(false); setIsClosing(false); }, 200);
  };

  const handleToggle = () => {
    if (isOpen) { handleClose(); } else { setIsOpen(true); }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        handleClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, isClosing]);

  const selectedLabel = value
    ? options.find(o => o.value === value)?.label || value
    : '\u6240\u6709\u7ae0\u8282';

  return (
    <div className="relative" ref={containerRef}>
      <div
        onClick={handleToggle}
        className={`w-full h-8 rounded-xl flex items-center justify-between cursor-pointer px-2.5 text-[11px] font-medium transition-all active:scale-[0.99] ${
          isDarkMode ? 'bg-[#1a202c] text-slate-300' : 'neu-pressed text-slate-600'
        }`}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown size={13} className={`opacity-50 transition-transform duration-200 ${isOpen && !isClosing ? 'rotate-180' : ''}`} />
      </div>
      {(isOpen || isClosing) && (
        <div className={`absolute top-full left-0 right-0 mt-1 p-1 rounded-xl z-10 max-h-32 overflow-y-auto border border-slate-400/10 shadow-lg ${
          isDarkMode ? 'bg-[#2d3748]' : 'bg-[#e0e5ec]'
        } ${isClosing ? 'reader-flyout-exit' : 'reader-flyout-enter'}`}>
          <div
            onClick={() => { onChange(null); handleClose(); }}
            className={`px-2.5 py-1.5 rounded-lg text-[11px] cursor-pointer transition-colors ${
              !value ? 'text-rose-400 font-bold bg-rose-400/10' : isDarkMode ? 'text-slate-300 hover:bg-slate-600' : 'text-slate-600 hover:bg-black/5'
            }`}
          >{'\u6240\u6709\u7ae0\u8282'}</div>
          {options.map(opt => (
            <div
              key={opt.value}
              onClick={() => { onChange(opt.value); handleClose(); }}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] cursor-pointer transition-colors truncate ${
                value === opt.value ? 'text-rose-400 font-bold bg-rose-400/10' : isDarkMode ? 'text-slate-300 hover:bg-slate-600' : 'text-slate-600 hover:bg-black/5'
              }`}
            >{opt.label}</div>
          ))}
        </div>
      )}
    </div>
  );
};

const Reader: React.FC<ReaderProps> = ({
  onBack,
  isDarkMode,
  activeBook,
  appSettings,
  setAppSettings,
  apiConfig,
  apiPresets,
  personas,
  activePersonaId,
  onSelectPersona,
  characters,
  activeCharacterId,
  onSelectCharacter,
  worldBookEntries,
  safeAreaTop = 0,
  safeAreaBottom = 0,
  ragIndexingState = null,
  ragApiConfigResolver,
  ttsConfig,
  ttsPresets,
  setTtsConfig,
  pendingHighlightJump,
  onClearPendingHighlightJump,
}) => {
  const [activeFloatingPanel, setActiveFloatingPanel] = useState<FloatingPanel>('none');
  const [closingFloatingPanel, setClosingFloatingPanel] = useState<FloatingPanel | null>(null);
  const [isHighlightMode, setIsHighlightMode] = useState(false);
  const [isHighlighterClickPending, setIsHighlighterClickPending] = useState(false);
  const [highlightColor, setHighlightColor] = useState(DEFAULT_HIGHLIGHT_COLOR);
  const [highlightColorDraft, setHighlightColorDraft] = useState<RgbValue>(() => hexToRgb(DEFAULT_HIGHLIGHT_COLOR));
  const [highlightHexInput, setHighlightHexInput] = useState(DEFAULT_HIGHLIGHT_COLOR);
  const [highlightRangesByChapter, setHighlightRangesByChapter] = useState<Record<string, TextHighlightRange[]>>({});
  const [aiUnderlineRangesByChapter, setAiUnderlineRangesByChapter] = useState<Record<string, TextAiUnderlineRange[]>>({});
  const [bookmarks, setBookmarks] = useState<ReaderBookmark[]>([]);
  const [vocabularyEntries, setVocabularyEntries] = useState<ReaderVocabulary[]>([]);
  const [vocabularyToast, setVocabularyToast] = useState<string | null>(null);
  const [selectedBookmarkId, setSelectedBookmarkId] = useState<string | null>(null);
  const [tocPanelTab, setTocPanelTab] = useState<TocPanelTab>('toc');
  const [highlightColorFilter, setHighlightColorFilter] = useState<string | null>(null);
  const [highlightChapterFilter, setHighlightChapterFilter] = useState<string | null>(null);
  const [highlightCopyToast, setHighlightCopyToast] = useState(false);
  const highlightCopyToastTimerRef = useRef<number | null>(null);
  const [isBookmarkModalOpen, setIsBookmarkModalOpen] = useState(false);
  const [isBookmarkModalClosing, setIsBookmarkModalClosing] = useState(false);
  const [bookmarkNameDraft, setBookmarkNameDraft] = useState('');
  const [pendingBookmarkPosition, setPendingBookmarkPosition] = useState<ReaderPositionState | null>(null);
  const [pendingHighlightRange, setPendingHighlightRange] = useState<TextHighlightRange | null>(null);
  const [isReaderStateHydrated, setIsReaderStateHydrated] = useState(false);
  const [hydratedBookId, setHydratedBookId] = useState<string | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [selectedChapterIndex, setSelectedChapterIndex] = useState<number | null>(null);
  const [bookText, setBookText] = useState('');
  const [isLoadingBookContent, setIsLoadingBookContent] = useState(false);
  const [readerScrollbar, setReaderScrollbar] = useState({ visible: false, height: 40 });
  const [chapterTransitionClass, setChapterTransitionClass] = useState('');
  const [readerTypography, setReaderTypography] = useState<ReaderTypographyStyle>(() => getDefaultReaderTypography(isDarkMode));
  const [readerTextColorInput, setReaderTextColorInput] = useState(() => getDefaultReaderTypography(isDarkMode).textColor);
  const [readerBgColorInput, setReaderBgColorInput] = useState(() => getDefaultReaderTypography(isDarkMode).backgroundColor);
  const [readerFontOptions, setReaderFontOptions] = useState<ReaderFontOption[]>(DEFAULT_READER_FONT_OPTIONS);
  const [selectedReaderFontId, setSelectedReaderFontId] = useState(DEFAULT_READER_FONT_ID);
  const [fontUrlInput, setFontUrlInput] = useState('');
  const [fontFamilyInput, setFontFamilyInput] = useState('');
  const [fontPanelMessage, setFontPanelMessage] = useState('');
  const [isReaderFontDropdownOpen, setIsReaderFontDropdownOpen] = useState(false);
  const [activeTypographyColorEditor, setActiveTypographyColorEditor] = useState<TypographyColorKind | null>(null);
  const [closingTypographyColorEditor, setClosingTypographyColorEditor] = useState<TypographyColorKind | null>(null);
  const [isReaderAppearanceHydrated, setIsReaderAppearanceHydrated] = useState(false);
  const [isMoreSettingsOpen, setIsMoreSettingsOpen] = useState(false);
  const [floatingPanelTopPx, setFloatingPanelTopPx] = useState(() => Math.max(0, safeAreaTop) + 72);
  const [, setImageDimensionTick] = useState(0);
  const [settledChapterImageKeys, setSettledChapterImageKeys] = useState<Set<string>>(new Set());
  const [isLoadingMaskVisible, setIsLoadingMaskVisible] = useState(true);

  // TTS State
  const [ttsPlaybackState, setTtsPlaybackState] = useState<TtsPlaybackState | null>(null);
  const [ttsActiveParagraphIndex, setTtsActiveParagraphIndex] = useState<number | null>(null);
  const [ttsResumePosition, setTtsResumePosition] = useState<ReaderBookState['ttsResumePosition']>(undefined);
  const [ttsRefreshingParagraphs, setTtsRefreshingParagraphs] = useState<Set<number>>(new Set());
  const [ttsPersistentCachedParagraphs, setTtsPersistentCachedParagraphs] = useState<number[]>([]);
  const [ttsAutoStartNextChapter, setTtsAutoStartNextChapter] = useState(false);
  const [ttsErrorToast, setTtsErrorToast] = useState<{ show: boolean; message: string }>({ show: false, message: '' });
  const ttsControllerRef = useRef<TtsPlaybackController | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsErrorToastTimerRef = useRef<number | null>(null);
  const vocabularyToastTimerRef = useRef<number | null>(null);
  const lastReaderSelectionRef = useRef('');
  const ttsAutoStartModeRef = useRef<'chapter_start' | 'viewport'>('chapter_start');
  const ttsAutoStartTaskIdRef = useRef(0);

  const readerRootRef = useRef<HTMLDivElement>(null);
  const readerViewportContainerRef = useRef<HTMLDivElement>(null);
  const readerScrollRef = useRef<HTMLDivElement>(null);
  const readerScrollbarTrackRef = useRef<HTMLDivElement>(null);
  const readerScrollbarThumbRef = useRef<HTMLButtonElement>(null);
  const readerArticleRef = useRef<HTMLElement>(null);
  const readerFontDropdownRef = useRef<HTMLDivElement>(null);
  const tocListRef = useRef<HTMLDivElement>(null);
  const tocItemRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const bookmarkItemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const bookmarkNameInputRef = useRef<HTMLInputElement>(null);
  const tocSwipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const chapterAutoSwitchLockRef = useRef(false);
  const lastReaderScrollTopRef = useRef(0);
  const touchStartYRef = useRef<number | null>(null);
  const touchLastYRef = useRef<number | null>(null);
  const touchSwitchHandledRef = useRef(false);
  const boundaryIntentDownRef = useRef(0);
  const boundaryIntentUpRef = useRef(0);
  const boundaryArmedDirectionRef = useRef<'next' | 'prev' | null>(null);
  const boundaryArmedAtRef = useRef(0);
  const chapterTransitionTimersRef = useRef<number[]>([]);
  const chapterTransitioningRef = useRef(false);
  const floatingPanelTimerRef = useRef<number | null>(null);
  const bookmarkModalTimerRef = useRef<number | null>(null);
  const typographyColorEditorTimerRef = useRef<number | null>(null);
  const persistReaderStateTimerRef = useRef<number | null>(null);
  const highlighterClickTimerRef = useRef<number | null>(null);
  const fontObjectUrlsRef = useRef<string[]>([]);
  const fontLinkNodesRef = useRef<HTMLLinkElement[]>([]);
  const fontCssLoadPromiseByUrlRef = useRef<Map<string, Promise<void>>>(new Map());
  const highlightDragRef = useRef<{ active: boolean; pointerId: number | null; startIndex: number | null }>({
    active: false,
    pointerId: null,
    startIndex: null,
  });
  const highlightTouchDragRef = useRef<{ active: boolean; touchId: number | null; startIndex: number | null }>({
    active: false,
    touchId: null,
    startIndex: null,
  });
  const touchPointerDragActiveRef = useRef(false);
  const pendingRestorePositionRef = useRef<ReaderPositionState | null>(null);
  const pendingRestorePassesRef = useRef(0);
  const pendingRestoreStablePassesRef = useRef(0);
  const pendingRestoreScrollHeightStablePassesRef = useRef(0);
  const pendingRestoreLastScrollHeightRef = useRef<number | null>(null);
  const pendingRestoreStartedAtRef = useRef(0);
  const pendingRestoreMediaSettledAtRef = useRef<number | null>(null);
  const pendingRestoreRetryTimerRef = useRef<number | null>(null);
  const visualRestoreGuardTimerRef = useRef<number | null>(null);
  const latestReadingPositionRef = useRef<ReaderPositionState | null>(null);
  const areChapterImagesSettledRef = useRef(true);
  const programmaticRestoreScrollRef = useRef(false);
  const readerScrollbarTopRef = useRef(0);
  const readerScrollbarTopRafRef = useRef<number | null>(null);
  const queuedReaderScrollbarTopRef = useRef<number | null>(null);
  const readerScrollRafRef = useRef<number | null>(null);
  const latestScrollTargetRef = useRef<HTMLDivElement | null>(null);
  const [, setIsVisualRestorePending] = useState(false);
  const [isRestorePositionPending, setIsRestorePositionPending] = useState(false);

  const isTocOpen = activeFloatingPanel === 'toc';
  const isHighlighterPanelOpen = activeFloatingPanel === 'highlighter';
  const isTypographyPanelOpen = activeFloatingPanel === 'typography';
  const isFloatingPanelVisible = activeFloatingPanel !== 'none';
  const conversationKey = useMemo(
    () => buildConversationKey(activeBook?.id || null, activePersonaId, activeCharacterId),
    [activeBook?.id, activePersonaId, activeCharacterId]
  );
  const sortedBookmarks = useMemo(() => sortReaderBookmarks(bookmarks), [bookmarks]);
  const resolveBookmarkChapterLabel = useCallback((position: ReaderPositionState | null | undefined) => {
    const chapterIndex = position?.chapterIndex;
    if (chapterIndex === null || chapterIndex === undefined || !Number.isFinite(chapterIndex)) {
      return '全文';
    }
    const normalizedChapterNo = Math.max(1, Math.floor(chapterIndex) + 1);
    return `第${normalizedChapterNo}章`;
  }, []);
  const buildDefaultBookmarkName = useCallback((position: ReaderPositionState | null | undefined, source: ReaderBookmark[]) => {
    const chapterLabel = resolveBookmarkChapterLabel(position);
    const labelRegex = new RegExp(`^${escapeRegExp(chapterLabel)}-(\\d+)$`);
    let maxSuffix = 0;

    source.forEach((bookmark) => {
      if (resolveBookmarkChapterLabel(bookmark.readingPosition) !== chapterLabel) return;
      const match = bookmark.name.trim().match(labelRegex);
      if (!match) return;
      const parsedSuffix = Number.parseInt(match[1], 10);
      if (Number.isFinite(parsedSuffix) && parsedSuffix > maxSuffix) {
        maxSuffix = parsedSuffix;
      }
    });

    return `${chapterLabel}-${maxSuffix + 1}`;
  }, [resolveBookmarkChapterLabel]);
  const syncFloatingPanelTop = useCallback(() => {
    const root = readerRootRef.current;
    const viewportContainer = readerViewportContainerRef.current;
    if (!root || !viewportContainer) return;
    const nextTop = Math.max(0, viewportContainer.getBoundingClientRect().top - root.getBoundingClientRect().top);
    setFloatingPanelTopPx((prev) => (Math.abs(prev - nextTop) < 0.5 ? prev : nextTop));
  }, []);

  const clearPendingRestorePosition = () => {
    pendingRestorePositionRef.current = null;
    pendingRestorePassesRef.current = 0;
    pendingRestoreStablePassesRef.current = 0;
    pendingRestoreScrollHeightStablePassesRef.current = 0;
    pendingRestoreLastScrollHeightRef.current = null;
    pendingRestoreStartedAtRef.current = 0;
    pendingRestoreMediaSettledAtRef.current = null;
    if (pendingRestoreRetryTimerRef.current) {
      window.clearTimeout(pendingRestoreRetryTimerRef.current);
      pendingRestoreRetryTimerRef.current = null;
    }
    if (visualRestoreGuardTimerRef.current) {
      window.clearTimeout(visualRestoreGuardTimerRef.current);
      visualRestoreGuardTimerRef.current = null;
    }
    setIsVisualRestorePending(false);
    setIsRestorePositionPending(false);
  };

  const queuePendingRestorePosition = (
    position: ReaderPositionState | null,
    passes = 6,
    options?: { hideDuringRestore?: boolean }
  ) => {
    if (!position) {
      clearPendingRestorePosition();
      return;
    }
    pendingRestorePositionRef.current = position;
    pendingRestorePassesRef.current = Math.max(1, Math.floor(passes));
    pendingRestoreStablePassesRef.current = 0;
    pendingRestoreScrollHeightStablePassesRef.current = 0;
    pendingRestoreLastScrollHeightRef.current = null;
    pendingRestoreStartedAtRef.current = Date.now();
    pendingRestoreMediaSettledAtRef.current = null;
    const shouldHide = Boolean(options?.hideDuringRestore);
    setIsVisualRestorePending(shouldHide);
    setIsRestorePositionPending(true);
    if (visualRestoreGuardTimerRef.current) {
      window.clearTimeout(visualRestoreGuardTimerRef.current);
      visualRestoreGuardTimerRef.current = null;
    }
    if (shouldHide) {
      visualRestoreGuardTimerRef.current = window.setTimeout(() => {
        visualRestoreGuardTimerRef.current = null;
        setIsVisualRestorePending(false);
      }, 900);
    }
  };

  const resolveRestoreTargetRatio = (position: ReaderPositionState, chapterLength: number) => {
    const ratioFromOffset = chapterLength > 0 ? position.chapterCharOffset / chapterLength : 0;
    return clamp(position.scrollRatio > 0 ? position.scrollRatio : ratioFromOffset, 0, 1);
  };

  const loadImageDimensionsFromUrl = (url: string): Promise<{ width: number; height: number } | null> =>
    new Promise((resolve) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        if (!width || !height) {
          resolve(null);
          return;
        }
        resolve({ width, height });
      };
      image.onerror = () => resolve(null);
      image.src = url;
    });

  const resolveImageDimensions = async (source: string): Promise<{ width: number; height: number } | null> => {
    const cached = IMAGE_DIMENSION_CACHE.get(source);
    if (cached) return cached;

    if (isImageRef(source)) {
      const blob = await getImageBlobByRef(source).catch(() => null);
      if (!blob) return null;

      if (typeof createImageBitmap === 'function') {
        try {
          const bitmap = await createImageBitmap(blob);
          const width = bitmap.width;
          const height = bitmap.height;
          bitmap.close();
          if (width > 0 && height > 0) {
            const dims = { width, height };
            IMAGE_DIMENSION_CACHE.set(source, dims);
            return dims;
          }
        } catch {
          // Fallback to object URL path below.
        }
      }

      const objectUrl = URL.createObjectURL(blob);
      try {
        const dims = await loadImageDimensionsFromUrl(objectUrl);
        if (dims) {
          IMAGE_DIMENSION_CACHE.set(source, dims);
        }
        return dims;
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    }

    const dims = await loadImageDimensionsFromUrl(source);
    if (dims) {
      IMAGE_DIMENSION_CACHE.set(source, dims);
    }
    return dims;
  };

  const isRestoreMediaLayoutSettled = () => {
    const article = readerArticleRef.current;
    if (!article) return true;

    const figures = Array.from(article.querySelectorAll('figure'));
    if (figures.length === 0) return true;

    const images = Array.from(article.querySelectorAll('img')) as HTMLImageElement[];
    if (images.length < figures.length) return false;
    return images.every((image) => image.complete);
  };

  const isReaderVisualContentReady = () => {
    const article = readerArticleRef.current;
    if (!article) return false;

    if ((article.textContent || '').trim().length > 0) return true;
    const images = Array.from(article.querySelectorAll('img')) as HTMLImageElement[];
    return images.some((image) => image.complete && (image.naturalWidth > 0 || image.width > 0));
  };

  const resolveClosestBookmarkIdFromList = (source: ReaderBookmark[], targetOffset: number) => {
    if (source.length === 0) return null;
    let best = source[0];
    let minGap = Math.abs(best.readingPosition.globalCharOffset - targetOffset);
    for (let i = 1; i < source.length; i += 1) {
      const item = source[i];
      const gap = Math.abs(item.readingPosition.globalCharOffset - targetOffset);
      if (gap < minGap) {
        minGap = gap;
        best = item;
      }
    }
    return best.id;
  };

  const resolveClosestBookmarkId = (targetOffset: number) => resolveClosestBookmarkIdFromList(sortedBookmarks, targetOffset);

  const chapterTextOffsets = useMemo(() => {
    if (chapters.length === 0) {
      return {
        starts: [0],
        totalLength: 0,
      };
    }

    const starts = new Array<number>(chapters.length + 1);
    starts[0] = 0;
    for (let index = 0; index < chapters.length; index += 1) {
      starts[index + 1] = starts[index] + (chapters[index].content?.length || 0);
    }

    return {
      starts,
      totalLength: starts[chapters.length],
    };
  }, [chapters]);

  const getChapterStartOffsetByIndex = useCallback(
    (chapterIndex: number) => {
      if (chapterIndex <= 0) return 0;
      const maxIndex = chapterTextOffsets.starts.length - 1;
      const safeIndex = Math.max(0, Math.min(chapterIndex, maxIndex));
      return chapterTextOffsets.starts[safeIndex] || 0;
    },
    [chapterTextOffsets.starts]
  );

  const resolveChapterPositionFromGlobalOffsetFast = useCallback(
    (globalOffset: number) => {
      const totalLength = chapters.length > 0 ? chapterTextOffsets.totalLength : bookText.length;
      const clampedOffset = clamp(Math.round(globalOffset), 0, totalLength);
      if (chapters.length === 0) {
        return { chapterIndex: null as number | null, chapterCharOffset: clampedOffset };
      }

      for (let index = 0; index < chapters.length; index += 1) {
        const chapterStart = chapterTextOffsets.starts[index] || 0;
        const chapterEnd = chapterTextOffsets.starts[index + 1] || chapterStart;
        if (clampedOffset <= chapterEnd || index === chapters.length - 1) {
          return {
            chapterIndex: index,
            chapterCharOffset: clamp(clampedOffset - chapterStart, 0, Math.max(0, chapterEnd - chapterStart)),
          };
        }
      }

      const fallbackIndex = Math.max(0, chapters.length - 1);
      const fallbackStart = chapterTextOffsets.starts[fallbackIndex] || 0;
      const fallbackEnd = chapterTextOffsets.starts[fallbackIndex + 1] || fallbackStart;
      return {
        chapterIndex: fallbackIndex,
        chapterCharOffset: clamp(clampedOffset - fallbackStart, 0, Math.max(0, fallbackEnd - fallbackStart)),
      };
    },
    [chapters, bookText.length, chapterTextOffsets]
  );

  const scheduleReaderScrollbarTop = useCallback((nextTop: number) => {
    queuedReaderScrollbarTopRef.current = nextTop;
    if (readerScrollbarTopRafRef.current !== null) return;
    readerScrollbarTopRafRef.current = window.requestAnimationFrame(() => {
      readerScrollbarTopRafRef.current = null;
      const queuedTop = queuedReaderScrollbarTopRef.current;
      if (queuedTop === null) return;
      queuedReaderScrollbarTopRef.current = null;
      if (Math.abs(readerScrollbarTopRef.current - queuedTop) < 0.2) return;
      readerScrollbarTopRef.current = queuedTop;
      const thumb = readerScrollbarThumbRef.current;
      if (thumb) {
        thumb.style.transform = `translateY(${queuedTop}px)`;
      }
    });
  }, []);

  const refreshReaderScrollbar = useCallback(() => {
    const scroller = readerScrollRef.current;
    if (!scroller) return;

    const { scrollTop, scrollHeight, clientHeight } = scroller;
    const contentScrollable = scrollHeight - clientHeight;

    if (contentScrollable <= 1) {
      readerScrollbarTopRef.current = 0;
      queuedReaderScrollbarTopRef.current = null;
      setReaderScrollbar((prev) => (prev.visible ? { ...prev, visible: false } : prev));
      return;
    }

    const trackHeight = readerScrollbarTrackRef.current?.clientHeight || Math.max(48, clientHeight - 24);
    const thumbHeight = Math.max(36, Math.min(trackHeight, (clientHeight / scrollHeight) * trackHeight));
    const trackScrollable = Math.max(1, trackHeight - thumbHeight);
    const clampedScrollTop = clamp(scrollTop, 0, contentScrollable);
    const thumbTop = clamp((clampedScrollTop / contentScrollable) * trackScrollable, 0, trackScrollable);
    scheduleReaderScrollbarTop(thumbTop);

    setReaderScrollbar((prev) => {
      const heightChanged = Math.abs(prev.height - thumbHeight) >= 0.5;
      if (prev.visible && !heightChanged) return prev;
      return {
        visible: true,
        height: thumbHeight,
      };
    });
  }, [scheduleReaderScrollbarTop]);

  const getCurrentReadingPosition = useCallback((timestamp = Date.now()): ReaderPositionState | null => {
    if (!activeBook) return null;

    const hasChapters = chapters.length > 0;
    const hasActiveChapter =
      hasChapters && selectedChapterIndex !== null && selectedChapterIndex >= 0 && selectedChapterIndex < chapters.length;
    const resolvedChapterIndex = hasActiveChapter && selectedChapterIndex !== null ? selectedChapterIndex : null;
    const chapterText = resolvedChapterIndex !== null ? chapters[resolvedChapterIndex].content || '' : bookText;
    const chapterLength = chapterText.length;

    const scroller = readerScrollRef.current;
    const hasScroller = Boolean(scroller);
    const scrollableHeight = scroller ? Math.max(0, scroller.scrollHeight - scroller.clientHeight) : 0;
    const scrollTop = scroller ? scroller.scrollTop : lastReaderScrollTopRef.current;
    const noScrollableContent = hasScroller && scrollableHeight <= 1;
    const scrollRatio = noScrollableContent
      ? (chapterLength > 0 ? 1 : 0)
      : scrollableHeight > 0
        ? clamp(scrollTop / scrollableHeight, 0, 1)
        : 0;

    const chapterCharOffset = chapterLength > 0 ? clamp(Math.round(chapterLength * scrollRatio), 0, chapterLength) : 0;
    const totalLength = chapters.length > 0 ? chapterTextOffsets.totalLength : bookText.length;
    const chapterStartOffset = resolvedChapterIndex !== null ? getChapterStartOffsetByIndex(resolvedChapterIndex) : 0;
    const globalCharOffset = clamp(chapterStartOffset + chapterCharOffset, 0, totalLength);

    return {
      chapterIndex: resolvedChapterIndex,
      chapterCharOffset,
      globalCharOffset,
      scrollRatio,
      totalLength,
      updatedAt: timestamp,
    };
  }, [activeBook, chapters, selectedChapterIndex, bookText, chapterTextOffsets.totalLength, getChapterStartOffsetByIndex]);

  const syncReadingPositionRef = useCallback((timestamp = Date.now()) => {
    const snapshot = getCurrentReadingPosition(timestamp);
    if (!snapshot) return null;
    latestReadingPositionRef.current = snapshot;
    return snapshot;
  }, [getCurrentReadingPosition]);

  const getLatestReadingPosition = useCallback(
    () => syncReadingPositionRef(Date.now()) || latestReadingPositionRef.current,
    [syncReadingPositionRef]
  );

  const scheduleScrollMetricsSync = useCallback((target: HTMLDivElement) => {
    latestScrollTargetRef.current = target;
    if (readerScrollRafRef.current !== null) return;
    readerScrollRafRef.current = window.requestAnimationFrame(() => {
      readerScrollRafRef.current = null;
      const scroller = latestScrollTargetRef.current || readerScrollRef.current;
      if (!scroller) return;
      refreshReaderScrollbar();
      syncReadingPositionRef(Date.now());
    });
  }, [refreshReaderScrollbar, syncReadingPositionRef]);

  useEffect(() => {
    return () => {
      if (readerScrollbarTopRafRef.current !== null) {
        window.cancelAnimationFrame(readerScrollbarTopRafRef.current);
        readerScrollbarTopRafRef.current = null;
      }
      if (readerScrollRafRef.current !== null) {
        window.cancelAnimationFrame(readerScrollRafRef.current);
        readerScrollRafRef.current = null;
      }
    };
  }, []);

  const resolveReadingTargetFromPosition = (position: ReaderPositionState) => {
    const hasChapters = chapters.length > 0;
    let nextChapterIndex: number | null = hasChapters ? 0 : null;
    let nextChapterOffset = 0;

    if (hasChapters) {
      const hasValidChapterIndex =
        position.chapterIndex !== null &&
        position.chapterIndex >= 0 &&
        position.chapterIndex < chapters.length;
      if (hasValidChapterIndex) {
        nextChapterIndex = position.chapterIndex;
        const chapterLength = chapters[nextChapterIndex].content?.length || 0;
        nextChapterOffset = clamp(position.chapterCharOffset, 0, chapterLength);
      } else {
        const resolved = resolveChapterPositionFromGlobalOffsetFast(position.globalCharOffset);
        nextChapterIndex = resolved.chapterIndex;
        nextChapterOffset = resolved.chapterCharOffset;
      }
    } else {
      const fallbackLength = bookText.length;
      const fallbackOffset = position.chapterCharOffset > 0 ? position.chapterCharOffset : position.globalCharOffset;
      nextChapterOffset = clamp(fallbackOffset, 0, fallbackLength);
    }

    const nextBookText =
      nextChapterIndex !== null
        ? chapters[nextChapterIndex]?.content || bookText
        : bookText;
    const chapterLength = nextBookText.length;
    const totalLength = chapters.length > 0 ? chapterTextOffsets.totalLength : bookText.length;
    const chapterStartOffset = nextChapterIndex !== null ? getChapterStartOffsetByIndex(nextChapterIndex) : 0;
    const globalCharOffset = clamp(chapterStartOffset + nextChapterOffset, 0, totalLength);
    const derivedRatio = chapterLength > 0 ? nextChapterOffset / chapterLength : 0;
    const normalizedRatio = position.scrollRatio > 0 ? position.scrollRatio : derivedRatio;

    const normalizedPosition: ReaderPositionState = {
      chapterIndex: nextChapterIndex,
      chapterCharOffset: nextChapterOffset,
      globalCharOffset,
      scrollRatio: clamp(normalizedRatio, 0, 1),
      totalLength,
      updatedAt: Date.now(),
    };

    return {
      nextChapterIndex,
      nextBookText,
      normalizedPosition,
    };
  };

  const applyPendingRestorePosition = () => {
    const pending = pendingRestorePositionRef.current;
    const scroller = readerScrollRef.current;
    if (!pending || !scroller || isLoadingBookContent) return false;
    if (!isReaderAppearanceHydrated) return false;
    const hasChapterMedia =
      currentChapterImageSignature.length > 0 ||
      Boolean(readerArticleRef.current?.querySelector('figure'));
    const minStableMs = hasChapterMedia
      ? RESTORE_LAYOUT_MIN_STABLE_WITH_MEDIA_MS
      : RESTORE_LAYOUT_MIN_STABLE_TEXT_ONLY_MS;
    const requiredStablePasses = hasChapterMedia
      ? RESTORE_TARGET_STABLE_PASSES_WITH_MEDIA
      : RESTORE_TARGET_STABLE_PASSES_TEXT_ONLY;
    const requiredScrollHeightStablePasses = hasChapterMedia
      ? RESTORE_SCROLL_HEIGHT_STABLE_PASSES_WITH_MEDIA
      : RESTORE_SCROLL_HEIGHT_STABLE_PASSES_TEXT_ONLY;
    const mediaSettleDelayMs = hasChapterMedia ? RESTORE_MEDIA_SETTLE_DELAY_WITH_MEDIA_MS : 0;
    const elapsedMs = Date.now() - pendingRestoreStartedAtRef.current;
    const hardTimeoutReached = elapsedMs >= RESTORE_HARD_TIMEOUT_MS;
    if (pendingRestorePassesRef.current <= 0) {
      clearPendingRestorePosition();
      return false;
    }

    const chapterLength = bookText.length;
    const targetRatio = resolveRestoreTargetRatio(pending, chapterLength);
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const needsScrollableArea = targetRatio > 0.002;
    if (needsScrollableArea && maxScrollTop <= 1) {
      pendingRestorePassesRef.current = Math.max(0, pendingRestorePassesRef.current - 1);
      if (pendingRestorePassesRef.current <= 0 || hardTimeoutReached) {
        clearPendingRestorePosition();
      }
      return false;
    }
    const nextScrollTop = maxScrollTop > 0 ? maxScrollTop * targetRatio : 0;
    programmaticRestoreScrollRef.current = true;
    scroller.scrollTop = nextScrollTop;
    window.requestAnimationFrame(() => {
      programmaticRestoreScrollRef.current = false;
    });
    lastReaderScrollTopRef.current = nextScrollTop;
    refreshReaderScrollbar();
    const snapshot = syncReadingPositionRef(Date.now());
    const resolvedRatio = snapshot?.scrollRatio ?? 0;
    const ratioGap = Math.abs(resolvedRatio - targetRatio);

    pendingRestorePassesRef.current = Math.max(0, pendingRestorePassesRef.current - 1);
    if (!needsScrollableArea || ratioGap <= 0.002) {
      pendingRestoreStablePassesRef.current += 1;
    } else {
      pendingRestoreStablePassesRef.current = 0;
    }

    const currentScrollHeight = scroller.scrollHeight;
    const lastScrollHeight = pendingRestoreLastScrollHeightRef.current;
    if (lastScrollHeight === null || Math.abs(lastScrollHeight - currentScrollHeight) > 0.5) {
      pendingRestoreScrollHeightStablePassesRef.current = 0;
      pendingRestoreLastScrollHeightRef.current = currentScrollHeight;
    } else {
      pendingRestoreScrollHeightStablePassesRef.current += 1;
    }
    const scrollHeightStable =
      pendingRestoreScrollHeightStablePassesRef.current >= requiredScrollHeightStablePasses;

    const mediaSettled = isRestoreMediaLayoutSettled();
    if (mediaSettled) {
      if (pendingRestoreMediaSettledAtRef.current === null) {
        pendingRestoreMediaSettledAtRef.current = Date.now();
      }
    } else {
      pendingRestoreMediaSettledAtRef.current = null;
    }
    const mediaSettleDelayElapsed =
      mediaSettleDelayMs <= 0 ||
      pendingRestoreMediaSettledAtRef.current === null ||
      Date.now() - pendingRestoreMediaSettledAtRef.current >= mediaSettleDelayMs;
    const mediaGateReady = mediaSettled && areChapterImagesSettledRef.current;

    const reachedStableWindow =
      !needsScrollableArea ||
      (pendingRestoreStablePassesRef.current >= requiredStablePasses && elapsedMs >= minStableMs);
    if (
      (reachedStableWindow && mediaGateReady && mediaSettleDelayElapsed && scrollHeightStable) ||
      pendingRestorePassesRef.current <= 0 ||
      hardTimeoutReached
    ) {
      clearPendingRestorePosition();
    }
    return true;
  };

  const scrollReaderTo = (target: ScrollTarget) => {
    const el = readerScrollRef.current;
    if (!el) return;

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const top = target === 'bottom' ? el.scrollHeight : 0;
        el.scrollTo({ top, behavior: 'auto' });
        lastReaderScrollTopRef.current = el.scrollTop;
        refreshReaderScrollbar();
      });
    });
  };

  const clearChapterTransitionTimers = () => {
    chapterTransitionTimersRef.current.forEach(id => window.clearTimeout(id));
    chapterTransitionTimersRef.current = [];
  };

  const runChapterSwitchTransition = (direction: ChapterSwitchDirection, onCommit: () => void) => {
    const OUT_MS = 120;
    const IN_MS = 180;

    clearChapterTransitionTimers();
    chapterTransitioningRef.current = true;
    setChapterTransitionClass(direction === 'next' ? 'reader-chapter-out-up' : 'reader-chapter-out-down');

    const outTimer = window.setTimeout(() => {
      onCommit();
      setChapterTransitionClass(direction === 'next' ? 'reader-chapter-in-up' : 'reader-chapter-in-down');

      const inTimer = window.setTimeout(() => {
        setChapterTransitionClass('');
        chapterTransitioningRef.current = false;
      }, IN_MS);
      chapterTransitionTimersRef.current.push(inTimer);
    }, OUT_MS);

    chapterTransitionTimersRef.current.push(outTimer);
  };

  const switchToChapter = (index: number, target: ScrollTarget, direction?: ChapterSwitchDirection) => {
    const chapter = chapters[index];
    if (!chapter) return false;
    const controllerState = ttsControllerRef.current?.getState();
    const shouldResumeTtsInNextChapter =
      !!controllerState?.isActive || !!ttsPlaybackState?.isActive || ttsAutoStartNextChapter;

    const applyChapter = () => {
      setSelectedChapterIndex(index);
      setBookText(chapter.content || '');
      closeFloatingPanel();
      scrollReaderTo(target);
      if (shouldResumeTtsInNextChapter) {
        // Keep TTS mode on across manual chapter switches and auto-start in next chapter.
        ttsAutoStartModeRef.current = 'viewport';
        ttsAutoStartTaskIdRef.current += 1;
        ttsControllerRef.current?.destroy();
        ttsControllerRef.current = null;
        setTtsActiveParagraphIndex(null);
        setTtsAutoStartNextChapter(true);
      } else {
        // TTS is not active: keep existing stop behavior.
        ttsAutoStartTaskIdRef.current += 1;
        setTtsAutoStartNextChapter(false);
        ttsControllerRef.current?.stop();
        ttsControllerRef.current = null;
        setTtsPlaybackState(null);
        setTtsActiveParagraphIndex(null);
      }
    };

    if (!direction || selectedChapterIndex === null || index === selectedChapterIndex) {
      applyChapter();
      return true;
    }

    runChapterSwitchTransition(direction, applyChapter);
    return true;
  };

  const tryAutoSwitchChapter = (direction: 'next' | 'prev') => {
    if (selectedChapterIndex === null) return false;
    if (chapters.length === 0) return false;
    if (isLoadingBookContent) return false;
    if (chapterAutoSwitchLockRef.current) return false;
    if (chapterTransitioningRef.current) return false;

    const nextIndex = direction === 'next' ? selectedChapterIndex + 1 : selectedChapterIndex - 1;
    if (nextIndex < 0 || nextIndex >= chapters.length) return false;

    chapterAutoSwitchLockRef.current = true;
    resetBoundaryIntent();
    clearBoundaryArm();
    const switched = switchToChapter(nextIndex, direction === 'next' ? 'top' : 'bottom', direction);
    window.setTimeout(() => {
      chapterAutoSwitchLockRef.current = false;
    }, 420);
    return switched;
  };

  const resetBoundaryIntent = () => {
    boundaryIntentDownRef.current = 0;
    boundaryIntentUpRef.current = 0;
  };

  const clearBoundaryArm = () => {
    boundaryArmedDirectionRef.current = null;
    boundaryArmedAtRef.current = 0;
  };

  const primeBoundaryArm = (direction: 'next' | 'prev') => {
    boundaryArmedDirectionRef.current = direction;
    boundaryArmedAtRef.current = Date.now();
  };

  const canConsumeBoundaryIntent = (direction: 'next' | 'prev', noScrollableContent: boolean) => {
    if (noScrollableContent) return true;

    const now = Date.now();
    const isSameDirection = boundaryArmedDirectionRef.current === direction;
    // Give users more time to complete the second gesture at chapter boundaries.
    const isFresh = now - boundaryArmedAtRef.current <= 1800;
    if (!isSameDirection || !isFresh) {
      primeBoundaryArm(direction);
      return false;
    }

    boundaryArmedAtRef.current = now;
    return true;
  };

  const canTriggerBoundarySwitch = (el: HTMLDivElement) => {
    const noScrollableContent = el.scrollHeight <= el.clientHeight + 1;
    const nearTop = el.scrollTop <= 1;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    return { noScrollableContent, nearTop, nearBottom };
  };

  const clearFloatingPanelTimer = () => {
    if (!floatingPanelTimerRef.current) return;
    window.clearTimeout(floatingPanelTimerRef.current);
    floatingPanelTimerRef.current = null;
  };

  const clearBookmarkModalTimer = () => {
    if (!bookmarkModalTimerRef.current) return;
    window.clearTimeout(bookmarkModalTimerRef.current);
    bookmarkModalTimerRef.current = null;
  };

  const hideBookmarkModalImmediately = () => {
    clearBookmarkModalTimer();
    setIsBookmarkModalOpen(false);
    setIsBookmarkModalClosing(false);
    setBookmarkNameDraft('');
    setPendingBookmarkPosition(null);
  };

  const clearTypographyColorEditorTimer = () => {
    if (!typographyColorEditorTimerRef.current) return;
    window.clearTimeout(typographyColorEditorTimerRef.current);
    typographyColorEditorTimerRef.current = null;
  };

  const closeTypographyColorEditor = (kind: TypographyColorKind) => {
    clearTypographyColorEditorTimer();
    setActiveTypographyColorEditor(prev => (prev === kind ? null : prev));
    setClosingTypographyColorEditor(kind);
    typographyColorEditorTimerRef.current = window.setTimeout(() => {
      setClosingTypographyColorEditor(prev => (prev === kind ? null : prev));
      typographyColorEditorTimerRef.current = null;
    }, TYPOGRAPHY_COLOR_EDITOR_TRANSITION_MS);
  };

  const toggleTypographyColorEditor = (kind: TypographyColorKind) => {
    if (activeTypographyColorEditor === kind) {
      closeTypographyColorEditor(kind);
      return;
    }
    clearTypographyColorEditorTimer();
    setClosingTypographyColorEditor(null);
    setActiveTypographyColorEditor(kind);
  };

  const hideFloatingPanelImmediately = () => {
    clearFloatingPanelTimer();
    clearTypographyColorEditorTimer();
    setActiveFloatingPanel('none');
    setClosingFloatingPanel(null);
    setActiveTypographyColorEditor(null);
    setClosingTypographyColorEditor(null);
  };

  const commitHighlighterDraftColor = () => {
    const nextColor = rgbToHex(highlightColorDraft);
    setHighlightColor(nextColor);
    setHighlightHexInput(nextColor);
  };

  const closeFloatingPanel = (options?: { discardDraft?: boolean }) => {
    if (activeFloatingPanel === 'none') return;
    if (activeFloatingPanel === 'highlighter' && !options?.discardDraft) {
      commitHighlighterDraftColor();
    }
    clearFloatingPanelTimer();
    const panelToClose = activeFloatingPanel;
    setClosingFloatingPanel(panelToClose);
    floatingPanelTimerRef.current = window.setTimeout(() => {
      setActiveFloatingPanel('none');
      setClosingFloatingPanel(null);
    }, FLOATING_PANEL_TRANSITION_MS);
  };

  const openFloatingPanel = (panel: Exclude<FloatingPanel, 'none'>) => {
    if (activeFloatingPanel === 'highlighter' && panel !== 'highlighter') {
      commitHighlighterDraftColor();
    }
    clearFloatingPanelTimer();
    setClosingFloatingPanel(null);
    setActiveFloatingPanel(panel);
  };

  const toggleTocPanel = () => {
    if (isTocOpen) {
      closeFloatingPanel();
      return;
    }
    setTocPanelTab('toc');
    openFloatingPanel('toc');
  };

  const openHighlighterPanel = () => {
    setHighlightColorDraft(hexToRgb(highlightColor));
    setHighlightHexInput(highlightColor.toUpperCase());
    openFloatingPanel('highlighter');
  };

  const openTypographyPanel = () => {
    openFloatingPanel('typography');
  };

  const showVocabularyToastMessage = (message: string) => {
    setVocabularyToast(message);
    if (vocabularyToastTimerRef.current) {
      window.clearTimeout(vocabularyToastTimerRef.current);
    }
    vocabularyToastTimerRef.current = window.setTimeout(() => {
      setVocabularyToast(null);
      vocabularyToastTimerRef.current = null;
    }, VOCAB_TOAST_MS);
  };

  const isSelectionInsideReaderArticle = (selection: Selection | null) => {
    if (!selection || selection.rangeCount === 0) return false;
    const article = readerArticleRef.current;
    if (!article) return false;
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    if (container.nodeType === Node.ELEMENT_NODE) {
      return article.contains(container as Element);
    }
    return article.contains(container.parentElement);
  };

  const getSelectedVocabularyTerm = () => {
    const selection = window.getSelection();
    if (isSelectionInsideReaderArticle(selection)) {
      const selected = sanitizeVocabularyTerm(selection?.toString() || '');
      if (selected) {
        lastReaderSelectionRef.current = selected;
        return selected;
      }
    }
    return sanitizeVocabularyTerm(lastReaderSelectionRef.current || '');
  };

  const handleAddVocabularyFromSelection = () => {
    if (!activeBook?.id) return;
    const term = getSelectedVocabularyTerm();
    if (!term) {
      showVocabularyToastMessage('请先选中一个单词或词组');
      return;
    }
    if (term.length > VOCAB_TERM_MAX_LENGTH) {
      showVocabularyToastMessage('选中文本太长，请只选词或短句');
      return;
    }

    const normalizedTerm = normalizeVocabularyKey(term);
    if (!normalizedTerm) {
      showVocabularyToastMessage('选中的内容不适合加入生词本');
      return;
    }

    let wasDuplicate = false;
    setVocabularyEntries((prev) => {
      const existing = prev.find((item) => item.normalizedTerm === normalizedTerm);
      if (existing) {
        wasDuplicate = true;
        return [
          { ...existing, term },
          ...prev.filter((item) => item.id !== existing.id),
        ];
      }
      return [
        {
          id: createReaderVocabularyId(),
          term,
          normalizedTerm,
        },
        ...prev,
      ];
    });

    void ensureLexiconEntryFromReaderTerm({
      term,
      bookId: activeBook.id,
    }).catch(() => undefined);

    if (!wasDuplicate) {
      void enrichLexiconEntry({
        term,
        normalizedTerm,
        apiConfig,
        bookId: activeBook.id,
      }).catch(() => undefined);
    }

    showVocabularyToastMessage(wasDuplicate ? '生词已更新到列表顶部' : '已添加到生词本');
  };

  useEffect(() => {
    const handleSelectionChange = () => {
      if (isHighlightMode) return;
      const selection = window.getSelection();
      if (!isSelectionInsideReaderArticle(selection)) return;
      const selected = sanitizeVocabularyTerm(selection?.toString() || '');
      if (!selected) return;
      lastReaderSelectionRef.current = selected;
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [isHighlightMode, activeBook?.id]);

  useEffect(() => {
    let cancelled = false;

    const loadBookContent = async () => {
      if (!activeBook) {
        setChapters([]);
        setSelectedChapterIndex(null);
        setBookText('');
        setHighlightRangesByChapter({});
        setAiUnderlineRangesByChapter({});
        setBookmarks([]);
        setVocabularyEntries([]);
        lastReaderSelectionRef.current = '';
        setSelectedBookmarkId(null);
        setTocPanelTab('toc');
        hideBookmarkModalImmediately();
        setHighlightColor(DEFAULT_HIGHLIGHT_COLOR);
        setHighlightColorDraft(hexToRgb(DEFAULT_HIGHLIGHT_COLOR));
        setHighlightHexInput(DEFAULT_HIGHLIGHT_COLOR);
        setFontPanelMessage('');
        setFontUrlInput('');
        setFontFamilyInput('');
        setIsReaderStateHydrated(false);
        setHydratedBookId(null);
        hideFloatingPanelImmediately();
        clearPendingRestorePosition();
        latestReadingPositionRef.current = null;
        setIsLoadingBookContent(false);
        return;
      }

      setIsLoadingBookContent(true);
      setIsReaderStateHydrated(false);
      setHydratedBookId(null);
      try {
        const content = await getBookContent(activeBook.id);
        const fullText = content?.fullText || activeBook.fullText || '';
        const contentChapters = content?.chapters || [];
        const fallbackChapters = activeBook.chapters || [];
        const resolvedChapters = contentChapters.length > 0 ? contentChapters : fallbackChapters;
        const readerState = content?.readerState;
        const persistedColor = readerState?.highlightColor;
        const persistedRanges = readerState?.highlightsByChapter;
        const persistedPosition = normalizeReaderPosition(readerState?.readingPosition);
        const persistedBookmarks = normalizeReaderBookmarks(readerState?.bookmarks);
        const persistedVocabularyEntries = normalizeReaderVocabularyEntries(readerState?.vocabularyEntries);
        const persistedTtsResume = readerState?.ttsResumePosition;

        if (cancelled) return;

        setChapters(resolvedChapters);
        setHighlightRangesByChapter(persistedRanges || {});
        setTtsResumePosition(persistedTtsResume);
        setBookmarks(persistedBookmarks);
        setVocabularyEntries(persistedVocabularyEntries);
        hideBookmarkModalImmediately();
        if (persistedColor && isValidHexColor(persistedColor.toUpperCase())) {
          const normalized = persistedColor.toUpperCase();
          setHighlightColor(normalized);
          setHighlightColorDraft(hexToRgb(normalized));
          setHighlightHexInput(normalized);
        } else {
          setHighlightColor(DEFAULT_HIGHLIGHT_COLOR);
          setHighlightColorDraft(hexToRgb(DEFAULT_HIGHLIGHT_COLOR));
          setHighlightHexInput(DEFAULT_HIGHLIGHT_COLOR);
        }
        setFontPanelMessage('');
        setFontUrlInput('');
        setFontFamilyInput('');
        hideFloatingPanelImmediately();

        const hasChapters = resolvedChapters.length > 0;
        let nextChapterIndex: number | null = hasChapters ? 0 : null;
        let nextChapterOffset = 0;

        if (persistedPosition) {
          if (hasChapters) {
            const hasValidChapterIndex =
              persistedPosition.chapterIndex !== null &&
              persistedPosition.chapterIndex >= 0 &&
              persistedPosition.chapterIndex < resolvedChapters.length;

            if (hasValidChapterIndex) {
              nextChapterIndex = persistedPosition.chapterIndex;
              const chapterLength = resolvedChapters[nextChapterIndex].content?.length || 0;
              nextChapterOffset = clamp(persistedPosition.chapterCharOffset, 0, chapterLength);
            } else {
              const resolved = resolveChapterPositionFromGlobalOffset(resolvedChapters, persistedPosition.globalCharOffset);
              nextChapterIndex = resolved.chapterIndex;
              nextChapterOffset = resolved.chapterCharOffset;
            }
          } else {
            const fallbackLength = fullText.length;
            const fallbackOffset = persistedPosition.chapterCharOffset > 0
              ? persistedPosition.chapterCharOffset
              : persistedPosition.globalCharOffset;
            nextChapterOffset = clamp(fallbackOffset, 0, fallbackLength);
          }
        }

        const nextBookText =
          nextChapterIndex !== null
            ? resolvedChapters[nextChapterIndex]?.content || fullText
            : fullText;

        setSelectedChapterIndex(nextChapterIndex);
        setBookText(nextBookText);

        if (persistedPosition) {
          const chapterLength = nextBookText.length;
          const totalLength = getTotalTextLength(resolvedChapters, fullText);
          const chapterStartOffset =
            nextChapterIndex !== null ? getChapterStartOffset(resolvedChapters, nextChapterIndex) : 0;
          const globalCharOffset = clamp(chapterStartOffset + nextChapterOffset, 0, totalLength);
          const derivedRatio = chapterLength > 0 ? nextChapterOffset / chapterLength : 0;
          const normalizedRatio = persistedPosition.scrollRatio > 0 ? persistedPosition.scrollRatio : derivedRatio;
          const restoredPosition: ReaderPositionState = {
            chapterIndex: nextChapterIndex,
            chapterCharOffset: nextChapterOffset,
            globalCharOffset,
            scrollRatio: clamp(normalizedRatio, 0, 1),
            totalLength,
            updatedAt: persistedPosition.updatedAt,
          };
          queuePendingRestorePosition(restoredPosition, 28, { hideDuringRestore: true });
          latestReadingPositionRef.current = restoredPosition;
          setSelectedBookmarkId(resolveClosestBookmarkIdFromList(persistedBookmarks, globalCharOffset));
        } else {
          clearPendingRestorePosition();
          latestReadingPositionRef.current = null;
          setSelectedBookmarkId(resolveClosestBookmarkIdFromList(persistedBookmarks, 0));
        }
      } catch (error) {
        console.error('Failed to load reader content:', error);
        if (!cancelled) {
          setChapters([]);
          setSelectedChapterIndex(null);
          setHighlightRangesByChapter({});
          setAiUnderlineRangesByChapter({});
          setBookmarks([]);
          setVocabularyEntries([]);
          lastReaderSelectionRef.current = '';
          setSelectedBookmarkId(null);
          setTocPanelTab('toc');
          hideBookmarkModalImmediately();
          setHighlightColor(DEFAULT_HIGHLIGHT_COLOR);
          setHighlightColorDraft(hexToRgb(DEFAULT_HIGHLIGHT_COLOR));
          setHighlightHexInput(DEFAULT_HIGHLIGHT_COLOR);
          setFontPanelMessage('');
          setFontUrlInput('');
          setFontFamilyInput('');
          hideFloatingPanelImmediately();
          clearPendingRestorePosition();
          latestReadingPositionRef.current = null;
          setBookText(activeBook.fullText || '');
        }
      } finally {
        if (!cancelled) {
          setIsReaderStateHydrated(true);
          setHydratedBookId(activeBook.id);
          setIsLoadingBookContent(false);
        }
      }
    };

    loadBookContent();
    return () => {
      cancelled = true;
    };
  }, [activeBook?.id]);

  // Consume pending highlight jump from StudyHub cross-view navigation
  useEffect(() => {
    if (!pendingHighlightJump || !activeBook || pendingHighlightJump.bookId !== activeBook.id) return;
    if (!isReaderStateHydrated || hydratedBookId !== activeBook.id) return;
    const chapterKey = pendingHighlightJump.chapterIndex === null ? 'full' : `chapter-${pendingHighlightJump.chapterIndex}`;
    const position = buildPositionFromHighlight(chapterKey, pendingHighlightJump.charOffset, chapters, bookText.length);
    jumpToReadingPosition(position);
    onClearPendingHighlightJump?.();
  }, [pendingHighlightJump, activeBook?.id, isReaderStateHydrated, hydratedBookId]);

  useEffect(() => {
    if (!activeBook?.id) {
      setAiUnderlineRangesByChapter({});
      return;
    }
    const bucket = readConversationBucket(conversationKey);
    const byBook = bucket.readingAiUnderlinesByBookId || {};
    setAiUnderlineRangesByChapter(byBook[activeBook.id] || {});
  }, [conversationKey, activeBook?.id]);

  useLayoutEffect(() => {
    applyPendingRestorePosition();
  }, [
    activeBook?.id,
    isLoadingBookContent,
    bookText,
    isReaderAppearanceHydrated,
    selectedReaderFontId,
    readerTypography.fontSizePx,
    readerTypography.lineHeight,
    isRestorePositionPending,
  ]);

  useEffect(() => {
    if (!pendingRestorePositionRef.current) return;
    if (isLoadingBookContent) return;

    let cancelled = false;
    const runStabilizedRestore = () => {
      if (cancelled) return;
      applyPendingRestorePosition();
      if (!pendingRestorePositionRef.current) return;
      if (pendingRestoreRetryTimerRef.current) {
        window.clearTimeout(pendingRestoreRetryTimerRef.current);
      }
      pendingRestoreRetryTimerRef.current = window.setTimeout(() => {
        window.requestAnimationFrame(() => runStabilizedRestore());
      }, RESTORE_RETRY_INTERVAL_MS);
    };

    runStabilizedRestore();
    const fontSet = document.fonts;
    fontSet.ready.then(() => {
      if (cancelled || !pendingRestorePositionRef.current) return;
      window.requestAnimationFrame(() => runStabilizedRestore());
    });

    return () => {
      cancelled = true;
      if (pendingRestoreRetryTimerRef.current) {
        window.clearTimeout(pendingRestoreRetryTimerRef.current);
        pendingRestoreRetryTimerRef.current = null;
      }
    };
  }, [
    activeBook?.id,
    isLoadingBookContent,
    bookText,
    isReaderAppearanceHydrated,
    selectedReaderFontId,
    readerTypography.fontSizePx,
    readerTypography.lineHeight,
    isRestorePositionPending,
  ]);

  useLayoutEffect(() => {
    syncFloatingPanelTop();
  }, [safeAreaTop, syncFloatingPanelTop]);

  useLayoutEffect(() => {
    if (!isTocOpen || tocPanelTab !== 'toc') return;
    if (selectedChapterIndex === null || selectedChapterIndex < 0) return;

    const panel = tocListRef.current;
    const activeItem = tocItemRefs.current[selectedChapterIndex];
    if (!panel || !activeItem) return;

    const frameId = window.requestAnimationFrame(() => {
      const panelRect = panel.getBoundingClientRect();
      const itemRect = activeItem.getBoundingClientRect();
      const delta = itemRect.top - panelRect.top - (panel.clientHeight - itemRect.height) / 2;
      const maxScrollTop = Math.max(0, panel.scrollHeight - panel.clientHeight);
      const nextScrollTop = clamp(panel.scrollTop + delta, 0, maxScrollTop);
      panel.scrollTo({ top: nextScrollTop, behavior: 'auto' });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [isTocOpen, tocPanelTab, selectedChapterIndex, chapters.length]);

  useEffect(() => {
    if (!isTocOpen || tocPanelTab !== 'bookmarks') return;
    if (sortedBookmarks.length === 0) {
      if (selectedBookmarkId !== null) {
        setSelectedBookmarkId(null);
      }
      return;
    }

    const currentPosition = getCurrentReadingPosition(Date.now()) || latestReadingPositionRef.current;
    const targetOffset = currentPosition?.globalCharOffset || 0;
    const closest = resolveClosestBookmarkId(targetOffset);
    if (closest && closest !== selectedBookmarkId) {
      setSelectedBookmarkId(closest);
    }
  }, [isTocOpen, tocPanelTab, sortedBookmarks, selectedBookmarkId]);

  useLayoutEffect(() => {
    if (!isTocOpen || tocPanelTab !== 'bookmarks') return;
    if (!selectedBookmarkId) return;

    const panel = tocListRef.current;
    const activeItem = bookmarkItemRefs.current[selectedBookmarkId];
    if (!panel || !activeItem) return;

    const frameId = window.requestAnimationFrame(() => {
      const panelRect = panel.getBoundingClientRect();
      const itemRect = activeItem.getBoundingClientRect();
      const delta = itemRect.top - panelRect.top - (panel.clientHeight - itemRect.height) / 2;
      const maxScrollTop = Math.max(0, panel.scrollHeight - panel.clientHeight);
      const nextScrollTop = clamp(panel.scrollTop + delta, 0, maxScrollTop);
      panel.scrollTo({ top: nextScrollTop, behavior: 'auto' });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [isTocOpen, tocPanelTab, selectedBookmarkId, sortedBookmarks.length]);

  useEffect(() => {
    refreshReaderScrollbar();
    const rafId = window.requestAnimationFrame(() => refreshReaderScrollbar());
    const timerId = window.setTimeout(() => refreshReaderScrollbar(), 120);
    const onResize = () => refreshReaderScrollbar();
    window.addEventListener('resize', onResize);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timerId);
      window.removeEventListener('resize', onResize);
    };
  }, [bookText, isLoadingBookContent, activeFloatingPanel, selectedChapterIndex]);

  useEffect(() => {
    const onResize = () => syncFloatingPanelTop();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
    };
  }, [syncFloatingPanelTop]);

  useEffect(() => {
    if (!activeBook || isLoadingBookContent) return;
    syncReadingPositionRef(Date.now());
  }, [activeBook?.id, isLoadingBookContent, selectedChapterIndex, bookText, chapters]);

  useEffect(() => {
    if (!isBookmarkModalOpen || isBookmarkModalClosing) return;
    const timer = window.setTimeout(() => {
      bookmarkNameInputRef.current?.focus();
      bookmarkNameInputRef.current?.select();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [isBookmarkModalOpen, isBookmarkModalClosing]);

  useEffect(() => {
    return () => {
      clearChapterTransitionTimers();
    };
  }, []);

  useEffect(() => {
    return () => {
      clearFloatingPanelTimer();
      clearBookmarkModalTimer();
      clearTypographyColorEditorTimer();
      if (persistReaderStateTimerRef.current) {
        window.clearTimeout(persistReaderStateTimerRef.current);
      }
      if (highlighterClickTimerRef.current) {
        window.clearTimeout(highlighterClickTimerRef.current);
      }
      if (vocabularyToastTimerRef.current) {
        window.clearTimeout(vocabularyToastTimerRef.current);
        vocabularyToastTimerRef.current = null;
      }
      if (pendingRestoreRetryTimerRef.current) {
        window.clearTimeout(pendingRestoreRetryTimerRef.current);
        pendingRestoreRetryTimerRef.current = null;
      }
      if (visualRestoreGuardTimerRef.current) {
        window.clearTimeout(visualRestoreGuardTimerRef.current);
        visualRestoreGuardTimerRef.current = null;
      }
      fontObjectUrlsRef.current.forEach(url => {
        URL.revokeObjectURL(url);
      });
      fontObjectUrlsRef.current = [];
      fontLinkNodesRef.current = [];
      fontCssLoadPromiseByUrlRef.current.clear();
      // TTS cleanup on unmount
      ttsControllerRef.current?.destroy();
      ttsControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    setReaderTextColorInput(readerTypography.textColor);
    setReaderBgColorInput(readerTypography.backgroundColor);
  }, [readerTypography.textColor, readerTypography.backgroundColor]);

  useEffect(() => {
    const prevMode = !isDarkMode;
    const prevDefaults = getDefaultReaderTypography(prevMode);
    const nextDefaults = getDefaultReaderTypography(isDarkMode);
    setReaderTypography(prev => {
      const nextTextColor = isSameHexColor(prev.textColor, prevDefaults.textColor) ? nextDefaults.textColor : prev.textColor;
      const nextBackgroundColor = isSameHexColor(prev.backgroundColor, prevDefaults.backgroundColor)
        ? nextDefaults.backgroundColor
        : prev.backgroundColor;

      if (nextTextColor === prev.textColor && nextBackgroundColor === prev.backgroundColor) {
        return prev;
      }

      return {
        ...prev,
        textColor: nextTextColor,
        backgroundColor: nextBackgroundColor,
      };
    });
  }, [isDarkMode]);

  useEffect(() => {
    let cancelled = false;
    const defaults = getDefaultReaderTypography(isDarkMode);

    const hydrateReaderAppearance = async () => {
      try {
        const stored = localStorage.getItem(READER_APPEARANCE_STORAGE_KEY);
        if (!stored) return;
        const parsed = JSON.parse(stored) as Pick<ReaderBookState, 'typographyStyle' | 'fontOptions' | 'selectedFontId'>;

        const typographyState = parsed?.typographyStyle;
        const normalizedTypography: ReaderTypographyStyle = {
          fontSizePx: clamp(
            typeof typographyState?.fontSizePx === 'number' ? typographyState.fontSizePx : defaults.fontSizePx,
            14,
            36
          ),
          lineHeight: clamp(
            typeof typographyState?.lineHeight === 'number' ? typographyState.lineHeight : defaults.lineHeight,
            1.2,
            2.8
          ),
          textColor:
            typeof typographyState?.textColor === 'string' && isValidHexColor(typographyState.textColor.toUpperCase())
              ? typographyState.textColor.toUpperCase()
              : defaults.textColor,
          backgroundColor:
            typeof typographyState?.backgroundColor === 'string' &&
            isValidHexColor(typographyState.backgroundColor.toUpperCase())
              ? typographyState.backgroundColor.toUpperCase()
              : defaults.backgroundColor,
          textAlign: normalizeReaderTextAlign(typographyState?.textAlign, defaults.textAlign),
        };

        const persistedFontOptionsRaw = Array.isArray(parsed?.fontOptions) ? parsed.fontOptions : [];
        const persistedFontOptions: ReaderFontOption[] = persistedFontOptionsRaw.reduce<ReaderFontOption[]>((acc, item) => {
          if (!item || typeof item !== 'object') return acc;
          const id = typeof item.id === 'string' ? item.id.trim() : '';
          if (!id || BUILTIN_READER_FONT_ID_SET.has(id)) return acc;
          const label = typeof item.label === 'string' ? sanitizeFontFamily(item.label) : '';
          const familyName = typeof item.family === 'string' ? normalizeStoredFontFamily(item.family) : '';
          const sourceUrl = typeof item.sourceUrl === 'string' ? item.sourceUrl.trim() : '';
          if (!label || !familyName || !sourceUrl || !isValidFontSourceType(item.sourceType)) return acc;
          acc.push({
            id,
            label,
            family: `"${familyName}"`,
            sourceType: item.sourceType,
            sourceUrl,
          });
          return acc;
        }, []);

        const mergedFontOptions = [...persistedFontOptions, ...DEFAULT_READER_FONT_OPTIONS].reduce<ReaderFontOption[]>(
          (acc, option) => {
            const exists = acc.some(existing => existing.id === option.id || existing.family === option.family || existing.label === option.label);
            if (!exists) acc.push(option);
            return acc;
          },
          []
        );

        const persistedSelectedFontId = typeof parsed?.selectedFontId === 'string' ? parsed.selectedFontId : '';
        const selectedFontId = mergedFontOptions.some(option => option.id === persistedSelectedFontId)
          ? persistedSelectedFontId
          : DEFAULT_READER_FONT_ID;
        const lightDefaults = getDefaultReaderTypography(false);
        const darkDefaults = getDefaultReaderTypography(true);
        const shouldFollowDefaultTextColor =
          isSameHexColor(normalizedTypography.textColor, lightDefaults.textColor) ||
          isSameHexColor(normalizedTypography.textColor, darkDefaults.textColor);
        const shouldFollowDefaultBackgroundColor =
          isSameHexColor(normalizedTypography.backgroundColor, lightDefaults.backgroundColor) ||
          isSameHexColor(normalizedTypography.backgroundColor, darkDefaults.backgroundColor);
        const hydratedTypography: ReaderTypographyStyle = {
          ...normalizedTypography,
          textColor: shouldFollowDefaultTextColor ? defaults.textColor : normalizedTypography.textColor,
          backgroundColor: shouldFollowDefaultBackgroundColor ? defaults.backgroundColor : normalizedTypography.backgroundColor,
        };

        if (cancelled) return;

        setReaderTypography(hydratedTypography);
        setReaderFontOptions(mergedFontOptions);
        setSelectedReaderFontId(selectedFontId);

        const fontsToEnsure = mergedFontOptions.filter(
          (option) => option.sourceType !== 'default' && typeof option.sourceUrl === 'string' && option.sourceUrl.trim().length > 0
        );
        if (fontsToEnsure.length > 0) {
          await Promise.allSettled(fontsToEnsure.map(option => ensureReaderFontResource(option)));
        }
      } catch (error) {
        console.error('Failed to hydrate global reader appearance:', error);
      }
    };

    void hydrateReaderAppearance().finally(() => {
      if (cancelled) return;
      setIsReaderAppearanceHydrated(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isTypographyPanelOpen) {
      clearTypographyColorEditorTimer();
      setIsReaderFontDropdownOpen(false);
      setActiveTypographyColorEditor(null);
      setClosingTypographyColorEditor(null);
    }
  }, [isTypographyPanelOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!readerFontDropdownRef.current) return;
      if (readerFontDropdownRef.current.contains(event.target as Node)) return;
      setIsReaderFontDropdownOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const currentChapterBlocks = useMemo(() => {
    if (selectedChapterIndex === null) return [] as NonNullable<Chapter['blocks']>;
    const chapter = chapters[selectedChapterIndex];
    if (!chapter || !Array.isArray(chapter.blocks)) return [] as NonNullable<Chapter['blocks']>;
    return chapter.blocks;
  }, [chapters, selectedChapterIndex]);

  const currentChapterTitle = useMemo(() => {
    if (selectedChapterIndex === null) return '';
    return chapters[selectedChapterIndex]?.title?.trim() || '';
  }, [chapters, selectedChapterIndex]);

  const { paragraphs, renderItems } = useMemo(() => {
    const fallbackParagraphs = dropLeadingDuplicateTitleParagraph(splitReaderParagraphs(bookText), currentChapterTitle);
    const fallbackRenderItems: ReaderRenderItem[] = fallbackParagraphs.map((_, index) => ({
      type: 'paragraph',
      key: `plain-paragraph-${index}`,
      paragraphIndex: index,
    }));

    if (currentChapterBlocks.length === 0) {
      return {
        paragraphs: fallbackParagraphs,
        renderItems: fallbackRenderItems,
      };
    }

    const nextParagraphs: string[] = [];
    const nextRenderItems: ReaderRenderItem[] = [];
    const leadingTextParagraphCandidates: string[] = [];
    currentChapterBlocks.forEach((block) => {
      if (block.type !== 'text') return;
      const blockParagraphs = splitReaderParagraphs(block.text || '');
      blockParagraphs.forEach((paragraphText) => {
        if (leadingTextParagraphCandidates.length >= 2) return;
        leadingTextParagraphCandidates.push(paragraphText);
      });
    });
    const leadingDuplicateCount = resolveLeadingDuplicateTitleParagraphCount(
      leadingTextParagraphCandidates,
      currentChapterTitle
    );
    let leadingTextParagraphCursor = 0;

    currentChapterBlocks.forEach((block, blockIndex) => {
      if (block.type === 'image') {
        nextRenderItems.push({
          type: 'image',
          key: `chapter-image-${blockIndex}-${block.imageRef}`,
          imageRef: block.imageRef,
          alt: block.alt,
          title: block.title,
          width: block.width,
          height: block.height,
        });
        return;
      }

      const blockParagraphs = splitReaderParagraphs(block.text || '');
      blockParagraphs.forEach((paragraphText, localIndex) => {
        if (leadingTextParagraphCursor < leadingDuplicateCount) {
          leadingTextParagraphCursor += 1;
          return;
        }
        leadingTextParagraphCursor += 1;

        const paragraphIndex = nextParagraphs.length;
        nextParagraphs.push(paragraphText);
        nextRenderItems.push({
          type: 'paragraph',
          key: `chapter-text-${blockIndex}-${localIndex}-${paragraphIndex}`,
          paragraphIndex,
        });
      });
    });

    if (nextParagraphs.length === 0 && nextRenderItems.length > 0) {
      return {
        paragraphs: [],
        renderItems: nextRenderItems,
      };
    }

    if (nextParagraphs.length === 0) {
      return {
        paragraphs: fallbackParagraphs,
        renderItems: fallbackRenderItems,
      };
    }

    return {
      paragraphs: nextParagraphs,
      renderItems: nextRenderItems,
    };
  }, [bookText, currentChapterBlocks, currentChapterTitle]);

  const currentChapterImageItems = useMemo(
    () => renderItems.filter((item): item is ReaderRenderImageItem => item.type === 'image'),
    [renderItems]
  );
  const currentChapterImageKeys = useMemo(
    () => currentChapterImageItems.map((item) => item.key),
    [currentChapterImageItems]
  );
  const currentChapterImageSignature = useMemo(
    () => currentChapterImageKeys.join('|'),
    [currentChapterImageKeys]
  );
  const areChapterImagesSettled = useMemo(() => {
    if (currentChapterImageKeys.length === 0) return true;
    return currentChapterImageKeys.every((key) => settledChapterImageKeys.has(key));
  }, [currentChapterImageKeys, settledChapterImageKeys]);

  useEffect(() => {
    areChapterImagesSettledRef.current = areChapterImagesSettled;
  }, [areChapterImagesSettled]);

  const markChapterImageSettled = useCallback((imageKey: string) => {
    setSettledChapterImageKeys((prev) => {
      if (prev.has(imageKey)) return prev;
      const next = new Set(prev);
      next.add(imageKey);
      return next;
    });
  }, []);

  useEffect(() => {
    setSettledChapterImageKeys(new Set());
  }, [activeBook?.id, selectedChapterIndex, currentChapterImageSignature]);

  useEffect(() => {
    if (!activeBook) {
      setIsLoadingMaskVisible(false);
      return;
    }

    if (isLoadingBookContent || isRestorePositionPending || !areChapterImagesSettled) {
      setIsLoadingMaskVisible(true);
      return;
    }

    let cancelled = false;
    const startedAt = Date.now();
    const maxWaitMs = RESTORE_MASK_VISUAL_READY_MAX_WAIT_MS;

    const settleMaskVisibility = () => {
      if (cancelled) return;
      const isReady = isReaderVisualContentReady();
      const timedOut = Date.now() - startedAt >= maxWaitMs;
      if (isReady || timedOut) {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            if (!cancelled) {
              setIsLoadingMaskVisible(false);
            }
          });
        });
        return;
      }
      window.requestAnimationFrame(settleMaskVisibility);
    };

    settleMaskVisibility();
    return () => {
      cancelled = true;
    };
  }, [
    activeBook?.id,
    selectedChapterIndex,
    currentChapterImageSignature,
    isLoadingBookContent,
    isRestorePositionPending,
    areChapterImagesSettled,
  ]);

  useEffect(() => {
    if (currentChapterImageItems.length === 0) return;
    let cancelled = false;

    const pendingSources: string[] = Array.from(
      new Set(
        currentChapterImageItems
          .map((item) => {
            if (item.width && item.height && item.width > 0 && item.height > 0) {
              IMAGE_DIMENSION_CACHE.set(item.imageRef, { width: item.width, height: item.height });
              return '';
            }
            return IMAGE_DIMENSION_CACHE.has(item.imageRef) ? '' : item.imageRef;
          })
          .filter((source): source is string => Boolean(source))
      )
    );
    if (pendingSources.length === 0) return;

    (async () => {
      let hasNewDimensions = false;
      for (const source of pendingSources) {
        const before = IMAGE_DIMENSION_CACHE.has(source);
        await resolveImageDimensions(source);
        if (!before && IMAGE_DIMENSION_CACHE.has(source)) {
          hasNewDimensions = true;
        }
      }
      if (!cancelled && hasNewDimensions) {
        persistImageDimensionCacheToStorage();
        setImageDimensionTick((prev) => prev + 1);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeBook?.id, selectedChapterIndex, currentChapterImageItems]);

  useEffect(() => {
    hydrateImageDimensionCacheFromStorage();
    setImageDimensionTick((prev) => prev + 1);
  }, []);

  const chapterNormalizedLengths = useMemo(
    () => chapters.map((chapter) => normalizeReaderLayoutText(chapter.content || '').length),
    [chapters]
  );

  const fullNormalizedLength = useMemo(() => normalizeReaderLayoutText(bookText).length, [bookText]);

  const paragraphMeta = useMemo(() => {
    let cursor = 0;
    return paragraphs.map((text, index) => {
      const start = cursor;
      const end = start + text.length;
      cursor = end + (index < paragraphs.length - 1 ? 1 : 0);
      return { text, start, end };
    });
  }, [paragraphs]);

  const totalParagraphLength = useMemo(() => {
    if (paragraphMeta.length === 0) return 0;
    return paragraphMeta[paragraphMeta.length - 1].end;
  }, [paragraphMeta]);

  const readerTextForHighlighting = useMemo(() => paragraphs.join('\n'), [paragraphs]);

  // ── Highlights collection memos ──

  const totalHighlightCount = useMemo(() => {
    let count = 0;
    for (const key of Object.keys(highlightRangesByChapter)) {
      count += highlightRangesByChapter[key]?.length || 0;
    }
    return count;
  }, [highlightRangesByChapter]);

  const resolvedHighlights = useMemo(() => {
    return resolveHighlightItems(highlightRangesByChapter, chapters, bookText);
  }, [highlightRangesByChapter, chapters, bookText]);

  const filteredHighlights = useMemo(() => {
    let items = resolvedHighlights;
    if (highlightColorFilter) {
      items = items.filter(item => item.range.color === highlightColorFilter);
    }
    if (highlightChapterFilter) {
      items = items.filter(item => item.chapterKey === highlightChapterFilter);
    }
    return items;
  }, [resolvedHighlights, highlightColorFilter, highlightChapterFilter]);

  // Persist reader state on page unload (app close / tab close while reading)
  useEffect(() => {
    const handlePageHide = () => {
      if (!activeBook?.id) return;
      const readingPosition = latestReadingPositionRef.current;
      if (!readingPosition) return;

      const scroller = readerScrollRef.current;
      const visibleRatio =
        scroller && scroller.scrollHeight > 1
          ? clamp(scroller.clientHeight / scroller.scrollHeight, 0, 1)
          : 0;
      const visibleTextRange = scroller
        ? (appSettings.readerMore.feature.readingContextIgnorePanelClip
            ? resolveFullViewportTextRange(scroller)
            : resolveVisibleReaderTextRange(scroller))
        : null;

      const readerState: ReaderBookState = {
        highlightColor,
        highlightsByChapter: highlightRangesByChapter,
        bookmarks: sortedBookmarks,
        vocabularyEntries,
        readingPosition: { ...readingPosition, updatedAt: Date.now() },
        visibleRatio,
        activeChapterRenderedText: readerTextForHighlighting,
        ...(visibleTextRange ? { visibleTextRange } : {}),
      };
      saveBookReaderState(activeBook.id, readerState).catch(() => {});
    };

    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, [activeBook?.id, highlightColor, highlightRangesByChapter, sortedBookmarks, vocabularyEntries, readerTextForHighlighting, appSettings.readerMore.feature.readingContextIgnorePanelClip]);

  const highlightStorageKey = useMemo(() => {
    return selectedChapterIndex === null ? 'full' : `chapter-${selectedChapterIndex}`;
  }, [selectedChapterIndex]);

  const currentHighlightRanges = useMemo(() => {
    return highlightRangesByChapter[highlightStorageKey] || [];
  }, [highlightRangesByChapter, highlightStorageKey]);

  const currentAiUnderlineRanges = useMemo(() => {
    return aiUnderlineRangesByChapter[highlightStorageKey] || [];
  }, [aiUnderlineRangesByChapter, highlightStorageKey]);

  const renderedHighlightRanges = useMemo(() => {
    if (!pendingHighlightRange || pendingHighlightRange.end <= pendingHighlightRange.start) {
      return currentHighlightRanges;
    }
    return applyHighlightStroke(currentHighlightRanges, pendingHighlightRange);
  }, [currentHighlightRanges, pendingHighlightRange]);

  const paragraphRenderData = useMemo(() => {
    return paragraphMeta.map(item => ({
      paragraph: item,
      segments: buildParagraphSegments(item, renderedHighlightRanges, currentAiUnderlineRanges),
    }));
  }, [paragraphMeta, renderedHighlightRanges, currentAiUnderlineRanges]);

  useEffect(() => {
    setPendingHighlightRange(null);
    highlightDragRef.current = { active: false, pointerId: null, startIndex: null };
    highlightTouchDragRef.current = { active: false, touchId: null, startIndex: null };
    touchPointerDragActiveRef.current = false;
  }, [highlightStorageKey]);

  useEffect(() => {
    if (!isHighlightMode) {
      setPendingHighlightRange(null);
      highlightDragRef.current = { active: false, pointerId: null, startIndex: null };
      highlightTouchDragRef.current = { active: false, touchId: null, startIndex: null };
      touchPointerDragActiveRef.current = false;
      window.getSelection()?.removeAllRanges();
    }
  }, [isHighlightMode]);

  useEffect(() => {
    if (!activeBook?.id || !isReaderStateHydrated || hydratedBookId !== activeBook.id) return;
    if (isRestorePositionPending || !areChapterImagesSettled) return;
    if (persistReaderStateTimerRef.current) {
      window.clearTimeout(persistReaderStateTimerRef.current);
    }

    persistReaderStateTimerRef.current = window.setTimeout(() => {
      const readingPosition = syncReadingPositionRef(Date.now()) || latestReadingPositionRef.current || undefined;
      const scroller = readerScrollRef.current;
      const visibleRatio =
        scroller && scroller.scrollHeight > 1
          ? clamp(scroller.clientHeight / scroller.scrollHeight, 0, 1)
          : 0;
      const visibleTextRange = scroller
        ? (appSettings.readerMore.feature.readingContextIgnorePanelClip
            ? resolveFullViewportTextRange(scroller)
            : resolveVisibleReaderTextRange(scroller))
        : null;
      const readerState: ReaderBookState = {
        highlightColor,
        highlightsByChapter: highlightRangesByChapter,
        bookmarks: sortedBookmarks,
        vocabularyEntries,
        readingPosition,
        visibleRatio,
        activeChapterRenderedText: readerTextForHighlighting,
        ...(visibleTextRange ? { visibleTextRange } : {}),
      };
      saveBookReaderState(activeBook.id, readerState).catch((error) => {
        console.error('Failed to persist reader state:', error);
      });
    }, 120);

    return () => {
      if (persistReaderStateTimerRef.current) {
        window.clearTimeout(persistReaderStateTimerRef.current);
        persistReaderStateTimerRef.current = null;
      }
    };
  }, [
    activeBook?.id,
    isReaderStateHydrated,
    hydratedBookId,
    highlightColor,
    highlightRangesByChapter,
    sortedBookmarks,
    vocabularyEntries,
    isRestorePositionPending,
    areChapterImagesSettled,
    readerTextForHighlighting,
    appSettings.readerMore.feature.readingContextIgnorePanelClip,
  ]);

  useEffect(() => {
    if (!activeBook?.id || !isReaderStateHydrated || hydratedBookId !== activeBook.id) return;
    persistConversationBucket(
      conversationKey,
      (existing) => ({
        ...existing,
        readingAiUnderlinesByBookId: {
          ...(existing.readingAiUnderlinesByBookId || {}),
          [activeBook.id]: aiUnderlineRangesByChapter,
        },
      }),
      'reader-ai-underlines-sync'
    );
  }, [
    activeBook?.id,
    conversationKey,
    hydratedBookId,
    isReaderStateHydrated,
    aiUnderlineRangesByChapter,
  ]);

  useEffect(() => {
    if (!isReaderAppearanceHydrated) return;

    const persistedFontOptions: ReaderFontState[] = readerFontOptions
      .filter(
        (option) =>
          option.sourceType !== 'default' &&
          !BUILTIN_READER_FONT_ID_SET.has(option.id) &&
          typeof option.sourceUrl === 'string' &&
          option.sourceUrl.trim().length > 0
      )
      .map(option => ({
        id: option.id,
        label: option.label,
        family: option.family,
        sourceType: option.sourceType,
        sourceUrl: option.sourceUrl!.trim(),
      }));

    const payload: Pick<ReaderBookState, 'typographyStyle' | 'fontOptions' | 'selectedFontId'> = {
      typographyStyle: readerTypography,
      fontOptions: persistedFontOptions,
      selectedFontId: selectedReaderFontId,
    };

    try {
      localStorage.setItem(READER_APPEARANCE_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.error('Failed to persist global reader appearance:', error);
    }
  }, [isReaderAppearanceHydrated, readerTypography, readerFontOptions, selectedReaderFontId]);

  const closeBookmarkModal = () => {
    if (!isBookmarkModalOpen) return;
    clearBookmarkModalTimer();
    setIsBookmarkModalClosing(true);
    bookmarkModalTimerRef.current = window.setTimeout(() => {
      hideBookmarkModalImmediately();
    }, FLOATING_PANEL_TRANSITION_MS);
  };

  const openBookmarkModal = () => {
    const fallbackPosition = syncReadingPositionRef(Date.now()) || latestReadingPositionRef.current;
    if (!fallbackPosition) return;
    const normalizedPosition = normalizeReaderPosition(fallbackPosition);
    if (!normalizedPosition) return;
    const nextDefaultName = buildDefaultBookmarkName(normalizedPosition, bookmarks);
    clearBookmarkModalTimer();
    setIsBookmarkModalClosing(false);
    setPendingBookmarkPosition({ ...normalizedPosition, updatedAt: Date.now() });
    setBookmarkNameDraft(nextDefaultName);
    setIsBookmarkModalOpen(true);
  };

  const handleConfirmAddBookmark = () => {
    if (!pendingBookmarkPosition) return;
    const timestamp = Date.now();
    const fallbackName = buildDefaultBookmarkName(pendingBookmarkPosition, bookmarks);
    const bookmark: ReaderBookmark = {
      id: createReaderBookmarkId(),
      name: sanitizeBookmarkName(bookmarkNameDraft, fallbackName),
      readingPosition: {
        ...pendingBookmarkPosition,
        updatedAt: timestamp,
      },
      createdAt: timestamp,
    };

    setBookmarks((prev) => sortReaderBookmarks([...prev, bookmark]));
    setSelectedBookmarkId(bookmark.id);
    setTocPanelTab('bookmarks');
    closeBookmarkModal();
  };

  const jumpToReadingPosition = (position: ReaderPositionState) => {
    const resolved = resolveReadingTargetFromPosition(position);
    queuePendingRestorePosition(resolved.normalizedPosition, 28, { hideDuringRestore: false });
    latestReadingPositionRef.current = resolved.normalizedPosition;

    const shouldUpdateChapter = resolved.nextChapterIndex !== selectedChapterIndex;
    const shouldUpdateText = resolved.nextBookText !== bookText;
    if (shouldUpdateChapter) {
      setSelectedChapterIndex(resolved.nextChapterIndex);
    }
    if (shouldUpdateText) {
      setBookText(resolved.nextBookText);
    }
    closeFloatingPanel();
    if (!shouldUpdateChapter && !shouldUpdateText) {
      window.requestAnimationFrame(() => {
        applyPendingRestorePosition();
      });
    }
  };

  const handleJumpToBookmark = (bookmark: ReaderBookmark) => {
    setSelectedBookmarkId(bookmark.id);
    jumpToReadingPosition(bookmark.readingPosition);
  };

  const handleDeleteBookmark = (bookmarkId: string) => {
    setBookmarks((prev) => sortReaderBookmarks(prev.filter((item) => item.id !== bookmarkId)));
    setSelectedBookmarkId((prev) => (prev === bookmarkId ? null : prev));
  };

  // ── Highlight collection handlers ──

  const handleJumpToHighlight = (item: ResolvedHighlightItem) => {
    const position = buildPositionFromHighlight(
      item.chapterKey, item.range.start, chapters, bookText.length,
    );
    jumpToReadingPosition(position);
  };

  const handleDeleteHighlight = (item: ResolvedHighlightItem) => {
    setHighlightRangesByChapter(prev => {
      const existing = prev[item.chapterKey] || [];
      const updated = existing.filter(
        r => !(r.start === item.range.start && r.end === item.range.end && r.color === item.range.color)
      );
      if (updated.length === 0) {
        const next = { ...prev };
        delete next[item.chapterKey];
        return next;
      }
      return { ...prev, [item.chapterKey]: updated };
    });
  };

  const handleCopyHighlightText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setHighlightCopyToast(true);
      if (highlightCopyToastTimerRef.current) window.clearTimeout(highlightCopyToastTimerRef.current);
      highlightCopyToastTimerRef.current = window.setTimeout(() => setHighlightCopyToast(false), 1500);
    } catch { /* ignore */ }
  };

  const handleBookmarkButtonClick = () => {
    if (!activeBook || isLoadingBookContent) return;
    openBookmarkModal();
  };

  const switchTocTab = (tab: TocPanelTab) => {
    setTocPanelTab(tab);
    if (tab !== 'highlights') {
      setHighlightColorFilter(null);
      setHighlightChapterFilter(null);
    }
    if (tab === 'highlights' && tocListRef.current) {
      tocListRef.current.scrollTop = 0;
    }
  };

  const handleTocPanelTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0];
    if (!touch) return;
    tocSwipeStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTocPanelTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const start = tocSwipeStartRef.current;
    tocSwipeStartRef.current = null;
    if (!start) return;

    const touch = e.changedTouches[0];
    if (!touch) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < 36) return;
    if (Math.abs(deltaX) <= Math.abs(deltaY) + 8) return;

    if (deltaX < 0) {
      switchTocTab('bookmarks');
      return;
    }
    switchTocTab('toc');
  };

  const handleJumpToChapter = (index: number) => {
    if (selectedChapterIndex === null) {
      if (!switchToChapter(index, 'top')) return;
      return;
    }

    const direction: ChapterSwitchDirection | undefined =
      index > selectedChapterIndex ? 'next' : index < selectedChapterIndex ? 'prev' : undefined;
    if (!switchToChapter(index, 'top', direction)) return;
  };

  const handleReaderScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    scheduleScrollMetricsSync(target);

    const prevTop = lastReaderScrollTopRef.current;
    const currTop = target.scrollTop;
    lastReaderScrollTopRef.current = currTop;
    if (programmaticRestoreScrollRef.current) return;

    const { nearTop, nearBottom, noScrollableContent } = canTriggerBoundarySwitch(target);
    const isScrollingDown = currTop > prevTop + 0.5;
    const isScrollingUp = currTop < prevTop - 0.5;

    if (noScrollableContent) {
      clearBoundaryArm();
      resetBoundaryIntent();
      return;
    }

    if (nearBottom && isScrollingDown) {
      primeBoundaryArm('next');
      resetBoundaryIntent();
      return;
    }

    if (nearTop && isScrollingUp) {
      primeBoundaryArm('prev');
      resetBoundaryIntent();
      return;
    }

    if (!nearTop && !nearBottom) {
      clearBoundaryArm();
      resetBoundaryIntent();
      return;
    }

    if (isScrollingDown || isScrollingUp) {
      clearBoundaryArm();
      resetBoundaryIntent();
    }
  };

  const handleReaderWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const { nearTop, nearBottom, noScrollableContent } = canTriggerBoundarySwitch(target);
    const WHEEL_SWITCH_THRESHOLD_SCROLLABLE_NEXT = 220;
    const WHEEL_SWITCH_THRESHOLD_SHORT_NEXT = 120;
    const WHEEL_SWITCH_THRESHOLD_SCROLLABLE_PREV = 140;
    const WHEEL_SWITCH_THRESHOLD_SHORT_PREV = 80;

    if (e.deltaY > 0) {
      if (nearBottom || noScrollableContent) {
        if (!canConsumeBoundaryIntent('next', noScrollableContent)) {
          resetBoundaryIntent();
          return;
        }

        const threshold = noScrollableContent ? WHEEL_SWITCH_THRESHOLD_SHORT_NEXT : WHEEL_SWITCH_THRESHOLD_SCROLLABLE_NEXT;
        boundaryIntentDownRef.current += Math.abs(e.deltaY);
        boundaryIntentUpRef.current = 0;
        if (boundaryIntentDownRef.current >= threshold) {
          if (tryAutoSwitchChapter('next')) {
            resetBoundaryIntent();
          }
        }
      } else {
        clearBoundaryArm();
        resetBoundaryIntent();
      }
      return;
    }

    if (e.deltaY < 0) {
      if (nearTop || noScrollableContent) {
        if (!canConsumeBoundaryIntent('prev', noScrollableContent)) {
          resetBoundaryIntent();
          return;
        }

        const threshold = noScrollableContent ? WHEEL_SWITCH_THRESHOLD_SHORT_PREV : WHEEL_SWITCH_THRESHOLD_SCROLLABLE_PREV;
        boundaryIntentUpRef.current += Math.abs(e.deltaY);
        boundaryIntentDownRef.current = 0;
        if (boundaryIntentUpRef.current >= threshold) {
          if (tryAutoSwitchChapter('prev')) {
            resetBoundaryIntent();
          }
        }
      } else {
        clearBoundaryArm();
        resetBoundaryIntent();
      }
    }
  };

  const handleReaderTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (isHighlightMode) return;
    const startY = e.touches[0]?.clientY ?? null;
    touchStartYRef.current = startY;
    touchLastYRef.current = startY;
    touchSwitchHandledRef.current = false;
  };

  const handleReaderTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (isHighlightMode) return;
    if (touchStartYRef.current === null) return;
    if (touchSwitchHandledRef.current) return;

    const target = e.currentTarget;
    const currentY = e.touches[0]?.clientY ?? touchStartYRef.current;
    const previousY = touchLastYRef.current ?? currentY;
    touchLastYRef.current = currentY;
    const deltaY = previousY - currentY;

    if (Math.abs(deltaY) < 6) return;

    const { nearTop, nearBottom, noScrollableContent } = canTriggerBoundarySwitch(target);
    const TOUCH_SWITCH_THRESHOLD_SCROLLABLE_NEXT = 96;
    const TOUCH_SWITCH_THRESHOLD_SHORT_NEXT = 72;
    const TOUCH_SWITCH_THRESHOLD_SCROLLABLE_PREV = 56;
    const TOUCH_SWITCH_THRESHOLD_SHORT_PREV = 40;

    if (deltaY > 0 && (nearBottom || noScrollableContent)) {
      if (!canConsumeBoundaryIntent('next', noScrollableContent)) {
        resetBoundaryIntent();
        return;
      }

      const threshold = noScrollableContent ? TOUCH_SWITCH_THRESHOLD_SHORT_NEXT : TOUCH_SWITCH_THRESHOLD_SCROLLABLE_NEXT;
      boundaryIntentDownRef.current += Math.abs(deltaY);
      boundaryIntentUpRef.current = 0;
      if (boundaryIntentDownRef.current >= threshold) {
        if (tryAutoSwitchChapter('next')) {
          touchSwitchHandledRef.current = true;
          resetBoundaryIntent();
        }
      }
      return;
    }

    if (deltaY < 0 && (nearTop || noScrollableContent)) {
      if (!canConsumeBoundaryIntent('prev', noScrollableContent)) {
        resetBoundaryIntent();
        return;
      }

      const threshold = noScrollableContent ? TOUCH_SWITCH_THRESHOLD_SHORT_PREV : TOUCH_SWITCH_THRESHOLD_SCROLLABLE_PREV;
      boundaryIntentUpRef.current += Math.abs(deltaY);
      boundaryIntentDownRef.current = 0;
      if (boundaryIntentUpRef.current >= threshold) {
        if (tryAutoSwitchChapter('prev')) {
          touchSwitchHandledRef.current = true;
          resetBoundaryIntent();
        }
      }
      return;
    }

    clearBoundaryArm();
    resetBoundaryIntent();
  };

  const handleReaderTouchEnd = () => {
    if (isHighlightMode) return;
    touchStartYRef.current = null;
    touchLastYRef.current = null;
    touchSwitchHandledRef.current = false;
    clearBoundaryArm();
    resetBoundaryIntent();
  };

  const handleReaderThumbPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const scroller = readerScrollRef.current;
    const track = readerScrollbarTrackRef.current;
    if (!scroller || !track || !readerScrollbar.visible) return;

    e.preventDefault();
    e.stopPropagation();
    safeSetPointerCapture(e.currentTarget as HTMLButtonElement, e.pointerId);

    const startY = e.clientY;
    const startScrollTop = scroller.scrollTop;
    const trackScrollable = Math.max(1, track.clientHeight - readerScrollbar.height);
    const contentScrollable = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
    const pxToScroll = contentScrollable / trackScrollable;

    const onMove = (ev: PointerEvent) => {
      const deltaY = ev.clientY - startY;
      const nextScrollTop = Math.min(contentScrollable, Math.max(0, startScrollTop + deltaY * pxToScroll));
      scroller.scrollTop = nextScrollTop;
      lastReaderScrollTopRef.current = nextScrollTop;
      refreshReaderScrollbar();
      syncReadingPositionRef(Date.now());
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const getCharacterIndexFromPoint = (x: number, y: number, fallbackTarget?: EventTarget | null) => {
    if (totalParagraphLength <= 0) return null;

    const doc = document as CaretDocument;
    let offsetNode: Node | null = null;
    let offset = 0;

    if (typeof doc.caretPositionFromPoint === 'function') {
      const caretPos = doc.caretPositionFromPoint(x, y);
      if (caretPos) {
        offsetNode = caretPos.offsetNode;
        offset = caretPos.offset;
      }
    }

    if (!offsetNode && typeof doc.caretRangeFromPoint === 'function') {
      const caretRange = doc.caretRangeFromPoint(x, y);
      if (caretRange) {
        offsetNode = caretRange.startContainer;
        offset = caretRange.startOffset;
      }
    }

    if (offsetNode) {
      return resolveNodeOffsetToIndex(offsetNode, offset, totalParagraphLength);
    }

    const elementAtPoint = document.elementFromPoint(x, y) as HTMLElement | null;
    const fallbackSegment =
      (elementAtPoint?.closest('[data-reader-segment="1"]') as HTMLElement | null) ||
      resolveSegmentElementFromTarget(fallbackTarget ?? null);
    if (!fallbackSegment) return null;

    const start = resolveSegmentStart(fallbackSegment);
    if (start === null) return null;

    const segmentTextLength = fallbackSegment.textContent?.length ?? 0;
    const segmentRect = fallbackSegment.getBoundingClientRect();
    const chooseTail = segmentRect.width > 1 && x > segmentRect.left + segmentRect.width / 2;
    const segmentOffset = chooseTail ? segmentTextLength : 0;
    return clamp(start + segmentOffset, 0, totalParagraphLength);
  };

  const resolveEnglishWordBoundary = (index: number, side: 'start' | 'end') => {
    if (!readerTextForHighlighting) {
      return clamp(index, 0, totalParagraphLength);
    }

    const text = readerTextForHighlighting;
    const textLength = text.length;
    const clampedIndex = clamp(index, 0, textLength);
    const rightChar = clampedIndex < textLength ? text[clampedIndex] : undefined;
    const leftChar = clampedIndex > 0 ? text[clampedIndex - 1] : undefined;

    let anchorCharIndex: number | null = null;
    if (isEnglishLetter(rightChar)) {
      anchorCharIndex = clampedIndex;
    } else if (isEnglishLetter(leftChar)) {
      anchorCharIndex = clampedIndex - 1;
    }

    if (anchorCharIndex === null) {
      return clampedIndex;
    }

    let wordStart = anchorCharIndex;
    while (wordStart > 0 && !isWhitespaceChar(text[wordStart - 1])) {
      wordStart -= 1;
    }

    let wordEnd = anchorCharIndex + 1;
    while (wordEnd < textLength && !isWhitespaceChar(text[wordEnd])) {
      wordEnd += 1;
    }

    return side === 'start' ? wordStart : wordEnd;
  };

  const resolveHighlightStrokeBounds = (anchorIndex: number, focusIndex: number) => {
    const rawStart = clamp(Math.min(anchorIndex, focusIndex), 0, totalParagraphLength);
    const rawEnd = clamp(Math.max(anchorIndex, focusIndex), 0, totalParagraphLength);
    if (rawEnd <= rawStart) {
      return { start: rawStart, end: rawEnd };
    }

    const snappedStart = resolveEnglishWordBoundary(rawStart, 'start');
    const snappedEnd = resolveEnglishWordBoundary(rawEnd, 'end');
    return {
      start: clamp(Math.min(snappedStart, snappedEnd), 0, totalParagraphLength),
      end: clamp(Math.max(snappedStart, snappedEnd), 0, totalParagraphLength),
    };
  };

  const buildHighlightStroke = (anchorIndex: number, focusIndex: number): TextHighlightRange => {
    const { start, end } = resolveHighlightStrokeBounds(anchorIndex, focusIndex);
    return { start, end, color: highlightColor };
  };

  const commitHighlightRange = (range: TextHighlightRange) => {
    if (range.end <= range.start) return;
    setHighlightRangesByChapter(prev => {
      const existing = prev[highlightStorageKey] || [];
      const merged = applyHighlightStroke(existing, range);
      return { ...prev, [highlightStorageKey]: merged };
    });
  };

  const handleAddAiUnderlineRange = (payload: { start: number; end: number; generationId: string }) => {
    const rawStart = Math.floor(Math.min(payload.start, payload.end));
    const rawEnd = Math.floor(Math.max(payload.start, payload.end));
    if (!payload.generationId || rawEnd <= rawStart) return;

    setAiUnderlineRangesByChapter((prev) => {
      let next = prev;
      const appendRange = (key: string, range: TextAiUnderlineRange) => {
        const existing = next[key] || [];
        const duplicated = existing.some(
          (item) =>
            item.start === range.start &&
            item.end === range.end &&
            (item.generationId || '') === (range.generationId || '')
        );
        if (duplicated) return;
        if (next === prev) {
          next = { ...prev };
        }
        next[key] = [...existing, range];
      };

      if (chapters.length > 0) {
        const totalLength = chapterNormalizedLengths.reduce((sum, length) => sum + length, 0);
        const start = clamp(rawStart, 0, totalLength);
        const end = clamp(rawEnd, 0, totalLength);
        if (end <= start) return prev;

        let cursor = 0;
        chapters.forEach((_, chapterIndex) => {
          const chapterLength = chapterNormalizedLengths[chapterIndex] || 0;
          const chapterStart = cursor;
          const chapterEnd = chapterStart + chapterLength;

          const overlapStart = Math.max(start, chapterStart);
          const overlapEnd = Math.min(end, chapterEnd);
          if (overlapEnd > overlapStart) {
            appendRange(`chapter-${chapterIndex}`, {
              start: overlapStart - chapterStart,
              end: overlapEnd - chapterStart,
              generationId: payload.generationId,
            });
          }

          cursor = chapterEnd;
        });

        return next;
      }

      const fullLength = Math.max(0, fullNormalizedLength);
      const start = clamp(rawStart, 0, fullLength);
      const end = clamp(rawEnd, 0, fullLength);
      if (end <= start) return prev;

      appendRange('full', { start, end, generationId: payload.generationId });
      return next;
    });
  };

  const handleRollbackAiUnderlineGeneration = (generationId: string) => {
    const normalizedGenerationId = generationId.trim();
    if (!normalizedGenerationId) return;

    setAiUnderlineRangesByChapter((prev) => {
      let changed = false;
      const next: Record<string, TextAiUnderlineRange[]> = {};

      Object.entries(prev).forEach(([key, ranges]) => {
        const safeRanges = Array.isArray(ranges) ? ranges : [];
        const filtered = safeRanges.filter((range) => (range.generationId || '') !== normalizedGenerationId);
        if (filtered.length !== safeRanges.length) {
          changed = true;
        }
        if (filtered.length > 0) {
          next[key] = filtered;
        } else if (safeRanges.length > 0) {
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  };

  // ─── TTS Handlers ───

  const showTtsErrorToast = useCallback((message: string) => {
    const safeMessage = (message || '').trim() || 'TTS 朗读发生错误，请检查配置后重试';
    if (ttsErrorToastTimerRef.current) {
      window.clearTimeout(ttsErrorToastTimerRef.current);
      ttsErrorToastTimerRef.current = null;
    }
    setTtsErrorToast({ show: true, message: safeMessage });
    ttsErrorToastTimerRef.current = window.setTimeout(() => {
      setTtsErrorToast({ show: false, message: '' });
      ttsErrorToastTimerRef.current = null;
    }, 2600);
  }, []);

  useEffect(() => () => {
    if (ttsErrorToastTimerRef.current) {
      window.clearTimeout(ttsErrorToastTimerRef.current);
      ttsErrorToastTimerRef.current = null;
    }
  }, []);

  const stopTtsPlaybackWithError = useCallback((message: string) => {
    showTtsErrorToast(message);
    ttsAutoStartTaskIdRef.current += 1;
    setTtsAutoStartNextChapter(false);
    ttsControllerRef.current?.stop();
    ttsControllerRef.current = null;
    setTtsPlaybackState(null);
    setTtsActiveParagraphIndex(null);
  }, [showTtsErrorToast]);

  const ttsScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ttsPendingScrollParagraphRef = useRef<number | null>(null);

  const scrollToParagraph = useCallback((paragraphIndex: number) => {
    // Debounce scroll: if a new paragraph arrives within 200ms, skip the previous one
    ttsPendingScrollParagraphRef.current = paragraphIndex;
    if (ttsScrollTimerRef.current) return; // already scheduled
    ttsScrollTimerRef.current = setTimeout(() => {
      ttsScrollTimerRef.current = null;
      const targetIdx = ttsPendingScrollParagraphRef.current;
      if (targetIdx === null) return;
      ttsPendingScrollParagraphRef.current = null;

      const article = readerArticleRef.current;
      const scroller = readerScrollRef.current;
      if (!article || !scroller) return;
      const el = article.querySelector(`[data-tts-paragraph-index="${targetIdx}"]`);
      if (!el) return;
      const targetOffset = scroller.clientHeight * 0.35;
      const elTop = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      scroller.scrollTo({ top: Math.max(0, elTop - targetOffset), behavior: 'smooth' });
    }, 200);
  }, []);

  // Ref for auto-advance: holds a function to advance to next chapter, always up-to-date
  const ttsAutoAdvanceRef = useRef<(() => void) | null>(null);

  // Helper: prepend chapter title chunk to chunks array if starting from beginning
  const prependTitleChunk = useCallback((chunks: TtsChunk[], startParagraph: number, chapterIdx: number | null) => {
    if (startParagraph !== 0 || chapterIdx === null || chunks.length === 0) return chunks;
    const chapter = chapters[chapterIdx];
    const title = chapter?.title?.trim();
    if (!title) return chunks;
    // Skip if the first paragraph already IS the title (avoid reading it twice)
    const firstChunkText = chunks[0].text.trim();
    if (firstChunkText === title || firstChunkText.startsWith(title)) return chunks;
    const titleChunk: TtsChunk = {
      id: `tts-title-${Date.now()}`,
      text: title,
      paragraphIndices: [-1],
      chapterIndex: chapterIdx,
      charStart: 0,
      charEnd: 0,
      status: 'pending',
    };
    return [titleChunk, ...chunks];
  }, [chapters]);

  // Shared TTS callbacks factory
  const makeTtsCallbacks = useCallback((): TtsPlaybackCallbacks => ({
    onStateChange: (state) => setTtsPlaybackState(state),
    onParagraphChange: (pIdx) => {
      setTtsActiveParagraphIndex(pIdx);
      scrollToParagraph(pIdx);
    },
    onError: (err) => {
      console.error('[TTS]', err);
      stopTtsPlaybackWithError(err);
    },
    onComplete: () => {
      // Try auto-advance to next chapter
      if (ttsAutoAdvanceRef.current) {
        ttsAutoAdvanceRef.current();
      } else {
        setTtsActiveParagraphIndex(null);
        setTtsPlaybackState(null);
      }
    },
  }), [scrollToParagraph, stopTtsPlaybackWithError]);

  const ensureTtsAudioElement = useCallback(() => {
    if (!ttsAudioRef.current) {
      ttsAudioRef.current = new Audio();
    }
    ttsAudioRef.current.preload = 'auto';
    ttsAudioRef.current.playsInline = true;
    return ttsAudioRef.current;
  }, []);

  const resolveTtsStartParagraphFromViewport = useCallback((paragraphCount: number) => {
    if (paragraphCount <= 0) return 0;

    const scroller = readerScrollRef.current;
    const article = readerArticleRef.current;
    if (!scroller || !article) return 0;

    const scrollerRect = scroller.getBoundingClientRect();
    const viewportTop = scrollerRect.top + scrollerRect.height * 0.2;
    const pEls = article.querySelectorAll<HTMLElement>('[data-tts-paragraph-index]');
    for (const pEl of pEls) {
      const rect = pEl.getBoundingClientRect();
      if (rect.bottom < viewportTop) continue;
      const idx = parseInt(pEl.getAttribute('data-tts-paragraph-index') || '0', 10);
      if (!Number.isNaN(idx)) {
        return clamp(idx, 0, paragraphCount - 1);
      }
      break;
    }

    return 0;
  }, []);

  const handleTtsStart = useCallback(() => {
    if (!ttsConfig || validateTtsConfig(ttsConfig)) return;

    // Build paragraph infos from current chapter
    const paraInfos = paragraphMeta.map((p, i) => ({
      text: p.text,
      start: p.start,
      end: p.end,
      index: i,
    }));
    if (paraInfos.length === 0) return;

    const startParagraph = resolveTtsStartParagraphFromViewport(paraInfos.length);

    const chIdx = selectedChapterIndex;
    let chunks = buildTtsChunks(paraInfos, chIdx, startParagraph, ttsConfig.chunkSize);
    chunks = prependTitleChunk(chunks, startParagraph, chIdx);
    if (chunks.length === 0) return;

    const ttsAudio = ensureTtsAudioElement();
    ttsControllerRef.current?.destroy();
    const bookId = activeBook?.id || '';
    const ctrl = new TtsPlaybackController(ttsAudio, ttsConfig, makeTtsCallbacks(), bookId);
    ttsControllerRef.current = ctrl;
    ctrl.start(chunks);
    setTtsResumePosition(undefined);
  }, [ttsConfig, paragraphMeta, selectedChapterIndex, scrollToParagraph, activeBook, prependTitleChunk, makeTtsCallbacks, ensureTtsAudioElement, resolveTtsStartParagraphFromViewport]);

  const handleTtsStop = useCallback(() => {
    ttsAutoStartTaskIdRef.current += 1;
    setTtsAutoStartNextChapter(false);
    ttsControllerRef.current?.stop();
    ttsControllerRef.current = null;
    setTtsPlaybackState(null);
    setTtsActiveParagraphIndex(null);
  }, []);

  const handleTtsPause = useCallback(() => {
    ttsControllerRef.current?.pause();
  }, []);

  const handleTtsResume = useCallback(() => {
    ttsControllerRef.current?.resume();
  }, []);

  const handleTtsPresetSelect = useCallback((presetId: string) => {
    const preset = ttsPresets?.find(p => p.id === presetId);
    if (preset && setTtsConfig) {
      setTtsConfig(preset.config);
      if (ttsControllerRef.current) {
        ttsControllerRef.current.updateConfig(preset.config);
      }
    }
  }, [ttsPresets, setTtsConfig]);

  const handleTtsLanguageChange = useCallback((language: string) => {
    if (!ttsConfig || !setTtsConfig) return;
    const updated = { ...ttsConfig, language };
    setTtsConfig(updated);
    if (ttsControllerRef.current) {
      ttsControllerRef.current.updateConfig(updated);
    }
  }, [ttsConfig, setTtsConfig]);

  const handleTtsClearCache = useCallback(async () => {
    if (ttsControllerRef.current) {
      await ttsControllerRef.current.clearAllAudioCache();
    } else if (activeBook?.id) {
      await clearBookTtsAudio(activeBook.id);
    }
    setTtsPersistentCachedParagraphs([]);
  }, [activeBook]);

  const ttsExportChapterOptions = useMemo(
    () => chapters.map((chapter, index) => ({
      value: String(index),
      label: chapter.title?.trim() || '未命名章节',
    })),
    [chapters],
  );

  const handleTtsExportAudiobook = useCallback(async (chapterIndices: number[], includeSubtitles: boolean) => {
    const bookId = activeBook?.id;
    if (!bookId) {
      throw new Error('未选择书籍，无法导出');
    }

    const result = await exportCachedTtsAudiobookZip({
      bookId,
      bookTitle: (activeBook?.title || '').trim() || 'book',
      chapters,
      chapterIndices,
      includeSubtitles,
    });

    const blobUrl = URL.createObjectURL(result.zipBlob);
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = result.zipFileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1200);

    const skippedReasons = result.chapterResults
      .filter((item) => !item.exported && item.reason)
      .map((item) => `${item.chapterTitle}：${item.reason as string}`);
    // Also report chapters that exported but had some chunks skipped due to decode failures
    for (const item of result.chapterResults) {
      if (item.exported && item.skippedChunks && item.skippedChunks > 0) {
        skippedReasons.push(`${item.chapterTitle}：有 ${item.skippedChunks} 段音频解码失败被跳过`);
      }
    }

    return {
      exportedCount: result.exportedCount,
      skippedCount: result.skippedCount,
      zipFileName: result.zipFileName,
      skippedReasons,
    };
  }, [activeBook?.id, activeBook?.title, chapters]);

  const handleTtsStartFromParagraph = useCallback((paragraphIndex: number) => {
    if (!ttsConfig || validateTtsConfig(ttsConfig)) return;
    const paraInfos = paragraphMeta.map((p, i) => ({
      text: p.text, start: p.start, end: p.end, index: i,
    }));
    if (paraInfos.length === 0) return;
    const chIdx = selectedChapterIndex;
    // -1 means start from chapter title; build chunks from paragraph 0 and prepend title
    const startParagraph = paragraphIndex === -1 ? 0 : paragraphIndex;
    let chunks = buildTtsChunks(paraInfos, chIdx, startParagraph, ttsConfig.chunkSize);
    chunks = prependTitleChunk(chunks, startParagraph, chIdx);
    if (chunks.length === 0) return;
    const ttsAudio = ensureTtsAudioElement();
    ttsControllerRef.current?.destroy();
    const bookId = activeBook?.id || '';
    const ctrl = new TtsPlaybackController(ttsAudio, ttsConfig, makeTtsCallbacks(), bookId);
    ttsControllerRef.current = ctrl;
    ctrl.start(chunks);
    setTtsResumePosition(undefined);
  }, [ttsConfig, paragraphMeta, selectedChapterIndex, activeBook, prependTitleChunk, makeTtsCallbacks, ensureTtsAudioElement]);

  const handleTtsJumpToParagraph = useCallback((paragraphIndex: number) => {
    const jumped = ttsControllerRef.current?.jumpToParagraph(paragraphIndex);
    if (jumped === false) {
      // Paragraph not in current chunks (e.g. before start position) — rebuild from this paragraph
      handleTtsStartFromParagraph(paragraphIndex);
    }
  }, [handleTtsStartFromParagraph]);

  const handleTtsRefreshParagraph = useCallback(async (paragraphIndex: number) => {
    setTtsRefreshingParagraphs(prev => new Set(prev).add(paragraphIndex));
    try {
      if (ttsControllerRef.current) {
        // TTS active: refresh via controller (deletes IndexedDB + re-fetches + plays)
        await ttsControllerRef.current.refreshParagraph(paragraphIndex);
      } else {
        // TTS not active: delete IndexedDB cache for this paragraph's chunks, then start playback
        const bookId = activeBook?.id;
        if (bookId && ttsConfig) {
          if (paragraphIndex === -1) {
            // Title chunk: delete by chapter title text
            const title = currentChapterTitle;
            if (title) {
              try { await deleteTtsAudio(bookId, selectedChapterIndex ?? 0, title); } catch { /* ignore */ }
            }
          } else {
            const paraInfos = paragraphMeta.map((p, i) => ({
              text: p.text, start: p.start, end: p.end, index: i,
            }));
            const chunks = buildTtsChunks(paraInfos, selectedChapterIndex, 0, ttsConfig.chunkSize);
            for (const chunk of chunks) {
              if (chunk.paragraphIndices.includes(paragraphIndex)) {
                try { await deleteTtsAudio(bookId, chunk.chapterIndex ?? 0, chunk.text); } catch { /* ignore */ }
              }
            }
          }
        }
        // Start TTS from this paragraph (will re-generate since cache was deleted)
        handleTtsStartFromParagraph(paragraphIndex);
      }
    } finally {
      setTtsRefreshingParagraphs(prev => {
        const next = new Set(prev);
        next.delete(paragraphIndex);
        return next;
      });
    }
  }, [activeBook?.id, ttsConfig, paragraphMeta, selectedChapterIndex, currentChapterTitle, handleTtsStartFromParagraph]);

  const handleTtsSpeedChange = useCallback((speed: number) => {
    if (ttsControllerRef.current) {
      ttsControllerRef.current.setSpeed(speed);
    }
    if (ttsConfig && setTtsConfig) {
      setTtsConfig({ ...ttsConfig, speed });
    }
  }, [ttsConfig, setTtsConfig]);

  const handleTtsResumeFromSaved = useCallback(() => {
    if (!ttsResumePosition || !ttsConfig || validateTtsConfig(ttsConfig)) return;

    // Navigate to the saved chapter if different
    if (ttsResumePosition.chapterIndex !== selectedChapterIndex) return;

    const paraInfos = paragraphMeta.map((p, i) => ({
      text: p.text, start: p.start, end: p.end, index: i,
    }));
    if (paraInfos.length === 0) return;

    const startParagraph = Math.min(ttsResumePosition.startParagraphIndex, paraInfos.length - 1);
    const chIdx = selectedChapterIndex;
    let chunks = buildTtsChunks(paraInfos, chIdx, startParagraph, ttsConfig.chunkSize);
    chunks = prependTitleChunk(chunks, startParagraph, chIdx);
    if (chunks.length === 0) return;

    const ttsAudio = ensureTtsAudioElement();
    ttsControllerRef.current?.destroy();
    const bookId = activeBook?.id || '';
    const ctrl = new TtsPlaybackController(ttsAudio, ttsConfig, makeTtsCallbacks(), bookId);
    ttsControllerRef.current = ctrl;
    ctrl.start(chunks);
    setTtsResumePosition(undefined);
  }, [ttsResumePosition, ttsConfig, selectedChapterIndex, paragraphMeta, activeBook, prependTitleChunk, makeTtsCallbacks, ensureTtsAudioElement]);

  // Keep auto-advance ref up-to-date with latest chapter state
  useEffect(() => {
    ttsAutoAdvanceRef.current = () => {
      if (selectedChapterIndex === null || !chapters.length) {
        setTtsActiveParagraphIndex(null);
        setTtsPlaybackState(null);
        return;
      }
      const nextIdx = selectedChapterIndex + 1;
      if (nextIdx >= chapters.length) {
        // Last chapter — playback complete
        setTtsActiveParagraphIndex(null);
        setTtsPlaybackState(null);
        return;
      }
      // Switch to next chapter without stopping TTS state
      const nextChapter = chapters[nextIdx];
      if (!nextChapter) {
        setTtsActiveParagraphIndex(null);
        setTtsPlaybackState(null);
        return;
      }
      ttsControllerRef.current?.destroy();
      ttsControllerRef.current = null;
      setSelectedChapterIndex(nextIdx);
      setBookText(nextChapter.content || '');
      scrollReaderTo('top');
      ttsAutoStartModeRef.current = 'chapter_start';
      ttsAutoStartTaskIdRef.current += 1;
      setTtsAutoStartNextChapter(true);
    };
  }, [selectedChapterIndex, chapters]);

  // Auto-start TTS after chapter switch triggered by auto-advance
  useEffect(() => {
    if (!ttsAutoStartNextChapter || paragraphMeta.length === 0 || !ttsConfig) return;
    const taskId = ++ttsAutoStartTaskIdRef.current;
    setTtsAutoStartNextChapter(false);

    const autoStartMode = ttsAutoStartModeRef.current;
    ttsAutoStartModeRef.current = 'chapter_start';

    const waitFrames = (count: number) => new Promise<void>((resolve) => {
      const next = (remaining: number) => {
        if (remaining <= 0) {
          resolve();
          return;
        }
        window.requestAnimationFrame(() => next(remaining - 1));
      };
      next(count);
    });

    (async () => {
      if (autoStartMode === 'viewport') {
        // Wait for chapter scroll positioning to settle before resolving visible paragraph.
        await waitFrames(3);
      }
      if (taskId !== ttsAutoStartTaskIdRef.current) return;

      const paraInfos = paragraphMeta.map((p, i) => ({
        text: p.text, start: p.start, end: p.end, index: i,
      }));
      const chIdx = selectedChapterIndex;
      const startParagraph = autoStartMode === 'viewport'
        ? resolveTtsStartParagraphFromViewport(paraInfos.length)
        : 0;

      let chunks = buildTtsChunks(paraInfos, chIdx, startParagraph, ttsConfig.chunkSize);
      chunks = prependTitleChunk(chunks, startParagraph, chIdx);
      if (chunks.length === 0) {
        setTtsActiveParagraphIndex(null);
        setTtsPlaybackState(null);
        return;
      }
      if (taskId !== ttsAutoStartTaskIdRef.current) return;

      const ttsAudio = ensureTtsAudioElement();
      const bookId = activeBook?.id || '';
      const ctrl = new TtsPlaybackController(ttsAudio, ttsConfig, makeTtsCallbacks(), bookId);
      if (taskId !== ttsAutoStartTaskIdRef.current) return;
      ttsControllerRef.current = ctrl;
      ctrl.start(chunks);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsAutoStartNextChapter, paragraphMeta, ensureTtsAudioElement, resolveTtsStartParagraphFromViewport]);

  // Load persistent cached paragraph indices from IndexedDB on chapter change
  const ttsCacheVersionRef = useRef(0);
  const refreshTtsPersistentCache = useCallback(() => { ttsCacheVersionRef.current++; }, []);
  useEffect(() => {
    const bookId = activeBook?.id;
    if (!bookId || selectedChapterIndex == null || !ttsConfig || paragraphMeta.length === 0) {
      setTtsPersistentCachedParagraphs([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const cachedTexts = await getChapterCachedChunkTexts(bookId, selectedChapterIndex);
        if (cancelled || cachedTexts.size === 0) {
          if (!cancelled) setTtsPersistentCachedParagraphs([]);
          return;
        }
        // Build chunks to map cached texts → paragraph indices
        const paraInfos = paragraphMeta.map((p, i) => ({
          text: p.text, start: p.start, end: p.end, index: i,
        }));
        const chunks = buildTtsChunks(paraInfos, selectedChapterIndex, 0, ttsConfig.chunkSize);
        const cachedIndicesSet = new Set<number>();
        // Check if chapter title audio is cached
        const chTitle = chapters[selectedChapterIndex]?.title?.trim();
        if (chTitle && cachedTexts.has(chTitle)) {
          cachedIndicesSet.add(-1);
        }
        for (const chunk of chunks) {
          if (cachedTexts.has(chunk.text)) {
            for (const idx of chunk.paragraphIndices) cachedIndicesSet.add(idx);
          }
        }
        if (!cancelled) setTtsPersistentCachedParagraphs(Array.from(cachedIndicesSet));
      } catch {
        if (!cancelled) setTtsPersistentCachedParagraphs([]);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBook?.id, selectedChapterIndex, paragraphMeta, ttsConfig?.chunkSize, ttsCacheVersionRef.current]);

  // Refresh persistent cache when TTS playback state changes (new audio generated)
  useEffect(() => {
    if (ttsPlaybackState) refreshTtsPersistentCache();
  }, [ttsPlaybackState, refreshTtsPersistentCache]);

  const clearHighlightDragState = () => {
    setPendingHighlightRange(null);
    highlightDragRef.current = { active: false, pointerId: null, startIndex: null };
    touchPointerDragActiveRef.current = false;
  };

  const clearHighlightTouchDragState = () => {
    setPendingHighlightRange(null);
    highlightTouchDragRef.current = { active: false, touchId: null, startIndex: null };
  };

  const findTouchById = (touches: TouchList, touchId: number | null) => {
    if (touchId === null) return null;
    for (let i = 0; i < touches.length; i += 1) {
      const touch = touches.item(i);
      if (touch && touch.identifier === touchId) {
        return touch;
      }
    }
    return null;
  };

  const handleReaderTextPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (!isHighlightMode) return;
    if (e.pointerType !== 'touch' && e.button !== 0) return;

    const index = getCharacterIndexFromPoint(e.clientX, e.clientY, e.target);
    if (index === null) return;

    e.preventDefault();
    e.stopPropagation();
    window.getSelection()?.removeAllRanges();

    highlightDragRef.current = {
      active: true,
      pointerId: e.pointerId,
      startIndex: index,
    };
    setPendingHighlightRange({ start: index, end: index, color: highlightColor });
    if (e.pointerType === 'touch') {
      touchPointerDragActiveRef.current = true;
    }
    safeSetPointerCapture(e.currentTarget, e.pointerId);
  };

  const handleReaderTextPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!isHighlightMode) return;

    const dragState = highlightDragRef.current;
    if (!dragState.active || dragState.pointerId !== e.pointerId) return;

    const index = getCharacterIndexFromPoint(e.clientX, e.clientY, e.target);
    if (index === null || dragState.startIndex === null) return;

    e.preventDefault();
    window.getSelection()?.removeAllRanges();

    setPendingHighlightRange(buildHighlightStroke(dragState.startIndex, index));
  };

  const handleReaderTextPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (!isHighlightMode) return;

    const dragState = highlightDragRef.current;
    if (!dragState.active || dragState.pointerId !== e.pointerId) return;

    e.preventDefault();
    window.getSelection()?.removeAllRanges();

    const index = getCharacterIndexFromPoint(e.clientX, e.clientY, e.target) ?? dragState.startIndex;
    if (index !== null && dragState.startIndex !== null) {
      commitHighlightRange(buildHighlightStroke(dragState.startIndex, index));
    }

    safeReleasePointerCapture(e.currentTarget, e.pointerId);
    clearHighlightDragState();
  };

  const handleReaderTextPointerCancel = (e: React.PointerEvent<HTMLElement>) => {
    safeReleasePointerCapture(e.currentTarget, e.pointerId);
    clearHighlightDragState();
  };

  const handleReaderTextTouchStart = (e: React.TouchEvent<HTMLElement>) => {
    if (!isHighlightMode) return;
    if (touchPointerDragActiveRef.current) return;

    const touch = e.changedTouches[0];
    if (!touch) return;

    const index = getCharacterIndexFromPoint(touch.clientX, touch.clientY, e.target);
    if (index === null) return;

    e.preventDefault();
    e.stopPropagation();
    window.getSelection()?.removeAllRanges();

    highlightTouchDragRef.current = {
      active: true,
      touchId: touch.identifier,
      startIndex: index,
    };
    setPendingHighlightRange({ start: index, end: index, color: highlightColor });
  };

  const handleReaderTextTouchMove = (e: React.TouchEvent<HTMLElement>) => {
    if (!isHighlightMode) return;
    if (touchPointerDragActiveRef.current) return;

    const dragState = highlightTouchDragRef.current;
    if (!dragState.active || dragState.touchId === null || dragState.startIndex === null) return;

    const touch = findTouchById(e.touches, dragState.touchId) || findTouchById(e.changedTouches, dragState.touchId);
    if (!touch) return;

    const pointTarget = document.elementFromPoint(touch.clientX, touch.clientY);
    const index = getCharacterIndexFromPoint(touch.clientX, touch.clientY, pointTarget);
    if (index === null) return;

    e.preventDefault();
    e.stopPropagation();
    window.getSelection()?.removeAllRanges();

    setPendingHighlightRange(buildHighlightStroke(dragState.startIndex, index));
  };

  const handleReaderTextTouchEnd = (e: React.TouchEvent<HTMLElement>) => {
    if (!isHighlightMode) return;
    if (touchPointerDragActiveRef.current) return;

    const dragState = highlightTouchDragRef.current;
    if (!dragState.active || dragState.touchId === null || dragState.startIndex === null) return;

    const touch = findTouchById(e.changedTouches, dragState.touchId);
    const pointTarget = touch ? document.elementFromPoint(touch.clientX, touch.clientY) : e.target;
    const index = touch
      ? getCharacterIndexFromPoint(touch.clientX, touch.clientY, pointTarget)
      : dragState.startIndex;
    const resolvedIndex = index ?? dragState.startIndex;

    e.preventDefault();
    e.stopPropagation();
    window.getSelection()?.removeAllRanges();

    if (resolvedIndex !== null) {
      commitHighlightRange(buildHighlightStroke(dragState.startIndex, resolvedIndex));
    }

    clearHighlightTouchDragState();
  };

  const handleReaderTextTouchCancel = (e: React.TouchEvent<HTMLElement>) => {
    if (!isHighlightMode) return;
    if (touchPointerDragActiveRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    clearHighlightTouchDragState();
  };

  const handleHighlighterButtonClick = () => {
    if (highlighterClickTimerRef.current) {
      window.clearTimeout(highlighterClickTimerRef.current);
      highlighterClickTimerRef.current = null;
      setIsHighlighterClickPending(false);
      openHighlighterPanel();
      return;
    }

    setIsHighlighterClickPending(true);
    highlighterClickTimerRef.current = window.setTimeout(() => {
      setIsHighlighterClickPending(false);
      setIsHighlightMode(prev => !prev);
      highlighterClickTimerRef.current = null;
    }, HIGHIGHTER_CLICK_DELAY_MS);
  };

  const updateHighlightDraftChannel = (channel: keyof RgbValue, value: number) => {
    const next = {
      ...highlightColorDraft,
      [channel]: clamp(Number.isNaN(value) ? 0 : value, 0, 255),
    };
    setHighlightColorDraft(next);
    setHighlightHexInput(rgbToHex(next));
  };

  const handleHighlightHexInputChange = (raw: string) => {
    const normalized = normalizeHexInput(raw);
    setHighlightHexInput(normalized);
    if (!isValidHexColor(normalized)) return;
    setHighlightColorDraft(hexToRgb(normalized));
  };

  const handleHighlightHexInputBlur = () => {
    if (isValidHexColor(highlightHexInput)) {
      setHighlightColorDraft(hexToRgb(highlightHexInput));
      return;
    }
    setHighlightHexInput(rgbToHex(highlightColorDraft));
  };

  const applyHighlightColorDraft = () => {
    commitHighlighterDraftColor();
    closeFloatingPanel({ discardDraft: true });
  };

  const updateReaderTypography = (patch: Partial<ReaderTypographyStyle>) => {
    setReaderTypography(prev => ({ ...prev, ...patch }));
  };

  const handleReaderColorInput = (kind: TypographyColorKind, raw: string) => {
    const normalized = normalizeHexInput(raw);
    if (kind === 'textColor') {
      setReaderTextColorInput(normalized);
    } else {
      setReaderBgColorInput(normalized);
    }
    if (isValidHexColor(normalized)) {
      updateReaderTypography({ [kind]: normalized });
    }
  };

  const handleReaderColorBlur = (kind: TypographyColorKind) => {
    const current = kind === 'textColor' ? readerTextColorInput : readerBgColorInput;
    if (isValidHexColor(current)) {
      updateReaderTypography({ [kind]: current });
      return;
    }
    if (kind === 'textColor') {
      setReaderTextColorInput(readerTypography.textColor);
    } else {
      setReaderBgColorInput(readerTypography.backgroundColor);
    }
  };

  const getReaderColorValue = (kind: TypographyColorKind) =>
    kind === 'textColor' ? readerTypography.textColor : readerTypography.backgroundColor;

  const setReaderColorValue = (kind: TypographyColorKind, color: string) => {
    const normalized = normalizeHexInput(color);
    if (!isValidHexColor(normalized)) return;
    if (kind === 'textColor') {
      setReaderTextColorInput(normalized);
      updateReaderTypography({ textColor: normalized });
    } else {
      setReaderBgColorInput(normalized);
      updateReaderTypography({ backgroundColor: normalized });
    }
  };

  const updateReaderColorChannel = (kind: TypographyColorKind, channel: keyof RgbValue, value: number) => {
    const currentHex = getReaderColorValue(kind);
    const nextRgb = {
      ...hexToRgb(currentHex),
      [channel]: clamp(Number.isNaN(value) ? 0 : value, 0, 255),
    };
    setReaderColorValue(kind, rgbToHex(nextRgb));
  };

  const resetReaderFontSize = () => {
    const defaults = getDefaultReaderTypography(isDarkMode);
    updateReaderTypography({ fontSizePx: defaults.fontSizePx });
  };

  const resetReaderLineHeight = () => {
    const defaults = getDefaultReaderTypography(isDarkMode);
    updateReaderTypography({ lineHeight: defaults.lineHeight });
  };

  const resetReaderColor = (kind: TypographyColorKind) => {
    const defaults = getDefaultReaderTypography(isDarkMode);
    const value = kind === 'textColor' ? defaults.textColor : defaults.backgroundColor;
    setReaderColorValue(kind, value);
  };

  const appendReaderFontOption = (option: ReaderFontOption) => {
    const existing = readerFontOptions.find(item => item.family === option.family || item.label === option.label);
    if (existing) {
      setSelectedReaderFontId(existing.id);
      return;
    }
    setReaderFontOptions(prev => [option, ...prev]);
    setSelectedReaderFontId(option.id);
  };

  const registerFontFaceFromSource = async (fontFamily: string, sourceUrl: string) => {
    const fontFace = new FontFace(fontFamily, `url("${sourceUrl}")`);
    const loaded = await fontFace.load();
    document.fonts.add(loaded);
  };

  const waitForStylesheetReady = (link: HTMLLinkElement, url: string) => {
    const cached = fontCssLoadPromiseByUrlRef.current.get(url);
    if (cached) return cached;

    const pending = new Promise<void>((resolve) => {
      if (link.dataset.readerFontLoaded === '1') {
        resolve();
        return;
      }

      let settled = false;
      let timeoutId: number | null = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        link.dataset.readerFontLoaded = '1';
        link.removeEventListener('load', finish);
        link.removeEventListener('error', finish);
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }
        resolve();
      };

      link.addEventListener('load', finish);
      link.addEventListener('error', finish);

      // If stylesheet is already attached and parsed, resolve immediately.
      if (link.sheet) {
        finish();
        return;
      }

      timeoutId = window.setTimeout(finish, 1800);
    });

    fontCssLoadPromiseByUrlRef.current.set(url, pending);
    return pending;
  };

  const warmUpReaderFontFamily = async (family: string, timeoutMs = 1200) => {
    const primaryFamily = normalizeStoredFontFamily(family);
    if (!primaryFamily) return;

    await Promise.race([
      document.fonts
        .load(`16px "${primaryFamily}"`)
        .then(() => undefined)
        .catch(() => undefined),
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, timeoutMs);
      }),
    ]);
  };

  const ensureReaderFontResource = async (option: ReaderFontOption) => {
    if (option.sourceType === 'default' || !option.sourceUrl) return;

    if (option.sourceType === 'css') {
      const url = option.sourceUrl;
      const existingFromRef = fontLinkNodesRef.current.find(node => node.href === url);
      if (existingFromRef) {
        await waitForStylesheetReady(existingFromRef, url);
        await warmUpReaderFontFamily(option.family);
        return;
      }
      const existingInDocument = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).find(
        node => node.href === url
      );
      if (existingInDocument) {
        fontLinkNodesRef.current.push(existingInDocument);
        await waitForStylesheetReady(existingInDocument, url);
        await warmUpReaderFontFamily(option.family);
        return;
      }

      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = url;
      link.dataset.readerFont = '1';
      document.head.appendChild(link);
      fontLinkNodesRef.current.push(link);
      await waitForStylesheetReady(link, url);
      await warmUpReaderFontFamily(option.family);
      return;
    }

    const fontFamilyName = normalizeStoredFontFamily(option.family) || sanitizeFontFamily(option.label);
    if (!fontFamilyName) return;
    // document.fonts.check() 对未注册的字体族名会返回 true（无需加载 = 通过），
    // 导致首次加载外部字体时直接跳过 registerFontFaceFromSource。
    // 改为遍历已注册的 FontFace 条目判断是否已加载。
    const alreadyLoaded = Array.from(document.fonts).some(
      (face) => face.family === fontFamilyName && face.status === 'loaded',
    );
    if (alreadyLoaded) return;
    await registerFontFaceFromSource(fontFamilyName, option.sourceUrl);
    await warmUpReaderFontFamily(fontFamilyName);
  };

  const handleApplyFontUrl = async () => {
    const url = fontUrlInput.trim();
    const fontFamily = sanitizeFontFamily(fontFamilyInput);
    if (!fontFamily) {
      setFontPanelMessage('\u8bf7\u8f93\u5165\u5b57\u4f53\u540d\u79f0');
      return;
    }
    if (!url) {
      setFontPanelMessage('\u8bf7\u8f93\u5165\u5b57\u4f53\u94fe\u63a5');
      return;
    }

    try {
      const parsed = new URL(url);
      const isCssSource = parsed.hostname.includes('fonts.googleapis.com') || /\.css($|\?)/i.test(parsed.pathname);
      const nextOption: ReaderFontOption = {
        id: `reader-font-url-${Date.now()}`,
        label: fontFamily,
        family: `"${fontFamily}"`,
        sourceType: isCssSource ? 'css' : 'font',
        sourceUrl: url,
      };
      await ensureReaderFontResource(nextOption);
      appendReaderFontOption(nextOption);
      setFontPanelMessage('\u5df2\u4fdd\u5b58\u5b57\u4f53');
      setIsReaderFontDropdownOpen(false);
    } catch (error) {
      setFontPanelMessage('\u5b57\u4f53\u94fe\u63a5\u65e0\u6548\u6216\u52a0\u8f7d\u5931\u8d25');
      console.error('Failed to apply font URL:', error);
    }
  };

  const handleDeleteFontPreset = () => {
    if (BUILTIN_READER_FONT_ID_SET.has(selectedReaderFontId)) return;
    setReaderFontOptions(prev => prev.filter(o => o.id !== selectedReaderFontId));
    setSelectedReaderFontId(DEFAULT_READER_FONT_ID);
    setFontPanelMessage('已删除字体预设');
  };

  const resetReaderFontOnly = () => {
    setSelectedReaderFontId(DEFAULT_READER_FONT_ID);
    setFontPanelMessage('\u5df2\u91cd\u7f6e\u5b57\u4f53');
  };

  const resetReaderTypography = () => {
    const defaults = getDefaultReaderTypography(isDarkMode);
    setReaderTypography(defaults);
    setSelectedReaderFontId(DEFAULT_READER_FONT_ID);
    setFontPanelMessage('\u5df2\u6062\u590d\u9ed8\u8ba4\u6b63\u6587\u6837\u5f0f');
  };

  const buildReaderSessionSnapshot = (): ReaderSessionSnapshot | null => {
    if (!activeBook?.id) return null;

    const now = Date.now();
    const readingPosition = syncReadingPositionRef(now) || latestReadingPositionRef.current;
    if (!readingPosition) return null;

    const safeTotalLength = Math.max(0, readingPosition.totalLength);
    const safeGlobalOffset = clamp(readingPosition.globalCharOffset, 0, safeTotalLength);
    const progress = safeTotalLength > 0 ? Math.round(clamp((safeGlobalOffset / safeTotalLength) * 100, 0, 100)) : 0;

    const normalizedPosition: ReaderPositionState = {
      ...readingPosition,
      globalCharOffset: safeGlobalOffset,
      totalLength: safeTotalLength,
      updatedAt: now,
    };

    latestReadingPositionRef.current = normalizedPosition;

    return {
      bookId: activeBook.id,
      progress,
      lastReadAt: now,
      readingPosition: normalizedPosition,
    };
  };

  const handleBackClick = () => {
    const sessionSnapshot = buildReaderSessionSnapshot();
    if (sessionSnapshot) {
      // Save TTS resume position if currently playing
      let ttsResumePosition: ReaderBookState['ttsResumePosition'];
      if (ttsControllerRef.current && ttsPlaybackState?.isActive) {
        const pIdx = ttsControllerRef.current.getCurrentParagraphIndex();
        if (pIdx >= 0) {
          ttsResumePosition = {
            chapterIndex: selectedChapterIndex,
            startParagraphIndex: pIdx,
          };
        }
      }
      const scroller = readerScrollRef.current;
      const visibleRatio =
        scroller && scroller.scrollHeight > 1
          ? clamp(scroller.clientHeight / scroller.scrollHeight, 0, 1)
          : 0;
      const visibleTextRange = scroller
        ? (appSettings.readerMore.feature.readingContextIgnorePanelClip
            ? resolveFullViewportTextRange(scroller)
            : resolveVisibleReaderTextRange(scroller))
        : null;
      const readerState: ReaderBookState = {
        highlightColor,
        highlightsByChapter: highlightRangesByChapter,
        bookmarks: sortedBookmarks,
        vocabularyEntries,
        readingPosition: sessionSnapshot.readingPosition,
        visibleRatio,
        activeChapterRenderedText: readerTextForHighlighting,
        ...(visibleTextRange ? { visibleTextRange } : {}),
        ...(ttsResumePosition ? { ttsResumePosition } : {}),
      };
      saveBookReaderState(sessionSnapshot.bookId, readerState).catch((error) => {
        console.error('Failed to persist reader state on exit:', error);
      });
    }
    // Stop TTS on exit
    ttsControllerRef.current?.destroy();
    ttsControllerRef.current = null;
    onBack(sessionSnapshot || undefined);
  };

  const isHighlighterVisualActive = isHighlightMode || isHighlighterClickPending;
  const highlighterToggleColor = isHighlightMode ? highlightColor : '#64748B';
  const highlighterToggleStyle = { color: highlighterToggleColor } as React.CSSProperties;
  const typographyToggleStyle = { color: '#64748B' } as React.CSSProperties;
  const floatingPanelAnchorStyle = { top: `${floatingPanelTopPx}px` } as React.CSSProperties;
  const typographyInputClass = `h-8 rounded-md px-2 text-[11px] outline-none ${isDarkMode ? 'bg-[#111827] text-slate-200 placeholder-slate-500' : 'bg-white/70 text-slate-700 placeholder-slate-400'}`;
  const typographySelectTriggerClass = `w-full h-8 rounded-md px-2 flex items-center justify-between cursor-pointer transition-all active:scale-[0.99] ${isDarkMode ? 'bg-[#111827] text-slate-200' : 'bg-white/70 text-slate-700'}`;
  const typographyIconButtonClass = `w-8 h-8 rounded-full flex items-center justify-center transition-all ${isDarkMode ? 'bg-[#111827] text-slate-300 hover:text-white' : 'neu-btn text-slate-500 hover:text-slate-700'}`;
  const getTypographyAlignButtonClass = (value: ReaderTextAlign) => {
    const isActive = readerTypography.textAlign === value;
    if (isDarkMode) {
      return `h-8 flex-1 rounded-lg flex items-center justify-center gap-1.5 text-[11px] font-semibold transition-all active:scale-[0.98] ${
        isActive
          ? 'bg-[#111827] text-rose-300 shadow-[inset_3px_3px_6px_#0b1220,inset_-3px_-3px_6px_#1f2937]'
          : 'bg-[#111827] text-slate-300 hover:text-white shadow-[3px_3px_6px_#0b1220,-3px_-3px_6px_#1f2937]'
      }`;
    }
    return `h-8 flex-1 rounded-lg flex items-center justify-center gap-1.5 text-[11px] font-semibold transition-all active:scale-[0.98] ${
      isActive ? 'neu-pressed text-rose-400' : 'neu-btn text-slate-500 hover:text-slate-700'
    }`;
  };
  const selectedReaderFontFamily =
    readerFontOptions.find(option => option.id === selectedReaderFontId)?.family ||
    DEFAULT_READER_FONT_OPTIONS.find(option => option.id === DEFAULT_READER_FONT_ID)?.family ||
    DEFAULT_READER_FONT_OPTIONS[0].family;
  const readerScrollStyle = {
    touchAction: isHighlightMode ? 'none' : 'pan-y',
    backgroundColor: readerTypography.backgroundColor,
  } as React.CSSProperties;
  const readerArticleStyle = {
    fontSize: `${readerTypography.fontSizePx}px`,
    lineHeight: readerTypography.lineHeight,
    color: readerTypography.textColor,
    fontFamily: selectedReaderFontFamily,
    fontKerning: 'normal',
    fontVariantEastAsian: 'normal',
    fontFeatureSettings: '"kern" 1, "liga" 1',
    textAlign: readerTypography.textAlign,
    ['--tw-prose-body' as string]: readerTypography.textColor,
    ['--tw-prose-headings' as string]: readerTypography.textColor,
    ['--tw-prose-links' as string]: readerTypography.textColor,
    ['--tw-prose-bold' as string]: readerTypography.textColor,
    ['--tw-prose-counters' as string]: readerTypography.textColor,
    ['--tw-prose-bullets' as string]: readerTypography.textColor,
  } as React.CSSProperties;
  const renderTypographyColorEditor = (kind: TypographyColorKind, label: string) => {
    const colorValue = getReaderColorValue(kind);
    const inputValue = kind === 'textColor' ? readerTextColorInput : readerBgColorInput;
    const presetColors = kind === 'textColor' ? PRESET_TEXT_COLORS : PRESET_BACKGROUND_COLORS;
    const colorRgb = hexToRgb(colorValue);
    const isClosing = closingTypographyColorEditor === kind;
    const shouldRenderPanel = activeTypographyColorEditor === kind || isClosing;

    return (
      <div className={`rounded-xl p-2 ${isDarkMode ? 'bg-[#1a202c]' : 'neu-pressed'}`}>
        <div className="flex items-center gap-2">
          <span className="w-14 text-[11px] font-semibold text-slate-500">{label}</span>
          <button
            type="button"
            onClick={() => toggleTypographyColorEditor(kind)}
            className="h-8 w-10 rounded-lg shrink-0"
            style={{ backgroundColor: colorValue }}
            title={label}
          />
          <input
            type="text"
            value={inputValue}
            onChange={(e) => handleReaderColorInput(kind, e.target.value)}
            onBlur={() => handleReaderColorBlur(kind)}
            maxLength={7}
            spellCheck={false}
            className={`flex-1 font-mono uppercase text-center ${typographyInputClass}`}
          />
          <button
            type="button"
            onClick={() => resetReaderColor(kind)}
            className={typographyIconButtonClass}
            title={`重置${label}`}
          >
            <RotateCcw size={13} />
          </button>
        </div>

        {shouldRenderPanel && (
          <div className={`mt-1.5 rounded-lg p-1.5 space-y-2 ${isClosing ? 'reader-flyout-exit' : 'reader-flyout-enter'}`}>
            <div className="grid grid-cols-6 gap-1.5">
              {presetColors.map(color => (
                <button
                  key={`${kind}-${color}`}
                  type="button"
                  onClick={() => setReaderColorValue(kind, color)}
                  className={`h-6 rounded-md transition-transform hover:scale-[1.03] active:scale-[0.98] ${
                    colorValue.toUpperCase() === color ? 'ring-2 ring-rose-400/70' : ''
                  }`}
                  style={{ backgroundColor: color }}
                  aria-label={`${kind}-preset-${color}`}
                />
              ))}
            </div>

            <div className="space-y-1.5">
              {(['r', 'g', 'b'] as const).map(channel => (
                <div key={`${kind}-${channel}`} className="flex items-center gap-2">
                  <span className="w-4 text-[10px] font-bold uppercase text-slate-500">{channel}</span>
                  <div className="relative flex-1 h-2">
                    <div className={`absolute inset-0 rounded-full ${isDarkMode ? 'bg-slate-700' : 'bg-black/10'}`} />
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-rose-300"
                      style={{ width: `${(colorRgb[channel] / 255) * 100}%` }}
                    />
                    <input
                      type="range"
                      min="0"
                      max="255"
                      value={colorRgb[channel]}
                      onChange={(e) => updateReaderColorChannel(kind, channel, parseInt(e.target.value, 10))}
                      className="app-range absolute top-1/2 -translate-y-1/2 left-0 w-full h-5 bg-transparent appearance-none cursor-pointer z-10"
                    />
                  </div>
                  <input
                    type="number"
                    min="0"
                    max="255"
                    value={colorRgb[channel]}
                    onChange={(e) => updateReaderColorChannel(kind, channel, parseInt(e.target.value || '0', 10))}
                    className={`w-11 h-6 text-center text-[10px] rounded-md outline-none ${isDarkMode ? 'bg-[#111827] text-slate-200' : 'bg-white/70 text-slate-700'} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      ref={readerRootRef}
      className={`flex flex-col h-full min-h-0 relative overflow-hidden transition-colors duration-300 ${
        isDarkMode ? 'dark-mode bg-[#2d3748] text-slate-300' : 'bg-[#e0e5ec] text-slate-700'
      }`}
      style={{ paddingTop: `${Math.max(0, safeAreaTop)}px`, paddingBottom: `${Math.max(0, safeAreaBottom)}px` }}
    >
      {ttsErrorToast.show && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[110] pointer-events-none transition-all duration-300"
          style={{ top: `${Math.max(0, safeAreaTop) + 24}px` }}
        >
          <div
            className={`w-[min(94vw,760px)] px-8 py-4 rounded-[28px] flex items-center gap-4 border backdrop-blur-md ${
              isDarkMode
                ? 'bg-[#2d3748]/95 text-slate-200 border-slate-700/70 shadow-[8px_8px_16px_#232b39,-8px_-8px_16px_#374357]'
                : 'bg-[#e0e5ec]/95 text-slate-600 border-white/20 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.8)]'
            }`}
          >
            <AlertCircle size={28} className="text-rose-400 flex-shrink-0" />
            <span className="font-bold text-xs sm:text-sm leading-snug">
              {ttsErrorToast.message}
            </span>
          </div>
        </div>
      )}
      {vocabularyToast && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[109] pointer-events-none transition-all duration-300"
          style={{ top: `${Math.max(0, safeAreaTop) + 86}px` }}
        >
          <div
            className={`w-[min(92vw,520px)] px-5 py-3 rounded-[22px] flex items-center gap-3 border backdrop-blur-md ${
              isDarkMode
                ? 'bg-[#2d3748]/95 text-slate-200 border-slate-700/70 shadow-[8px_8px_16px_#232b39,-8px_-8px_16px_#374357]'
                : 'bg-[#e0e5ec]/95 text-slate-600 border-white/20 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.8)]'
            }`}
          >
            <Plus size={18} className="text-rose-400 flex-shrink-0" />
            <span className="font-semibold text-xs sm:text-sm leading-snug">{vocabularyToast}</span>
          </div>
        </div>
      )}

      <div className={`flex items-center gap-3 p-4 z-10 transition-colors ${isDarkMode ? 'bg-[#2d3748]' : 'bg-[#e0e5ec]'}`}>
        <button onClick={handleBackClick} className="w-10 h-10 neu-btn rounded-full text-slate-500 hover:text-slate-700 shrink-0">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0 max-w-[calc(100%-14rem)]">
          <div className="text-sm font-serif font-medium opacity-70 truncate">{activeBook?.title || '\u9605\u8bfb\u4e2d'}</div>
        </div>
        <div className="flex gap-3 shrink-0">
          <button
            onClick={toggleTocPanel}
            className="w-10 h-10 neu-btn rounded-full text-slate-500 hover:text-rose-400"
            title="\u76ee\u5f55"
          >
            <ListIcon size={18} />
          </button>
          <button
            onClick={handleBookmarkButtonClick}
            className={`w-10 h-10 neu-btn reader-tool-toggle rounded-full ${isBookmarkModalOpen ? 'reader-tool-active' : ''}`}
            style={typographyToggleStyle}
            title={'\u6dfb\u52a0\u4e66\u7b7e'}
          >
            <Bookmark size={18} />
          </button>
          <button
            onClick={handleHighlighterButtonClick}
            className={`w-10 h-10 neu-btn reader-tool-toggle rounded-full ${isHighlighterVisualActive ? 'reader-tool-active' : ''}`}
            style={highlighterToggleStyle}
            title={'\u8367\u5149\u7b14'}
          >
            <Highlighter size={18} />
          </button>
          <button
            onClick={handleAddVocabularyFromSelection}
            className="w-10 h-10 neu-btn rounded-full text-slate-500 hover:text-rose-400"
            style={typographyToggleStyle}
            title={'\u6dfb\u52a0\u751f\u8bcd'}
          >
            <Plus size={18} />
          </button>
          <button
            onClick={() => setIsMoreSettingsOpen(true)}
            className={`w-10 h-10 neu-btn reader-tool-toggle rounded-full ${isMoreSettingsOpen ? 'reader-tool-active' : ''}`}
            style={typographyToggleStyle}
            title="更多设置"
          >
            <MoreHorizontal size={18} />
          </button>
        </div>
      </div>

      {isFloatingPanelVisible && (
        <>
          <button
            aria-label="close-floating-panel"
            className={`absolute inset-0 z-40 bg-black/35 backdrop-blur-sm ${closingFloatingPanel ? 'app-fade-exit' : 'app-fade-enter'}`}
            onClick={closeFloatingPanel}
          />
          {isTocOpen && (
            <div
              onTouchStart={handleTocPanelTouchStart}
              onTouchEnd={handleTocPanelTouchEnd}
              className={`absolute z-50 right-4 w-[min(22rem,calc(100vw-2rem))] h-[32vh] overflow-hidden rounded-2xl p-2 border ${isDarkMode ? 'bg-[#2d3748] border-slate-600 shadow-2xl' : 'bg-[#e0e5ec] border-white/50 shadow-2xl'} ${closingFloatingPanel === 'toc' ? 'reader-flyout-exit' : 'reader-flyout-enter'} flex flex-col`}
              style={floatingPanelAnchorStyle}
            >
              <div className="px-1 pb-2">
                <div className={`rounded-xl p-1 ${isDarkMode ? 'bg-[#1a202c]' : 'neu-pressed'}`}>
                  <div className="relative grid grid-cols-3">
                    <div
                      className="pointer-events-none absolute inset-y-0 left-0 w-1/3 transition-transform duration-300"
                      style={{ transform: `translateX(${(tocPanelTab === 'toc' ? 0 : tocPanelTab === 'bookmarks' ? 1 : 2) * 100}%)` }}
                    >
                      <div className="h-full mx-[2px] rounded-lg bg-rose-400/10" />
                    </div>
                    <button
                      type="button"
                      onClick={() => switchTocTab('toc')}
                      className={`relative z-10 h-8 rounded-lg text-xs font-bold transition-colors ${
                        tocPanelTab === 'toc' ? 'text-rose-400' : isDarkMode ? 'text-slate-300 hover:text-white' : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      {`\u76ee\u5f55 ${chapters.length > 0 ? `(${chapters.length})` : ''}`}
                    </button>
                    <button
                      type="button"
                      onClick={() => switchTocTab('bookmarks')}
                      className={`relative z-10 h-8 rounded-lg text-xs font-bold transition-colors ${
                        tocPanelTab === 'bookmarks' ? 'text-rose-400' : isDarkMode ? 'text-slate-300 hover:text-white' : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      {`\u4e66\u7b7e ${sortedBookmarks.length > 0 ? `(${sortedBookmarks.length})` : ''}`}
                    </button>
                    <button
                      type="button"
                      onClick={() => switchTocTab('highlights')}
                      className={`relative z-10 h-8 rounded-lg text-xs font-bold transition-colors ${
                        tocPanelTab === 'highlights' ? 'text-rose-400' : isDarkMode ? 'text-slate-300 hover:text-white' : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      {`\u9ad8\u4eae ${totalHighlightCount > 0 ? `(${totalHighlightCount})` : ''}`}
                    </button>
                  </div>
                </div>
              </div>
              <div ref={tocListRef} className="flex-1 overflow-y-auto no-scrollbar px-1 pb-1">
                <div style={{ display: tocPanelTab === 'toc' ? undefined : 'none' }}>
                    {chapters.length === 0 && (
                      <div className="text-xs text-slate-400 px-2 py-3">{'\u5f53\u524d\u56fe\u4e66\u6ca1\u6709\u7ae0\u8282\u6570\u636e\uff0c\u5df2\u6309\u5168\u6587\u9605\u8bfb\u3002'}</div>
                    )}
                    {chapters.map((chapter, index) => {
                      const isActive = selectedChapterIndex === index;
                      const title = chapter.title?.trim() || `Chapter ${index + 1}`;
                      return (
                        <button
                          key={`${title}-${index}`}
                          ref={(node) => {
                            if (node) {
                              tocItemRefs.current[index] = node;
                              return;
                            }
                            delete tocItemRefs.current[index];
                          }}
                          onClick={() => handleJumpToChapter(index)}
                          className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${isActive ? 'text-rose-400 bg-rose-400/10' : 'text-slate-500 hover:bg-black/5 dark:hover:bg-white/5'}`}
                        >
                          <span className="text-xs mr-2 opacity-70">{index + 1}.</span>
                          <span>{title}</span>
                        </button>
                      );
                    })}
                </div>
                <div style={{ display: tocPanelTab === 'bookmarks' ? undefined : 'none' }}>
                    {sortedBookmarks.length === 0 && (
                      <div className="text-xs text-slate-400 px-2 py-3">{'\u8fd8\u6ca1\u6709\u4e66\u7b7e\uff0c\u70b9\u51fb\u9876\u90e8\u4e66\u7b7e\u6309\u94ae\u5373\u53ef\u65b0\u589e\u3002'}</div>
                    )}
                    {sortedBookmarks.map((bookmark, index) => {
                      const isActive = bookmark.id === selectedBookmarkId;
                      const chapterLabel = resolveBookmarkChapterLabel(bookmark.readingPosition);
                      return (
                        <div key={bookmark.id} className="flex items-center gap-1">
                          <button
                            ref={(node) => {
                              if (node) {
                                bookmarkItemRefs.current[bookmark.id] = node;
                                return;
                              }
                              delete bookmarkItemRefs.current[bookmark.id];
                            }}
                            onClick={() => handleJumpToBookmark(bookmark)}
                            className={`flex-1 text-left px-3 py-2 rounded-lg text-sm transition-colors ${isActive ? 'text-rose-400 bg-rose-400/10' : 'text-slate-500 hover:bg-black/5 dark:hover:bg-white/5'}`}
                          >
                            <span className="flex w-full items-center justify-between gap-2">
                              <span className="min-w-0 truncate">
                                <span className="text-xs mr-2 opacity-70">{index + 1}.</span>
                                <span>{bookmark.name}</span>
                              </span>
                              <span className={`shrink-0 text-[11px] text-right ${isActive ? 'opacity-80' : 'opacity-60'}`}>
                                {chapterLabel}
                              </span>
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteBookmark(bookmark.id);
                            }}
                            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                              isDarkMode
                                ? 'text-slate-400 hover:text-rose-300 hover:bg-[#1a202c]'
                                : 'text-slate-500 hover:text-rose-400 hover:bg-black/5'
                            }`}
                            title={'\u5220\u9664\u4e66\u7b7e'}
                            aria-label={`delete-bookmark-${bookmark.id}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      );
                    })}
                </div>
                <div style={{ display: tocPanelTab === 'highlights' ? undefined : 'none' }}>
                    {/* Color filter chips */}
                    <div className="flex items-center gap-1.5 px-2 pb-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setHighlightColorFilter(null)}
                        className={`h-6 px-2 rounded-full text-[10px] font-bold transition-all ${
                          !highlightColorFilter
                            ? 'text-rose-400 bg-rose-400/10'
                            : isDarkMode ? 'text-slate-400 hover:text-white' : 'text-slate-500'
                        }`}
                      >
                        {'全部'}
                      </button>
                      {PRESET_HIGHLIGHT_COLORS.map(color => {
                        const count = resolvedHighlights.filter(h => h.range.color === color).length;
                        if (count === 0) return null;
                        return (
                          <button
                            key={color}
                            type="button"
                            onClick={() => setHighlightColorFilter(highlightColorFilter === color ? null : color)}
                            className={`w-4 h-4 rounded-full border-2 transition-all ${
                              highlightColorFilter === color ? 'border-rose-400 scale-110' : 'border-transparent'
                            }`}
                            style={{ backgroundColor: color }}
                            title={`${count} 条`}
                          />
                        );
                      })}
                    </div>
                    {/* Chapter filter dropdown */}
                    {chapters.length > 1 && (
                      <div className="px-2 pb-2">
                        <HighlightChapterDropdown
                          value={highlightChapterFilter}
                          options={chapters.map((ch, idx) => ({
                            value: `chapter-${idx}`,
                            label: ch.title?.trim() || `第${idx + 1}章`,
                          }))}
                          onChange={setHighlightChapterFilter}
                          isDarkMode={isDarkMode}
                        />
                      </div>
                    )}
                    {/* Highlight cards */}
                    {filteredHighlights.length === 0 && (
                      <div className="text-xs text-slate-400 px-2 py-3">
                        {'\u8fd8\u6ca1\u6709\u9ad8\u4eae\uff0c\u5728\u9605\u8bfb\u65f6\u957f\u6309\u6587\u5b57\u5373\u53ef\u6dfb\u52a0\u3002'}
                      </div>
                    )}
                    {filteredHighlights.map(item => (
                      <div key={item.id} className="flex items-start gap-2 px-2 py-1.5">
                        <div
                          className="w-1 self-stretch rounded-full flex-shrink-0 mt-0.5"
                          style={{ backgroundColor: item.range.color }}
                        />
                        <button
                          type="button"
                          onClick={() => handleJumpToHighlight(item)}
                          className={`flex-1 text-left min-w-0 ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}
                        >
                          <div className="text-xs line-clamp-2 leading-relaxed">{item.text}</div>
                          <div className="text-[10px] opacity-50 mt-0.5">{item.chapterTitle}</div>
                        </button>
                        <div className="flex flex-col gap-0.5 flex-shrink-0">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleCopyHighlightText(item.text); }}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                              isDarkMode ? 'text-slate-400 hover:text-white hover:bg-[#1a202c]' : 'text-slate-400 hover:text-slate-600 hover:bg-black/5'
                            }`}
                            title={'\u590d\u5236'}
                          >
                            <Copy size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleDeleteHighlight(item); }}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                              isDarkMode ? 'text-slate-400 hover:text-rose-300 hover:bg-[#1a202c]' : 'text-slate-500 hover:text-rose-400 hover:bg-black/5'
                            }`}
                            title={'\u5220\u9664\u9ad8\u4eae'}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                    {/* Copy toast */}
                    {highlightCopyToast && (
                      <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[999] px-4 py-2 rounded-xl text-xs font-bold text-white bg-black/70 shadow-lg pointer-events-none">
                        {'\u5df2\u590d\u5236\u5230\u526a\u8d34\u677f'}
                      </div>
                    )}
                </div>
              </div>
            </div>
          )}
          {isHighlighterPanelOpen && (
            <div
              className={`absolute z-50 right-4 w-[min(22rem,calc(100vw-2rem))] max-h-[32vh] overflow-hidden rounded-2xl p-2 border ${isDarkMode ? 'bg-[#2d3748] border-slate-600 shadow-2xl' : 'bg-[#e0e5ec] border-white/50 shadow-2xl'} ${closingFloatingPanel === 'highlighter' ? 'reader-flyout-exit' : 'reader-flyout-enter'} flex flex-col`}
              style={floatingPanelAnchorStyle}
            >
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400 px-2 py-1">
                {'\u8367\u5149\u7b14\u989c\u8272'}
              </div>
              <div className="flex-1 overflow-y-auto no-scrollbar px-1 pb-1">
                <div className="mb-2 flex items-center gap-2">
                  <div className={`h-10 flex-1 rounded-xl p-1.5 ${isDarkMode ? 'bg-[#1a202c]' : 'neu-pressed'}`}>
                    <div className="w-full h-full rounded-lg border border-white/20" style={{ backgroundColor: resolveHighlightBackgroundColor(rgbToHex(highlightColorDraft), isDarkMode) }} />
                  </div>
                  <input
                    type="text"
                    value={highlightHexInput}
                    onChange={(e) => handleHighlightHexInputChange(e.target.value)}
                    onBlur={handleHighlightHexInputBlur}
                    maxLength={7}
                    spellCheck={false}
                    className={`h-10 w-28 rounded-lg font-mono text-xs uppercase text-center outline-none ${isDarkMode ? 'bg-[#1a202c] text-slate-200' : 'bg-white/60 text-slate-700'}`}
                  />
                </div>

                <div className="grid grid-cols-6 gap-1.5 mb-2">
                  {PRESET_HIGHLIGHT_COLORS.map(color => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => {
                        setHighlightColorDraft(hexToRgb(color));
                        setHighlightHexInput(color);
                      }}
                      className={`h-6 rounded-md border transition-transform hover:scale-[1.03] active:scale-[0.98] ${rgbToHex(highlightColorDraft) === color ? 'border-slate-500' : 'border-white/25'}`}
                      style={{ backgroundColor: color }}
                      aria-label={`preset-${color}`}
                    />
                  ))}
                </div>

                <div className="space-y-2">
                  {(['r', 'g', 'b'] as const).map(channel => (
                    <div key={channel} className="flex items-center gap-2">
                      <span className="w-4 text-[10px] font-bold uppercase text-slate-500">{channel}</span>
                      <div className="relative flex-1 h-2">
                        <div className={`absolute inset-0 rounded-full ${isDarkMode ? 'bg-slate-700' : 'bg-black/10'}`} />
                        <div
                          className="absolute inset-y-0 left-0 rounded-full bg-rose-300"
                          style={{ width: `${(highlightColorDraft[channel] / 255) * 100}%` }}
                        />
                        <input
                          type="range"
                          min="0"
                          max="255"
                          value={highlightColorDraft[channel]}
                          onChange={(e) => updateHighlightDraftChannel(channel, parseInt(e.target.value, 10))}
                          className="app-range absolute top-1/2 -translate-y-1/2 left-0 w-full h-5 bg-transparent appearance-none cursor-pointer z-10"
                        />
                      </div>
                      <input
                        type="number"
                        min="0"
                        max="255"
                        value={highlightColorDraft[channel]}
                        onChange={(e) => updateHighlightDraftChannel(channel, parseInt(e.target.value || '0', 10))}
                        className={`w-11 h-6 text-center text-[10px] rounded-md outline-none ${isDarkMode ? 'bg-[#1a202c] text-slate-200' : 'bg-white/60 text-slate-700'} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-1 flex gap-2 px-1 pb-1">
                <button
                  type="button"
                  onClick={() => closeFloatingPanel({ discardDraft: true })}
                  className={`flex-1 h-7 rounded-full text-[11px] font-bold ${isDarkMode ? 'bg-[#1a202c] text-slate-300 hover:text-slate-100' : 'neu-btn text-slate-500 hover:text-slate-700'}`}
                >
                  {'\u53d6\u6d88'}
                </button>
                <button
                  type="button"
                  onClick={applyHighlightColorDraft}
                  className="flex-1 h-7 rounded-full text-[11px] font-bold text-white bg-rose-400 shadow-lg hover:bg-rose-500 active:scale-95 transition-all"
                >
                  {'\u5e94\u7528'}
                </button>
              </div>
            </div>
          )}
          {isTypographyPanelOpen && (
            <div
              className={`absolute z-50 right-4 w-[min(22rem,calc(100vw-2rem))] max-h-[32vh] overflow-hidden rounded-2xl p-2 border ${isDarkMode ? 'bg-[#2d3748] border-slate-600 shadow-2xl' : 'bg-[#e0e5ec] border-white/50 shadow-2xl'} ${closingFloatingPanel === 'typography' ? 'reader-flyout-exit' : 'reader-flyout-enter'} flex flex-col`}
              style={floatingPanelAnchorStyle}
            >
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400 px-2 py-1">
                {'\u6587\u5b57\u6837\u5f0f'}
              </div>
              <div className="flex-1 overflow-y-auto no-scrollbar px-1 pb-1 space-y-2">
                <div className={`rounded-xl p-2 ${isDarkMode ? 'bg-[#1a202c]' : 'neu-pressed'}`}>
                  <div className="text-[11px] font-semibold text-slate-500">{'\u5bf9\u9f50'}</div>
                  <div className="mt-1.5 flex items-center gap-2">
                    {READER_TEXT_ALIGN_OPTIONS.map(({ value, label, icon: Icon }) => (
                      <button
                        key={`reader-text-align-${value}`}
                        type="button"
                        onClick={() => updateReaderTypography({ textAlign: value })}
                        className={getTypographyAlignButtonClass(value)}
                        title={label}
                        aria-label={`reader-text-align-${value}`}
                      >
                        <Icon size={14} />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className={`rounded-xl p-2 ${isDarkMode ? 'bg-[#1a202c]' : 'neu-pressed'}`}>
                  <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
                    <span>{'\u5b57\u53f7'}</span>
                    <div className="flex items-center gap-2">
                      <span>{`${readerTypography.fontSizePx}px`}</span>
                      <button
                        type="button"
                        onClick={resetReaderFontSize}
                        className={typographyIconButtonClass}
                        title={'\u91cd\u7f6e\u5b57\u53f7'}
                      >
                        <RotateCcw size={13} />
                      </button>
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center">
                    <div className="relative flex-1 h-2">
                      <div className={`absolute inset-0 rounded-full ${isDarkMode ? 'bg-slate-700' : 'bg-black/10'}`} />
                      <div
                        className="absolute inset-y-0 left-0 rounded-full bg-rose-300"
                        style={{ width: `${((readerTypography.fontSizePx - 14) / (36 - 14)) * 100}%` }}
                      />
                      <input
                        type="range"
                        min="14"
                        max="36"
                        step="1"
                        value={readerTypography.fontSizePx}
                        onChange={(e) => updateReaderTypography({ fontSizePx: parseInt(e.target.value, 10) })}
                        className="app-range absolute top-1/2 -translate-y-1/2 left-0 w-full h-5 bg-transparent appearance-none cursor-pointer z-10"
                      />
                    </div>
                  </div>
                </div>

                <div className={`rounded-xl p-2 ${isDarkMode ? 'bg-[#1a202c]' : 'neu-pressed'}`}>
                  <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
                    <span>{'\u884c\u8ddd'}</span>
                    <div className="flex items-center gap-2">
                      <span>{readerTypography.lineHeight.toFixed(2)}</span>
                      <button
                        type="button"
                        onClick={resetReaderLineHeight}
                        className={typographyIconButtonClass}
                        title={'\u91cd\u7f6e\u884c\u8ddd'}
                      >
                        <RotateCcw size={13} />
                      </button>
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center">
                    <div className="relative flex-1 h-2">
                      <div className={`absolute inset-0 rounded-full ${isDarkMode ? 'bg-slate-700' : 'bg-black/10'}`} />
                      <div
                        className="absolute inset-y-0 left-0 rounded-full bg-rose-300"
                        style={{ width: `${((readerTypography.lineHeight - 1.2) / (2.8 - 1.2)) * 100}%` }}
                      />
                      <input
                        type="range"
                        min="1.2"
                        max="2.8"
                        step="0.05"
                        value={readerTypography.lineHeight}
                        onChange={(e) => updateReaderTypography({ lineHeight: parseFloat(e.target.value) })}
                        className="app-range absolute top-1/2 -translate-y-1/2 left-0 w-full h-5 bg-transparent appearance-none cursor-pointer z-10"
                      />
                    </div>
                  </div>
                </div>

                {renderTypographyColorEditor('textColor', '\u6587\u5b57\u989c\u8272')}
                {renderTypographyColorEditor('backgroundColor', '\u80cc\u666f\u989c\u8272')}

                <div className={`rounded-xl p-2 ${isDarkMode ? 'bg-[#1a202c]' : 'neu-pressed'}`}>
                  <div className="text-[11px] font-semibold text-slate-500">{'\u6b63\u6587\u5b57\u4f53'}</div>
                  <div className="mt-1 relative" ref={readerFontDropdownRef}>
                    <button
                      type="button"
                      onClick={() => setIsReaderFontDropdownOpen(prev => !prev)}
                      className={typographySelectTriggerClass}
                    >
                      <span className="truncate text-[12px]">{readerFontOptions.find(option => option.id === selectedReaderFontId)?.label || '\u9009\u62e9\u5b57\u4f53'}</span>
                      <ChevronDown size={14} className={`transition-transform ${isReaderFontDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isReaderFontDropdownOpen && (
                      <div className={`absolute top-full left-0 right-0 mt-1 p-1.5 rounded-xl z-40 max-h-44 overflow-y-auto ${isDarkMode ? 'bg-[#111827] border border-slate-700 shadow-xl' : 'bg-[#e0e5ec] border border-white/60 shadow-xl'}`}>
                        {readerFontOptions.map(option => {
                          const isSelected = option.id === selectedReaderFontId;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => {
                                setSelectedReaderFontId(option.id);
                                setIsReaderFontDropdownOpen(false);
                              }}
                              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs ${
                                isSelected
                                  ? 'text-rose-400 bg-rose-400/10 font-semibold'
                                  : isDarkMode
                                  ? 'text-slate-300 hover:bg-slate-700/60'
                                  : 'text-slate-600 hover:bg-slate-200/70'
                              }`}
                            >
                              <span className={`w-4 h-4 rounded border flex items-center justify-center ${isSelected ? 'bg-rose-400 border-rose-400' : 'border-slate-400'}`}>
                                {isSelected && <Check size={10} className="text-white" />}
                              </span>
                              <span className="truncate">{option.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="mt-2">
                    <input
                      type="text"
                      value={fontFamilyInput}
                      onChange={(e) => setFontFamilyInput(e.target.value)}
                      placeholder={'\u5b57\u4f53\u540d\u79f0(\u5fc5\u586b)'}
                      className={`w-full ${typographyInputClass}`}
                    />
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="text"
                      value={fontUrlInput}
                      onChange={(e) => setFontUrlInput(e.target.value)}
                      placeholder={'.ttf,.otf\u7b49'}
                      className={`flex-1 ${typographyInputClass}`}
                    />
                    <button
                      type="button"
                      onClick={handleApplyFontUrl}
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white bg-rose-400 shadow-lg hover:bg-rose-500 active:scale-95 transition-all"
                      title={'\u4fdd\u5b58\u5b57\u4f53'}
                    >
                      <Save size={14} />
                    </button>
                    {!BUILTIN_READER_FONT_ID_SET.has(selectedReaderFontId) && (
                      <button
                        type="button"
                        onClick={handleDeleteFontPreset}
                        className={typographyIconButtonClass}
                        title={'\u5220\u9664\u5f53\u524d\u5b57\u4f53\u9884\u8bbe'}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={resetReaderFontOnly}
                      className={typographyIconButtonClass}
                      title={'\u91cd\u7f6e\u5b57\u4f53'}
                    >
                      <RotateCcw size={13} />
                    </button>
                  </div>
                  {fontPanelMessage && (
                    <div className={`mt-1 text-[10px] ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                      {fontPanelMessage}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-1 flex gap-2 px-1 pb-1">
                <button
                  type="button"
                  onClick={resetReaderTypography}
                  className={`flex-1 h-7 rounded-full text-[11px] font-bold ${isDarkMode ? 'bg-[#1a202c] text-slate-300 hover:text-slate-100' : 'neu-btn text-slate-500 hover:text-slate-700'}`}
                >
                  {'\u91cd\u7f6e'}
                </button>
                <button
                  type="button"
                  onClick={closeFloatingPanel}
                  className="flex-1 h-7 rounded-full text-[11px] font-bold text-white bg-rose-400 shadow-lg hover:bg-rose-500 active:scale-95 transition-all"
                >
                  {'\u5e94\u7528'}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {isBookmarkModalOpen && (
        <>
          <button
            type="button"
            aria-label="close-bookmark-modal"
            className={`absolute inset-0 z-40 bg-black/35 backdrop-blur-sm ${isBookmarkModalClosing ? 'app-fade-exit' : 'app-fade-enter'}`}
            onClick={closeBookmarkModal}
          />
          <div
            className={`absolute z-50 right-4 w-[min(22rem,calc(100vw-2rem))] rounded-2xl p-2 border ${isDarkMode ? 'bg-[#2d3748] border-slate-600 shadow-2xl' : 'bg-[#e0e5ec] border-white/50 shadow-2xl'} ${isBookmarkModalClosing ? 'reader-flyout-exit' : 'reader-flyout-enter'}`}
            style={floatingPanelAnchorStyle}
          >
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400 px-2 py-1">{'\u65b0\u5efa\u4e66\u7b7e'}</div>
            <div className="px-1 pb-1">
              <input
                ref={bookmarkNameInputRef}
                type="text"
                value={bookmarkNameDraft}
                onChange={(e) => setBookmarkNameDraft(e.target.value.slice(0, BOOKMARK_NAME_MAX_LENGTH))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleConfirmAddBookmark();
                    return;
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    closeBookmarkModal();
                  }
                }}
                maxLength={BOOKMARK_NAME_MAX_LENGTH}
                placeholder={'\u8bf7\u8f93\u5165\u4e66\u7b7e\u540d\u79f0'}
                className={`w-full h-10 rounded-xl px-3 text-sm outline-none ${isDarkMode ? 'bg-[#1a202c] text-slate-200 placeholder-slate-500' : 'neu-pressed text-slate-700 placeholder-slate-400'}`}
              />
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeBookmarkModal}
                  className={`flex-1 h-7 rounded-full text-[11px] font-bold ${isDarkMode ? 'bg-[#1a202c] text-slate-300 hover:text-slate-100' : 'neu-btn text-slate-500 hover:text-slate-700'}`}
                >
                  {'\u53d6\u6d88'}
                </button>
                <button
                  type="button"
                  onClick={handleConfirmAddBookmark}
                  className="flex-1 h-7 rounded-full text-[11px] font-bold text-white bg-rose-400 shadow-lg hover:bg-rose-500 active:scale-95 transition-all"
                >
                  {'\u4fdd\u5b58'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      <div ref={readerViewportContainerRef} className="relative flex-1 min-h-0 m-4 mt-0">
        <div
          ref={readerScrollRef}
          aria-busy={isLoadingMaskVisible}
          className={`reader-scroll-panel reader-content-scroll relative h-full min-h-0 overflow-y-auto rounded-2xl shadow-inner transition-colors px-6 py-6 pb-24 ${
            isDarkMode ? 'bg-[#1a202c] shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)]' : 'bg-[#f0f2f5] shadow-[inset_4px_4px_8px_#d1d9e6,inset_-4px_-4px_8px_#ffffff]'
          }`}
          style={readerScrollStyle}
          onScroll={handleReaderScroll}
          onWheel={handleReaderWheel}
          onTouchStart={handleReaderTouchStart}
          onTouchMove={handleReaderTouchMove}
          onTouchEnd={handleReaderTouchEnd}
        >
          <article
            ref={readerArticleRef}
            className={`prose prose-lg max-w-none font-serif leading-loose ${chapterTransitionClass} ${isDarkMode ? 'prose-invert' : ''} ${isHighlightMode ? 'cursor-crosshair' : ''} ${isLoadingMaskVisible ? 'opacity-0 pointer-events-none select-none' : ''}`}
            style={readerArticleStyle}
            onPointerDown={handleReaderTextPointerDown}
            onPointerMove={handleReaderTextPointerMove}
            onPointerUp={handleReaderTextPointerUp}
            onPointerCancel={handleReaderTextPointerCancel}
            onTouchStart={handleReaderTextTouchStart}
            onTouchMove={handleReaderTextTouchMove}
            onTouchEnd={handleReaderTextTouchEnd}
            onTouchCancel={handleReaderTextTouchCancel}
          >
            {!activeBook && <p className="mb-6 indent-8 opacity-70">{'\u672a\u9009\u62e9\u4e66\u7c4d\uff0c\u8bf7\u8fd4\u56de\u4e66\u67b6\u9009\u62e9\u4e00\u672c\u4e66\u3002'}</p>}
            {activeBook && !isLoadingBookContent && renderItems.length === 0 && (
              <p className="mb-6 indent-8 opacity-70">{'\u8fd9\u672c\u4e66\u8fd8\u6ca1\u6709\u6b63\u6587\u5185\u5bb9\u3002'}</p>
            )}
            {activeBook && !isLoadingBookContent && currentChapterTitle && (() => {
              const isTitleCurrentTts = ttsPlaybackState?.isActive && ttsActiveParagraphIndex === -1;
              const isTitleActiveCached = ttsPlaybackState?.isActive && ttsPlaybackState.cachedParagraphIndices?.includes(-1);
              const isTitlePersistentCached = ttsPersistentCachedParagraphs.includes(-1);
              const showTitleTtsIcons = !!ttsPlaybackState?.isActive && (
                isTitleCurrentTts || isTitleActiveCached || isTitlePersistentCached
              );
              const isTitleRefreshing = ttsRefreshingParagraphs.has(-1);
              return (
                <>
                  {showTitleTtsIcons && (
                    <div className="flex items-center gap-2 mb-1.5 -mt-1 not-prose" style={{ textIndent: 0 }}>
                      {isTitleCurrentTts ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); ttsPlaybackState?.isPaused ? handleTtsResume() : handleTtsPause(); }}
                          className={`w-7 h-7 rounded-full flex items-center justify-center transition-all active:scale-90 ${
                            isDarkMode
                              ? 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30'
                              : 'bg-rose-100 text-rose-500 hover:bg-rose-200'
                          }`}
                        >
                          {ttsPlaybackState?.isPaused ? <Play size={14} fill="currentColor" /> : <Pause size={14} fill="currentColor" />}
                        </button>
                      ) : ttsPlaybackState?.isActive ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleTtsJumpToParagraph(-1); }}
                          className={`w-7 h-7 rounded-full flex items-center justify-center transition-all active:scale-90 ${
                            isDarkMode
                              ? 'bg-slate-600/30 text-slate-400 hover:bg-slate-600/50'
                              : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                          }`}
                        >
                          <Play size={12} fill="currentColor" />
                        </button>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleTtsStartFromParagraph(-1); }}
                          className={`w-7 h-7 rounded-full flex items-center justify-center transition-all active:scale-90 ${
                            isDarkMode
                              ? 'bg-slate-600/30 text-slate-400 hover:bg-slate-600/50'
                              : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                          }`}
                        >
                          <Play size={12} fill="currentColor" />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleTtsRefreshParagraph(-1); }}
                        className={`w-7 h-7 rounded-full flex items-center justify-center transition-all active:scale-90 ${
                          isDarkMode
                            ? 'bg-slate-600/30 text-slate-400 hover:bg-slate-600/50'
                            : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                        }`}
                      >
                        <RotateCcw size={13} className={isTitleRefreshing ? 'animate-spin' : ''} />
                      </button>
                    </div>
                  )}
                  <p
                    className={`text-center font-bold mb-6 transition-colors duration-300 ${
                      ttsActiveParagraphIndex === -1
                        ? (isDarkMode ? 'bg-rose-500/10 rounded-lg -mx-2 px-2 py-1' : 'bg-rose-100/60 rounded-lg -mx-2 px-2 py-1')
                        : ''
                    }`}
                    style={{ textIndent: 0 }}
                    data-tts-paragraph-index={-1}
                  >
                    {currentChapterTitle}
                  </p>
                </>
              );
            })()}
            {activeBook && !isLoadingBookContent && renderItems.map((item) => {
              if (item.type === 'image') {
                const cachedDimensions = IMAGE_DIMENSION_CACHE.get(item.imageRef);
                const resolvedWidth =
                  typeof item.width === 'number' && item.width > 0
                    ? Math.round(item.width)
                    : cachedDimensions?.width;
                const resolvedHeight =
                  typeof item.height === 'number' && item.height > 0
                    ? Math.round(item.height)
                    : cachedDimensions?.height;
                return (
                  <figure key={item.key} className="mb-6 not-prose">
                    <div className={`mx-auto w-fit max-w-full rounded-xl p-1.5 overflow-hidden ${isDarkMode ? 'bg-slate-900/30' : 'bg-white/60'}`}>
                      <ResolvedImage
                        src={item.imageRef}
                        alt={item.alt || item.title || 'Embedded image'}
                        width={resolvedWidth}
                        height={resolvedHeight}
                        onResolved={() => markChapterImageSettled(item.key)}
                        className="block w-auto max-w-full h-auto max-h-[60vh] object-contain rounded-lg mx-auto"
                      />
                    </div>
                    {item.title && (
                      <figcaption className={`mt-1.5 text-[11px] leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                        {item.title}
                      </figcaption>
                    )}
                  </figure>
                );
              }

              const paragraph = paragraphRenderData[item.paragraphIndex];
              if (!paragraph) return null;
              const isCurrentTtsParagraph = ttsPlaybackState?.isActive && ttsActiveParagraphIndex === item.paragraphIndex;
              const isActiveCachedParagraph = ttsPlaybackState?.isActive && ttsPlaybackState.cachedParagraphIndices?.includes(item.paragraphIndex);
              const isPersistentCachedParagraph = ttsPersistentCachedParagraphs.includes(item.paragraphIndex);
              const showTtsIcons = !!ttsPlaybackState?.isActive && (
                isCurrentTtsParagraph || isActiveCachedParagraph || isPersistentCachedParagraph
              );
              const isRefreshing = ttsRefreshingParagraphs.has(item.paragraphIndex);
              return (
                <React.Fragment key={item.key}>
                  {showTtsIcons && (
                    <div className="flex items-center gap-2 mb-1.5 -mt-1 not-prose" style={{ textIndent: 0 }}>
                      {isCurrentTtsParagraph ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); ttsPlaybackState?.isPaused ? handleTtsResume() : handleTtsPause(); }}
                          className={`w-7 h-7 rounded-full flex items-center justify-center transition-all active:scale-90 ${
                            isDarkMode
                              ? 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30'
                              : 'bg-rose-100 text-rose-500 hover:bg-rose-200'
                          }`}
                        >
                          {ttsPlaybackState?.isPaused ? <Play size={14} fill="currentColor" /> : <Pause size={14} fill="currentColor" />}
                        </button>
                      ) : ttsPlaybackState?.isActive ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleTtsJumpToParagraph(item.paragraphIndex); }}
                          className={`w-7 h-7 rounded-full flex items-center justify-center transition-all active:scale-90 ${
                            isDarkMode
                              ? 'bg-slate-600/30 text-slate-400 hover:bg-slate-600/50'
                              : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                          }`}
                        >
                          <Play size={12} fill="currentColor" />
                        </button>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleTtsStartFromParagraph(item.paragraphIndex); }}
                          className={`w-7 h-7 rounded-full flex items-center justify-center transition-all active:scale-90 ${
                            isDarkMode
                              ? 'bg-slate-600/30 text-slate-400 hover:bg-slate-600/50'
                              : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                          }`}
                        >
                          <Play size={12} fill="currentColor" />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleTtsRefreshParagraph(item.paragraphIndex); }}
                        className={`w-7 h-7 rounded-full flex items-center justify-center transition-all active:scale-90 ${
                          isDarkMode
                            ? 'bg-slate-600/30 text-slate-400 hover:bg-slate-600/50'
                            : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                        }`}
                      >
                        <RotateCcw size={13} className={isRefreshing ? 'animate-spin' : ''} />
                      </button>
                    </div>
                  )}
                  <p
                    className={`mb-6 indent-8 transition-colors duration-300 ${
                      ttsActiveParagraphIndex === item.paragraphIndex
                        ? (isDarkMode ? 'bg-rose-500/10 rounded-lg -mx-2 px-2 py-1' : 'bg-rose-100/60 rounded-lg -mx-2 px-2 py-1')
                        : ''
                    }`}
                    data-tts-paragraph-index={item.paragraphIndex}
                  >
                    {paragraph.segments.map(segment => (
                      <span
                        key={`${segment.start}-${segment.end}-${segment.color || 'plain'}`}
                        data-reader-segment="1"
                        data-start={segment.start}
                        className={segment.color ? 'rounded-[0.14em]' : undefined}
                        style={{
                          ...(segment.color ? { backgroundColor: resolveHighlightBackgroundColor(segment.color, isDarkMode) } : {}),
                          ...(segment.hasAiUnderline
                            ? {
                                textDecorationLine: 'underline',
                                textDecorationStyle: 'dashed',
                                textDecorationColor: isDarkMode
                                  ? 'rgb(var(--theme-300) / 0.95)'
                                  : 'rgb(var(--theme-500) / 0.92)',
                                textDecorationThickness: '1.5px',
                                textUnderlineOffset: '0.16em',
                                textDecorationSkipInk: 'none',
                                WebkitTextDecorationSkip: 'none',
                              }
                            : {}),
                        }}
                      >
                        {segment.text}
                      </span>
                    ))}
                  </p>
                </React.Fragment>
              );
            })}
          </article>

        </div>

        {activeBook && isLoadingMaskVisible && (
          <div
            className={`pointer-events-none absolute left-6 top-6 z-20 text-sm opacity-70 ${
              isDarkMode ? 'text-slate-400' : 'text-slate-500'
            }`}
            aria-hidden="true"
          >
            {'\u6b63\u5728\u52a0\u8f7d\u6b63\u6587\u5185\u5bb9...'}
          </div>
        )}

        {readerScrollbar.visible && (
          <div ref={readerScrollbarTrackRef} className="absolute right-1.5 top-3 bottom-3 w-1 z-10 pointer-events-none overflow-hidden rounded-full">
            <button
              ref={readerScrollbarThumbRef}
              type="button"
              aria-label="reader-scrollbar-thumb"
              onPointerDown={handleReaderThumbPointerDown}
              className={`absolute left-0 w-1 rounded-full border pointer-events-auto touch-none ${
                isDarkMode
                  ? 'bg-slate-400/70 border-slate-300/30'
                  : 'bg-slate-500/65 border-slate-200/50'
              }`}
              style={{
                height: `${readerScrollbar.height}px`,
                transform: `translateY(${readerScrollbarTopRef.current}px)`,
              }}
            />
          </div>
        )}

      </div>

      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 hidden">
        <div className="neu-flat text-slate-600 rounded-full flex p-2 gap-4">
          <button className="p-2 hover:text-rose-400"><Highlighter size={20} /></button>
          <button className="p-2 hover:text-rose-400"><Bookmark size={20} /></button>
          <button className="px-3 py-1 bg-rose-400 text-white rounded-full text-sm font-bold shadow-lg">Ask AI</button>
        </div>
      </div>

      <ReaderMessagePanel
        isDarkMode={isDarkMode}
        apiConfig={apiConfig}
        apiPresets={apiPresets}
        safeAreaTop={Math.max(0, safeAreaTop)}
        safeAreaBottom={Math.max(0, safeAreaBottom)}
        activeBook={activeBook}
        appSettings={appSettings}
        setAppSettings={setAppSettings}
        aiProactiveUnderlineEnabled={appSettings.aiProactiveUnderlineEnabled}
        aiProactiveUnderlineProbability={appSettings.aiProactiveUnderlineProbability}
        personas={personas}
        activePersonaId={activePersonaId}
        onSelectPersona={onSelectPersona}
        characters={characters}
        activeCharacterId={activeCharacterId}
        onSelectCharacter={onSelectCharacter}
        worldBookEntries={worldBookEntries}
        chapters={chapters}
        bookText={bookText}
        activeChapterRenderedText={readerTextForHighlighting}
        highlightRangesByChapter={highlightRangesByChapter}
        onAddAiUnderlineRange={handleAddAiUnderlineRange}
        onRollbackAiUnderlineGeneration={handleRollbackAiUnderlineGeneration}
        readerContentRef={readerScrollRef}
        getLatestReadingPosition={getLatestReadingPosition}
        isMoreSettingsOpen={isMoreSettingsOpen}
        onCloseMoreSettings={() => setIsMoreSettingsOpen(false)}
        ragApiConfigResolver={ragApiConfigResolver}
        ttsConfig={ttsConfig ?? null}
        ttsPresets={ttsPresets || []}
        ttsPlaybackState={ttsPlaybackState}
        onTtsStartFromCurrentPosition={handleTtsStart}
        onTtsStop={handleTtsStop}
        onTtsPresetSelect={handleTtsPresetSelect}
        onTtsLanguageChange={handleTtsLanguageChange}
        onTtsSpeedChange={handleTtsSpeedChange}
        onTtsClearCache={handleTtsClearCache}
        ttsResumePosition={ttsResumePosition}
        onTtsResumeFromSaved={handleTtsResumeFromSaved}
        ttsExportChapterOptions={ttsExportChapterOptions}
        onTtsExportAudiobook={handleTtsExportAudiobook}
        onOpenReaderTypography={openTypographyPanel}
      />
    </div>
  );
};

export default Reader;
