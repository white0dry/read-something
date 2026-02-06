import { Book, Chapter } from '../types';

const BOOK_CONTENT_DB_NAME = 'app_book_content_v1';
const BOOK_CONTENT_STORE = 'book_contents';
const BOOK_CONTENT_DB_VERSION = 1;

interface StoredBookContent {
  fullText: string;
  chapters: Chapter[];
}

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
    const payload: StoredBookContent = {
      fullText,
      chapters,
    };
    store.put(payload, bookId);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to save book content'));
    tx.onabort = () => reject(tx.error || new Error('Failed to save book content'));
  });
};

export const getBookContent = async (bookId: string): Promise<StoredBookContent | null> => {
  const db = await openBookContentDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(BOOK_CONTENT_STORE, 'readonly');
    const store = tx.objectStore(BOOK_CONTENT_STORE);
    const request = store.get(bookId);

    request.onsuccess = () => {
      const result = request.result as StoredBookContent | undefined;
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
  if (typeof book.fullText === 'string') return book.fullText.length;
  return book.fullTextLength || 0;
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

