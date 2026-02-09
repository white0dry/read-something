import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Cell, LabelList } from 'recharts';
import { Flame, Clock, BookOpen, Calendar, Search, Check, X } from 'lucide-react';
import ModalPortal from './ModalPortal';

interface StatsProps {
  isDarkMode?: boolean;
  dailyReadingMsByDate?: Record<string, number>;
  themeColor?: string;
  completedBookCount?: number;
  completedBookIds?: string[];
  books?: Array<{
    id: string;
    title: string;
    author?: string;
    tags?: string[];
  }>;
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

type SummaryCardKey = 'streak' | 'duration' | 'completed' | 'goal';

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

const Stats: React.FC<StatsProps> = ({
  isDarkMode,
  dailyReadingMsByDate = {},
  themeColor,
  completedBookCount = 0,
  completedBookIds = [],
  books = [],
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
  const now = useMemo(() => new Date(), []);
  const todayDateKey = useMemo(() => formatDateKey(now), [now]);
  const durationAccentColor = useMemo(() => resolveModeAccentColor('#7DA0F2', isDarkMode), [isDarkMode]);
  const completedAccentColor = useMemo(() => resolveModeAccentColor('#A7DCBD', isDarkMode), [isDarkMode]);
  const goalAccentColor = useMemo(() => resolveModeAccentColor('#8B7AB8', isDarkMode), [isDarkMode]);
  const totalCompletedBookCount = useMemo(
    () => Math.max(completedBookCount, completedBookIds.length),
    [completedBookCount, completedBookIds]
  );

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
      const baseLabel = (book.title || '未命名书籍').trim() || '未命名书籍';
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
        label: goalBookLabelById.get(book.id) || '未命名书籍',
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
  const modalTitleMap: Record<SummaryCardKey, string> = {
    streak: '连续阅读',
    duration: '累计时长',
    completed: '累计读完',
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
  const closeCardModal = () => {
    setOpenCardModal(null);
    setGoalBookSearchKeyword('');
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

              {openCardModal === 'goal' ? (
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
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <span className={`text-base font-bold ${headingClass}`}>开发中</span>
                </div>
              )}
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
