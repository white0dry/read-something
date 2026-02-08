import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  ArrowLeft,
  Bookmark,
  Check,
  ChevronDown,
  Highlighter,
  List as ListIcon,
  MoreHorizontal,
  RotateCcw,
  Save,
  Send,
  Sparkles,
  Type,
} from 'lucide-react';
import {
  Book,
  Chapter,
  Message,
  ReaderBookState,
  ReaderFontState,
  ReaderHighlightRange,
  ReaderPositionState,
  ReaderSessionSnapshot,
} from '../types';
import { getBookContent, saveBookReaderState } from '../utils/bookContentStorage';

interface ReaderProps {
  onBack: (snapshot?: ReaderSessionSnapshot) => void;
  isDarkMode: boolean;
  activeBook: Book | null;
  safeAreaTop?: number;
  safeAreaBottom?: number;
}

type ScrollTarget = 'top' | 'bottom';
type ChapterSwitchDirection = 'next' | 'prev';
type FloatingPanel = 'none' | 'toc' | 'highlighter' | 'typography';

interface RgbValue {
  r: number;
  g: number;
  b: number;
}

type TextHighlightRange = ReaderHighlightRange;

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
}

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
const AI_FAB_OPEN_DELAY_MS = 120;
const READER_APPEARANCE_STORAGE_KEY = 'app_reader_appearance';
const DEFAULT_HIGHLIGHT_COLOR = '#FFE066';
const PRESET_HIGHLIGHT_COLORS = ['#FFE066', '#FFD6A5', '#FFADAD', '#C7F9CC', '#A0C4FF', '#D7B5FF'];
const PRESET_TEXT_COLORS = ['#1E293B', '#334155', '#475569', '#0F172A', '#9F1239', '#164E63'];
const PRESET_BACKGROUND_COLORS = ['#F0F2F5', '#FFF7E8', '#F2FCEB', '#EAF5FF', '#1A202C', '#0F172A'];
const DEFAULT_READER_FONT_ID = 'reader-font-serif-default';
const READER_TEXT_ALIGN_OPTIONS: Array<{ value: ReaderTextAlign; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { value: 'left', label: '\u5c45\u5de6', icon: AlignLeft },
  { value: 'center', label: '\u5c45\u4e2d', icon: AlignCenter },
  { value: 'justify', label: '\u4e24\u7aef', icon: AlignJustify },
];
const DEFAULT_READER_FONT_OPTIONS: ReaderFontOption[] = [
  {
    id: DEFAULT_READER_FONT_ID,
    label: '\u9ed8\u8ba4\u886c\u7ebf',
    family: '"Noto Serif SC", Georgia, "Times New Roman", serif',
    sourceType: 'default',
  },
  {
    id: 'reader-font-sans-default',
    label: '\u9ed8\u8ba4\u65e0\u886c\u7ebf',
    family: '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", Arial, sans-serif',
    sourceType: 'default',
  },
  {
    id: 'reader-font-mono-default',
    label: '\u9ed8\u8ba4\u7b49\u5bbd',
    family: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    sourceType: 'default',
  },
];

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

const buildParagraphSegments = (paragraph: ParagraphMeta, ranges: TextHighlightRange[]) => {
  const segments: ParagraphSegment[] = [];
  let cursor = paragraph.start;

  const pushPlain = (start: number, end: number) => {
    if (end <= start) return;
    segments.push({
      start,
      end,
      text: paragraph.text.slice(start - paragraph.start, end - paragraph.start),
    });
  };

  const pushHighlight = (start: number, end: number, color: string) => {
    if (end <= start) return;
    segments.push({
      start,
      end,
      text: paragraph.text.slice(start - paragraph.start, end - paragraph.start),
      color,
    });
  };

  ranges.forEach(range => {
    if (range.end <= paragraph.start || range.start >= paragraph.end) return;
    const rangeStart = Math.max(range.start, paragraph.start);
    const rangeEnd = Math.min(range.end, paragraph.end);

    pushPlain(cursor, rangeStart);
    pushHighlight(rangeStart, rangeEnd, range.color);
    cursor = Math.max(cursor, rangeEnd);
  });

  pushPlain(cursor, paragraph.end);

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

const Reader: React.FC<ReaderProps> = ({ onBack, isDarkMode, activeBook, safeAreaTop = 0, safeAreaBottom = 0 }) => {
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(true);
  const [isAiFabOpening, setIsAiFabOpening] = useState(false);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  const [activeFloatingPanel, setActiveFloatingPanel] = useState<FloatingPanel>('none');
  const [closingFloatingPanel, setClosingFloatingPanel] = useState<FloatingPanel | null>(null);
  const [isHighlightMode, setIsHighlightMode] = useState(false);
  const [isHighlighterClickPending, setIsHighlighterClickPending] = useState(false);
  const [highlightColor, setHighlightColor] = useState(DEFAULT_HIGHLIGHT_COLOR);
  const [highlightColorDraft, setHighlightColorDraft] = useState<RgbValue>(() => hexToRgb(DEFAULT_HIGHLIGHT_COLOR));
  const [highlightHexInput, setHighlightHexInput] = useState(DEFAULT_HIGHLIGHT_COLOR);
  const [highlightRangesByChapter, setHighlightRangesByChapter] = useState<Record<string, TextHighlightRange[]>>({});
  const [pendingHighlightRange, setPendingHighlightRange] = useState<TextHighlightRange | null>(null);
  const [isReaderStateHydrated, setIsReaderStateHydrated] = useState(false);
  const [hydratedBookId, setHydratedBookId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      sender: 'ai',
      text: 'I am your reading assistant. Ask about plot, character, or details anytime.',
      timestamp: new Date(),
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [selectedChapterIndex, setSelectedChapterIndex] = useState<number | null>(null);
  const [bookText, setBookText] = useState('');
  const [isLoadingBookContent, setIsLoadingBookContent] = useState(false);
  const [readerScrollbar, setReaderScrollbar] = useState({ visible: false, top: 0, height: 40 });
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

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const readerScrollRef = useRef<HTMLDivElement>(null);
  const readerScrollbarTrackRef = useRef<HTMLDivElement>(null);
  const readerArticleRef = useRef<HTMLElement>(null);
  const readerFontDropdownRef = useRef<HTMLDivElement>(null);
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
  const isAiPanelOpenRef = useRef(isAiPanelOpen);
  const floatingPanelTimerRef = useRef<number | null>(null);
  const typographyColorEditorTimerRef = useRef<number | null>(null);
  const persistReaderStateTimerRef = useRef<number | null>(null);
  const highlighterClickTimerRef = useRef<number | null>(null);
  const aiFabOpenTimerRef = useRef<number | null>(null);
  const fontObjectUrlsRef = useRef<string[]>([]);
  const fontLinkNodesRef = useRef<HTMLLinkElement[]>([]);
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
  const latestReadingPositionRef = useRef<ReaderPositionState | null>(null);

  const isTocOpen = activeFloatingPanel === 'toc';
  const isHighlighterPanelOpen = activeFloatingPanel === 'highlighter';
  const isTypographyPanelOpen = activeFloatingPanel === 'typography';
  const isFloatingPanelVisible = activeFloatingPanel !== 'none';

  const scrollMessagesToBottom = (behavior: ScrollBehavior = 'auto') => {
    if (!messagesContainerRef.current) return;
    messagesContainerRef.current.scrollTo({
      top: messagesContainerRef.current.scrollHeight,
      behavior,
    });
  };

  const refreshReaderScrollbar = () => {
    const scroller = readerScrollRef.current;
    if (!scroller) return;

    const { scrollTop, scrollHeight, clientHeight } = scroller;
    const contentScrollable = scrollHeight - clientHeight;

    if (contentScrollable <= 1) {
      setReaderScrollbar(prev => (prev.visible ? { ...prev, visible: false, top: 0 } : prev));
      return;
    }

    const trackHeight = readerScrollbarTrackRef.current?.clientHeight || Math.max(48, clientHeight - 24);
    const thumbHeight = Math.max(36, Math.min(trackHeight, (clientHeight / scrollHeight) * trackHeight));
    const trackScrollable = Math.max(1, trackHeight - thumbHeight);
    const clampedScrollTop = clamp(scrollTop, 0, contentScrollable);
    const thumbTop = clamp((clampedScrollTop / contentScrollable) * trackScrollable, 0, trackScrollable);

    setReaderScrollbar({
      visible: true,
      top: thumbTop,
      height: thumbHeight,
    });
  };

  const getCurrentReadingPosition = (timestamp = Date.now()): ReaderPositionState | null => {
    if (!activeBook) return null;

    const hasChapters = chapters.length > 0;
    const hasActiveChapter =
      hasChapters && selectedChapterIndex !== null && selectedChapterIndex >= 0 && selectedChapterIndex < chapters.length;
    const resolvedChapterIndex = hasActiveChapter && selectedChapterIndex !== null ? selectedChapterIndex : null;
    const chapterText = resolvedChapterIndex !== null ? chapters[resolvedChapterIndex].content || '' : bookText;
    const chapterLength = chapterText.length;

    const scroller = readerScrollRef.current;
    const scrollableHeight = scroller ? Math.max(0, scroller.scrollHeight - scroller.clientHeight) : 0;
    const scrollTop = scroller ? scroller.scrollTop : lastReaderScrollTopRef.current;
    const scrollRatio = scrollableHeight > 0 ? clamp(scrollTop / scrollableHeight, 0, 1) : 0;

    const chapterCharOffset = chapterLength > 0 ? clamp(Math.round(chapterLength * scrollRatio), 0, chapterLength) : 0;
    const totalLength = getTotalTextLength(chapters, bookText);
    const chapterStartOffset = resolvedChapterIndex !== null ? getChapterStartOffset(chapters, resolvedChapterIndex) : 0;
    const globalCharOffset = clamp(chapterStartOffset + chapterCharOffset, 0, totalLength);

    return {
      chapterIndex: resolvedChapterIndex,
      chapterCharOffset,
      globalCharOffset,
      scrollRatio,
      totalLength,
      updatedAt: timestamp,
    };
  };

  const syncReadingPositionRef = (timestamp = Date.now()) => {
    const snapshot = getCurrentReadingPosition(timestamp);
    if (!snapshot) return null;
    latestReadingPositionRef.current = snapshot;
    return snapshot;
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

    const applyChapter = () => {
      setSelectedChapterIndex(index);
      setBookText(chapter.content || '');
      closeFloatingPanel();
      scrollReaderTo(target);
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
    const isFresh = now - boundaryArmedAtRef.current <= 900;
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
    openFloatingPanel('toc');
  };

  const openHighlighterPanel = () => {
    setHighlightColorDraft(hexToRgb(highlightColor));
    setHighlightHexInput(highlightColor.toUpperCase());
    openFloatingPanel('highlighter');
  };

  const toggleTypographyPanel = () => {
    if (isTypographyPanelOpen) {
      closeFloatingPanel();
      return;
    }
    openFloatingPanel('typography');
  };

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
  }, [messages, isAiPanelOpen]);

  useEffect(() => {
    let cancelled = false;

    const loadBookContent = async () => {
      if (!activeBook) {
        setChapters([]);
        setSelectedChapterIndex(null);
        setBookText('');
        setHighlightRangesByChapter({});
        setHighlightColor(DEFAULT_HIGHLIGHT_COLOR);
        setHighlightColorDraft(hexToRgb(DEFAULT_HIGHLIGHT_COLOR));
        setHighlightHexInput(DEFAULT_HIGHLIGHT_COLOR);
        setFontPanelMessage('');
        setFontUrlInput('');
        setFontFamilyInput('');
        setIsReaderStateHydrated(false);
        setHydratedBookId(null);
        hideFloatingPanelImmediately();
        pendingRestorePositionRef.current = null;
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

        if (cancelled) return;

        setChapters(resolvedChapters);
        setHighlightRangesByChapter(persistedRanges || {});
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
          pendingRestorePositionRef.current = {
            chapterIndex: nextChapterIndex,
            chapterCharOffset: nextChapterOffset,
            globalCharOffset,
            scrollRatio: clamp(normalizedRatio, 0, 1),
            totalLength,
            updatedAt: persistedPosition.updatedAt,
          };
          latestReadingPositionRef.current = pendingRestorePositionRef.current;
        } else {
          pendingRestorePositionRef.current = null;
          latestReadingPositionRef.current = null;
        }
      } catch (error) {
        console.error('Failed to load reader content:', error);
        if (!cancelled) {
          setChapters([]);
          setSelectedChapterIndex(null);
          setHighlightRangesByChapter({});
          setHighlightColor(DEFAULT_HIGHLIGHT_COLOR);
          setHighlightColorDraft(hexToRgb(DEFAULT_HIGHLIGHT_COLOR));
          setHighlightHexInput(DEFAULT_HIGHLIGHT_COLOR);
          setFontPanelMessage('');
          setFontUrlInput('');
          setFontFamilyInput('');
          hideFloatingPanelImmediately();
          pendingRestorePositionRef.current = null;
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

  useLayoutEffect(() => {
    const pending = pendingRestorePositionRef.current;
    const scroller = readerScrollRef.current;
    if (!pending || !scroller || isLoadingBookContent) return;

    const chapterLength = bookText.length;
    const ratioFromOffset = chapterLength > 0 ? pending.chapterCharOffset / chapterLength : 0;
    const targetRatio = clamp(pending.scrollRatio > 0 ? pending.scrollRatio : ratioFromOffset, 0, 1);

    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const nextScrollTop = maxScrollTop > 0 ? maxScrollTop * targetRatio : 0;
    scroller.scrollTop = nextScrollTop;
    lastReaderScrollTopRef.current = nextScrollTop;
    refreshReaderScrollbar();
    syncReadingPositionRef(Date.now());
    pendingRestorePositionRef.current = null;
  }, [activeBook?.id, isLoadingBookContent, bookText]);

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
    if (!activeBook || isLoadingBookContent) return;
    syncReadingPositionRef(Date.now());
  }, [activeBook?.id, isLoadingBookContent, selectedChapterIndex, bookText, chapters]);

  useEffect(() => {
    return () => {
      clearChapterTransitionTimers();
    };
  }, []);

  useEffect(() => {
    return () => {
      clearFloatingPanelTimer();
      clearTypographyColorEditorTimer();
      if (persistReaderStateTimerRef.current) {
        window.clearTimeout(persistReaderStateTimerRef.current);
      }
      if (highlighterClickTimerRef.current) {
        window.clearTimeout(highlighterClickTimerRef.current);
      }
      if (aiFabOpenTimerRef.current) {
        window.clearTimeout(aiFabOpenTimerRef.current);
        aiFabOpenTimerRef.current = null;
      }
      fontObjectUrlsRef.current.forEach(url => {
        URL.revokeObjectURL(url);
      });
      fontObjectUrlsRef.current = [];
      fontLinkNodesRef.current.forEach(node => node.remove());
      fontLinkNodesRef.current = [];
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
          const label = typeof item.label === 'string' ? sanitizeFontFamily(item.label) : '';
          const familyName = typeof item.family === 'string' ? normalizeStoredFontFamily(item.family) : '';
          const sourceUrl = typeof item.sourceUrl === 'string' ? item.sourceUrl.trim() : '';
          if (!id || !label || !familyName || !sourceUrl || !isValidFontSourceType(item.sourceType)) return acc;
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

        if (persistedFontOptions.length > 0) {
          await Promise.allSettled(persistedFontOptions.map(option => ensureReaderFontResource(option)));
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

  const paragraphs = useMemo(() => {
    const normalizedText = bookText.replace(/\r\n/g, '\n').trim();
    if (!normalizedText) return [];

    const splitByBlankLine = normalizedText
      .split(/\n{2,}/)
      .map(p => p.trim())
      .filter(Boolean);

    if (splitByBlankLine.length > 1) return splitByBlankLine;

    return normalizedText
      .split('\n')
      .map(p => p.trim())
      .filter(Boolean);
  }, [bookText]);

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

  const highlightStorageKey = useMemo(() => {
    return selectedChapterIndex === null ? 'full' : `chapter-${selectedChapterIndex}`;
  }, [selectedChapterIndex]);

  const currentHighlightRanges = useMemo(() => {
    return highlightRangesByChapter[highlightStorageKey] || [];
  }, [highlightRangesByChapter, highlightStorageKey]);

  const renderedHighlightRanges = useMemo(() => {
    if (!pendingHighlightRange || pendingHighlightRange.end <= pendingHighlightRange.start) {
      return currentHighlightRanges;
    }
    return applyHighlightStroke(currentHighlightRanges, pendingHighlightRange);
  }, [currentHighlightRanges, pendingHighlightRange]);

  const paragraphRenderData = useMemo(() => {
    return paragraphMeta.map(item => ({
      paragraph: item,
      segments: buildParagraphSegments(item, renderedHighlightRanges),
    }));
  }, [paragraphMeta, renderedHighlightRanges]);

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
    if (persistReaderStateTimerRef.current) {
      window.clearTimeout(persistReaderStateTimerRef.current);
    }

    persistReaderStateTimerRef.current = window.setTimeout(() => {
      const readingPosition = syncReadingPositionRef(Date.now()) || latestReadingPositionRef.current || undefined;
      const readerState: ReaderBookState = {
        highlightColor,
        highlightsByChapter: highlightRangesByChapter,
        readingPosition,
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
  ]);

  useEffect(() => {
    if (!isReaderAppearanceHydrated) return;

    const persistedFontOptions: ReaderFontState[] = readerFontOptions
      .filter(option => option.sourceType !== 'default' && typeof option.sourceUrl === 'string' && option.sourceUrl.trim().length > 0)
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
    refreshReaderScrollbar();

    const prevTop = lastReaderScrollTopRef.current;
    const currTop = target.scrollTop;
    lastReaderScrollTopRef.current = currTop;
    syncReadingPositionRef(Date.now());

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
    const WHEEL_SWITCH_THRESHOLD_SCROLLABLE = 220;
    const WHEEL_SWITCH_THRESHOLD_SHORT = 120;

    if (e.deltaY > 0) {
      if (nearBottom || noScrollableContent) {
        if (!canConsumeBoundaryIntent('next', noScrollableContent)) {
          resetBoundaryIntent();
          return;
        }

        const threshold = noScrollableContent ? WHEEL_SWITCH_THRESHOLD_SHORT : WHEEL_SWITCH_THRESHOLD_SCROLLABLE;
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

        const threshold = noScrollableContent ? WHEEL_SWITCH_THRESHOLD_SHORT : WHEEL_SWITCH_THRESHOLD_SCROLLABLE;
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
    const TOUCH_SWITCH_THRESHOLD_SCROLLABLE = 96;
    const TOUCH_SWITCH_THRESHOLD_SHORT = 72;

    if (deltaY > 0 && (nearBottom || noScrollableContent)) {
      if (!canConsumeBoundaryIntent('next', noScrollableContent)) {
        resetBoundaryIntent();
        return;
      }

      const threshold = noScrollableContent ? TOUCH_SWITCH_THRESHOLD_SHORT : TOUCH_SWITCH_THRESHOLD_SCROLLABLE;
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

      const threshold = noScrollableContent ? TOUCH_SWITCH_THRESHOLD_SHORT : TOUCH_SWITCH_THRESHOLD_SCROLLABLE;
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

  const ensureReaderFontResource = async (option: ReaderFontOption) => {
    if (option.sourceType === 'default' || !option.sourceUrl) return;

    if (option.sourceType === 'css') {
      const existingFromRef = fontLinkNodesRef.current.find(node => node.href === option.sourceUrl);
      if (existingFromRef) return;
      const existingInDocument = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).find(
        node => node.href === option.sourceUrl
      );
      if (existingInDocument) return;

      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = option.sourceUrl;
      link.dataset.readerFont = '1';
      document.head.appendChild(link);
      fontLinkNodesRef.current.push(link);
      return;
    }

    const fontFamilyName = normalizeStoredFontFamily(option.family) || sanitizeFontFamily(option.label);
    if (!fontFamilyName) return;
    await registerFontFaceFromSource(fontFamilyName, option.sourceUrl);
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

  const handleSimulateAiMessage = () => {
    if (!isAiPanelOpenRef.current) {
      setUnreadMessageCount(prev => Math.min(99, prev + 1));
    }

    const newMsg: Message = {
      id: Date.now().toString(),
      sender: 'ai',
      text: 'This passage has a key emotional turn. Check context before and after.',
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, newMsg]);
  };

  const handleSendMessage = () => {
    if (!inputText.trim()) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      sender: 'user',
      text: inputText,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInputText('');

    window.setTimeout(() => {
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        sender: 'ai',
        text: 'Got it. I can keep breaking down this section for you.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, aiMsg]);
      if (!isAiPanelOpenRef.current) {
        setUnreadMessageCount(prev => Math.min(99, prev + 1));
      }
    }, 800);
  };

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
      const readerState: ReaderBookState = {
        highlightColor,
        highlightsByChapter: highlightRangesByChapter,
        readingPosition: sessionSnapshot.readingPosition,
      };
      saveBookReaderState(sessionSnapshot.bookId, readerState).catch((error) => {
        console.error('Failed to persist reader state on exit:', error);
      });
    }
    onBack(sessionSnapshot || undefined);
  };

  const isHighlighterVisualActive = isHighlightMode || isHighlighterClickPending;
  const highlighterToggleColor = isHighlightMode ? highlightColor : '#64748B';
  const highlighterToggleStyle = { color: highlighterToggleColor } as React.CSSProperties;
  const typographyToggleStyle = { color: '#64748B' } as React.CSSProperties;
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
      className={`flex flex-col h-full min-h-0 relative overflow-hidden transition-colors duration-300 ${
        isDarkMode ? 'dark-mode bg-[#2d3748] text-slate-300' : 'bg-[#e0e5ec] text-slate-700'
      }`}
      style={{ paddingTop: `${Math.max(0, safeAreaTop)}px`, paddingBottom: `${Math.max(0, safeAreaBottom)}px` }}
    >
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
            onClick={handleHighlighterButtonClick}
            className={`w-10 h-10 neu-btn reader-tool-toggle rounded-full ${isHighlighterVisualActive ? 'reader-tool-active' : ''}`}
            style={highlighterToggleStyle}
            title={'\u8367\u5149\u7b14'}
          >
            <Highlighter size={18} />
          </button>
          <button
            onClick={toggleTypographyPanel}
            className={`w-10 h-10 neu-btn reader-tool-toggle rounded-full ${isTypographyPanelOpen ? 'reader-tool-active' : ''}`}
            style={typographyToggleStyle}
            title={'\u6587\u5b57\u6837\u5f0f'}
          >
            <Type size={18} />
          </button>
          <button className="w-10 h-10 neu-btn rounded-full" style={typographyToggleStyle}>
            <MoreHorizontal size={18} />
          </button>
        </div>
      </div>

      {isFloatingPanelVisible && (
        <>
          <button
            aria-label="close-floating-panel"
            className={`absolute inset-0 z-20 bg-black/35 backdrop-blur-sm ${closingFloatingPanel ? 'app-fade-exit' : 'app-fade-enter'}`}
            onClick={closeFloatingPanel}
          />
          {isTocOpen && (
            <div className={`absolute z-30 top-16 right-4 w-[min(22rem,calc(100vw-2rem))] max-h-[32vh] overflow-y-auto no-scrollbar rounded-2xl p-3 border ${isDarkMode ? 'bg-[#2d3748] border-slate-600 shadow-2xl' : 'bg-[#e0e5ec] border-white/50 shadow-2xl'} ${closingFloatingPanel === 'toc' ? 'reader-flyout-exit' : 'reader-flyout-enter'}`}>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400 px-2 py-2">
                {`\u76ee\u5f55 ${chapters.length > 0 ? `(${chapters.length})` : ''}`}
              </div>
              {chapters.length === 0 && (
                <div className="text-xs text-slate-400 px-2 py-3">{'\u5f53\u524d\u56fe\u4e66\u6ca1\u6709\u7ae0\u8282\u6570\u636e\uff0c\u5df2\u6309\u5168\u6587\u9605\u8bfb\u3002'}</div>
              )}
              {chapters.map((chapter, index) => {
                const isActive = selectedChapterIndex === index;
                const title = chapter.title?.trim() || `Chapter ${index + 1}`;
                return (
                  <button
                    key={`${title}-${index}`}
                    onClick={() => handleJumpToChapter(index)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${isActive ? 'text-rose-400 bg-rose-400/10' : 'text-slate-500 hover:bg-black/5 dark:hover:bg-white/5'}`}
                  >
                    <span className="text-xs mr-2 opacity-70">{index + 1}.</span>
                    <span>{title}</span>
                  </button>
                );
              })}
            </div>
          )}
          {isHighlighterPanelOpen && (
            <div className={`absolute z-30 top-16 right-4 w-[min(22rem,calc(100vw-2rem))] max-h-[32vh] overflow-hidden rounded-2xl p-2 border ${isDarkMode ? 'bg-[#2d3748] border-slate-600 shadow-2xl' : 'bg-[#e0e5ec] border-white/50 shadow-2xl'} ${closingFloatingPanel === 'highlighter' ? 'reader-flyout-exit' : 'reader-flyout-enter'} flex flex-col`}>
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
            <div className={`absolute z-30 top-16 right-4 w-[min(22rem,calc(100vw-2rem))] max-h-[32vh] overflow-hidden rounded-2xl p-2 border ${isDarkMode ? 'bg-[#2d3748] border-slate-600 shadow-2xl' : 'bg-[#e0e5ec] border-white/50 shadow-2xl'} ${closingFloatingPanel === 'typography' ? 'reader-flyout-exit' : 'reader-flyout-enter'} flex flex-col`}>
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

      <div className="relative flex-1 min-h-0 m-4 mt-0">
        <div
          ref={readerScrollRef}
          className={`reader-scroll-panel reader-content-scroll h-full min-h-0 overflow-y-auto rounded-2xl shadow-inner transition-colors px-6 py-6 pb-24 ${
            isDarkMode ? 'bg-[#1a202c] shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)]' : 'bg-[#f0f2f5] shadow-[inset_4px_4px_8px_#d1d9e6,inset_-4px_-4px_8px_#ffffff]'
          }`}
          style={readerScrollStyle}
          onScroll={handleReaderScroll}
          onWheel={handleReaderWheel}
          onTouchStart={handleReaderTouchStart}
          onTouchMove={handleReaderTouchMove}
          onTouchEnd={handleReaderTouchEnd}
          onClick={() => {
            if (isHighlightMode) return;
            if (Math.random() > 0.7) handleSimulateAiMessage();
          }}
        >
          <article
            ref={readerArticleRef}
            className={`prose prose-lg max-w-none font-serif leading-loose ${chapterTransitionClass} ${isDarkMode ? 'prose-invert' : ''} ${isHighlightMode ? 'cursor-crosshair' : ''}`}
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
            {activeBook && isLoadingBookContent && <p className="mb-6 indent-8 opacity-70">{'\u6b63\u5728\u52a0\u8f7d\u6b63\u6587\u5185\u5bb9...'}</p>}
            {activeBook && !isLoadingBookContent && paragraphs.length === 0 && (
              <p className="mb-6 indent-8 opacity-70">{'\u8fd9\u672c\u4e66\u8fd8\u6ca1\u6709\u6b63\u6587\u5185\u5bb9\u3002'}</p>
            )}
            {activeBook && !isLoadingBookContent && paragraphRenderData.map(({ segments }, index) => (
              <p key={index} className="mb-6 indent-8">
                {segments.map(segment => (
                  <span
                    key={`${segment.start}-${segment.end}-${segment.color || 'plain'}`}
                    data-reader-segment="1"
                    data-start={segment.start}
                    className={segment.color ? 'rounded-[0.14em]' : undefined}
                    style={segment.color ? { backgroundColor: resolveHighlightBackgroundColor(segment.color, isDarkMode) } : undefined}
                  >
                    {segment.text}
                  </span>
                ))}
              </p>
            ))}
          </article>
        </div>

        {readerScrollbar.visible && (
          <div ref={readerScrollbarTrackRef} className="absolute right-1.5 top-3 bottom-3 w-2 z-10 pointer-events-none overflow-hidden rounded-full">
            <button
              type="button"
              aria-label="reader-scrollbar-thumb"
              onPointerDown={handleReaderThumbPointerDown}
              className={`absolute left-0 w-2 rounded-full border pointer-events-auto touch-none ${
                isDarkMode
                  ? 'bg-slate-400/70 border-slate-300/30'
                  : 'bg-slate-500/65 border-slate-200/50'
              }`}
              style={{
                height: `${readerScrollbar.height}px`,
                transform: `translateY(${readerScrollbar.top}px)`,
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

      {!isAiPanelOpen && (
        <button
          onClick={handleOpenAiPanelFromFab}
          className={`reader-ai-fab absolute bottom-6 right-6 w-12 h-12 neu-btn rounded-full z-20 text-rose-400 ${
            isAiFabOpening ? 'neu-btn-active' : ''
          }`}
        >
          <Sparkles size={20} />
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
        className={`absolute bottom-0 left-0 right-0 h-[40vh] transition-[transform,opacity] duration-500 ease-in-out z-30 ${
          isAiPanelOpen ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'
        } ${isDarkMode ? 'bg-[#2d3748] rounded-t-3xl shadow-[0_-5px_20px_rgba(0,0,0,0.4)]' : 'neu-flat rounded-t-3xl'}`}
        style={{ boxShadow: isDarkMode ? '' : '0 -10px 20px -5px rgba(163,177,198, 0.4)' }}
      >
        <div className="h-8 flex items-center justify-center cursor-pointer opacity-60 hover:opacity-100" onClick={() => setIsAiPanelOpen(false)}>
          <div className={`w-12 h-1.5 rounded-full ${isDarkMode ? 'bg-slate-600' : 'bg-slate-300'}`} />
        </div>

        <div className="flex flex-col h-[calc(100%-2rem)]">
          <div className="px-6 pb-2 flex justify-between items-center mx-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full neu-pressed flex items-center justify-center text-[10px] text-rose-400 font-bold border-2 border-transparent">
                AI
              </div>
              <span className={`text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                {'\u5267\u60c5\u5206\u6790\u52a9\u624b'}
              </span>
            </div>
            <button onClick={() => setIsAiPanelOpen(false)} className="w-8 h-8 neu-btn rounded-full text-slate-400 hover:text-slate-600">
              <ChevronDown size={16} />
            </button>
          </div>

          <div ref={messagesContainerRef} className="reader-scroll-panel flex-1 overflow-y-auto p-4 space-y-4 px-6" style={{ overflowAnchor: 'none' }}>
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] px-5 py-3 text-sm leading-relaxed ${
                    msg.sender === 'user'
                      ? isDarkMode
                        ? 'bg-rose-500 text-white rounded-2xl rounded-br-none shadow-md'
                        : 'bg-rose-400 text-white rounded-2xl rounded-br-none shadow-[5px_5px_10px_#d1d5db,-5px_-5px_10px_#ffffff]'
                      : isDarkMode
                      ? 'bg-[#1a202c] text-slate-300 rounded-2xl rounded-bl-none shadow-md'
                      : 'neu-flat text-slate-700 rounded-2xl rounded-bl-none'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}
          </div>

          <div className="p-4 pb-6">
            <div className={`flex items-center gap-3 rounded-full px-2 py-2 ${isDarkMode ? 'bg-[#1a202c] shadow-inner' : 'neu-pressed'}`}>
              <input
                type="text"
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
                placeholder={'\u8be2\u95ee\u5173\u4e8e\u5267\u60c5\u3001\u4eba\u7269\u7684\u5185\u5bb9...'}
                className={`flex-1 bg-transparent outline-none text-sm min-w-0 px-4 ${
                  isDarkMode ? 'text-slate-200 placeholder-slate-600' : 'text-slate-700'
                }`}
              />
              <button
                onClick={handleSendMessage}
                disabled={!inputText.trim()}
                className={`p-2 rounded-full transition-all ${
                  inputText.trim()
                    ? isDarkMode
                      ? 'bg-rose-400 text-white'
                      : 'neu-flat text-rose-400 active:scale-95'
                    : 'text-slate-400 opacity-50'
                }`}
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Reader;
