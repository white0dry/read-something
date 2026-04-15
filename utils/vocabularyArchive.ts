import { ReaderVocabularyEntry } from '../types';
import { getAllBookContents, replaceAllBookContents } from './bookContentStorage';
import {
  exportVocabularyLexiconForArchive,
  mergeVocabularyLexiconFromArchive,
  normalizeVocabularyTermKey,
  sanitizeVocabularySurfaceTerm,
} from './vocabularyLexiconStorage';

const VOCAB_ARCHIVE_SCHEMA = 'ai-reader-vocabulary-archive';
const VOCAB_ARCHIVE_VERSION = 1;
const VOCAB_ARCHIVE_APP_ID = 'ai-reader-companion';

export interface VocabularyArchivePayload {
  meta: {
    schema: string;
    version: number;
    exportedAt: string;
    appId: string;
  };
  readerVocabularyByBook: Record<string, ReaderVocabularyEntry[]>;
  lexicon: unknown[];
}

const createVocabularyEntryId = () => `reader-vocab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const normalizeReaderVocabularyEntry = (value: unknown): ReaderVocabularyEntry | null => {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<ReaderVocabularyEntry>;
  const term = sanitizeVocabularySurfaceTerm(typeof source.term === 'string' ? source.term : '');
  if (!term) return null;
  const normalizedTerm = normalizeVocabularyTermKey(source.normalizedTerm || term);
  if (!normalizedTerm) return null;
  return {
    id: typeof source.id === 'string' && source.id.trim() ? source.id.trim() : createVocabularyEntryId(),
    term,
    normalizedTerm,
  };
};

const normalizeReaderVocabularyList = (value: unknown): ReaderVocabularyEntry[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const next: ReaderVocabularyEntry[] = [];
  value.forEach((item) => {
    const normalized = normalizeReaderVocabularyEntry(item);
    if (!normalized) return;
    if (seen.has(normalized.normalizedTerm)) return;
    seen.add(normalized.normalizedTerm);
    next.push(normalized);
  });
  return next;
};

const normalizeArchivePayload = (raw: unknown): VocabularyArchivePayload => {
  if (!raw || typeof raw !== 'object') throw new Error('词库存档格式无效');
  const source = raw as Partial<VocabularyArchivePayload>;
  const meta = source.meta;
  if (!meta || typeof meta !== 'object') throw new Error('词库存档缺少 meta 字段');
  if (meta.schema !== VOCAB_ARCHIVE_SCHEMA) throw new Error('词库存档 schema 不匹配');
  if (meta.appId !== VOCAB_ARCHIVE_APP_ID) throw new Error('词库存档应用标识不匹配');
  if (!Number.isFinite(Number(meta.version)) || Number(meta.version) < 1) throw new Error('词库存档版本无效');

  const readerVocabularySource = source.readerVocabularyByBook;
  const normalizedByBook: Record<string, ReaderVocabularyEntry[]> = {};
  if (readerVocabularySource && typeof readerVocabularySource === 'object') {
    Object.entries(readerVocabularySource).forEach(([bookId, entries]) => {
      if (!bookId) return;
      const normalized = normalizeReaderVocabularyList(entries);
      if (normalized.length === 0) return;
      normalizedByBook[bookId] = normalized;
    });
  }

  const lexicon = Array.isArray(source.lexicon) ? source.lexicon : [];
  return {
    meta: {
      schema: VOCAB_ARCHIVE_SCHEMA,
      version: Math.floor(Number(meta.version)),
      exportedAt: typeof meta.exportedAt === 'string' ? meta.exportedAt : new Date().toISOString(),
      appId: VOCAB_ARCHIVE_APP_ID,
    },
    readerVocabularyByBook: normalizedByBook,
    lexicon,
  };
};

export const createVocabularyArchivePayload = async (): Promise<VocabularyArchivePayload> => {
  const contents = await getAllBookContents();
  const readerVocabularyByBook: Record<string, ReaderVocabularyEntry[]> = {};
  Object.entries(contents).forEach(([bookId, content]) => {
    const normalized = normalizeReaderVocabularyList(content?.readerState?.vocabularyEntries || []);
    if (normalized.length === 0) return;
    readerVocabularyByBook[bookId] = normalized;
  });

  return {
    meta: {
      schema: VOCAB_ARCHIVE_SCHEMA,
      version: VOCAB_ARCHIVE_VERSION,
      exportedAt: new Date().toISOString(),
      appId: VOCAB_ARCHIVE_APP_ID,
    },
    readerVocabularyByBook,
    lexicon: await exportVocabularyLexiconForArchive(),
  };
};

export const restoreVocabularyArchivePayloadMerge = async (raw: unknown): Promise<VocabularyArchivePayload> => {
  const archive = normalizeArchivePayload(raw);
  const contents = await getAllBookContents();
  const nextContents = { ...contents };

  Object.entries(archive.readerVocabularyByBook).forEach(([bookId, importedEntries]) => {
    const current = nextContents[bookId];
    if (!current) return;
    const currentEntries = normalizeReaderVocabularyList(current?.readerState?.vocabularyEntries || []);
    const mergedMap = new Map<string, ReaderVocabularyEntry>();
    currentEntries.forEach((entry) => mergedMap.set(entry.normalizedTerm, entry));
    importedEntries.forEach((entry) => {
      const existing = mergedMap.get(entry.normalizedTerm);
      if (existing) {
        mergedMap.set(entry.normalizedTerm, { ...existing, term: entry.term || existing.term });
      } else {
        mergedMap.set(entry.normalizedTerm, entry);
      }
    });

    const mergedEntries = Array.from(mergedMap.values());
    nextContents[bookId] = {
      ...current,
      readerState: {
        ...(current.readerState || {}),
        vocabularyEntries: mergedEntries,
      },
    };
  });

  await replaceAllBookContents(nextContents);
  await mergeVocabularyLexiconFromArchive(archive.lexicon);
  return archive;
};
