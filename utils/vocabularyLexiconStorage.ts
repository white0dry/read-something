import { ApiConfig, VocabularyLexiconEntry } from '../types';
import { callAiModel } from './readerAiEngine';

const DB_NAME = 'app_vocabulary_lexicon_v1';
const DB_VERSION = 1;
const LEXICON_STORE = 'lexicon_entries';

let dbPromise: Promise<IDBDatabase> | null = null;

const sanitizeArrayStrings = (value: unknown, limit = 8): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const next: string[] = [];
  value.forEach((item) => {
    if (next.length >= limit) return;
    const text = typeof item === 'string' ? item.trim() : '';
    if (!text) return;
    const key = text.toLocaleLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    next.push(text);
  });
  return next;
};

export const sanitizeVocabularySurfaceTerm = (raw: string): string =>
  raw
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'“”‘’`~!@#$%^&*()_+\-=[\]{};:,.<>/?|\\]+/, '')
    .replace(/[\s"'“”‘’`~!@#$%^&*()_+\-=[\]{};:,.<>/?|\\]+$/, '')
    .trim()
    .slice(0, 80);

export const normalizeVocabularyTermKey = (raw: string): string =>
  sanitizeVocabularySurfaceTerm(raw).toLocaleLowerCase();

const isProbablyEnglishTerm = (term: string): boolean => /^[a-zA-Z][a-zA-Z\s'/-]*$/.test(term.trim());

const safeNow = () => Date.now();
const LOOKUP_TIMEOUT_MS = 4200;
const AI_LOOKUP_MAX_RETRIES = 5;
const AI_LOOKUP_RETRY_BASE_DELAY_MS = 800;
const API_ISSUE_ALERT_COOLDOWN_MS = 2 * 60 * 1000;
let lastApiIssueAlertAt = 0;

const openDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LEXICON_STORE)) {
        db.createObjectStore(LEXICON_STORE, { keyPath: 'id' });
      }
    };
    request.onblocked = () => {
      dbPromise = null;
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error || new Error('无法打开生词词库数据库'));
    };
  });
  return dbPromise;
};

const normalizeLexiconEntry = (value: unknown): VocabularyLexiconEntry | null => {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<VocabularyLexiconEntry>;
  const normalizedTerm = normalizeVocabularyTermKey(source.normalizedTerm || source.term || '');
  if (!normalizedTerm) return null;
  const term = sanitizeVocabularySurfaceTerm(source.term || normalizedTerm) || normalizedTerm;

  const now = safeNow();
  const dueAtRaw = Number(source.dueAt);
  const createdAtRaw = Number(source.createdAt);
  const updatedAtRaw = Number(source.updatedAt);
  const easeRaw = Number(source.sm2Ease);
  const repetitionsRaw = Number(source.sm2Repetitions);
  const intervalRaw = Number(source.sm2IntervalDays);
  const reviewRaw = Number(source.reviewCount);
  const failRaw = Number(source.failCount);
  const lastReviewedRaw = Number(source.lastReviewedAt);

  const posTags = sanitizeArrayStrings(source.posTags, 6);
  const meanings = sanitizeArrayStrings(source.meanings, 10);
  const examples = sanitizeArrayStrings(source.examples, 6);
  const bookIds = sanitizeArrayStrings(source.bookIds, 50);
  const sourceValue = source.source;
  const resolvedSource: VocabularyLexiconEntry['source'] =
    sourceValue === 'book' || sourceValue === 'api' || sourceValue === 'manual' || sourceValue === 'mixed'
      ? sourceValue
      : 'book';

  return {
    id: normalizedTerm,
    term,
    normalizedTerm,
    phonetic: typeof source.phonetic === 'string' ? source.phonetic.trim().slice(0, 64) : undefined,
    posTags,
    meanings,
    examples,
    source: resolvedSource,
    bookIds,
    createdAt: Number.isFinite(createdAtRaw) && createdAtRaw > 0 ? Math.floor(createdAtRaw) : now,
    updatedAt: Number.isFinite(updatedAtRaw) && updatedAtRaw > 0 ? Math.floor(updatedAtRaw) : now,
    dueAt: Number.isFinite(dueAtRaw) && dueAtRaw > 0 ? Math.floor(dueAtRaw) : now,
    sm2Ease: Number.isFinite(easeRaw) ? Math.max(1.3, Math.min(3.0, easeRaw)) : 2.5,
    sm2Repetitions: Number.isFinite(repetitionsRaw) ? Math.max(0, Math.floor(repetitionsRaw)) : 0,
    sm2IntervalDays: Number.isFinite(intervalRaw) ? Math.max(0, Math.floor(intervalRaw)) : 0,
    reviewCount: Number.isFinite(reviewRaw) ? Math.max(0, Math.floor(reviewRaw)) : 0,
    failCount: Number.isFinite(failRaw) ? Math.max(0, Math.floor(failRaw)) : 0,
    lastReviewedAt: Number.isFinite(lastReviewedRaw) && lastReviewedRaw > 0 ? Math.floor(lastReviewedRaw) : undefined,
  };
};

const mergeLexiconEntry = (
  current: VocabularyLexiconEntry | null,
  patch: Partial<VocabularyLexiconEntry>,
): VocabularyLexiconEntry | null => {
  const normalizedPatch = normalizeLexiconEntry({
    ...(current || {}),
    ...patch,
    term: sanitizeVocabularySurfaceTerm(patch.term || current?.term || ''),
    normalizedTerm: patch.normalizedTerm || current?.normalizedTerm || patch.term || current?.term || '',
    id: patch.normalizedTerm || current?.normalizedTerm || patch.term || current?.term || '',
    updatedAt: safeNow(),
  });
  if (!normalizedPatch) return null;
  if (!current) return normalizedPatch;

  const mergedPosTags = sanitizeArrayStrings([...(current.posTags || []), ...(normalizedPatch.posTags || [])], 6);
  const mergedMeanings = sanitizeArrayStrings([...(current.meanings || []), ...(normalizedPatch.meanings || [])], 10);
  const mergedExamples = sanitizeArrayStrings([...(current.examples || []), ...(normalizedPatch.examples || [])], 6);
  const mergedBookIds = sanitizeArrayStrings([...(current.bookIds || []), ...(normalizedPatch.bookIds || [])], 50);
  const source =
    current.source === normalizedPatch.source
      ? current.source
      : current.source === 'manual' || normalizedPatch.source === 'manual'
        ? 'manual'
        : 'mixed';

  return {
    ...current,
    ...normalizedPatch,
    id: current.id,
    normalizedTerm: current.normalizedTerm,
    term: normalizedPatch.term || current.term,
    phonetic: normalizedPatch.phonetic || current.phonetic,
    posTags: mergedPosTags,
    meanings: mergedMeanings,
    examples: mergedExamples,
    bookIds: mergedBookIds,
    createdAt: current.createdAt,
    source,
    dueAt: Math.min(current.dueAt || safeNow(), normalizedPatch.dueAt || safeNow()),
    sm2Ease: current.sm2Ease,
    sm2Repetitions: current.sm2Repetitions,
    sm2IntervalDays: current.sm2IntervalDays,
    reviewCount: current.reviewCount,
    failCount: current.failCount,
    lastReviewedAt: current.lastReviewedAt,
  };
};

export const getLexiconEntry = async (termOrNormalized: string): Promise<VocabularyLexiconEntry | null> => {
  const key = normalizeVocabularyTermKey(termOrNormalized);
  if (!key) return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LEXICON_STORE, 'readonly');
    const request = tx.objectStore(LEXICON_STORE).get(key);
    request.onsuccess = () => resolve(normalizeLexiconEntry(request.result));
    request.onerror = () => reject(request.error || new Error('读取生词词条失败'));
  });
};

export const saveLexiconEntry = async (entry: VocabularyLexiconEntry): Promise<void> => {
  const normalized = normalizeLexiconEntry(entry);
  if (!normalized) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(LEXICON_STORE, 'readwrite');
    tx.objectStore(LEXICON_STORE).put(normalized);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('保存生词词条失败'));
    tx.onabort = () => reject(tx.error || new Error('保存生词词条失败'));
  });
};

export const upsertLexiconEntry = async (
  patch: Partial<VocabularyLexiconEntry> & { term: string; normalizedTerm?: string },
): Promise<VocabularyLexiconEntry | null> => {
  const normalizedTerm = normalizeVocabularyTermKey(patch.normalizedTerm || patch.term);
  if (!normalizedTerm) return null;
  const current = await getLexiconEntry(normalizedTerm);
  const merged = mergeLexiconEntry(current, {
    ...patch,
    term: sanitizeVocabularySurfaceTerm(patch.term),
    normalizedTerm,
    id: normalizedTerm,
  });
  if (!merged) return null;
  await saveLexiconEntry(merged);
  return merged;
};

export const ensureLexiconEntryFromReaderTerm = async (params: {
  term: string;
  bookId?: string;
  example?: string;
}): Promise<VocabularyLexiconEntry | null> => {
  const term = sanitizeVocabularySurfaceTerm(params.term);
  const normalizedTerm = normalizeVocabularyTermKey(term);
  if (!normalizedTerm) return null;
  const example = typeof params.example === 'string' ? params.example.trim().slice(0, 220) : '';
  return upsertLexiconEntry({
    term,
    normalizedTerm,
    bookIds: params.bookId ? [params.bookId] : [],
    examples: example ? [example] : [],
    source: 'book',
    dueAt: safeNow(),
  });
};

const extractFreeDictionaryData = (raw: unknown): {
  phonetic?: string;
  posTags: string[];
  meanings: string[];
  example?: string;
} => {
  if (!Array.isArray(raw) || raw.length === 0) return { posTags: [], meanings: [] };
  const first = raw[0] as Record<string, unknown>;
  let phonetic = typeof first?.phonetic === 'string' ? first.phonetic : '';
  const phonetics = Array.isArray(first?.phonetics) ? first.phonetics : [];
  if (!phonetic) {
    for (const item of phonetics) {
      if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).text === 'string') {
        phonetic = (item as Record<string, unknown>).text as string;
        break;
      }
    }
  }

  const posTags: string[] = [];
  const meanings: string[] = [];
  let example = '';
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const meaningsList = Array.isArray((entry as Record<string, unknown>).meanings)
      ? (entry as Record<string, unknown>).meanings as unknown[]
      : [];
    for (const meaning of meaningsList) {
      if (!meaning || typeof meaning !== 'object') continue;
      const pos = typeof (meaning as Record<string, unknown>).partOfSpeech === 'string'
        ? ((meaning as Record<string, unknown>).partOfSpeech as string).trim()
        : '';
      if (pos) posTags.push(pos);
      const defs = Array.isArray((meaning as Record<string, unknown>).definitions)
        ? (meaning as Record<string, unknown>).definitions as unknown[]
        : [];
      for (const def of defs) {
        if (!def || typeof def !== 'object') continue;
        const defText = typeof (def as Record<string, unknown>).definition === 'string'
          ? ((def as Record<string, unknown>).definition as string).trim()
          : '';
        if (defText) meanings.push(defText);
        if (!example) {
          const ex = typeof (def as Record<string, unknown>).example === 'string'
            ? ((def as Record<string, unknown>).example as string).trim()
            : '';
          if (ex) example = ex;
        }
      }
    }
  }

  return {
    phonetic: phonetic || undefined,
    posTags: sanitizeArrayStrings(posTags, 6),
    meanings: sanitizeArrayStrings(meanings, 8),
    example: example || undefined,
  };
};

const fetchJsonWithTimeout = async (url: string, timeoutMs = LOOKUP_TIMEOUT_MS): Promise<unknown | null> => {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: 'force-cache',
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  } finally {
    globalThis.clearTimeout(timer);
  }
};

const extractDatamuseData = (raw: unknown, term: string): {
  phonetic?: string;
  posTags: string[];
  meanings: string[];
} => {
  if (!Array.isArray(raw) || raw.length === 0) return { posTags: [], meanings: [] };
  const target = term.trim().toLocaleLowerCase();
  const list = raw.filter((item) => item && typeof item === 'object') as Array<Record<string, unknown>>;
  const exact = list.find((item) => typeof item.word === 'string' && item.word.toLocaleLowerCase() === target);
  const first = exact || list[0];
  if (!first) return { posTags: [], meanings: [] };

  const tags = Array.isArray(first.tags) ? first.tags : [];
  let phonetic = '';
  const posTags: string[] = [];
  tags.forEach((tag) => {
    if (typeof tag !== 'string') return;
    if (tag.startsWith('ipa_pron:')) {
      phonetic = tag.slice('ipa_pron:'.length).trim();
      return;
    }
    if (tag.startsWith('pron:') && !phonetic) {
      phonetic = tag.slice('pron:'.length).trim();
      return;
    }
    if (/^(n|v|adj|adv|u)$/.test(tag)) posTags.push(tag);
  });

  const defs = Array.isArray(first.defs) ? first.defs : [];
  const meanings = defs
    .map((item) => (typeof item === 'string' ? item : ''))
    .map((line) => {
      if (!line) return '';
      const split = line.split('\t');
      return split.length >= 2 ? split.slice(1).join(' ').trim() : line.trim();
    })
    .filter(Boolean);

  return {
    phonetic: phonetic || undefined,
    posTags: sanitizeArrayStrings(posTags, 6),
    meanings: sanitizeArrayStrings(meanings, 8),
  };
};

const hasReadyApiConfig = (apiConfig?: ApiConfig | null): apiConfig is ApiConfig => {
  if (!apiConfig) return false;
  const key = apiConfig.apiKey?.trim();
  const model = apiConfig.model?.trim();
  if (!key || !model) return false;
  if (apiConfig.provider === 'GEMINI') return true;
  return Boolean(apiConfig.endpoint?.trim());
};

const sleep = (ms: number) => new Promise<void>((resolve) => {
  globalThis.setTimeout(resolve, Math.max(0, ms));
});

const shouldRetryAiLookupError = (error: unknown): boolean => {
  if (!error || !(error instanceof Error)) return true;
  const message = (error.message || '').toLocaleLowerCase();
  if (!message) return true;
  if (message.includes('abort')) return false;
  if (message.includes('429')) return true;
  if (message.includes('rate')) return true;
  if (message.includes('timeout')) return true;
  if (message.includes('network')) return true;
  if (message.includes('failed to fetch')) return true;
  return true;
};

const notifyApiIssuePopup = () => {
  if (typeof window === 'undefined' || typeof window.alert !== 'function') return;
  const now = safeNow();
  if (now - lastApiIssueAlertAt < API_ISSUE_ALERT_COOLDOWN_MS) return;
  lastApiIssueAlertAt = now;
  window.alert('生词 AI 接口连续失败（已重试 5 次），请检查 API 配置或稍后再试。');
};

const requestChineseMeaningsByAi = async (term: string, apiConfig: ApiConfig): Promise<string[]> => {
  const prompt = `<task>
请为英文单词 "${term}" 生成简明中文释义，用于生词本复习。
</task>
<requirements>
- 输出 JSON
- 字段 meanings 为数组，2~4 条
- 每条不超过 12 个中文字符
- 不要输出额外文本
</requirements>
<output>
{"meanings":["释义1","释义2"]}
</output>`;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= AI_LOOKUP_MAX_RETRIES; attempt += 1) {
    try {
      const raw = await callAiModel(prompt, apiConfig);
      const cleaned = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      try {
        const parsed = JSON.parse(cleaned) as { meanings?: unknown };
        return sanitizeArrayStrings(parsed.meanings, 6);
      } catch {
        const arrayLike = cleaned.match(/\[[\s\S]*\]/);
        if (!arrayLike) return [];
        try {
          const parsed = JSON.parse(arrayLike[0]) as unknown;
          return sanitizeArrayStrings(parsed, 6);
        } catch {
          return [];
        }
      }
    } catch (error) {
      lastError = error;
      const retryable = shouldRetryAiLookupError(error);
      const shouldRetry = retryable && attempt < AI_LOOKUP_MAX_RETRIES;
      if (!shouldRetry) break;
      const backoffMs = AI_LOOKUP_RETRY_BASE_DELAY_MS * attempt;
      await sleep(backoffMs);
    }
  }
  if (lastError) notifyApiIssuePopup();
  return [];
};

export const enrichLexiconEntry = async (params: {
  term: string;
  normalizedTerm?: string;
  apiConfig?: ApiConfig | null;
  fallbackExample?: string;
  bookId?: string;
}): Promise<VocabularyLexiconEntry | null> => {
  const term = sanitizeVocabularySurfaceTerm(params.term);
  const normalizedTerm = normalizeVocabularyTermKey(params.normalizedTerm || term);
  if (!normalizedTerm) return null;

  let phonetic = '';
  let posTags: string[] = [];
  let meanings: string[] = [];
  let example = params.fallbackExample?.trim().slice(0, 220) || '';
  let usedFreeDictionary = false;
  let usedDatamuse = false;
  let usedAi = false;

  if (isProbablyEnglishTerm(term)) {
    const freeRaw = await fetchJsonWithTimeout(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term)}`,
    );
    if (freeRaw) {
      const parsed = extractFreeDictionaryData(freeRaw);
      phonetic = phonetic || parsed.phonetic || '';
      posTags = sanitizeArrayStrings([...(posTags || []), ...(parsed.posTags || [])], 6);
      meanings = sanitizeArrayStrings([...(meanings || []), ...(parsed.meanings || [])], 10);
      if (!example && parsed.example) example = parsed.example.slice(0, 220);
      if (parsed.meanings.length > 0 || parsed.posTags.length > 0 || parsed.phonetic) {
        usedFreeDictionary = true;
      }
    }

    if (meanings.length === 0 || !phonetic || posTags.length === 0) {
      const datamuseRaw = await fetchJsonWithTimeout(
        `https://api.datamuse.com/words?sp=${encodeURIComponent(term)}&max=5&md=drp`,
      );
      if (datamuseRaw) {
        const parsed = extractDatamuseData(datamuseRaw, term);
        if (parsed.meanings.length > 0 || parsed.posTags.length > 0 || parsed.phonetic) {
          usedDatamuse = true;
        }
        if (!phonetic && parsed.phonetic) phonetic = parsed.phonetic;
        posTags = sanitizeArrayStrings([...(posTags || []), ...(parsed.posTags || [])], 6);
        meanings = sanitizeArrayStrings([...(meanings || []), ...(parsed.meanings || [])], 10);
      }
    }

  }

  // Paid model fallback: only when free dictionaries can't provide meanings.
  if (isProbablyEnglishTerm(term) && meanings.length === 0 && hasReadyApiConfig(params.apiConfig)) {
    try {
      const zhMeanings = await requestChineseMeaningsByAi(term, params.apiConfig);
      if (zhMeanings.length > 0) {
        meanings = sanitizeArrayStrings([...zhMeanings, ...meanings], 10);
        usedAi = true;
      }
    } catch {
      // keep silent fallback
    }
  }

  const usedFreeSource = usedFreeDictionary || usedDatamuse;
  const source: VocabularyLexiconEntry['source'] =
    usedAi && usedFreeSource
      ? 'mixed'
      : usedAi
        ? 'manual'
        : usedFreeSource
          ? 'api'
          : 'book';

  return upsertLexiconEntry({
    term,
    normalizedTerm,
    phonetic: phonetic || undefined,
    posTags,
    meanings,
    examples: example ? [example] : [],
    source,
    bookIds: params.bookId ? [params.bookId] : [],
  });
};

export const getAllLexiconEntries = async (): Promise<VocabularyLexiconEntry[]> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LEXICON_STORE, 'readonly');
    const request = tx.objectStore(LEXICON_STORE).getAll();
    request.onsuccess = () => {
      const list = Array.isArray(request.result) ? request.result : [];
      const normalized = list
        .map((item) => normalizeLexiconEntry(item))
        .filter((item): item is VocabularyLexiconEntry => Boolean(item));
      normalized.sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
      resolve(normalized);
    };
    request.onerror = () => reject(request.error || new Error('读取生词词库失败'));
  });
};

export const deleteLexiconEntry = async (termOrNormalized: string): Promise<void> => {
  const key = normalizeVocabularyTermKey(termOrNormalized);
  if (!key) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(LEXICON_STORE, 'readwrite');
    tx.objectStore(LEXICON_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('删除词条失败'));
    tx.onabort = () => reject(tx.error || new Error('删除词条失败'));
  });
};

const applySm2Success = (entry: VocabularyLexiconEntry, quality: 'easy' | 'good' | 'hard') => {
  const next = { ...entry };
  const now = safeNow();
  let ease = Number(next.sm2Ease || 2.5);
  let repetitions = Number(next.sm2Repetitions || 0) + 1;
  let intervalDays = Number(next.sm2IntervalDays || 0);

  if (quality === 'easy') ease = Math.min(3.0, ease + 0.15);
  if (quality === 'good') ease = Math.min(3.0, ease + 0.05);
  if (quality === 'hard') ease = Math.max(1.3, ease - 0.15);

  if (repetitions === 1) intervalDays = 1;
  else if (repetitions === 2) intervalDays = 6;
  else intervalDays = Math.round(Math.max(1, intervalDays) * ease);
  intervalDays = Math.max(1, Math.min(365, intervalDays));

  next.sm2Ease = ease;
  next.sm2Repetitions = repetitions;
  next.sm2IntervalDays = intervalDays;
  next.reviewCount = Math.max(0, Number(next.reviewCount || 0)) + 1;
  next.lastReviewedAt = now;
  next.dueAt = now + intervalDays * 24 * 60 * 60 * 1000;
  next.updatedAt = now;
  return next;
};

const applySm2Fail = (entry: VocabularyLexiconEntry) => {
  const next = { ...entry };
  const now = safeNow();
  const ease = Math.max(1.3, Number(next.sm2Ease || 2.5) - 0.2);
  next.sm2Ease = ease;
  next.sm2Repetitions = 0;
  next.sm2IntervalDays = 0;
  next.failCount = Math.max(0, Number(next.failCount || 0)) + 1;
  next.lastReviewedAt = now;
  next.dueAt = now + 10 * 60 * 1000;
  next.updatedAt = now;
  return next;
};

export const recordLexiconReviewResult = async (
  termOrNormalized: string,
  result: 'easy' | 'good' | 'hard' | 'fail',
): Promise<VocabularyLexiconEntry | null> => {
  const current = await getLexiconEntry(termOrNormalized);
  if (!current) return null;
  const next = result === 'fail' ? applySm2Fail(current) : applySm2Success(current, result);
  await saveLexiconEntry(next);
  return next;
};

export const getDueLexiconEntries = async (now = safeNow()): Promise<VocabularyLexiconEntry[]> => {
  const list = await getAllLexiconEntries();
  return list.filter((item) => !Number.isFinite(item.dueAt) || item.dueAt <= now);
};

export const getVocabularyLexiconUsageBytes = async (): Promise<number> => {
  const entries = await getAllLexiconEntries();
  const encoder = new TextEncoder();
  return entries.reduce((sum, entry) => {
    try {
      return sum + encoder.encode(JSON.stringify(entry)).length;
    } catch {
      return sum;
    }
  }, 0);
};

export const exportVocabularyLexiconForArchive = async (): Promise<VocabularyLexiconEntry[]> => {
  return getAllLexiconEntries();
};

const clearLexiconStore = async (): Promise<void> => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(LEXICON_STORE, 'readwrite');
    tx.objectStore(LEXICON_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('清空词库失败'));
    tx.onabort = () => reject(tx.error || new Error('清空词库失败'));
  });
};

export const restoreVocabularyLexiconFromArchive = async (raw: unknown): Promise<void> => {
  const source = Array.isArray(raw) ? raw : [];
  const normalized = source
    .map((item) => normalizeLexiconEntry(item))
    .filter((item): item is VocabularyLexiconEntry => Boolean(item));
  await clearLexiconStore();
  for (const item of normalized) {
    await saveLexiconEntry(item);
  }
};

export const mergeVocabularyLexiconFromArchive = async (raw: unknown): Promise<void> => {
  const source = Array.isArray(raw) ? raw : [];
  for (const item of source) {
    const normalized = normalizeLexiconEntry(item);
    if (!normalized) continue;
    await upsertLexiconEntry(normalized);
  }
};
