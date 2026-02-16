const CHAT_HISTORY_DB_NAME = 'app_reader_chat_history_db_v1';
const CHAT_HISTORY_STORE = 'chat_history_store';
const CHAT_HISTORY_DB_VERSION = 1;
const CHAT_HISTORY_RECORD_KEY = 'chat_store_v1';

let dbPromise: Promise<IDBDatabase> | null = null;

const openChatHistoryDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(CHAT_HISTORY_DB_NAME, CHAT_HISTORY_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CHAT_HISTORY_STORE)) {
        db.createObjectStore(CHAT_HISTORY_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open chat history IndexedDB'));
  });

  return dbPromise;
};

export type StoredChatHistoryStore = Record<string, unknown>;

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const normalizeStoredChatStore = (value: unknown): StoredChatHistoryStore => {
  if (!isObjectRecord(value)) return {};
  return Object.entries(value).reduce<StoredChatHistoryStore>((acc, [key, payload]) => {
    if (!key || !isObjectRecord(payload)) return acc;
    acc[key] = payload;
    return acc;
  }, {});
};

export const getStoredChatHistoryStore = async (): Promise<StoredChatHistoryStore> => {
  const db = await openChatHistoryDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHAT_HISTORY_STORE, 'readonly');
    const store = tx.objectStore(CHAT_HISTORY_STORE);
    const request = store.get(CHAT_HISTORY_RECORD_KEY);
    request.onsuccess = () => {
      resolve(normalizeStoredChatStore(request.result));
    };
    request.onerror = () => reject(request.error || new Error('Failed to read chat history store'));
  });
};

export const saveStoredChatHistoryStore = async (payload: StoredChatHistoryStore): Promise<void> => {
  const db = await openChatHistoryDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CHAT_HISTORY_STORE, 'readwrite');
    const store = tx.objectStore(CHAT_HISTORY_STORE);
    store.put(normalizeStoredChatStore(payload), CHAT_HISTORY_RECORD_KEY);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to save chat history store'));
    tx.onabort = () => reject(tx.error || new Error('Failed to save chat history store'));
  });
};

export const replaceStoredChatHistoryStore = async (payload: StoredChatHistoryStore): Promise<void> => {
  await saveStoredChatHistoryStore(payload);
};

export const clearStoredChatHistoryStore = async (): Promise<void> => {
  const db = await openChatHistoryDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CHAT_HISTORY_STORE, 'readwrite');
    const store = tx.objectStore(CHAT_HISTORY_STORE);
    store.delete(CHAT_HISTORY_RECORD_KEY);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to clear chat history store'));
    tx.onabort = () => reject(tx.error || new Error('Failed to clear chat history store'));
  });
};

const getUtf8Bytes = (value: string) => new TextEncoder().encode(value).length;

export const getChatHistoryStorageUsageBytes = async (): Promise<number> => {
  const payload = await getStoredChatHistoryStore();
  const serialized = JSON.stringify(payload || {});
  return getUtf8Bytes(CHAT_HISTORY_RECORD_KEY) + getUtf8Bytes(serialized);
};

export const exportChatHistoryForArchive = async (): Promise<StoredChatHistoryStore> => {
  return getStoredChatHistoryStore();
};

export const restoreChatHistoryFromArchive = async (payload: unknown): Promise<void> => {
  await replaceStoredChatHistoryStore(normalizeStoredChatStore(payload));
};

