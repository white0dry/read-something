import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  ChevronDown,
  Highlighter,
  List as ListIcon,
  MoreHorizontal,
  Send,
  Sparkles,
  Type,
} from 'lucide-react';
import { Book, Chapter, Message } from '../types';
import { getBookContent } from '../utils/bookContentStorage';

interface ReaderProps {
  onBack: () => void;
  isDarkMode: boolean;
  activeBook: Book | null;
}

type ScrollTarget = 'top' | 'bottom';
type ChapterSwitchDirection = 'next' | 'prev';

const Reader: React.FC<ReaderProps> = ({ onBack, isDarkMode, activeBook }) => {
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(true);
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);
  const [isTocOpen, setIsTocOpen] = useState(false);
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

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const readerScrollRef = useRef<HTMLDivElement>(null);
  const readerScrollbarTrackRef = useRef<HTMLDivElement>(null);
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
    const thumbTop = (scrollTop / contentScrollable) * trackScrollable;

    setReaderScrollbar({
      visible: true,
      top: thumbTop,
      height: thumbHeight,
    });
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
      setIsTocOpen(false);
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

  useEffect(() => {
    if (!isAiPanelOpen) return;
    const rafId = window.requestAnimationFrame(() => {
      scrollMessagesToBottom('smooth');
      setHasUnreadMessages(false);
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
        setIsTocOpen(false);
        setIsLoadingBookContent(false);
        return;
      }

      setIsLoadingBookContent(true);
      try {
        const content = await getBookContent(activeBook.id);
        const fullText = content?.fullText || activeBook.fullText || '';
        const contentChapters = content?.chapters || [];
        const fallbackChapters = activeBook.chapters || [];
        const resolvedChapters = contentChapters.length > 0 ? contentChapters : fallbackChapters;

        if (cancelled) return;

        setChapters(resolvedChapters);
        setIsTocOpen(false);

        if (resolvedChapters.length > 0) {
          setSelectedChapterIndex(0);
          setBookText(resolvedChapters[0].content || fullText);
        } else {
          setSelectedChapterIndex(null);
          setBookText(fullText);
        }
      } catch (error) {
        console.error('Failed to load reader content:', error);
        if (!cancelled) {
          setChapters([]);
          setSelectedChapterIndex(null);
          setIsTocOpen(false);
          setBookText(activeBook.fullText || '');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingBookContent(false);
        }
      }
    };

    loadBookContent();
    return () => {
      cancelled = true;
    };
  }, [activeBook?.id]);

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
  }, [bookText, isLoadingBookContent, isTocOpen, selectedChapterIndex]);

  useEffect(() => {
    return () => {
      clearChapterTransitionTimers();
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

  const activeChapterTitle = selectedChapterIndex !== null
    ? (chapters[selectedChapterIndex]?.title || `Chapter ${selectedChapterIndex + 1}`)
    : '';

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
    const startY = e.touches[0]?.clientY ?? null;
    touchStartYRef.current = startY;
    touchLastYRef.current = startY;
    touchSwitchHandledRef.current = false;
  };

  const handleReaderTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
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
    (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);

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

  const handleSimulateAiMessage = () => {
    if (!isAiPanelOpen) setHasUnreadMessages(true);

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
      if (!isAiPanelOpen) setHasUnreadMessages(true);
    }, 800);
  };

  return (
    <div
      className={`flex flex-col h-full min-h-0 relative overflow-hidden transition-colors duration-300 ${
        isDarkMode ? 'dark-mode bg-[#2d3748] text-slate-300' : 'bg-[#e0e5ec] text-slate-700'
      }`}
    >
      <div className={`flex items-center gap-3 p-4 z-10 transition-colors ${isDarkMode ? 'bg-[#2d3748]' : 'bg-[#e0e5ec]'}`}>
        <button onClick={onBack} className="w-10 h-10 neu-btn rounded-full text-slate-500 hover:text-slate-700 shrink-0">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0 max-w-[calc(100%-11rem)]">
          <div className="text-sm font-serif font-medium opacity-70 truncate">{activeBook?.title || '\u9605\u8bfb\u4e2d'}</div>
        </div>
        <div className="flex gap-3 shrink-0">
          <button
            onClick={() => setIsTocOpen(prev => !prev)}
            className="w-10 h-10 neu-btn rounded-full text-slate-500 hover:text-rose-400"
            title="\u76ee\u5f55"
          >
            <ListIcon size={18} />
          </button>
          <button className="w-10 h-10 neu-btn rounded-full text-slate-500 hover:text-slate-700">
            <Type size={18} />
          </button>
          <button className="w-10 h-10 neu-btn rounded-full text-slate-500 hover:text-slate-700">
            <MoreHorizontal size={18} />
          </button>
        </div>
      </div>

      {isTocOpen && (
        <>
          <button
            aria-label="close-toc"
            className="absolute inset-0 z-20 bg-black/40 backdrop-blur-sm"
            onClick={() => setIsTocOpen(false)}
          />
          <div className={`absolute z-30 top-16 right-4 w-[min(22rem,calc(100vw-2rem))] max-h-[55vh] overflow-y-auto no-scrollbar rounded-2xl p-3 border ${isDarkMode ? 'bg-[#2d3748] border-slate-600 shadow-2xl' : 'bg-[#e0e5ec] border-white/50 shadow-2xl'}`}>
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
        </>
      )}

      <div className="relative flex-1 min-h-0 m-4 mt-0">
        <div
          ref={readerScrollRef}
          className={`reader-scroll-panel reader-content-scroll h-full min-h-0 overflow-y-auto rounded-2xl shadow-inner transition-colors px-6 py-6 pb-24 ${
            isDarkMode ? 'bg-[#1a202c] shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)]' : 'bg-[#f0f2f5] shadow-[inset_4px_4px_8px_#d1d9e6,inset_-4px_-4px_8px_#ffffff]'
          }`}
          onScroll={handleReaderScroll}
          onWheel={handleReaderWheel}
          onTouchStart={handleReaderTouchStart}
          onTouchMove={handleReaderTouchMove}
          onTouchEnd={handleReaderTouchEnd}
          onClick={() => {
            if (Math.random() > 0.7) handleSimulateAiMessage();
          }}
        >
          <article className={`prose prose-lg max-w-none font-serif leading-loose ${chapterTransitionClass} ${isDarkMode ? 'prose-invert text-slate-400' : 'text-slate-800'}`}>
            {!activeBook && <p className="mb-6 indent-8 text-justify opacity-70">{'\u672a\u9009\u62e9\u4e66\u7c4d\uff0c\u8bf7\u8fd4\u56de\u4e66\u67b6\u9009\u62e9\u4e00\u672c\u4e66\u3002'}</p>}
            {activeBook && isLoadingBookContent && <p className="mb-6 indent-8 text-justify opacity-70">{'\u6b63\u5728\u52a0\u8f7d\u6b63\u6587\u5185\u5bb9...'}</p>}
            {activeBook && !isLoadingBookContent && selectedChapterIndex !== null && (
              <h2 className="text-base font-bold mb-4 tracking-wide">{activeChapterTitle}</h2>
            )}
            {activeBook && !isLoadingBookContent && paragraphs.length === 0 && (
              <p className="mb-6 indent-8 text-justify opacity-70">{'\u8fd9\u672c\u4e66\u8fd8\u6ca1\u6709\u6b63\u6587\u5185\u5bb9\u3002'}</p>
            )}
            {activeBook && !isLoadingBookContent && paragraphs.map((paragraph, index) => (
              <p key={index} className="mb-6 indent-8 text-justify">
                {paragraph}
              </p>
            ))}
          </article>
        </div>

        {readerScrollbar.visible && (
          <div ref={readerScrollbarTrackRef} className="absolute right-1.5 top-3 bottom-3 w-2 z-10 pointer-events-none">
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

      {!isAiPanelOpen && hasUnreadMessages && (
        <button
          onClick={() => setIsAiPanelOpen(true)}
          className="absolute bottom-6 right-6 bg-rose-400 text-white px-4 py-3 rounded-full shadow-lg hover:bg-rose-500 transition-all animate-bounce flex items-center gap-2 z-20"
        >
          <Sparkles size={18} />
          <span className="text-sm font-medium">{'\u65b0\u6d88\u606f'}</span>
        </button>
      )}

      {!isAiPanelOpen && !hasUnreadMessages && (
        <button
          onClick={() => setIsAiPanelOpen(true)}
          className="absolute bottom-6 right-6 w-12 h-12 neu-btn rounded-full z-20 text-rose-400"
        >
          <Sparkles size={20} />
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
