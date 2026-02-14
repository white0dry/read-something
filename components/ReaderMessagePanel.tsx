import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Pencil,
  Quote,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { ApiConfig, Book, Chapter, ReaderHighlightRange, ReaderPositionState } from '../types';
import { Character, Persona, WorldBookEntry } from './settings/types';
import ResolvedImage from './ResolvedImage';
import {
  buildCharacterPromptRecord,
  buildConversationKey,
  buildUserPromptRecord,
  ChatBubble,
  ChatSender,
  ChatQuotePayload,
  clamp,
  compactText,
  ensureConversationBucket,
  formatTimestampMinute,
  GenerationMode,
  getConversationGenerationStatus,
  onChatStoreUpdated,
  onGenerationStatusChanged,
  persistConversationBucket,
  persistConversationMessages,
  readChatStore,
} from '../utils/readerChatRuntime';
import {
  buildCharacterWorldBookSections,
  buildReadingContextSnapshot,
  ReadingContextSnapshot,
  runConversationGeneration,
} from '../utils/readerAiEngine';

interface ReaderMessagePanelProps {
  isDarkMode: boolean;
  apiConfig: ApiConfig;
  activeBook: Book | null;
  aiProactiveUnderlineEnabled: boolean;
  aiProactiveUnderlineProbability: number;
  personas: Persona[];
  activePersonaId: string | null;
  characters: Character[];
  activeCharacterId: string | null;
  worldBookEntries: WorldBookEntry[];
  chapters: Chapter[];
  bookText: string;
  highlightRangesByChapter: Record<string, ReaderHighlightRange[]>;
  onAddAiUnderlineRange: (payload: { start: number; end: number; generationId: string }) => void;
  onRollbackAiUnderlineGeneration: (generationId: string) => void;
  readerContentRef: React.RefObject<HTMLDivElement>;
  getLatestReadingPosition: () => ReaderPositionState | null;
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

const ReaderMessagePanel: React.FC<ReaderMessagePanelProps> = ({
  isDarkMode,
  apiConfig,
  activeBook,
  aiProactiveUnderlineEnabled,
  aiProactiveUnderlineProbability,
  personas,
  activePersonaId,
  characters,
  activeCharacterId,
  worldBookEntries,
  chapters,
  bookText,
  highlightRangesByChapter,
  onAddAiUnderlineRange,
  onRollbackAiUnderlineGeneration,
  readerContentRef,
  getLatestReadingPosition,
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
  const [fabBottomPx, setFabBottomPx] = useState(24);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [contextMenuLayout, setContextMenuLayout] = useState<{ left: number; top: number } | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [quotedMessageId, setQuotedMessageId] = useState<string | null>(null);
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [selectedDeleteIds, setSelectedDeleteIds] = useState<string[]>([]);
  const [chatHistorySummary, setChatHistorySummary] = useState('');
  const [readingPrefixSummaryByBookId, setReadingPrefixSummaryByBookId] = useState<Record<string, string>>({});

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

  const userRealName = activePersona?.name?.trim() || DEFAULT_USER_NAME;
  const userNickname = activePersona?.userNickname?.trim() || userRealName;
  const characterRealName = activeCharacter?.name?.trim() || DEFAULT_CHAR_NAME;
  const characterNickname = activeCharacter?.nickname?.trim() || characterRealName;
  const characterDescription = activeCharacter?.description?.trim() || '（暂无角色人设）';

  const conversationKey = useMemo(
    () => buildConversationKey(activeBook?.id || null, activePersonaId, activeCharacterId),
    [activeBook?.id, activePersonaId, activeCharacterId]
  );
  const legacyConversationKey = useMemo(
    () => `persona:${activePersonaId || 'none'}::character:${activeCharacterId || 'none'}`,
    [activePersonaId, activeCharacterId]
  );

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
  const visibleMessages = useMemo(
    () => (hiddenBubbleIds.length === 0 ? messages : messages.filter((message) => !hiddenBubbleIdSet.has(message.id))),
    [messages, hiddenBubbleIds.length, hiddenBubbleIdSet]
  );
  const resolvedPanelHeight = clamp(panelHeightPx, panelBounds.min, panelBounds.max);

  const updateHiddenBubbleIds = useCallback((updater: (prev: string[]) => string[]) => {
    const prev = hiddenBubbleIdsRef.current;
    const next = updater(prev);
    hiddenBubbleIdsRef.current = next;
    setHiddenBubbleIds(next);
  }, []);

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
    bubbleRevealSequenceRef.current += 1;
    hiddenBubbleIdsRef.current = [];
    setHiddenBubbleIds([]);
    setIsConversationHydrated(false);
    const bucket = ensureConversationBucket(conversationKey, legacyConversationKey);
    const status = getConversationGenerationStatus(conversationKey);
    setMessages(bucket.messages);
    messagesRef.current = bucket.messages;
    setChatHistorySummary(bucket.chatHistorySummary || '');
    setReadingPrefixSummaryByBookId(bucket.readingPrefixSummaryByBookId || {});
    setActiveGenerationMode(status.isLoading ? status.mode : null);
    setInputText('');
    setQuotedMessageId(null);
    setEditingMessageId(null);
    setIsDeleteMode(false);
    setSelectedDeleteIds([]);
    setContextMenu(null);
    setIsConversationHydrated(true);
  }, [conversationKey, legacyConversationKey]);

  useEffect(() => {
    if (!isConversationHydrated) return;
    persistConversationBucket(
      conversationKey,
      (existing) => ({
        ...existing,
        messages,
        chatHistorySummary,
        readingPrefixSummaryByBookId,
      }),
      'panel-local-sync'
    );
  }, [conversationKey, messages, chatHistorySummary, readingPrefixSummaryByBookId, isConversationHydrated]);

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
    });
  };

  const requestAiReply = async (sourceMessages: ChatBubble[]) => {
    if (isManualLoading) return;
    const readingContext = buildReadingContext();
    const requestConversationKey = conversationKey;
    setContextMenu(null);

    try {
      const result = await runConversationGeneration({
        mode: 'manual',
        conversationKey: requestConversationKey,
        sourceMessages,
        apiConfig,
        userRealName,
        userNickname,
        characterRealName,
        characterNickname,
        characterDescription,
        characterWorldBookEntries,
        activeBookId: activeBook?.id || null,
        activeBookTitle: activeBook?.title || '未选择书籍',
        chatHistorySummary,
        readingPrefixSummaryByBookId,
        readingContext,
        aiProactiveUnderlineEnabled,
        aiProactiveUnderlineProbability,
        allowEmptyPending: false,
        onAddAiUnderlineRange,
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
      {!isAiPanelOpen && (
        <button
          onClick={handleOpenAiPanelFromFab}
          className={`reader-ai-fab absolute right-6 w-12 h-12 neu-btn rounded-full z-20 text-rose-400 ${
            isAiFabOpening ? 'neu-btn-active' : ''
          }`}
          style={{ bottom: `${fabBottomPx}px` }}
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
        className={`absolute bottom-0 left-0 right-0 transition-[transform,opacity] ${isPanelDragging ? 'duration-75' : 'duration-500'} ease-in-out z-30 pointer-events-none ${
          isAiPanelOpen ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'
        }`}
        style={{
          height: `${resolvedPanelHeight}px`,
        }}
      >
        <div
          className={`absolute bottom-0 left-0 right-0 pointer-events-auto overflow-hidden ${
            isDarkMode ? 'bg-[#2d3748] rounded-t-3xl shadow-[0_-5px_20px_rgba(0,0,0,0.4)]' : 'neu-flat rounded-t-3xl'
          }`}
          style={{
            height: `${resolvedPanelHeight}px`,
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
          <div className="px-6 pb-2 flex items-center">
            <div className="flex items-center gap-2 min-w-0">
              <div
                className={`w-10 h-10 rounded-full overflow-hidden flex items-center justify-center border-2 border-transparent ${
                  isDarkMode ? 'bg-[#1a202c]' : 'neu-pressed'
                }`}
              >
                {renderCharacterAvatar()}
              </div>
              <span className={`text-sm font-bold truncate ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
                {characterNickname}
              </span>
            </div>
          </div>

          <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
          <div
            ref={messagesContainerRef}
            className={`reader-scroll-panel reader-message-scroll flex-1 min-h-0 overflow-y-auto p-4 px-6 transition-transform duration-200 ${
              isAiLoading ? '-translate-y-1' : 'translate-y-0'
            }`}
            style={{ overflowAnchor: 'none' }}
          >
            <div className="min-h-full flex flex-col justify-end space-y-4">
            {messages.length === 0 && (
              <div className={`text-xs text-center pt-8 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                暂无聊天消息
              </div>
            )}

            {visibleMessages.map((message) => {
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

                    <div
                      className={`px-5 py-3 text-sm leading-relaxed transition-colors ${
                        isUser
                          ? isDarkMode
                            ? 'bg-rose-500 text-white rounded-2xl rounded-br shadow-md'
                            : 'bg-rose-400 text-white rounded-2xl rounded-br shadow-[5px_5px_10px_#d1d5db,-5px_-5px_10px_#ffffff]'
                          : isDarkMode
                            ? 'bg-[#1a202c] text-slate-300 rounded-2xl rounded-bl shadow-md'
                            : 'neu-flat text-slate-700 rounded-2xl rounded-bl'
                       } ${isUser ? 'reader-bubble-enter-right' : 'reader-bubble-enter-left'} ${
                         isEditingTarget ? 'ring-2 ring-rose-300' : ''
                       }`}
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
              );
            })}
            </div>
          </div>

          <div className="p-4 pb-6 relative">
            {toast && (
              <div
                className={`absolute left-1/2 -translate-x-1/2 -top-8 px-6 py-2 rounded-full flex items-center gap-2 border backdrop-blur-md text-xs font-bold ${
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
                className={`mb-2 px-3 text-xs reader-typing-breath ${
                  isDarkMode ? 'text-slate-400' : 'text-slate-500'
                }`}
              >
                {characterNickname} 正在输入中...
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

            <div className={`flex items-center gap-3 rounded-full px-2 py-2 ${isDarkMode ? 'bg-[#1a202c] shadow-inner' : 'neu-pressed'}`}>
              <input
                type="text"
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder=""
                disabled={isManualLoading || isDeleteMode}
                className={`flex-1 bg-transparent outline-none text-sm min-w-0 px-4 ${
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
                    className={`p-2 rounded-full transition-all ${
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
                    className={`p-2 rounded-full transition-all ${
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

