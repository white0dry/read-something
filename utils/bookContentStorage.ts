import { Book, Chapter, ReaderBookState, ReaderSummaryCard } from '../types';

const BOOK_CONTENT_DB_NAME = 'app_book_content_v1';
const BOOK_CONTENT_STORE = 'book_contents';
const BOOK_CONTENT_DB_VERSION = 1;

export interface StoredBookContent {
  fullText: string;
  chapters: Chapter[];
  readerState?: ReaderBookState;
  bookSummaryCards?: ReaderSummaryCard[];
  bookAutoSummaryLastEnd?: number;
}

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

const normalizeChapterBlocks = (value: unknown): Chapter['blocks'] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const blocks = value.reduce<NonNullable<Chapter['blocks']>>((acc, item) => {
    if (!item || typeof item !== 'object') return acc;
    const source = item as Partial<NonNullable<Chapter['blocks']>[number]>;

    if (source.type === 'text') {
      if (typeof (source as { text?: unknown }).text !== 'string') return acc;
      acc.push({
        type: 'text',
        text: (source as { text: string }).text,
      });
      return acc;
    }

    if (source.type === 'image') {
      const imageRef = typeof (source as { imageRef?: unknown }).imageRef === 'string'
        ? (source as { imageRef: string }).imageRef.trim()
        : '';
      if (!imageRef) return acc;
      const width = Number((source as { width?: unknown }).width);
      const height = Number((source as { height?: unknown }).height);
      acc.push({
        type: 'image',
        imageRef,
        alt: typeof (source as { alt?: unknown }).alt === 'string'
          ? (source as { alt: string }).alt
          : undefined,
        title: typeof (source as { title?: unknown }).title === 'string'
          ? (source as { title: string }).title
          : undefined,
        width: Number.isFinite(width) && width > 0 ? Math.round(width) : undefined,
        height: Number.isFinite(height) && height > 0 ? Math.round(height) : undefined,
      });
    }

    return acc;
  }, []);

  return blocks.length > 0 ? blocks : undefined;
};

const normalizeChapter = (value: unknown): Chapter | null => {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<Chapter>;
  const title = typeof source.title === 'string' ? source.title.trim() : '';
  const content = typeof source.content === 'string' ? source.content : '';
  if (!title && !content) return null;
  const blocks = normalizeChapterBlocks((source as { blocks?: unknown }).blocks);
  return {
    title: title || 'Untitled Chapter',
    content,
    ...(blocks ? { blocks } : {}),
  };
};

const normalizeStoredBookContent = (value: unknown): StoredBookContent | null => {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<StoredBookContent>;
  const fullText = typeof source.fullText === 'string' ? source.fullText : '';
  const chapters = Array.isArray(source.chapters)
    ? source.chapters
        .map((item) => normalizeChapter(item))
        .filter((item): item is Chapter => Boolean(item))
    : [];
  const bookSummaryCards = Array.isArray(source.bookSummaryCards)
    ? source.bookSummaryCards
        .map((item) => normalizeSummaryCard(item))
        .filter((item): item is ReaderSummaryCard => Boolean(item))
    : [];
  const bookAutoSummaryLastEnd = Number.isFinite(Number(source.bookAutoSummaryLastEnd))
    ? Math.max(0, Math.floor(Number(source.bookAutoSummaryLastEnd)))
    : 0;
  return {
    fullText,
    chapters,
    readerState: source.readerState,
    bookSummaryCards,
    bookAutoSummaryLastEnd,
  };
};

let dbPromise: Promise<IDBDatabase> | null = null;

const openBookContentDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(BOOK_CONTENT_DB_NAME, BOOK_CONTENT_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BOOK_CONTENT_STORE)) {
        db.createObjectStore(BOOK_CONTENT_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open book content IndexedDB'));
  });

  return dbPromise;
};

export const saveBookContent = async (bookId: string, fullText: string, chapters: Chapter[]): Promise<void> => {
  const db = await openBookContentDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BOOK_CONTENT_STORE, 'readwrite');
    const store = tx.objectStore(BOOK_CONTENT_STORE);

    const getRequest = store.get(bookId);
    getRequest.onsuccess = () => {
      const existing = normalizeStoredBookContent(getRequest.result);
      const payload: StoredBookContent = {
        fullText,
        chapters,
        readerState: existing?.readerState,
        bookSummaryCards: existing?.bookSummaryCards || [],
        bookAutoSummaryLastEnd: existing?.bookAutoSummaryLastEnd || 0,
      };
      store.put(payload, bookId);
    };
    getRequest.onerror = () => reject(getRequest.error || new Error('Failed to read existing book content'));

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to save book content'));
    tx.onabort = () => reject(tx.error || new Error('Failed to save book content'));
  });
};

export const saveBookReaderState = async (bookId: string, readerState: ReaderBookState): Promise<void> => {
  const db = await openBookContentDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BOOK_CONTENT_STORE, 'readwrite');
    const store = tx.objectStore(BOOK_CONTENT_STORE);

    const getRequest = store.get(bookId);
    getRequest.onsuccess = () => {
      const existing = normalizeStoredBookContent(getRequest.result) || { fullText: '', chapters: [] };
      const payload: StoredBookContent = {
        fullText: existing.fullText || '',
        chapters: existing.chapters || [],
        readerState,
        bookSummaryCards: existing.bookSummaryCards || [],
        bookAutoSummaryLastEnd: existing.bookAutoSummaryLastEnd || 0,
      };
      store.put(payload, bookId);
    };
    getRequest.onerror = () => reject(getRequest.error || new Error('Failed to read existing reader state'));

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to save reader state'));
    tx.onabort = () => reject(tx.error || new Error('Failed to save reader state'));
  });
};

export const saveBookSummaryState = async (
  bookId: string,
  summary: {
    bookSummaryCards?: ReaderSummaryCard[];
    bookAutoSummaryLastEnd?: number;
  }
): Promise<void> => {
  const db = await openBookContentDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BOOK_CONTENT_STORE, 'readwrite');
    const store = tx.objectStore(BOOK_CONTENT_STORE);

    const getRequest = store.get(bookId);
    getRequest.onsuccess = () => {
      const existing = normalizeStoredBookContent(getRequest.result) || { fullText: '', chapters: [] };
      const payload: StoredBookContent = {
        fullText: existing.fullText || '',
        chapters: existing.chapters || [],
        readerState: existing.readerState,
        bookSummaryCards: summary.bookSummaryCards || existing.bookSummaryCards || [],
        bookAutoSummaryLastEnd:
          typeof summary.bookAutoSummaryLastEnd === 'number'
            ? Math.max(0, Math.floor(summary.bookAutoSummaryLastEnd))
            : existing.bookAutoSummaryLastEnd || 0,
      };
      store.put(payload, bookId);
    };
    getRequest.onerror = () => reject(getRequest.error || new Error('Failed to read existing summary state'));

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to save summary state'));
    tx.onabort = () => reject(tx.error || new Error('Failed to save summary state'));
  });
};

export const getBookContent = async (bookId: string): Promise<StoredBookContent | null> => {
  const db = await openBookContentDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(BOOK_CONTENT_STORE, 'readonly');
    const store = tx.objectStore(BOOK_CONTENT_STORE);
    const request = store.get(bookId);

    request.onsuccess = () => {
      const result = normalizeStoredBookContent(request.result);
      resolve(result || null);
    };
    request.onerror = () => reject(request.error || new Error('Failed to read book content'));
  });
};

export const deleteBookContent = async (bookId: string): Promise<void> => {
  const db = await openBookContentDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BOOK_CONTENT_STORE, 'readwrite');
    const store = tx.objectStore(BOOK_CONTENT_STORE);
    store.delete(bookId);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to delete book content'));
    tx.onabort = () => reject(tx.error || new Error('Failed to delete book content'));
  });
};

export const getBookTextLength = (book: Partial<Book>): number => {
  if (typeof book.fullTextLength === 'number') return book.fullTextLength;
  if (typeof book.fullText === 'string') return book.fullText.length;
  return 0;
};

const compactBook = (book: Book, fullTextLength: number, chapterCount: number): Book => {
  return {
    ...book,
    fullText: '',
    chapters: [],
    fullTextLength,
    chapterCount,
  };
};

export const migrateInlineBookContent = async (books: Book[]): Promise<Book[]> => {
  let changed = false;

  const migrated = await Promise.all(
    books.map(async (book) => {
      const hasInlineText = typeof book.fullText === 'string' && book.fullText.length > 0;
      const hasInlineChapters = Array.isArray(book.chapters) && book.chapters.length > 0;

      if (!hasInlineText && !hasInlineChapters) {
        const estimatedLength =
          typeof book.fullText === 'string' ? book.fullText.length : (book.fullTextLength || 0);
        const estimatedChapters =
          Array.isArray(book.chapters) ? book.chapters.length : (book.chapterCount || 0);

        if (estimatedLength > 0 || estimatedChapters > 0) {
          return compactBook(book, estimatedLength, estimatedChapters);
        }

        // Backfill old compacted records (length/count were 0) from IndexedDB payload if it exists.
        const stored = await getBookContent(book.id).catch(() => null);
        if (stored) {
          const backfilledLength = stored.fullText?.length || 0;
          const backfilledChapters = stored.chapters?.length || 0;
          if (backfilledLength > 0 || backfilledChapters > 0) {
            changed = true;
            return compactBook(book, backfilledLength, backfilledChapters);
          }
        }

        return compactBook(book, estimatedLength, estimatedChapters);
      }

      const fullText = book.fullText || '';
      const chapters = book.chapters || [];
      await saveBookContent(book.id, fullText, chapters);
      changed = true;
      return compactBook(book, fullText.length, chapters.length);
    })
  );

  if (!changed) {
    const needsCompaction = migrated.some(
      (book, idx) => book.fullText !== books[idx]?.fullText || book.chapters !== books[idx]?.chapters
    );
    return needsCompaction ? migrated : books;
  }

  return migrated;
};

export const compactBookForState = (book: Book): Book => {
  const fullTextLength = typeof book.fullText === 'string' ? book.fullText.length : (book.fullTextLength || 0);
  const chapterCount = Array.isArray(book.chapters) ? book.chapters.length : (book.chapterCount || 0);
  return compactBook(book, fullTextLength, chapterCount);
};

export const getAllBookContents = async (): Promise<Record<string, StoredBookContent>> => {
  const db = await openBookContentDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(BOOK_CONTENT_STORE, 'readonly');
    const store = tx.objectStore(BOOK_CONTENT_STORE);
    const request = store.openCursor();
    const result: Record<string, StoredBookContent> = {};

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(result);
        return;
      }
      const key = typeof cursor.key === 'string' ? cursor.key : `${cursor.key}`;
      const normalized = normalizeStoredBookContent(cursor.value);
      if (normalized) {
        result[key] = normalized;
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error || new Error('Failed to read all book contents'));
  });
};

export const clearAllBookContents = async (): Promise<void> => {
  const db = await openBookContentDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BOOK_CONTENT_STORE, 'readwrite');
    const store = tx.objectStore(BOOK_CONTENT_STORE);
    store.clear();

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to clear book contents'));
    tx.onabort = () => reject(tx.error || new Error('Failed to clear book contents'));
  });
};

export const replaceAllBookContents = async (nextEntries: Record<string, StoredBookContent>): Promise<void> => {
  const db = await openBookContentDb();
  const entries = Object.entries(nextEntries || {});

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BOOK_CONTENT_STORE, 'readwrite');
    const store = tx.objectStore(BOOK_CONTENT_STORE);
    store.clear();

    entries.forEach(([bookId, payload]) => {
      if (!bookId || typeof bookId !== 'string') return;
      const normalized = normalizeStoredBookContent(payload);
      if (!normalized) return;
      store.put(normalized, bookId);
    });

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to replace book contents'));
    tx.onabort = () => reject(tx.error || new Error('Failed to replace book contents'));
  });
};

export const getBookContentStorageUsageBytes = async (): Promise<{ totalBytes: number; byBookId: Record<string, number> }> => {
  const encoder = new TextEncoder();
  const allContents = await getAllBookContents();
  const byBookId: Record<string, number> = {};

  let totalBytes = 0;
  Object.entries(allContents).forEach(([bookId, payload]) => {
    const serialized = JSON.stringify(payload);
    const bytes = encoder.encode(serialized).length;
    byBookId[bookId] = bytes;
    totalBytes += bytes;
  });

  return { totalBytes, byBookId };
};
