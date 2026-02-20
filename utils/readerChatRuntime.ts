import { ReaderAiUnderlineRange, ReaderSummaryCard } from '../types';
import {
  getStoredChatHistoryStore,
  saveStoredChatHistoryStore,
} from './chatHistoryStorage';

export type ChatSender = 'user' | 'character';

export interface ChatQuotePayload {
  sourceMessageId: string;
  sender: ChatSender;
  senderName: string;
  content: string;
  timestamp: number;
}

export interface ChatBubble {
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

export interface ReaderChatBucket {
  updatedAt: number;
  messages: ChatBubble[];
  personaName: string;
  characterName: string;
  chatHistorySummary: string;
  readingPrefixSummaryByBookId: Record<string, string>;
  readingAiUnderlinesByBookId: Record<string, Record<string, ReaderAiUnderlineRange[]>>;
  chatSummaryCards: ReaderSummaryCard[];
  chatAutoSummaryLastEnd: number;
}

export type ReaderChatStore = Record<string, ReaderChatBucket>;
export type GenerationMode = 'manual' | 'proactive';

export interface ChatStoreUpdatedEventDetail {
  conversationKey: string;
  bucket: ReaderChatBucket;
  reason?: string;
}

export interface GenerationStatusEventDetail {
  conversationKey: string;
  isLoading: boolean;
  mode: GenerationMode | null;
  requestId: string | null;
  previousMode?: GenerationMode;
  reason?: string;
}

interface GenerationRecord {
  mode: GenerationMode;
  requestId: string;
  controller: AbortController;
}

const DEFAULT_USER_NAME = 'User';
const DEFAULT_CHAR_NAME = 'Char';

export const CHAT_HISTORY_STORAGE_KEY = 'app_reader_chat_history_v1';
export const CHAT_STORE_UPDATED_EVENT = 'app-reader-chat-store-updated';
export const GENERATION_STATUS_EVENT = 'app-reader-chat-generation-status';

const generationRegistry = new Map<string, GenerationRecord>();
let chatStoreCache: ReaderChatStore = {};
let chatStoreHydrated = false;
let chatStoreHydrationPromise: Promise<void> | null = null;
let chatStorePersistQueue: Promise<void> = Promise.resolve();
let pendingStoreBeforeHydration: ReaderChatStore | null = null;

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const compactText = (value: string) => value.replace(/\s+/g, ' ').trim();
const LEGACY_PROMPT_ROLE_PREFIX_RE = /^\[(?:用户消息|角色消息)\]/;
const MODERN_PROMPT_RECORD_RE = /^\[发送者:[^\]]+\]\[[^\]]+\]\s*/;

const minutePad = (value: number) => `${value}`.padStart(2, '0');

export const formatTimestampMinute = (timestamp: number) => {
  const date = new Date(timestamp);
  const yyyy = date.getFullYear();
  const mm = minutePad(date.getMonth() + 1);
  const dd = minutePad(date.getDate());
  const hh = minutePad(date.getHours());
  const min = minutePad(date.getMinutes());
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
};

export const buildConversationKey = (bookId: string | null, personaId: string | null, characterId: string | null) =>
  `book:${bookId || 'none'}::persona:${personaId || 'none'}::character:${characterId || 'none'}`;

interface ParsedConversationKey {
  bookId: string | null;
  personaId: string | null;
  characterId: string | null;
}

const parseConversationKey = (conversationKey: string): ParsedConversationKey | null => {
  const matched = conversationKey.match(/^book:(.+?)::persona:(.+?)::character:(.+)$/);
  if (!matched) return null;
  return {
    bookId: matched[1] === 'none' ? null : matched[1],
    personaId: matched[2] === 'none' ? null : matched[2],
    characterId: matched[3] === 'none' ? null : matched[3],
  };
};

const buildConversationArchiveIdentity = (conversationKey: string, bucket: ReaderChatBucket) => {
  const parsed = parseConversationKey(conversationKey);
  if (!parsed) return '';
  const personaName = compactText(bucket.personaName || '').toLowerCase();
  const characterName = compactText(bucket.characterName || '').toLowerCase();
  if (!personaName || !characterName) return '';
  return `book:${parsed.bookId || 'none'}::persona-name:${personaName}::character-name:${characterName}`;
};

const getBucketScore = (bucket: ReaderChatBucket) => {
  const messageCount = Array.isArray(bucket.messages) ? bucket.messages.length : 0;
  const summaryCount = Array.isArray(bucket.chatSummaryCards) ? bucket.chatSummaryCards.length : 0;
  const updatedAt = Number(bucket.updatedAt) || 0;
  return messageCount * 1_000_000 + summaryCount * 1_000 + updatedAt;
};

const mergeDuplicateBuckets = (left: ReaderChatBucket, right: ReaderChatBucket): ReaderChatBucket => {
  const preferLeft = getBucketScore(left) >= getBucketScore(right);
  const primary = preferLeft ? left : right;
  const secondary = preferLeft ? right : left;
  return normalizeChatBucket({
    ...primary,
    personaName: primary.personaName || secondary.personaName || '',
    characterName: primary.characterName || secondary.characterName || '',
    messages:
      (Array.isArray(primary.messages) ? primary.messages.length : 0) >=
      (Array.isArray(secondary.messages) ? secondary.messages.length : 0)
        ? primary.messages
        : secondary.messages,
    chatHistorySummary: primary.chatHistorySummary || secondary.chatHistorySummary || '',
    readingPrefixSummaryByBookId: {
      ...(secondary.readingPrefixSummaryByBookId || {}),
      ...(primary.readingPrefixSummaryByBookId || {}),
    },
    readingAiUnderlinesByBookId: {
      ...(secondary.readingAiUnderlinesByBookId || {}),
      ...(primary.readingAiUnderlinesByBookId || {}),
    },
    chatSummaryCards:
      (Array.isArray(primary.chatSummaryCards) ? primary.chatSummaryCards.length : 0) >=
      (Array.isArray(secondary.chatSummaryCards) ? secondary.chatSummaryCards.length : 0)
        ? primary.chatSummaryCards
        : secondary.chatSummaryCards,
    chatAutoSummaryLastEnd: Math.max(
      Number(primary.chatAutoSummaryLastEnd) || 0,
      Number(secondary.chatAutoSummaryLastEnd) || 0
    ),
    updatedAt: Math.max(Number(primary.updatedAt) || 0, Number(secondary.updatedAt) || 0),
  });
};

const dedupeConversationStore = (
  sourceStore: ReaderChatStore,
  preferredConversationKey?: string
): { store: ReaderChatStore; changed: boolean } => {
  const store: ReaderChatStore = { ...sourceStore };
  const identityToKey = new Map<string, string>();
  let changed = false;

  Object.keys(store).forEach((conversationKey) => {
    const bucket = store[conversationKey];
    if (!bucket) return;
    const identity = buildConversationArchiveIdentity(conversationKey, bucket);
    if (!identity) return;
    const existingKey = identityToKey.get(identity);
    if (!existingKey) {
      identityToKey.set(identity, conversationKey);
      return;
    }
    const existingBucket = store[existingKey];
    if (!existingBucket) {
      identityToKey.set(identity, conversationKey);
      return;
    }

    const keepKey =
      preferredConversationKey && (existingKey === preferredConversationKey || conversationKey === preferredConversationKey)
        ? preferredConversationKey
        : getBucketScore(existingBucket) >= getBucketScore(bucket)
          ? existingKey
          : conversationKey;
    const dropKey = keepKey === existingKey ? conversationKey : existingKey;
    const keepBucket = store[keepKey];
    const dropBucket = store[dropKey];
    if (!keepBucket || !dropBucket) return;

    store[keepKey] = mergeDuplicateBuckets(keepBucket, dropBucket);
    delete store[dropKey];
    identityToKey.set(identity, keepKey);
    changed = true;
  });

  return { store, changed };
};

export const buildUserPromptRecord = (
  userRealName: string,
  content: string,
  timestamp: number,
  quote?: ChatQuotePayload
) => {
  const messageText = compactText(content);
  const quoteText = quote
    ? ` [引用:发送者=${quote.senderName};时间=${formatTimestampMinute(quote.timestamp)};内容=${compactText(quote.content)}]`
    : '';
  return `[发送者:${userRealName}][时间:${formatTimestampMinute(timestamp)}] ${messageText}${quoteText}`;
};

export const buildCharacterPromptRecord = (characterRealName: string, content: string, timestamp: number) => {
  const messageText = compactText(content);
  return `[发送者:${characterRealName}][${formatTimestampMinute(timestamp)}] ${messageText}`;
};

const migratePromptRecordFormat = (value: string): string => {
  const compact = compactText(value || '');
  if (!compact) return '';
  return compact.replace(LEGACY_PROMPT_ROLE_PREFIX_RE, '');
};

export const defaultChatBucket = (): ReaderChatBucket => ({
  updatedAt: Date.now(),
  messages: [],
  personaName: '',
  characterName: '',
  chatHistorySummary: '',
  readingPrefixSummaryByBookId: {},
  readingAiUnderlinesByBookId: {},
  chatSummaryCards: [],
  chatAutoSummaryLastEnd: 0,
});

const normalizeSummaryCard = (value: unknown): ReaderSummaryCard | null => {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<ReaderSummaryCard>;
  const id = typeof source.id === 'string' && source.id.trim() ? source.id : '';
  const content = typeof source.content === 'string' ? source.content.trim() : '';
  const start = Number(source.start);
  const end = Number(source.end);
  if (!id || !content || !Number.isFinite(start) || !Number.isFinite(end)) return null;
  const safeStart = Math.max(0, Math.floor(start));
  const safeEnd = Math.max(safeStart, Math.floor(end));
  const createdAt = Number(source.createdAt);
  const updatedAt = Number(source.updatedAt);
  return {
    id,
    content,
    start: safeStart,
    end: safeEnd,
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
  };
};

const normalizeSummaryCards = (value: unknown) => {
  if (!Array.isArray(value)) return [] as ReaderSummaryCard[];
  return value
    .map((item) => normalizeSummaryCard(item))
    .filter((item): item is ReaderSummaryCard => Boolean(item));
};

const normalizeQuotePayload = (value: unknown, fallbackTimestamp: number): ChatQuotePayload | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Partial<ChatQuotePayload>;
  if (source.sender !== 'user' && source.sender !== 'character') return undefined;
  if (typeof source.content !== 'string') return undefined;
  if (typeof source.senderName !== 'string') return undefined;
  const content = compactText(source.content);
  if (!content) return undefined;
  const timestamp = Number(source.timestamp);
  if (!Number.isFinite(timestamp)) return undefined;
  return {
    sourceMessageId:
      typeof source.sourceMessageId === 'string' && source.sourceMessageId.trim()
        ? source.sourceMessageId
        : `quote-${fallbackTimestamp}`,
    sender: source.sender,
    senderName: compactText(source.senderName) || (source.sender === 'user' ? DEFAULT_USER_NAME : DEFAULT_CHAR_NAME),
    content,
    timestamp,
  };
};

const normalizeChatBubble = (value: unknown): ChatBubble | null => {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<ChatBubble>;
  if (source.sender !== 'user' && source.sender !== 'character') return null;
  const content = typeof source.content === 'string' ? compactText(source.content) : '';
  const timestamp = Number(source.timestamp);
  if (!content || !Number.isFinite(timestamp)) return null;
  const quote = normalizeQuotePayload(source.quote, timestamp);
  const migratedPromptRecord =
    typeof source.promptRecord === 'string'
      ? migratePromptRecordFormat(source.promptRecord)
      : '';
  const fallbackPromptRecord =
    source.sender === 'user'
      ? buildUserPromptRecord(DEFAULT_USER_NAME, content, timestamp, quote)
      : buildCharacterPromptRecord(DEFAULT_CHAR_NAME, content, timestamp);
  return {
    id: typeof source.id === 'string' && source.id.trim() ? source.id : `${timestamp}-${Math.random()}`,
    sender: source.sender,
    content,
    timestamp,
    promptRecord: MODERN_PROMPT_RECORD_RE.test(migratedPromptRecord) ? migratedPromptRecord : fallbackPromptRecord,
    sentToAi: source.sentToAi !== false,
    quote,
    generationId: typeof source.generationId === 'string' ? source.generationId : undefined,
    editedAt: Number.isFinite(Number(source.editedAt)) ? Number(source.editedAt) : undefined,
  };
};

const normalizeReadingPrefixSummaryByBookId = (value: unknown) => {
  if (!value || typeof value !== 'object') return {};
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>((acc, [bookId, text]) => {
    if (!bookId || typeof text !== 'string') return acc;
    acc[bookId] = text;
    return acc;
  }, {});
};

const normalizeAiUnderlineRange = (value: unknown): ReaderAiUnderlineRange | null => {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<ReaderAiUnderlineRange>;
  const start = Number(source.start);
  const end = Number(source.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const safeStart = Math.max(0, Math.floor(Math.min(start, end)));
  const safeEnd = Math.max(safeStart, Math.floor(Math.max(start, end)));
  return {
    start: safeStart,
    end: safeEnd,
    generationId:
      typeof source.generationId === 'string' && source.generationId.trim()
        ? source.generationId.trim()
        : undefined,
  };
};

const normalizeAiUnderlinesByChapter = (value: unknown) => {
  if (!value || typeof value !== 'object') return {} as Record<string, ReaderAiUnderlineRange[]>;
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, ReaderAiUnderlineRange[]>>(
    (acc, [chapterKey, ranges]) => {
      if (!chapterKey || !Array.isArray(ranges)) return acc;
      const normalizedRanges = ranges
        .map((item) => normalizeAiUnderlineRange(item))
        .filter((item): item is ReaderAiUnderlineRange => Boolean(item));
      acc[chapterKey] = normalizedRanges;
      return acc;
    },
    {}
  );
};

const normalizeReadingAiUnderlinesByBookId = (value: unknown) => {
  if (!value || typeof value !== 'object') return {} as Record<string, Record<string, ReaderAiUnderlineRange[]>>;
  return Object.entries(value as Record<string, unknown>).reduce<
    Record<string, Record<string, ReaderAiUnderlineRange[]>>
  >((acc, [bookId, chapterMap]) => {
    if (!bookId || !chapterMap || typeof chapterMap !== 'object') return acc;
    acc[bookId] = normalizeAiUnderlinesByChapter(chapterMap);
    return acc;
  }, {});
};

const normalizeChatBucket = (value: unknown): ReaderChatBucket => {
  if (!value || typeof value !== 'object') return defaultChatBucket();
  const source = value as Partial<ReaderChatBucket>;
  const messages = Array.isArray(source.messages)
    ? source.messages.map((item) => normalizeChatBubble(item)).filter((item): item is ChatBubble => Boolean(item))
    : [];
  return {
    updatedAt: Number.isFinite(Number(source.updatedAt)) ? Number(source.updatedAt) : Date.now(),
    messages,
    personaName: typeof source.personaName === 'string' ? source.personaName.trim() : '',
    characterName: typeof source.characterName === 'string' ? source.characterName.trim() : '',
    chatHistorySummary: typeof source.chatHistorySummary === 'string' ? source.chatHistorySummary : '',
    readingPrefixSummaryByBookId: normalizeReadingPrefixSummaryByBookId(source.readingPrefixSummaryByBookId),
    readingAiUnderlinesByBookId: normalizeReadingAiUnderlinesByBookId(source.readingAiUnderlinesByBookId),
    chatSummaryCards: normalizeSummaryCards(source.chatSummaryCards),
    chatAutoSummaryLastEnd: Number.isFinite(Number(source.chatAutoSummaryLastEnd))
      ? Math.max(0, Math.floor(Number(source.chatAutoSummaryLastEnd)))
      : 0,
  };
};

const normalizeChatStore = (value: unknown): ReaderChatStore => {
  if (!value || typeof value !== 'object') return {};
  const normalized: ReaderChatStore = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, bucket]) => {
    if (!key || !bucket || typeof bucket !== 'object') return;
    normalized[key] = normalizeChatBucket(bucket);
  });
  return normalized;
};

const cloneChatStore = (store: ReaderChatStore): ReaderChatStore => {
  const cloned: ReaderChatStore = {};
  Object.entries(store || {}).forEach(([key, bucket]) => {
    if (!key || !bucket || typeof bucket !== 'object') return;
    cloned[key] = normalizeChatBucket(bucket);
  });
  return cloned;
};

const readLegacyChatStoreFromLocalStorage = (): ReaderChatStore => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(CHAT_HISTORY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const normalized = normalizeChatStore(parsed);
    const deduped = dedupeConversationStore(normalized);
    return deduped.store;
  } catch {
    return {};
  }
};

const queuePersistChatStore = (store: ReaderChatStore) => {
  const snapshot = cloneChatStore(store);
  chatStorePersistQueue = chatStorePersistQueue
    .catch(() => undefined)
    .then(() => saveStoredChatHistoryStore(snapshot as Record<string, unknown>))
    .catch((error) => {
      console.error('Failed to persist chat store into IndexedDB', error);
    });
};

export const hydrateReaderChatStore = async () => {
  if (chatStoreHydrated) return;
  if (chatStoreHydrationPromise) {
    await chatStoreHydrationPromise;
    return;
  }

  chatStoreHydrationPromise = (async () => {
    let loaded = {} as ReaderChatStore;
    let hasLegacyMigration = false;
    try {
      const stored = await getStoredChatHistoryStore();
      loaded = normalizeChatStore(stored);
    } catch (error) {
      console.error('Failed to read chat store from IndexedDB', error);
    }

    const legacy = readLegacyChatStoreFromLocalStorage();
    if (Object.keys(loaded).length === 0 && Object.keys(legacy).length > 0) {
      loaded = legacy;
      hasLegacyMigration = true;
    }

    if (pendingStoreBeforeHydration) {
      loaded = {
        ...loaded,
        ...pendingStoreBeforeHydration,
      };
    }

    const deduped = dedupeConversationStore(loaded);
    chatStoreCache = deduped.store;
    chatStoreHydrated = true;
    const shouldPersist = deduped.changed || hasLegacyMigration || Boolean(pendingStoreBeforeHydration);
    pendingStoreBeforeHydration = null;

    if (hasLegacyMigration && typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(CHAT_HISTORY_STORAGE_KEY);
      } catch {
        // ignore
      }
    }

    if (shouldPersist) {
      await saveStoredChatHistoryStore(chatStoreCache as Record<string, unknown>).catch((error) => {
        console.error('Failed to save hydrated chat store', error);
      });
    }
  })()
    .catch((error) => {
      console.error('Failed to hydrate chat store', error);
      chatStoreCache = cloneChatStore(readLegacyChatStoreFromLocalStorage());
      chatStoreHydrated = true;
      pendingStoreBeforeHydration = null;
    })
    .finally(() => {
      chatStoreHydrationPromise = null;
    });

  await chatStoreHydrationPromise;
};

const emitChatStoreUpdated = (detail: ChatStoreUpdatedEventDetail) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ChatStoreUpdatedEventDetail>(CHAT_STORE_UPDATED_EVENT, { detail }));
};

const emitGenerationStatus = (detail: GenerationStatusEventDetail) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<GenerationStatusEventDetail>(GENERATION_STATUS_EVENT, { detail }));
};

export const readChatStore = (): ReaderChatStore => {
  if (!chatStoreHydrated) {
    if (pendingStoreBeforeHydration) {
      return cloneChatStore(pendingStoreBeforeHydration);
    }
    const legacyStore = readLegacyChatStoreFromLocalStorage();
    if (Object.keys(legacyStore).length > 0) return cloneChatStore(legacyStore);
  }
  return cloneChatStore(chatStoreCache);
};

export const saveChatStore = (store: ReaderChatStore, preferredConversationKey?: string) => {
  const deduped = dedupeConversationStore(normalizeChatStore(store), preferredConversationKey);
  const nextStore = cloneChatStore(deduped.store);
  chatStoreCache = nextStore;
  if (!chatStoreHydrated) {
    pendingStoreBeforeHydration = nextStore;
    return;
  }
  queuePersistChatStore(nextStore);
};

export const readConversationBucket = (conversationKey: string): ReaderChatBucket => {
  if (!conversationKey) return defaultChatBucket();
  const store = readChatStore();
  return store[conversationKey] || defaultChatBucket();
};

export const ensureConversationBucket = (conversationKey: string, legacyConversationKey?: string) => {
  const store = readChatStore();
  const legacyBucket =
    legacyConversationKey && legacyConversationKey !== conversationKey ? store[legacyConversationKey] : undefined;
  const nextBucket = store[conversationKey] || legacyBucket || defaultChatBucket();
  let changed = false;

  if (!store[conversationKey]) {
    store[conversationKey] = nextBucket;
    changed = true;
  }
  if (legacyConversationKey && legacyConversationKey !== conversationKey && legacyBucket) {
    delete store[legacyConversationKey];
    changed = true;
  }

  if (changed) {
    const deduped = dedupeConversationStore(store, conversationKey);
    const resolvedBucket = deduped.store[conversationKey] || nextBucket;
    saveChatStore(deduped.store, conversationKey);
    emitChatStoreUpdated({
      conversationKey,
      bucket: resolvedBucket,
      reason: legacyBucket ? 'migrate-legacy-key' : 'init-bucket',
    });
    return resolvedBucket;
  }

  return nextBucket;
};

type ConversationBucketUpdater =
  | Partial<ReaderChatBucket>
  | ((existing: ReaderChatBucket) => ReaderChatBucket);

export const persistConversationBucket = (
  conversationKey: string,
  updater: ConversationBucketUpdater,
  reason?: string
) => {
  if (!conversationKey) return defaultChatBucket();
  const store = readChatStore();
  const existing = store[conversationKey] || defaultChatBucket();
  const candidate =
    typeof updater === 'function'
      ? updater(existing)
      : {
          ...existing,
          ...updater,
        };
  const nextBucket = normalizeChatBucket({
    ...candidate,
    updatedAt: Date.now(),
  });
  store[conversationKey] = nextBucket;
  const deduped = dedupeConversationStore(store, conversationKey);
  const finalBucket = deduped.store[conversationKey] || nextBucket;
  saveChatStore(deduped.store, conversationKey);
  emitChatStoreUpdated({
    conversationKey,
    bucket: finalBucket,
    reason,
  });
  return finalBucket;
};

export const persistConversationMessages = (conversationKey: string, messages: ChatBubble[], reason?: string) =>
  persistConversationBucket(
    conversationKey,
    (existing) => ({
      ...existing,
      messages,
    }),
    reason
  );

export const getConversationGenerationStatus = (conversationKey: string) => {
  const current = generationRegistry.get(conversationKey);
  if (!current) {
    return {
      isLoading: false,
      mode: null as GenerationMode | null,
      requestId: null as string | null,
    };
  }
  return {
    isLoading: true,
    mode: current.mode,
    requestId: current.requestId,
  };
};

export const beginConversationGeneration = (conversationKey: string, mode: GenerationMode) => {
  if (!conversationKey) {
    return {
      status: 'blocked' as const,
      blockedByMode: null as GenerationMode | null,
      reason: 'missing-conversation-key',
    };
  }

  const existing = generationRegistry.get(conversationKey);
  if (existing) {
    if (mode === 'manual' && existing.mode === 'proactive') {
      existing.controller.abort('manual-priority');
      generationRegistry.delete(conversationKey);
      emitGenerationStatus({
        conversationKey,
        isLoading: false,
        mode: null,
        requestId: null,
        previousMode: 'proactive',
        reason: 'aborted-by-manual',
      });
    } else if (existing.mode === mode) {
      return {
        status: 'duplicate' as const,
        blockedByMode: existing.mode,
      };
    } else {
      return {
        status: 'blocked' as const,
        blockedByMode: existing.mode,
      };
    }
  }

  const requestId = `${mode}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const controller = new AbortController();
  generationRegistry.set(conversationKey, {
    mode,
    requestId,
    controller,
  });
  emitGenerationStatus({
    conversationKey,
    isLoading: true,
    mode,
    requestId,
  });
  return {
    status: 'started' as const,
    requestId,
    controller,
  };
};

export const finishConversationGeneration = (
  conversationKey: string,
  requestId: string,
  reason?: string
) => {
  const existing = generationRegistry.get(conversationKey);
  if (!existing) return;
  if (existing.requestId !== requestId) return;
  generationRegistry.delete(conversationKey);
  emitGenerationStatus({
    conversationKey,
    isLoading: false,
    mode: null,
    requestId: null,
    previousMode: existing.mode,
    reason,
  });
};

export const abortConversationGeneration = (
  conversationKey: string,
  reason = 'aborted'
) => {
  const existing = generationRegistry.get(conversationKey);
  if (!existing) return;
  existing.controller.abort(reason);
  generationRegistry.delete(conversationKey);
  emitGenerationStatus({
    conversationKey,
    isLoading: false,
    mode: null,
    requestId: null,
    previousMode: existing.mode,
    reason,
  });
};

export const deleteConversationBucket = (conversationKey: string, reason = 'delete-bucket') => {
  if (!conversationKey) return false;
  const store = readChatStore();
  if (!store[conversationKey]) return false;
  delete store[conversationKey];
  saveChatStore(store);
  abortConversationGeneration(conversationKey, reason);
  emitChatStoreUpdated({
    conversationKey,
    bucket: defaultChatBucket(),
    reason,
  });
  return true;
};

export const onChatStoreUpdated = (listener: (detail: ChatStoreUpdatedEventDetail) => void) => {
  if (typeof window === 'undefined') return () => undefined;
  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<ChatStoreUpdatedEventDetail>;
    if (!customEvent.detail) return;
    listener(customEvent.detail);
  };
  window.addEventListener(CHAT_STORE_UPDATED_EVENT, handler);
  return () => window.removeEventListener(CHAT_STORE_UPDATED_EVENT, handler);
};

export const onGenerationStatusChanged = (listener: (detail: GenerationStatusEventDetail) => void) => {
  if (typeof window === 'undefined') return () => undefined;
  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<GenerationStatusEventDetail>;
    if (!customEvent.detail) return;
    listener(customEvent.detail);
  };
  window.addEventListener(GENERATION_STATUS_EVENT, handler);
  return () => window.removeEventListener(GENERATION_STATUS_EVENT, handler);
};
