import { Chapter, ReaderPositionState, ApiConfig } from '../types';
import { sanitizeTextForAiPrompt } from './readerAiEngine';

// ─── 类型定义 ───

export interface TextChunk {
  id: string;
  bookId: string;
  chapterIndex: number;
  startOffset: number;
  endOffset: number;
  text: string;
}

interface StoredEmbedding {
  chunkId: string;
  bookId: string;
  chapterIndex: number;
  startOffset: number;
  endOffset: number;
  text: string;
  embedding: number[];
}

interface RagBookMeta {
  bookId: string;
  chunkCount: number;
  indexedUpTo: number;
  updatedAt: number;
  contentSignature?: string;
  ragModelPresetId?: string;
}

interface RetrieveRelevantChunksOptions {
  topK?: number;
  perBookTopK?: number;
}

export interface RagModelDebugEvent {
  time: number;
  type:
    | 'model-load-start'
    | 'host-check-start'
    | 'host-check-success'
    | 'host-check-failed'
    | 'pipeline-load-start'
    | 'pipeline-load-success'
    | 'pipeline-load-failed'
    | 'cache-clear-start'
    | 'cache-clear-success'
    | 'cache-clear-failed'
    | 'host-attempt-failed'
    | 'model-load-success'
    | 'model-load-failed';
  host?: string;
  url?: string;
  detail?: string;
}

export interface RagModelDebugSnapshot {
  modelLoaded: boolean;
  hosts: string[];
  events: RagModelDebugEvent[];
}

export interface RagStorageUsageResult {
  totalBytes: number;
  embeddingsBytes: number;
  metaBytes: number;
}

export interface RagArchiveEmbedding {
  chunkId: string;
  bookId: string;
  chapterIndex: number;
  startOffset: number;
  endOffset: number;
  text: string;
  embedding: number[];
}

export interface RagArchiveMeta {
  bookId: string;
  chunkCount: number;
  indexedUpTo: number;
  updatedAt: number;
  contentSignature?: string;
}

export interface RagArchivePayload {
  embeddings: RagArchiveEmbedding[];
  meta: RagArchiveMeta[];
}

export class RagEmbeddingApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RagEmbeddingApiError';
  }
}

type RagModelDebugListener = (event: RagModelDebugEvent) => void;

// ─── 常量 ───

const CHUNK_SIZE = 512;
const CHUNK_OVERLAP = 64;
const CHUNK_STEP = CHUNK_SIZE - CHUNK_OVERLAP;
const MIN_CHUNK_TEXT_LENGTH = 20;
const TOP_K = 5;
const DEFAULT_PER_BOOK_TOP_K = 2;
const KEYWORD_BOOST_WEIGHT = 0.08;
const MODEL_NAME = 'Xenova/multilingual-e5-small';
const HF_REMOTE_HOST = 'https://huggingface.co/';
const HF_REMOTE_PATH_TEMPLATE = '{model}/resolve/{revision}/';
const HF_REMOTE_REVISION = 'main';
const RAG_MODEL_MIRRORS = ['https://hf-mirror.com/'];
const MODEL_HEALTHCHECK_FILES = ['config.json', 'tokenizer_config.json'];
const TRANSFORMERS_CACHE_NAME = 'transformers-cache';
const RAG_DEBUG_EVENT_LIMIT = 100;
const MODEL_HOST_CHECK_TIMEOUT_MS = 15000;
const MODEL_PIPELINE_LOAD_TIMEOUT_MS = 60000;

const RAG_DB_NAME = 'app_rag_embeddings_v1';
const RAG_DB_VERSION = 1;
const EMBEDDINGS_STORE = 'embeddings';
const META_STORE = 'meta';

const ragModelDebugListeners = new Set<RagModelDebugListener>();
const ragModelDebugEvents: RagModelDebugEvent[] = [];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const isBrowserCacheAvailable = (): boolean => {
  try {
    if (typeof globalThis === 'undefined') return false;
    const cacheApi = (globalThis as { caches?: { open?: unknown } }).caches;
    if (!cacheApi) return false;
    return typeof cacheApi.open === 'function';
  } catch {
    return false;
  }
};

const promiseWithTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> => {
  if (typeof AbortController === 'undefined') {
    return promiseWithTimeout(
      fetch(url, init),
      timeoutMs,
      `[RAG] Fetch timeout (${timeoutMs}ms): ${url}`,
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`[RAG] Fetch timeout (${timeoutMs}ms): ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

const formatRagDebugDetail = (value: unknown): string => {
  const raw = value instanceof Error
    ? `${value.message}${value.stack ? `\n${value.stack}` : ''}`
    : String(value ?? '');
  return raw.replace(/\s+/g, ' ').trim().slice(0, 500);
};

const emitRagModelDebugEvent = (
  event: Omit<RagModelDebugEvent, 'time'> & { time?: number },
): void => {
  const normalized: RagModelDebugEvent = {
    ...event,
    time: typeof event.time === 'number' ? event.time : Date.now(),
    detail: typeof event.detail === 'string' ? event.detail.slice(0, 500) : event.detail,
  };
  ragModelDebugEvents.push(normalized);
  if (ragModelDebugEvents.length > RAG_DEBUG_EVENT_LIMIT) {
    ragModelDebugEvents.splice(0, ragModelDebugEvents.length - RAG_DEBUG_EVENT_LIMIT);
  }
  ragModelDebugListeners.forEach((listener) => {
    try {
      listener(normalized);
    } catch {
      // ignore subscriber errors
    }
  });
};

export const subscribeRagModelDebugEvents = (
  listener: RagModelDebugListener,
): (() => void) => {
  ragModelDebugListeners.add(listener);
  return () => {
    ragModelDebugListeners.delete(listener);
  };
};

export const getRagModelDebugSnapshot = (): RagModelDebugSnapshot => ({
  modelLoaded,
  hosts: getRagModelHosts(),
  events: [...ragModelDebugEvents],
});

const inFlightIndexByBook = new Map<string, Promise<void>>();
const pendingIndexByBook = new Map<string, {
  chapters: Chapter[];
  targetOffset: number;
  onProgress?: (pct: number) => void;
  ragModelPresetId?: string;
  ragApiConfig?: ApiConfig;
}>();

interface PreparedChapter {
  chapterIndex: number;
  rawLength: number;
  text: string;
  startOffset: number;
  endOffset: number;
}

interface PreparedChapterMetrics {
  chapters: PreparedChapter[];
  rawTotalLength: number;
  sanitizedTotalLength: number;
}

const preparedChapterMetricsCache = new WeakMap<Chapter[], PreparedChapterMetrics>();

// ─── IndexedDB ───

let ragDbPromise: Promise<IDBDatabase> | null = null;

const openRagDb = (): Promise<IDBDatabase> => {
  if (ragDbPromise) return ragDbPromise;
  ragDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(RAG_DB_NAME, RAG_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(EMBEDDINGS_STORE)) {
        const store = db.createObjectStore(EMBEDDINGS_STORE, { keyPath: 'chunkId' });
        store.createIndex('byBook', 'bookId', { unique: false });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'bookId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      ragDbPromise = null;
      reject(request.error);
    };
  });
  return ragDbPromise;
};

const storeEmbeddings = async (embeddings: StoredEmbedding[]): Promise<void> => {
  const db = await openRagDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EMBEDDINGS_STORE, 'readwrite');
    const store = tx.objectStore(EMBEDDINGS_STORE);
    for (const emb of embeddings) {
      store.put(emb);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

const getEmbeddingsByBook = async (bookId: string): Promise<StoredEmbedding[]> => {
  const db = await openRagDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EMBEDDINGS_STORE, 'readonly');
    const store = tx.objectStore(EMBEDDINGS_STORE);
    const index = store.index('byBook');
    const request = index.getAll(bookId);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
};

export const deleteEmbeddingsByBook = async (bookId: string): Promise<void> => {
  const db = await openRagDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([EMBEDDINGS_STORE, META_STORE], 'readwrite');
    const store = tx.objectStore(EMBEDDINGS_STORE);
    const index = store.index('byBook');
    const request = index.openCursor(bookId);
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    // 同时删除 meta
    tx.objectStore(META_STORE).delete(bookId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

const saveBookMeta = async (meta: RagBookMeta): Promise<void> => {
  const db = await openRagDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).put(meta);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export const getBookMeta = async (bookId: string): Promise<RagBookMeta | null> => {
  const db = await openRagDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readonly');
    const request = tx.objectStore(META_STORE).get(bookId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
};

const getAllFromStore = async <T>(storeName: string): Promise<T[]> => {
  const db = await openRagDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve((request.result || []) as T[]);
    request.onerror = () => reject(request.error);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
};

const normalizeArchiveEmbedding = (value: unknown): StoredEmbedding | null => {
  if (!isRecord(value)) return null;
  const chunkId = typeof value.chunkId === 'string' ? value.chunkId.trim() : '';
  const bookId = typeof value.bookId === 'string' ? value.bookId.trim() : '';
  const text = typeof value.text === 'string' ? value.text : '';
  const chapterIndex = Number(value.chapterIndex);
  const startOffset = Number(value.startOffset);
  const endOffset = Number(value.endOffset);
  if (!chunkId || !bookId || !text) return null;
  if (!Number.isFinite(chapterIndex) || chapterIndex < 0) return null;
  if (!Number.isFinite(startOffset) || startOffset < 0) return null;
  if (!Number.isFinite(endOffset) || endOffset < startOffset) return null;
  if (!Array.isArray(value.embedding)) return null;

  const embedding = value.embedding.map((item) => Number(item));
  if (embedding.length === 0 || embedding.some((item) => !Number.isFinite(item))) return null;

  return {
    chunkId,
    bookId,
    chapterIndex: Math.floor(chapterIndex),
    startOffset: Math.floor(startOffset),
    endOffset: Math.floor(endOffset),
    text,
    embedding,
  };
};

const normalizeArchiveMeta = (value: unknown): RagBookMeta | null => {
  if (!isRecord(value)) return null;
  const bookId = typeof value.bookId === 'string' ? value.bookId.trim() : '';
  const chunkCount = Number(value.chunkCount);
  const indexedUpTo = Number(value.indexedUpTo);
  const updatedAt = Number(value.updatedAt);
  if (!bookId) return null;
  if (!Number.isFinite(chunkCount) || chunkCount < 0) return null;
  if (!Number.isFinite(indexedUpTo) || indexedUpTo < 0) return null;
  if (!Number.isFinite(updatedAt) || updatedAt < 0) return null;

  return {
    bookId,
    chunkCount: Math.floor(chunkCount),
    indexedUpTo: Math.floor(indexedUpTo),
    updatedAt: Math.floor(updatedAt),
    contentSignature: typeof value.contentSignature === 'string' && value.contentSignature.trim()
      ? value.contentSignature
      : undefined,
    ragModelPresetId: typeof value.ragModelPresetId === 'string' && value.ragModelPresetId.trim()
      ? value.ragModelPresetId
      : undefined,
  };
};

const replaceAllRagRecords = async (
  embeddings: StoredEmbedding[],
  metaEntries: RagBookMeta[],
): Promise<void> => {
  const db = await openRagDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([EMBEDDINGS_STORE, META_STORE], 'readwrite');
    const embeddingStore = tx.objectStore(EMBEDDINGS_STORE);
    const metaStore = tx.objectStore(META_STORE);
    embeddingStore.clear();
    metaStore.clear();

    embeddings.forEach((entry) => {
      embeddingStore.put(entry);
    });
    metaEntries.forEach((entry) => {
      metaStore.put(entry);
    });

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
};

export const exportRagIndexForArchive = async (): Promise<RagArchivePayload> => {
  const [rawEmbeddings, rawMeta] = await Promise.all([
    getAllFromStore<StoredEmbedding>(EMBEDDINGS_STORE),
    getAllFromStore<RagBookMeta>(META_STORE),
  ]);

  const embeddings = rawEmbeddings
    .map((entry) => normalizeArchiveEmbedding(entry))
    .filter((entry): entry is StoredEmbedding => Boolean(entry))
    .map((entry) => ({
      chunkId: entry.chunkId,
      bookId: entry.bookId,
      chapterIndex: entry.chapterIndex,
      startOffset: entry.startOffset,
      endOffset: entry.endOffset,
      text: entry.text,
      embedding: [...entry.embedding],
    }));

  const meta = rawMeta
    .map((entry) => normalizeArchiveMeta(entry))
    .filter((entry): entry is RagBookMeta => Boolean(entry))
    .map((entry) => ({
      bookId: entry.bookId,
      chunkCount: entry.chunkCount,
      indexedUpTo: entry.indexedUpTo,
      updatedAt: entry.updatedAt,
      ...(entry.contentSignature ? { contentSignature: entry.contentSignature } : {}),
      ...(entry.ragModelPresetId ? { ragModelPresetId: entry.ragModelPresetId } : {}),
    }));

  return { embeddings, meta };
};

export const restoreRagIndexFromArchive = async (raw: unknown): Promise<void> => {
  const source = isRecord(raw) ? raw : {};
  const embeddingsSource = Array.isArray(source.embeddings) ? source.embeddings : [];
  const metaSource = Array.isArray(source.meta) ? source.meta : [];

  const embeddings = embeddingsSource
    .map((entry) => normalizeArchiveEmbedding(entry))
    .filter((entry): entry is StoredEmbedding => Boolean(entry));
  const metaEntries = metaSource
    .map((entry) => normalizeArchiveMeta(entry))
    .filter((entry): entry is RagBookMeta => Boolean(entry));

  pendingIndexByBook.clear();
  await replaceAllRagRecords(embeddings, metaEntries);
};

const getStoreUsageBytes = async (storeName: string): Promise<number> => {
  const db = await openRagDb();
  const encoder = new TextEncoder();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.openCursor();
    let total = 0;

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(total);
        return;
      }
      try {
        total += encoder.encode(JSON.stringify(cursor.value)).length;
      } catch {
        // Skip malformed records and keep scanning.
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
};

export const getRagStorageUsageBytes = async (): Promise<RagStorageUsageResult> => {
  try {
    const [embeddingsBytes, metaBytes] = await Promise.all([
      getStoreUsageBytes(EMBEDDINGS_STORE),
      getStoreUsageBytes(META_STORE),
    ]);
    return {
      totalBytes: Math.max(0, embeddingsBytes + metaBytes),
      embeddingsBytes: Math.max(0, embeddingsBytes),
      metaBytes: Math.max(0, metaBytes),
    };
  } catch {
    return {
      totalBytes: 0,
      embeddingsBytes: 0,
      metaBytes: 0,
    };
  }
};

const clampOffset = (value: number, fallback: number = 0): number => {
  if (!Number.isFinite(value)) return Math.max(0, Math.floor(fallback));
  return Math.max(0, Math.floor(value));
};

const clampOffsetWithin = (value: number, max: number, fallback: number = 0): number =>
  Math.min(Math.max(0, Math.floor(max)), clampOffset(value, fallback));

const yieldToMainThread = async (): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

const getPreparedChapterMetrics = (chapters: Chapter[]): PreparedChapterMetrics => {
  const cached = preparedChapterMetricsCache.get(chapters);
  if (cached) return cached;

  const preparedChapters: PreparedChapter[] = [];
  let rawCursor = 0;
  let sanitizedCursor = 0;

  for (let i = 0; i < chapters.length; i++) {
    const rawText = chapters[i]?.content || '';
    const sanitizedText = sanitizeTextForAiPrompt(rawText);
    const rawLength = rawText.length;
    const sanitizedLength = sanitizedText.length;

    preparedChapters.push({
      chapterIndex: i,
      rawLength,
      text: sanitizedText,
      startOffset: sanitizedCursor,
      endOffset: sanitizedCursor + sanitizedLength,
    });

    rawCursor += rawLength;
    sanitizedCursor += sanitizedLength;
  }

  const metrics: PreparedChapterMetrics = {
    chapters: preparedChapters,
    rawTotalLength: rawCursor,
    sanitizedTotalLength: sanitizedCursor,
  };
  preparedChapterMetricsCache.set(chapters, metrics);
  return metrics;
};

export const estimateRagSafeOffset = (
  chapters: Chapter[] | null | undefined,
  readingPosition: ReaderPositionState | null | undefined,
  fallbackOffset: number = 0,
): number => {
  const safeFallback = clampOffset(fallbackOffset, 0);
  if (!Array.isArray(chapters) || chapters.length === 0) return safeFallback;

  const metrics = getPreparedChapterMetrics(chapters);
  const totalSanitized = Math.max(0, metrics.sanitizedTotalLength);
  if (totalSanitized <= 0) return 0;

  if (!readingPosition) {
    return clampOffsetWithin(safeFallback, totalSanitized, safeFallback);
  }

  const chapterIndex = readingPosition.chapterIndex;
  if (
    typeof chapterIndex === 'number' &&
    Number.isFinite(chapterIndex) &&
    chapterIndex >= 0 &&
    chapterIndex < metrics.chapters.length
  ) {
    const chapter = metrics.chapters[chapterIndex];
    const safeRawInChapter = clampOffset(readingPosition.chapterCharOffset, 0);
    const chapterRawLength = Math.max(0, chapter.rawLength);
    const ratio = chapterRawLength > 0 ? Math.min(1, safeRawInChapter / chapterRawLength) : 0;
    const projectedInChapter = Math.round(ratio * chapter.text.length);
    return clampOffsetWithin(chapter.startOffset + projectedInChapter, totalSanitized, safeFallback);
  }

  const safeRawGlobal = clampOffset(readingPosition.globalCharOffset, 0);
  if (metrics.rawTotalLength > 0) {
    const ratio = Math.min(1, safeRawGlobal / metrics.rawTotalLength);
    return clampOffsetWithin(Math.round(ratio * totalSanitized), totalSanitized, safeFallback);
  }

  return clampOffsetWithin(safeFallback, totalSanitized, safeFallback);
};

const createChaptersSignature = (chapters: Chapter[]): string => {
  // FNV-1a 32-bit hash，快速识别书籍内容是否变化（用于决定是否重建索引）
  let hash = 0x811c9dc5;
  const feed = (input: string) => {
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  };

  const metrics = getPreparedChapterMetrics(chapters);
  feed(String(metrics.chapters.length));
  for (let i = 0; i < metrics.chapters.length; i++) {
    const title = chapters[i]?.title || '';
    const text = metrics.chapters[i].text;
    const previewHead = text.slice(0, 80);
    const previewTail = text.slice(-80);
    feed(`${i}|${title}|${text.length}|${previewHead}|${previewTail}`);
  }
  return (hash >>> 0).toString(16);
};

const extractQueryTerms = (query: string): string[] => {
  const normalized = sanitizeTextForAiPrompt(query || '').toLowerCase();
  if (!normalized) return [];

  const matchedTerms = normalized.match(/[\p{Script=Han}]{2,}|[a-z0-9]{2,}/giu) || [];
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const rawTerm of matchedTerms) {
    const term = rawTerm.trim();
    if (!term || term.length < 2 || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
    if (terms.length >= 12) break;
  }
  return terms;
};

const computeKeywordBoost = (text: string, queryTerms: string[]): number => {
  if (queryTerms.length === 0 || !text) return 0;
  const haystack = text.toLowerCase();
  let boost = 0;
  for (const term of queryTerms) {
    if (!haystack.includes(term)) continue;
    const lenWeight = term.length >= 6 ? 1.2 : term.length >= 4 ? 1.0 : 0.7;
    boost += lenWeight;
  }
  return boost;
};

// ─── 文本分块 ───

export const chunkBookText = (
  bookId: string,
  chapters: Chapter[],
  maxGlobalOffset: number,
): TextChunk[] => {
  const chunks: TextChunk[] = [];
  let globalOffset = 0;

  for (let ci = 0; ci < chapters.length; ci++) {
    const rawContent = chapters[ci].content || '';
    const chapterText = sanitizeTextForAiPrompt(rawContent);
    const chapterLen = chapterText.length;

    for (let pos = 0; pos < chapterLen; pos += CHUNK_SIZE - CHUNK_OVERLAP) {
      const start = globalOffset + pos;
      if (start >= maxGlobalOffset) break;

      const end = Math.min(globalOffset + pos + CHUNK_SIZE, globalOffset + chapterLen);
      const effectiveEnd = Math.min(end, maxGlobalOffset);
      const text = chapterText.slice(pos, pos + (effectiveEnd - start));
      if (text.length < 20) continue;

      chunks.push({
        id: `${bookId}_ch${ci}_${pos}`,
        bookId,
        chapterIndex: ci,
        startOffset: start,
        endOffset: effectiveEnd,
        text,
      });
    }
    globalOffset += chapterLen;
  }
  return chunks;
};

const chunkBookTextInRange = (
  bookId: string,
  chapters: Chapter[],
  startOffsetExclusive: number,
  maxGlobalOffset: number,
): TextChunk[] => {
  const upperBound = clampOffset(maxGlobalOffset, 0);
  const lowerBound = clampOffset(startOffsetExclusive, 0);
  if (upperBound <= lowerBound) return [];

  const chunks: TextChunk[] = [];
  let globalOffset = 0;

  for (let ci = 0; ci < chapters.length; ci++) {
    const rawContent = chapters[ci].content || '';
    const chapterText = sanitizeTextForAiPrompt(rawContent);
    const chapterLen = chapterText.length;

    for (let pos = 0; pos < chapterLen; pos += CHUNK_SIZE - CHUNK_OVERLAP) {
      const start = globalOffset + pos;
      if (start >= upperBound) break;

      const end = Math.min(globalOffset + pos + CHUNK_SIZE, globalOffset + chapterLen);
      const effectiveEnd = Math.min(end, upperBound);
      if (effectiveEnd <= lowerBound) continue;

      const text = chapterText.slice(pos, pos + (effectiveEnd - start));
      if (text.length < 20) continue;

      chunks.push({
        id: `${bookId}_ch${ci}_${pos}`,
        bookId,
        chapterIndex: ci,
        startOffset: start,
        endOffset: effectiveEnd,
        text,
      });
    }

    globalOffset += chapterLen;
    if (globalOffset >= upperBound) break;
  }

  return chunks;
};

// ─── Embedding 模型（懒加载单例，从 Hugging Face 远程加载） ───

let embedPipelinePromise: Promise<any> | null = null;
let modelLoaded = false;

export const isEmbedModelLoaded = () => modelLoaded;
export const warmupRagModel = async (): Promise<void> => {
  await getEmbedPipeline();
};

const normalizeHost = (host: string): string => host.endsWith('/') ? host : `${host}/`;

const getRagModelHosts = (): string[] => {
  const envMirrorRaw = (import.meta as any)?.env?.VITE_RAG_MIRRORS as string | undefined;
  const envMirrors = typeof envMirrorRaw === 'string'
    ? envMirrorRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  const allHosts = [HF_REMOTE_HOST, ...envMirrors, ...RAG_MODEL_MIRRORS].map(normalizeHost);
  return Array.from(new Set(allHosts));
};

const isHtmlLikePayload = (contentType: string, payloadStart: string): boolean => {
  const ct = contentType.toLowerCase();
  const prefix = payloadStart.trimStart().slice(0, 32).toLowerCase();
  return ct.includes('text/html') || prefix.startsWith('<!doctype html') || prefix.startsWith('<html');
};

const ensureModelHostHealth = async (host: string): Promise<void> => {
  const base = `${normalizeHost(host)}${MODEL_NAME}/resolve/${encodeURIComponent(HF_REMOTE_REVISION)}/`;

  for (const file of MODEL_HEALTHCHECK_FILES) {
    const url = `${base}${file}`;
    emitRagModelDebugEvent({ type: 'host-check-start', host, url, detail: file });
    const resp = await fetchWithTimeout(url, { cache: 'no-store' }, MODEL_HOST_CHECK_TIMEOUT_MS);
    if (!resp.ok) {
      const message = `[RAG] Host check failed (${resp.status}): ${url}`;
      emitRagModelDebugEvent({ type: 'host-check-failed', host, url, detail: message });
      throw new Error(message);
    }

    const contentType = resp.headers.get('content-type') || '';
    const payload = await resp.text();
    if (isHtmlLikePayload(contentType, payload)) {
      const message = `[RAG] Host check returned HTML instead of JSON: ${url}`;
      emitRagModelDebugEvent({ type: 'host-check-failed', host, url, detail: message });
      throw new Error(message);
    }

    try {
      JSON.parse(payload);
    } catch {
      const message = `[RAG] Host check got invalid JSON: ${url}`;
      emitRagModelDebugEvent({ type: 'host-check-failed', host, url, detail: message });
      throw new Error(message);
    }
    emitRagModelDebugEvent({ type: 'host-check-success', host, url, detail: file });
  }
};

const shouldResetTransformersCache = (err: unknown): boolean => {
  const msg = err instanceof Error ? `${err.message}\n${err.stack || ''}` : String(err);
  return msg.includes("Unexpected token '<'") || msg.includes('<!DOCTYPE');
};

const clearTransformersCache = async (): Promise<void> => {
  if (!isBrowserCacheAvailable()) {
    emitRagModelDebugEvent({ type: 'cache-clear-failed', detail: 'Cache API is unavailable in current runtime' });
    return;
  }
  emitRagModelDebugEvent({ type: 'cache-clear-start', detail: TRANSFORMERS_CACHE_NAME });
  try {
    await caches.delete(TRANSFORMERS_CACHE_NAME);
    emitRagModelDebugEvent({ type: 'cache-clear-success', detail: TRANSFORMERS_CACHE_NAME });
  } catch {
    emitRagModelDebugEvent({ type: 'cache-clear-failed', detail: 'Failed to delete transformers-cache' });
    // ignore cache clear failures
  }
};

const getEmbedPipeline = async () => {
  if (!embedPipelinePromise) {
    embedPipelinePromise = (async () => {
      const { pipeline, env } = await import('@xenova/transformers');
      // Vite 预打包会 shim fs 模块，导致库误判为 Node 环境
      // 强制关闭文件系统访问，使用浏览器 fetch 加载
      env.useFS = false;
      env.useFSCache = false;
      env.allowLocalModels = false;
      env.allowRemoteModels = true;
      env.remotePathTemplate = HF_REMOTE_PATH_TEMPLATE;
      // 使用浏览器 Cache API 缓存以加速后续加载
      const browserCacheAvailable = isBrowserCacheAvailable();
      env.useBrowserCache = browserCacheAvailable;

      const hosts = getRagModelHosts();
      emitRagModelDebugEvent({
        type: 'model-load-start',
        detail: `hosts=${hosts.join(', ')} | browserCache=${browserCacheAvailable ? 'on' : 'off'}`,
      });
      let lastError: unknown = null;

      for (const host of hosts) {
        try {
          env.remoteHost = normalizeHost(host);
          await ensureModelHostHealth(host);

          const loadPipe = () => pipeline('feature-extraction', MODEL_NAME, { revision: HF_REMOTE_REVISION });
          emitRagModelDebugEvent({ type: 'pipeline-load-start', host, detail: MODEL_NAME });
          let pipe: any;
          try {
            pipe = await promiseWithTimeout(
              loadPipe(),
              MODEL_PIPELINE_LOAD_TIMEOUT_MS,
              `[RAG] Pipeline load timeout (${MODEL_PIPELINE_LOAD_TIMEOUT_MS}ms) on ${host}`,
            );
          } catch (err) {
            // 典型场景：曾缓存了 HTML 页面（<!DOCTYPE ...>），会导致 JSON.parse 失败。
            // 清理 transformers-cache 后仅在当前 host 重试一次，避免陷入报错循环。
            if (!shouldResetTransformersCache(err)) throw err;
            console.warn(`[RAG] Invalid cache detected on ${host}, clearing transformers-cache and retrying once...`);
            await clearTransformersCache();
            await ensureModelHostHealth(host);
            emitRagModelDebugEvent({
              type: 'pipeline-load-start',
              host,
              detail: `${MODEL_NAME} (retry-after-cache-clear)`,
            });
            pipe = await promiseWithTimeout(
              loadPipe(),
              MODEL_PIPELINE_LOAD_TIMEOUT_MS,
              `[RAG] Pipeline retry timeout (${MODEL_PIPELINE_LOAD_TIMEOUT_MS}ms) on ${host}`,
            );
          }

          emitRagModelDebugEvent({ type: 'pipeline-load-success', host, detail: MODEL_NAME });
          modelLoaded = true;
          emitRagModelDebugEvent({ type: 'model-load-success', host, detail: MODEL_NAME });
          return pipe;
        } catch (err) {
          lastError = err;
          emitRagModelDebugEvent({
            type: 'host-attempt-failed',
            host,
            detail: formatRagDebugDetail(err),
          });
          emitRagModelDebugEvent({
            type: 'pipeline-load-failed',
            host,
            detail: formatRagDebugDetail(err),
          });
          console.warn(`[RAG] Model load failed on host: ${host}`, err);
        }
      }

      const reason = lastError instanceof Error ? lastError.message : String(lastError);
      emitRagModelDebugEvent({
        type: 'model-load-failed',
        detail: `hosts=${hosts.join(', ')} | last=${formatRagDebugDetail(lastError)}`,
      });
      throw new Error(`[RAG] Unable to load embedding model from all hosts (${hosts.join(', ')}). Last error: ${reason}`);
    })().catch((err) => {
      // 加载失败时重置单例，允许下次重试
      embedPipelinePromise = null;
      emitRagModelDebugEvent({
        type: 'model-load-failed',
        detail: formatRagDebugDetail(err),
      });
      throw err;
    });
  }
  return embedPipelinePromise;
};

const embedTexts = async (texts: string[], apiConfig?: ApiConfig): Promise<number[][]> => {
  if (apiConfig) return embedTextsViaApi(texts, apiConfig);
  const pipe = await getEmbedPipeline();
  const results: number[][] = [];
  for (const text of texts) {
    const output = await pipe(`passage: ${text}`, { pooling: 'mean', normalize: true });
    results.push(Array.from(output.data as Float32Array));
  }
  return results;
};

const embedQuery = async (query: string, apiConfig?: ApiConfig): Promise<number[]> => {
  if (apiConfig) return embedQueryViaApi(query, apiConfig);
  const pipe = await getEmbedPipeline();
  const output = await pipe(`query: ${query}`, { pooling: 'mean', normalize: true });
  return Array.from(output.data as Float32Array);
};

// ─── API Embedding ───

const buildEmbeddingEndpoint = (apiConfig: ApiConfig): string => {
  const base = (apiConfig.endpoint || '').trim().replace(/\/+$/, '');
  if (apiConfig.provider === 'GEMINI') {
    const model = (apiConfig.model || '').trim();
    return `${base}/models/${model}:batchEmbedContents?key=${encodeURIComponent(apiConfig.apiKey)}`;
  }
  return `${base}/embeddings`;
};

const buildEmbeddingHeaders = (apiConfig: ApiConfig): Record<string, string> => {
  if (apiConfig.provider === 'GEMINI') return { 'Content-Type': 'application/json' };
  if (apiConfig.provider === 'CLAUDE') {
    return {
      'x-api-key': apiConfig.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    };
  }
  return {
    Authorization: `Bearer ${apiConfig.apiKey}`,
    'Content-Type': 'application/json',
  };
};

const embedTextsViaApi = async (texts: string[], apiConfig: ApiConfig): Promise<number[][]> => {
  const model = (apiConfig.model || '').trim();
  if (!model) throw new RagEmbeddingApiError('RAG模型预设中未指定模型名称');

  const url = buildEmbeddingEndpoint(apiConfig);
  const headers = buildEmbeddingHeaders(apiConfig);

  let body: string;
  if (apiConfig.provider === 'GEMINI') {
    body = JSON.stringify({
      requests: texts.map(t => ({
        model: `models/${model}`,
        content: { parts: [{ text: t }] },
      })),
    });
  } else {
    body = JSON.stringify({ model, input: texts });
  }

  const response = await fetch(url, { method: 'POST', headers, body });

  if (!response.ok) {
    let detail = '';
    try {
      const raw = await response.text();
      const parsed = JSON.parse(raw);
      detail = parsed?.error?.message || parsed?.message || parsed?.detail || raw.slice(0, 200);
    } catch { detail = `HTTP ${response.status}`; }
    throw new RagEmbeddingApiError(
      `Embedding API 调用失败 (${response.status}): ${detail}`
    );
  }

  const data = await response.json();

  if (apiConfig.provider === 'GEMINI') {
    const embeddings = data?.embeddings;
    if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
      throw new RagEmbeddingApiError('Gemini embedding 响应格式异常');
    }
    return embeddings.map((e: any) => {
      if (!Array.isArray(e?.values)) throw new RagEmbeddingApiError('Gemini embedding values 缺失');
      return e.values as number[];
    });
  }

  // OpenAI-compatible response
  const items = data?.data;
  if (!Array.isArray(items) || items.length !== texts.length) {
    throw new RagEmbeddingApiError(
      'Embedding 响应格式异常。请确认所选模型是 embedding 模型（如 text-embedding-3-small），而非文本生成模型。'
    );
  }
  const sorted = [...items].sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0));
  return sorted.map((item: any) => {
    if (!Array.isArray(item.embedding)) {
      throw new RagEmbeddingApiError('Embedding 响应缺少 embedding 数组');
    }
    return item.embedding as number[];
  });
};

const embedQueryViaApi = async (query: string, apiConfig: ApiConfig): Promise<number[]> => {
  const results = await embedTextsViaApi([query], apiConfig);
  return results[0];
};

// ─── 向量相似度 ───

const cosineSimilarity = (a: number[], b: number[]): number => {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // 已归一化，点积即余弦相似度
};

const selectTopEmbeddingsByScore = (
  embeddings: StoredEmbedding[],
  queryEmbedding: number[],
  topK: number,
  queryTerms: string[],
): (StoredEmbedding & { score: number })[] => {
  if (topK <= 0 || embeddings.length === 0) return [];

  const selected: (StoredEmbedding & { score: number })[] = [];
  for (const embedding of embeddings) {
    const semanticScore = cosineSimilarity(queryEmbedding, embedding.embedding);
    const keywordBoost = computeKeywordBoost(embedding.text, queryTerms);
    const score = semanticScore + keywordBoost * KEYWORD_BOOST_WEIGHT;

    if (selected.length < topK) {
      selected.push({ ...embedding, score });
      if (selected.length === topK) {
        selected.sort((a, b) => b.score - a.score);
      }
      continue;
    }

    if (score <= selected[selected.length - 1].score) continue;

    let insertAt = selected.length - 1;
    while (insertAt > 0 && score > selected[insertAt - 1].score) {
      insertAt--;
    }
    selected.splice(insertAt, 0, { ...embedding, score });
    selected.pop();
  }

  if (selected.length < topK) {
    selected.sort((a, b) => b.score - a.score);
  }

  return selected;
};

// ─── 高层 API ───

export const isBookIndexed = async (bookId: string): Promise<boolean> => {
  try {
    const meta = await getBookMeta(bookId);
    return meta !== null && meta.chunkCount > 0;
  } catch {
    return false;
  }
};

export const getBookIndexedUpTo = async (bookId: string): Promise<number> => {
  try {
    const meta = await getBookMeta(bookId);
    return clampOffset(meta?.indexedUpTo ?? 0, 0);
  } catch {
    return 0;
  }
};

export const indexBookForRag = async (
  bookId: string,
  chapters: Chapter[],
  maxGlobalOffset: number,
  onProgress?: (pct: number) => void,
  ragModelPresetId?: string,
  ragApiConfig?: ApiConfig,
): Promise<void> => {
  if (!bookId || !Array.isArray(chapters) || chapters.length === 0) return;

  const requestedTargetOffset = clampOffset(maxGlobalOffset, 0);
  const metrics = getPreparedChapterMetrics(chapters);
  const targetOffset = clampOffsetWithin(requestedTargetOffset, metrics.sanitizedTotalLength, requestedTargetOffset);
  if (targetOffset <= 0) return;

  const contentSignature = createChaptersSignature(chapters);
  let meta = await getBookMeta(bookId);

  // 书籍内容发生变化时，重建该书索引，避免旧向量污染检索结果。
  const shouldRebuild =
    !meta ||
    (meta.chunkCount || 0) <= 0 ||
    meta.contentSignature !== contentSignature;
  if (shouldRebuild) {
    await deleteEmbeddingsByBook(bookId);
    meta = {
      bookId,
      chunkCount: 0,
      indexedUpTo: 0,
      updatedAt: Date.now(),
      contentSignature,
    };
  }

  const indexedUpTo = clampOffset(meta.indexedUpTo || 0, 0);
  if (targetOffset <= indexedUpTo) return;

  // 本地模型每批 8 个（避免阻塞 UI），API 每批最多 2048 个（减少请求次数）
  const batchSize = ragApiConfig ? 2048 : 8;
  const pendingChunks: TextChunk[] = [];
  let latestOffset = indexedUpTo;
  const totalDelta = Math.max(1, targetOffset - indexedUpTo);

  const flushChunkBatch = async () => {
    if (pendingChunks.length === 0) return;

    const vectors = await embedTexts(pendingChunks.map((c) => c.text), ragApiConfig);
    const embeddings: StoredEmbedding[] = pendingChunks.map((chunk, idx) => ({
      chunkId: chunk.id,
      bookId: chunk.bookId,
      chapterIndex: chunk.chapterIndex,
      startOffset: chunk.startOffset,
      endOffset: chunk.endOffset,
      text: chunk.text,
      embedding: vectors[idx],
    }));
    await storeEmbeddings(embeddings);
    pendingChunks.length = 0;
    await yieldToMainThread();
  };

  for (const chapter of metrics.chapters) {
    if (chapter.endOffset <= indexedUpTo) continue;
    if (chapter.startOffset >= targetOffset) break;

    const chapterLen = chapter.text.length;
    for (let pos = 0; pos < chapterLen; pos += CHUNK_STEP) {
      const start = chapter.startOffset + pos;
      if (start >= targetOffset) break;

      const end = Math.min(chapter.startOffset + pos + CHUNK_SIZE, chapter.endOffset);
      const effectiveEnd = Math.min(end, targetOffset);
      if (effectiveEnd <= indexedUpTo) continue;

      const text = chapter.text.slice(pos, pos + (effectiveEnd - start));
      if (text.length < MIN_CHUNK_TEXT_LENGTH) continue;

      pendingChunks.push({
        id: `${bookId}_ch${chapter.chapterIndex}_${pos}`,
        bookId,
        chapterIndex: chapter.chapterIndex,
        startOffset: start,
        endOffset: effectiveEnd,
        text,
      });
      latestOffset = Math.max(latestOffset, effectiveEnd);

      if (pendingChunks.length >= batchSize) {
        await flushChunkBatch();
        onProgress?.(Math.min(1, Math.max(0, (latestOffset - indexedUpTo) / totalDelta)));
      }
    }
  }

  await flushChunkBatch();
  onProgress?.(1);

  const persistedCount = (await getEmbeddingsByBook(bookId)).length;
  await saveBookMeta({
    bookId,
    chunkCount: persistedCount,
    indexedUpTo: Math.max(indexedUpTo, targetOffset),
    updatedAt: Date.now(),
    contentSignature,
    ragModelPresetId,
  });
};

export const ensureBookIndexedUpTo = async (
  bookId: string,
  chapters: Chapter[],
  maxGlobalOffset: number,
  onProgress?: (pct: number) => void,
  ragModelPresetId?: string,
  ragApiConfig?: ApiConfig,
): Promise<void> => {
  const targetOffset = clampOffset(maxGlobalOffset, 0);
  if (!bookId || !Array.isArray(chapters) || chapters.length === 0 || targetOffset <= 0) return;

  const pending = pendingIndexByBook.get(bookId);
  if (!pending || targetOffset > pending.targetOffset) {
    pendingIndexByBook.set(bookId, { chapters, targetOffset, onProgress, ragModelPresetId, ragApiConfig });
  } else if (pending && chapters !== pending.chapters) {
    pendingIndexByBook.set(bookId, { ...pending, chapters, onProgress: onProgress || pending.onProgress, ragModelPresetId: ragModelPresetId || pending.ragModelPresetId, ragApiConfig: ragApiConfig || pending.ragApiConfig });
  }

  const inFlight = inFlightIndexByBook.get(bookId);
  if (inFlight) return inFlight;

  const task = (async () => {
    while (true) {
      const currentPending = pendingIndexByBook.get(bookId);
      if (!currentPending) break;
      pendingIndexByBook.delete(bookId);

      await indexBookForRag(
        bookId,
        currentPending.chapters,
        currentPending.targetOffset,
        currentPending.onProgress,
        currentPending.ragModelPresetId,
        currentPending.ragApiConfig,
      );

      const nextPending = pendingIndexByBook.get(bookId);
      if (!nextPending || nextPending.targetOffset <= currentPending.targetOffset) break;
    }
  })().finally(() => {
    inFlightIndexByBook.delete(bookId);
  });

  inFlightIndexByBook.set(bookId, task);
  return task;
};

export const retrieveRelevantChunks = async (
  query: string,
  offsetByBookId: Record<string, number>,
  options: RetrieveRelevantChunksOptions = {},
  resolveApiConfig?: (presetId: string | undefined) => ApiConfig | undefined,
): Promise<TextChunk[]> => {
  const topK = Math.max(1, Math.floor(options.topK ?? TOP_K));
  const queryTerms = extractQueryTerms(query);

  const entries = Object.entries(offsetByBookId).filter(([bookId]) => Boolean(bookId));
  const hasExplicitPerBookTopK = typeof options.perBookTopK === 'number';
  const perBookTopK = hasExplicitPerBookTopK
    ? Math.max(1, Math.floor(options.perBookTopK || 1))
    : (entries.length <= 1 ? topK : DEFAULT_PER_BOOK_TOP_K);

  // 按 ragModelPresetId 分组，每组共享同一 query embedding
  const presetGroupMap = new Map<string, string[]>(); // presetKey → bookIds
  const bookPresetMap = new Map<string, string | undefined>(); // bookId → presetId
  for (const [bookId] of entries) {
    let presetId: string | undefined;
    try {
      const meta = await getBookMeta(bookId);
      presetId = meta?.ragModelPresetId;
    } catch { /* 无 meta 视为默认 */ }
    bookPresetMap.set(bookId, presetId);
    const key = presetId || '__local__';
    const group = presetGroupMap.get(key) || [];
    group.push(bookId);
    presetGroupMap.set(key, group);
  }

  // 为每组 embed query（不同模型各 embed 一次）
  const queryEmbeddingCache = new Map<string, number[]>();
  for (const [key, groupBookIds] of presetGroupMap) {
    if (groupBookIds.length === 0) continue;
    const presetId = key === '__local__' ? undefined : key;
    const apiConfig = resolveApiConfig?.(presetId);
    const qe = await embedQuery(query, apiConfig);
    queryEmbeddingCache.set(key, qe);
  }

  const rankedByBook = new Map<string, (StoredEmbedding & { score: number })[]>();

  for (const [bookId, rawMaxOffset] of entries) {
    const maxOffset = Number.isFinite(rawMaxOffset) ? clampOffset(rawMaxOffset, 0) : Infinity;
    if (maxOffset <= 0) continue;

    try {
      const presetId = bookPresetMap.get(bookId);
      const key = presetId || '__local__';
      const queryEmbedding = queryEmbeddingCache.get(key);
      if (!queryEmbedding) continue;

      const bookEmbeddings = await getEmbeddingsByBook(bookId);
      const visibleEmbeddings = bookEmbeddings.filter((e) => e.endOffset <= maxOffset);
      if (visibleEmbeddings.length === 0) continue;

      const ranked = selectTopEmbeddingsByScore(visibleEmbeddings, queryEmbedding, perBookTopK, queryTerms);

      if (ranked.length > 0) rankedByBook.set(bookId, ranked);
    } catch {
      // 跳过无法读取的书
    }
  }

  if (rankedByBook.size === 0) return [];

  // 轮询取样：优先保证多本书都有机会进入上下文，减少“总是同一本同一段”。
  const bookOrder = Array.from(rankedByBook.entries())
    .sort((a, b) => (b[1][0]?.score || -Infinity) - (a[1][0]?.score || -Infinity))
    .map(([bookId]) => bookId);

  const selected: (StoredEmbedding & { score: number })[] = [];
  while (selected.length < topK) {
    let pickedAny = false;
    for (const bookId of bookOrder) {
      if (selected.length >= topK) break;
      const queue = rankedByBook.get(bookId);
      if (!queue || queue.length === 0) continue;
      const next = queue.shift();
      if (!next) continue;
      selected.push(next);
      pickedAny = true;
    }
    if (!pickedAny) break;
  }

  return selected.map((s) => ({
    id: s.chunkId,
    bookId: s.bookId,
    chapterIndex: s.chapterIndex,
    startOffset: s.startOffset,
    endOffset: s.endOffset,
    text: s.text,
  }));
};
