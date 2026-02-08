import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Cell, LabelList } from 'recharts';
import { Flame, Clock, BookOpen, Calendar } from 'lucide-react';

interface StatsProps {
  isDarkMode?: boolean;
  dailyReadingMsByDate?: Record<string, number>;
  themeColor?: string;
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

const Stats: React.FC<StatsProps> = ({ isDarkMode, dailyReadingMsByDate = {}, themeColor }) => {
  const containerClass = isDarkMode ? 'bg-[#2d3748] text-slate-200' : 'neu-bg text-slate-600';
  const cardClass = isDarkMode ? 'bg-[#2d3748] shadow-[6px_6px_12px_#232b39,-6px_-6px_12px_#374357]' : 'neu-flat';
  const pressedClass = isDarkMode ? 'bg-[#2d3748] shadow-[inset_3px_3px_6px_#232b39,inset_-3px_-3px_6px_#374357]' : 'neu-pressed';
  const headingClass = isDarkMode ? 'text-slate-200' : 'text-slate-700';
  const axisTextColor = isDarkMode ? '#94a3b8' : '#64748b';
  const [weekOffset, setWeekOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  const [chartWidth, setChartWidth] = useState(0);
  const [weekSlideClass, setWeekSlideClass] = useState('');
  const [monthSlideClass, setMonthSlideClass] = useState('');
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const weekPointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const monthPointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const weekTouchGestureRef = useRef<TouchGestureState | null>(null);
  const monthTouchGestureRef = useRef<TouchGestureState | null>(null);
  const now = useMemo(() => new Date(), []);

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
        <div className={`${cardClass} p-4 flex flex-col justify-between h-28 rounded-2xl`}>
           <div className="flex items-center gap-2 text-rose-400">
             <Flame size={20} />
             <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">连续打卡</span>
           </div>
           <div className={`text-2xl font-black ${headingClass}`}>12 <span className="text-sm font-normal text-slate-400">天</span></div>
        </div>
        <div className={`${cardClass} p-4 flex flex-col justify-between h-28 rounded-2xl`}>
           <div className="flex items-center gap-2 text-blue-400">
             <Clock size={20} />
             <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">总时长</span>
           </div>
           <div className={`text-2xl font-black ${headingClass}`}>48.5 <span className="text-sm font-normal text-slate-400">h</span></div>
        </div>
        <div className={`${cardClass} p-4 flex flex-col justify-between h-28 rounded-2xl`}>
           <div className="flex items-center gap-2 text-emerald-400">
             <BookOpen size={20} />
             <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">已读完</span>
           </div>
           <div className={`text-2xl font-black ${headingClass}`}>3 <span className="text-sm font-normal text-slate-400">本</span></div>
        </div>
        <div className={`${cardClass} p-4 flex flex-col justify-between h-28 rounded-2xl`}>
           <div className="flex items-center gap-2 text-violet-400">
             <Calendar size={20} />
             <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">目标</span>
           </div>
           <div className={`w-full h-3 rounded-full overflow-hidden p-[3px] mt-2 ${pressedClass}`}>
              <div className="h-full bg-violet-400 rounded-full w-[15%]" />
           </div>
        </div>
      </div>

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

              return (
                <div
                  key={`day-${index}`}
                  className={`aspect-square rounded-lg ${pressedClass} relative overflow-hidden flex items-center justify-center`}
                  style={resolveCalendarCellStyle(cell.tier)}
                >
                  <span
                    className="relative z-[1] text-[10px] font-normal leading-none"
                    style={{ color: axisTextColor }}
                  >
                    {cell.day}
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
