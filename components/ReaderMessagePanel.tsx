import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { GoogleGenAI } from '@google/genai';
import { ApiConfig, Book, Chapter, ReaderHighlightRange, ReaderPositionState } from '../types';
import { Character, Persona, WorldBookEntry } from './settings/types';
import ResolvedImage from './ResolvedImage';

interface ReaderMessagePanelProps {
  isDarkMode: boolean;
  apiConfig: ApiConfig;
  activeBook: Book | null;
  personas: Persona[];
  activePersonaId: string | null;
  characters: Character[];
  activeCharacterId: string | null;
  worldBookEntries: WorldBookEntry[];
  chapters: Chapter[];
  bookText: string;
  highlightRangesByChapter: Record<string, ReaderHighlightRange[]>;
  readerContentRef: React.RefObject<HTMLDivElement>;
  getLatestReadingPosition: () => ReaderPositionState | null;
}

type ChatSender = 'user' | 'character';

interface ChatQuotePayload {
  sourceMessageId: string;
  sender: ChatSender;
  senderName: string;
  content: string;
  timestamp: number;
}

interface ChatBubble {
  id: string;
  sender: ChatSender;
  content: string;
  timestamp: number;
  promptRecord: string;
  sentToAi: boolean;
  quote?: ChatQuotePayload;
  generationId?: string;
  editedAt?: number;
}

interface ReaderChatBucket {
  updatedAt: number;
  messages: ChatBubble[];
  chatHistorySummary: string;
  readingPrefixSummaryByBookId: Record<string, string>;
}

type ReaderChatStore = Record<string, ReaderChatBucket>;

interface ContextMenuState {
  bubbleId: string;
  x: number;
  y: number;
}

interface PanelBounds {
  min: number;
  max: number;
}

const CHAT_HISTORY_STORAGE_KEY = 'app_reader_chat_history_v1';
const AI_PANEL_HEIGHT_STORAGE_KEY = 'app_reader_ai_panel_height_v1';
const AI_FAB_OPEN_DELAY_MS = 120;
const AI_REPLY_FIRST_BUBBLE_DELAY_MS = 420;
const AI_REPLY_BUBBLE_INTERVAL_MS = 1500;
const MIN_PANEL_HEIGHT_RATIO = 0.4;
const MAX_PANEL_HEIGHT_RATIO = 0.8;
const LONG_PRESS_MS = 420;
const CONTEXT_MENU_MARGIN = 8;
const PANEL_GRIP_HEIGHT_PX = 32;
const DEFAULT_CHAR_IMG = 'https://i.postimg.cc/ZY3jJTK4/56163534-p0.jpg';
const DEFAULT_USER_NAME = 'User';
const DEFAULT_CHAR_NAME = 'Char';
const ACTIVE_AI_GENERATION_KEYS = new Set<string>();

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const compactText = (value: string) => value.replace(/\s+/g, ' ').trim();
const minutePad = (value: number) => `${value}`.padStart(2, '0');
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const getViewportHeight = () => {
  if (typeof window === 'undefined') return 800;
  return Math.max(1, window.innerHeight || 800);
};

const buildConversationKey = (bookId: string | null, personaId: string | null, characterId: string | null) =>
  `book:${bookId || 'none'}::persona:${personaId || 'none'}::character:${characterId || 'none'}`;

const formatTimestampMinute = (timestamp: number) => {
  const date = new Date(timestamp);
  const yyyy = date.getFullYear();
  const mm = minutePad(date.getMonth() + 1);
  const dd = minutePad(date.getDate());
  const hh = minutePad(date.getHours());
  const min = minutePad(date.getMinutes());
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
};

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

const buildUserPromptRecord = (
  userRealName: string,
  content: string,
  timestamp: number,
  quote?: ChatQuotePayload
) => {
  const messageText = compactText(content);
  const quoteText = quote
    ? ` [引用:发送者=${quote.senderName};时间=${formatTimestampMinute(quote.timestamp)};内容=${compactText(quote.content)}]`
    : '';
  return `[用户消息][发送者:${userRealName}][时间:${formatTimestampMinute(timestamp)}] ${messageText}${quoteText}`;
};

const buildCharacterPromptRecord = (characterRealName: string, content: string, timestamp: number) => {
  const messageText = compactText(content);
  return `[角色消息][发送者:${characterRealName}][时间:${formatTimestampMinute(timestamp)}] ${messageText}`;
};

const defaultChatBucket = (): ReaderChatBucket => ({
  updatedAt: Date.now(),
  messages: [],
  chatHistorySummary: '',
  readingPrefixSummaryByBookId: {},
});

const safeReadChatStore = (): ReaderChatStore => {
  try {
    const saved = localStorage.getItem(CHAT_HISTORY_STORAGE_KEY);
    if (!saved) return {};
    const parsed = JSON.parse(saved);
    if (!parsed || typeof parsed !== 'object') return {};

    const normalized: ReaderChatStore = {};
    Object.entries(parsed).forEach(([key, value]) => {
      if (!key || !value || typeof value !== 'object') return;
      const source = value as Partial<ReaderChatBucket>;
      const sourceMessages = Array.isArray(source.messages) ? source.messages : [];
      const messages = sourceMessages
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const msg = item as Partial<ChatBubble>;
          const sender = msg.sender === 'user' || msg.sender === 'character' ? msg.sender : null;
          const content = typeof msg.content === 'string' ? compactText(msg.content) : '';
          const timestamp = Number(msg.timestamp);
          if (!sender || !content || !Number.isFinite(timestamp)) return null;
          const quoteSource = msg.quote;
          const quote =
            quoteSource &&
            typeof quoteSource === 'object' &&
            (quoteSource.sender === 'user' || quoteSource.sender === 'character') &&
            typeof quoteSource.content === 'string' &&
            compactText(quoteSource.content) &&
            typeof quoteSource.senderName === 'string' &&
            Number.isFinite(Number(quoteSource.timestamp))
              ? {
                  sourceMessageId:
                    typeof quoteSource.sourceMessageId === 'string' && quoteSource.sourceMessageId.trim()
                      ? quoteSource.sourceMessageId
                      : `quote-${timestamp}`,
                  sender: quoteSource.sender,
                  senderName: compactText(quoteSource.senderName) || (quoteSource.sender === 'user' ? 'User' : 'Char'),
                  content: compactText(quoteSource.content),
                  timestamp: Number(quoteSource.timestamp),
                }
              : undefined;

          return {
            id: typeof msg.id === 'string' && msg.id.trim() ? msg.id : `${timestamp}-${Math.random()}`,
            sender,
            content,
            timestamp,
            promptRecord:
              typeof msg.promptRecord === 'string' && compactText(msg.promptRecord)
                ? msg.promptRecord
                : sender === 'user'
                  ? buildUserPromptRecord(DEFAULT_USER_NAME, content, timestamp, quote)
                  : buildCharacterPromptRecord(DEFAULT_CHAR_NAME, content, timestamp),
            sentToAi: msg.sentToAi !== false,
            quote,
            generationId: typeof msg.generationId === 'string' ? msg.generationId : undefined,
            editedAt: Number.isFinite(Number(msg.editedAt)) ? Number(msg.editedAt) : undefined,
          } as ChatBubble;
        })
        .filter((item): item is ChatBubble => Boolean(item));

      const readingPrefixSummaryByBookId =
        source.readingPrefixSummaryByBookId && typeof source.readingPrefixSummaryByBookId === 'object'
          ? Object.entries(source.readingPrefixSummaryByBookId).reduce<Record<string, string>>((acc, [bookId, text]) => {
              if (!bookId || typeof text !== 'string') return acc;
              acc[bookId] = text;
              return acc;
            }, {})
          : {};

      normalized[key] = {
        updatedAt: Number.isFinite(Number(source.updatedAt)) ? Number(source.updatedAt) : Date.now(),
        messages,
        chatHistorySummary: typeof source.chatHistorySummary === 'string' ? source.chatHistorySummary : '',
        readingPrefixSummaryByBookId,
      };
    });
    return normalized;
  } catch {
    return {};
  }
};

const safeSaveChatStore = (store: ReaderChatStore) => {
  try {
    localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // no-op: localStorage can fail in private mode
  }
};

const persistConversationMessagesToStore = (conversationKey: string, messages: ChatBubble[]) => {
  if (!conversationKey) return;
  const store = safeReadChatStore();
  const existing = store[conversationKey] || defaultChatBucket();
  store[conversationKey] = {
    ...existing,
    updatedAt: Date.now(),
    messages,
  };
  safeSaveChatStore(store);
};

const ensureBubbleCount = (items: string[]) => {
  let lines = items.map(compactText).filter(Boolean);
  if (lines.length > 8) lines = lines.slice(0, 8);
  if (lines.length >= 3) return lines;

  const raw = compactText(lines.join(' '));
  const splitByPunctuation = raw
    .split(/[。！？!?；;，,\n]+/)
    .map(compactText)
    .filter(Boolean);

  lines = splitByPunctuation.length > 0 ? splitByPunctuation : lines;
  if (lines.length > 8) lines = lines.slice(0, 8);
  if (lines.length >= 3) return lines;

  if (raw) {
    const chunkSize = Math.max(2, Math.ceil(raw.length / 3));
    const chunks: string[] = [];
    for (let index = 0; index < raw.length && chunks.length < 8; index += chunkSize) {
      chunks.push(raw.slice(index, index + chunkSize));
    }
    if (chunks.length > 0) lines = chunks;
  }

  const fallback = lines[0] || '收到';
  while (lines.length < 3) {
    lines.push(fallback);
  }
  return lines.slice(0, 8);
};

const normalizeAiBubbleLines = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) return ['收到', '我在', '继续聊'];

  let cleaned = trimmed;
  cleaned = cleaned.replace(/```(?:[\w-]+)?\n?/g, '');
  cleaned = cleaned.replace(/```/g, '');

  const tagMatches = [...cleaned.matchAll(/<bubble>([\s\S]*?)<\/bubble>/gi)]
    .map((match) => compactText(match[1] || ''))
    .filter(Boolean);
  if (tagMatches.length > 0) return ensureBubbleCount(tagMatches);

  const lines = cleaned.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const marked = lines
    .map((line) => line.match(/^\[气泡\]\s*(.+)$/)?.[1] || line.match(/^【气泡】\s*(.+)$/)?.[1] || '')
    .map(compactText)
    .filter(Boolean);
  if (marked.length > 0) return ensureBubbleCount(marked);

  const plainLines = lines
    .map((line) => line.replace(/^\d+[\.\)、-]\s*/, ''))
    .map(compactText)
    .filter(Boolean);
  return ensureBubbleCount(plainLines.length > 0 ? plainLines : [cleaned]);
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
  personas,
  activePersonaId,
  characters,
  activeCharacterId,
  worldBookEntries,
  chapters,
  bookText,
  highlightRangesByChapter,
  readerContentRef,
  getLatestReadingPosition,
}) => {
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(true);
  const [isAiFabOpening, setIsAiFabOpening] = useState(false);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  const [messages, setMessages] = useState<ChatBubble[]>([]);
  const [inputText, setInputText] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: 'error' | 'info' } | null>(null);
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
  const [panelHeaderHeightPx, setPanelHeaderHeightPx] = useState(0);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const panelHeaderRef = useRef<HTMLDivElement>(null);
  const isAiPanelOpenRef = useRef(isAiPanelOpen);
  const aiFabOpenTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const dragRafRef = useRef<number | null>(null);
  const pendingDragHeightRef = useRef<number | null>(null);
  const keepBottomRafRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);
  const currentConversationKeyRef = useRef('');
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

  const characterWorldBookEntries = useMemo(() => {
    const boundCategories = new Set(
      (activeCharacter?.boundWorldBookCategories || []).map((category) => category.trim()).filter(Boolean)
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

  const canSendToAi = useMemo(() => {
    const last = messages[messages.length - 1];
    return Boolean(last && last.sender === 'user');
  }, [messages]);

  const quotedMessage = useMemo(
    () => messages.find((message) => message.id === quotedMessageId) || null,
    [messages, quotedMessageId]
  );

  const selectedDeleteIdSet = useMemo(() => new Set(selectedDeleteIds), [selectedDeleteIds]);
  const resolvedPanelHeight = clamp(panelHeightPx, panelBounds.min, panelBounds.max);
  const panelBodyMaxHeight = Math.max(0, panelBounds.max - PANEL_GRIP_HEIGHT_PX);
  const panelConversationMaxHeight = Math.max(0, panelBodyMaxHeight - panelHeaderHeightPx);

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
    setIsConversationHydrated(false);
    const store = safeReadChatStore();
    const legacyBucket = store[legacyConversationKey];
    const bucket = store[conversationKey] || legacyBucket || defaultChatBucket();
    if (!store[conversationKey]) {
      store[conversationKey] = bucket;
      if (legacyBucket) {
        delete store[legacyConversationKey];
      }
      safeSaveChatStore(store);
    }
    setMessages(bucket.messages);
    setChatHistorySummary(bucket.chatHistorySummary || '');
    setReadingPrefixSummaryByBookId(bucket.readingPrefixSummaryByBookId || {});
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
    const store = safeReadChatStore();
    const existing = store[conversationKey] || defaultChatBucket();
    store[conversationKey] = {
      ...existing,
      updatedAt: Date.now(),
      messages,
      chatHistorySummary,
      readingPrefixSummaryByBookId,
    };
    safeSaveChatStore(store);
  }, [conversationKey, messages, chatHistorySummary, readingPrefixSummaryByBookId, isConversationHydrated]);

  useEffect(() => {
    const pending = pendingGenerationRef.current;
    if (!pending || pending.conversationKey === conversationKey) return;
    persistConversationMessagesToStore(pending.conversationKey, [
      ...pending.committedMessages,
      ...pending.remainingMessages,
    ]);
    pendingGenerationRef.current = null;
  }, [conversationKey]);

  useEffect(() => {
    currentConversationKeyRef.current = conversationKey;
    setIsAiLoading(ACTIVE_AI_GENERATION_KEYS.has(conversationKey));
  }, [conversationKey]);

  useEffect(() => {
    if (!isAiLoading) return;
    const syncFromStore = () => {
      const storeBucket = safeReadChatStore()[conversationKey];
      const storeMessages = Array.isArray(storeBucket?.messages) ? storeBucket.messages : [];
      if (storeMessages.length > 0) {
        setMessages((prev) => {
          if (storeMessages.length <= prev.length) return prev;
          const prevLastId = prev.length > 0 ? prev[prev.length - 1].id : '';
          if (prevLastId && !storeMessages.some((item) => item.id === prevLastId)) return prev;
          return storeMessages;
        });
      }

      if (!ACTIVE_AI_GENERATION_KEYS.has(conversationKey)) {
        setIsAiLoading(false);
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
    const nextBottom = Math.max(16, Math.round(viewportBottomGap + 14));
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
    const measureHeader = () => {
      const measured = panelHeaderRef.current?.getBoundingClientRect().height || 0;
      const next = Math.max(0, Math.round(measured));
      setPanelHeaderHeightPx((prev) => (prev === next ? prev : next));
    };

    measureHeader();
    const observed = panelHeaderRef.current;
    const observer =
      typeof ResizeObserver !== 'undefined' && observed
        ? new ResizeObserver(() => {
            measureHeader();
          })
        : null;
    observer?.observe(observed);
    window.addEventListener('resize', measureHeader);

    return () => {
      window.removeEventListener('resize', measureHeader);
      observer?.disconnect();
    };
  }, []);

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

  useEffect(() => {
    if (!isAiPanelOpen) return;
    queueKeepLastMessageVisible();
  }, [resolvedPanelHeight, panelHeaderHeightPx, isAiPanelOpen, queueKeepLastMessageVisible]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      const pending = pendingGenerationRef.current;
      if (pending) {
        persistConversationMessagesToStore(pending.conversationKey, [
          ...pending.committedMessages,
          ...pending.remainingMessages,
        ]);
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
      queueKeepLastMessageVisible();
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
      setPanelHeightPx(pendingDragHeightRef.current as number);
      pendingDragHeightRef.current = null;
    }
    if (dragRafRef.current) {
      window.cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    clearDragState();
    setIsPanelDragging(false);
    queueKeepLastMessageVisible();
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
      setPanelHeightPx(pendingDragHeightRef.current as number);
      pendingDragHeightRef.current = null;
    }
    if (dragRafRef.current) {
      window.cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    clearDragState();
    setIsPanelDragging(false);
    queueKeepLastMessageVisible();
  };

  const getBubbleDisplayName = (sender: ChatSender) => (sender === 'user' ? userRealName : characterRealName);

  const buildReadingContext = () => {
    const joinedBookText = chapters.length > 0 ? chapters.map((chapter) => chapter.content || '').join('') : bookText;
    const readingPosition = getLatestReadingPosition();
    const totalLength = joinedBookText.length;
    const safeOffset = clamp(readingPosition?.globalCharOffset || 0, 0, totalLength);
    const start = clamp(safeOffset - 800, 0, safeOffset);
    const excerpt = joinedBookText.slice(start, safeOffset).trim();

    const chapterOffsets = new Map<number, number>();
    if (chapters.length > 0) {
      let cursor = 0;
      chapters.forEach((chapter, index) => {
        chapterOffsets.set(index, cursor);
        cursor += (chapter.content || '').length;
      });
    }

    const highlightedSnippets: string[] = [];
    Object.entries(highlightRangesByChapter).forEach(([key, ranges]) => {
      const safeRanges = Array.isArray(ranges) ? ranges : [];
      let base = 0;
      if (key.startsWith('chapter-')) {
        const chapterIndex = Number(key.replace('chapter-', ''));
        base = Number.isFinite(chapterIndex) ? chapterOffsets.get(chapterIndex) || 0 : 0;
      }

      safeRanges.forEach((range) => {
        const rangeStart = base + Math.max(0, Math.floor(range.start));
        const rangeEnd = base + Math.max(0, Math.floor(range.end));
        if (rangeEnd <= rangeStart) return;
        if (rangeEnd <= start || rangeStart >= safeOffset) return;

        const clippedStart = clamp(rangeStart, start, safeOffset);
        const clippedEnd = clamp(rangeEnd, start, safeOffset);
        if (clippedEnd <= clippedStart) return;

        const snippet = compactText(joinedBookText.slice(clippedStart, clippedEnd));
        if (!snippet) return;
        if (highlightedSnippets.includes(snippet)) return;
        highlightedSnippets.push(snippet);
      });
    });

    return {
      excerpt,
      highlightedSnippets: highlightedSnippets.slice(0, 12),
    };
  };

  const formatWorldBookSection = (entries: WorldBookEntry[], title: string) => {
    if (entries.length === 0) return `${title}:（无）`;
    return [
      `${title}:`,
      ...entries.map((entry, index) => {
        const code = getWorldBookOrderCode(entry);
        const codeText = Number.isFinite(code) ? code.toString() : '-';
        const entryTitle = entry.title?.trim() || `条目${index + 1}`;
        const entryContent = entry.content?.trim() || '（空）';
        return `[世界书-${index + 1} | 编码:${codeText} | 分类:${entry.category}] ${entryTitle}\n${entryContent}`;
      }),
    ].join('\n');
  };

  const buildAiPrompt = (sourceMessages: ChatBubble[], pendingMessages: ChatBubble[], regenerate: boolean) => {
    const { excerpt, highlightedSnippets } = buildReadingContext();
    const activeBookSummary = activeBook?.id ? readingPrefixSummaryByBookId[activeBook.id] || '' : '';
    const recentHistory = sourceMessages
      .slice(-100)
      .map((message) => message.promptRecord)
      .join('\n');

    const latestUserRecord =
      [...sourceMessages].reverse().find((message) => message.sender === 'user')?.promptRecord || '（暂无用户消息）';
    const pendingRecordText =
      pendingMessages.length > 0
        ? pendingMessages.map((message) => message.promptRecord).join('\n')
        : `${latestUserRecord}\n（当前是刷新上一次回复，请基于这条用户消息重写回复）`;

    return [
      `你是角色 ${characterRealName}。`,
      `你的聊天昵称是 ${characterNickname}。`,
      `当前共读用户真名：${userRealName}。`,
      `当前共读用户昵称：${userNickname}。`,
      '',
      formatWorldBookSection(characterWorldBookEntries.before, '【世界书-角色定义前】'),
      '【角色设定】',
      characterDescription,
      formatWorldBookSection(characterWorldBookEntries.after, '【世界书-角色定义后】'),
      '',
      `【当前书籍】${activeBook?.title || '未选择书籍'}`,
      `【书籍前文总结（预留字段）】${activeBookSummary || '（尚未生成）'}`,
      `【聊天前文总结（预留字段）】${chatHistorySummary || '（尚未生成）'}`,
      '',
      '【当前阅读进度前文800字符，仅前文】',
      excerpt || '（当前无可用前文）',
      '',
      '【前文中荧光笔重点】',
      highlightedSnippets.length > 0 ? highlightedSnippets.map((item) => `- ${item}`).join('\n') : '（暂无）',
      highlightedSnippets.length === 0 ? '【荧光笔状态】当前没有任何划线句子，禁止编造“划线内容”。' : '',
      '',
      '【最近100条聊天记录】',
      recentHistory || '（暂无）',
      '',
      '【本轮待回复用户消息】',
      pendingRecordText,
      '',
      '【场景与语气要求】',
      '- 当前场景是两人正在共读同一本书。',
      '- 语气要接近真人网络聊天，短句、口语化，可拆分句子。',
      '- 可以省略部分标点，不要写成书面报告。',
      '- 不能剧透用户尚未读到的后文。',
      '- 如果荧光笔重点为“（暂无）”，不要提及任何不存在的划线句子。',
      regenerate ? '- 这是对上一轮回复的刷新重答，请保持信息一致但表达自然变化。' : '',
      '',
      '【输出格式要求（必须严格遵守）】',
      '- 只输出 3 到 8 行。',
      '- 每一行必须以 [气泡] 开头。',
      '- [气泡] 后面只写一条聊天消息。',
      '- 不要输出任何解释、标题、编号、代码块。',
      '',
      '[气泡] 示例',
      '[气泡] 继续示例',
      '[气泡] 结束示例',
    ]
      .filter(Boolean)
      .join('\n');
  };

  const callAiModel = async (prompt: string) => {
    const provider = apiConfig.provider;
    const endpoint = (apiConfig.endpoint || '').trim().replace(/\/+$/, '');
    const apiKey = (apiConfig.apiKey || '').trim();
    const model = (apiConfig.model || '').trim();
    const parseResponseError = async (response: Response, fallback: string) => {
      try {
        const raw = await response.text();
        const compact = raw.replace(/\s+/g, ' ').trim();
        if (!compact) return fallback;

        try {
          const parsed = JSON.parse(compact) as
            | { error?: { message?: string } | string; message?: string; detail?: string }
            | null;
          const candidate =
            (typeof parsed?.error === 'string' ? parsed.error : parsed?.error?.message) ||
            parsed?.message ||
            parsed?.detail;
          if (typeof candidate === 'string' && candidate.trim()) {
            return `${fallback}: ${candidate.trim()}`;
          }
        } catch {
          // ignore JSON parse and fallback to plain text
        }

        return `${fallback}: ${compact.slice(0, 180)}`;
      } catch {
        return fallback;
      }
    };

    if (!apiKey) throw new Error('请先设置 API Key');
    if (!model) throw new Error('请先设置模型名称');
    if (provider !== 'GEMINI' && !endpoint) throw new Error('请先设置 API 地址');

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
          max_tokens: 800,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!response.ok) {
        const baseMessage = `Claude API Error ${response.status}`;
        throw new Error(await parseResponseError(response, baseMessage));
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
        temperature: 0.85,
      }),
    });
    if (!response.ok) {
      const baseMessage = `API Error ${response.status}`;
      throw new Error(await parseResponseError(response, baseMessage));
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  };

  const requestAiReply = async (sourceMessages: ChatBubble[], options?: { regenerate?: boolean }) => {
    if (isAiLoading) return;
    const regenerate = options?.regenerate === true;
    const pending = sourceMessages.filter((message) => message.sender === 'user' && !message.sentToAi);
    const lastMessage = sourceMessages[sourceMessages.length - 1] || null;
    const fallbackLatestUserMessage =
      !regenerate && pending.length === 0 && lastMessage?.sender === 'user' ? lastMessage : null;
    const effectivePending = fallbackLatestUserMessage ? [fallbackLatestUserMessage] : pending;
    if (!regenerate && effectivePending.length === 0) {
      showToast('当前没有待发送的用户消息', 'info');
      return;
    }

    const requestConversationKey = conversationKey;
    ACTIVE_AI_GENERATION_KEYS.add(requestConversationKey);
    setIsAiLoading(true);
    setContextMenu(null);

    try {
      const prompt = buildAiPrompt(sourceMessages, effectivePending, regenerate);
      const rawReply = await callAiModel(prompt);
      const bubbleLines = normalizeAiBubbleLines(rawReply);
      const generationId = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const now = Date.now();
      const aiMessages: ChatBubble[] = bubbleLines.map((line, index) => {
        const timestamp = now + index * 1000;
        return {
          id: `${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
          sender: 'character',
          content: compactText(line),
          timestamp,
          promptRecord: buildCharacterPromptRecord(characterRealName, line, timestamp),
          sentToAi: true,
          generationId,
        };
      });

      const pendingIds = new Set(effectivePending.map((item) => item.id));
      const baseMessages = sourceMessages.map((message) =>
        pendingIds.has(message.id) ? { ...message, sentToAi: true } : message
      );
      pendingGenerationRef.current = {
        conversationKey: requestConversationKey,
        committedMessages: baseMessages,
        remainingMessages: [...aiMessages],
      };
      if (!isMountedRef.current) {
        const pendingGeneration = pendingGenerationRef.current;
        if (pendingGeneration) {
          persistConversationMessagesToStore(pendingGeneration.conversationKey, [
            ...pendingGeneration.committedMessages,
            ...pendingGeneration.remainingMessages,
          ]);
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
            persistConversationMessagesToStore(pendingGeneration.conversationKey, [
              ...pendingGeneration.committedMessages,
              ...pendingGeneration.remainingMessages,
            ]);
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
    } finally {
      ACTIVE_AI_GENERATION_KEYS.delete(requestConversationKey);
      if (isMountedRef.current && currentConversationKeyRef.current === requestConversationKey) {
        setIsAiLoading(ACTIVE_AI_GENERATION_KEYS.has(requestConversationKey));
      }
    }
  };

  const handleQueueUserBubble = () => {
    if (isAiLoading || isDeleteMode) return;
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

    const deleteIds = new Set<string>();
    if (last.generationId) {
      for (let index = sourceMessages.length - 1; index >= 0; index -= 1) {
        const message = sourceMessages[index];
        if (message.sender === 'character' && message.generationId === last.generationId) {
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
    return sourceMessages.filter((message) => !deleteIds.has(message.id));
  };

  const handleRefreshReply = async () => {
    if (isAiLoading) return;
    if (messages.length === 0 || messages[messages.length - 1].sender !== 'character') {
      showToast('目前没有可以重置的回复', 'info');
      return;
    }
    const stripped = removeLastAiGeneration(messages);
    if (!stripped) {
      showToast('目前没有可以重置的回复', 'info');
      return;
    }
    setMessages(stripped);
    await requestAiReply(stripped, { regenerate: true });
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
          <div ref={panelHeaderRef} className="px-6 pb-2 flex items-center">
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

          <div className="relative flex-1 min-h-0 overflow-hidden">
            <div
              className="absolute bottom-0 left-0 right-0 flex flex-col min-h-0"
              style={{
                height: `${panelConversationMaxHeight}px`,
              }}
            >
          <div
            ref={messagesContainerRef}
            className={`reader-scroll-panel flex-1 min-h-0 overflow-y-auto p-4 px-6 transition-transform duration-200 ${
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

            {messages.map((message) => {
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
                      } ${isEditingTarget ? 'ring-2 ring-rose-300' : ''}`}
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
                disabled={isAiLoading || isDeleteMode}
                className={`flex-1 bg-transparent outline-none text-sm min-w-0 px-4 ${
                  isDarkMode ? 'text-slate-200 placeholder-slate-600' : 'text-slate-700'
                } ${isAiLoading || isDeleteMode ? 'opacity-60 cursor-not-allowed' : ''}`}
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
                    disabled={isAiLoading || !canSendToAi}
                    className={`p-2 rounded-full transition-all ${
                      !isAiLoading && canSendToAi
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
                    disabled={isAiLoading}
                    className={`p-2 rounded-full transition-all ${
                      isAiLoading
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
