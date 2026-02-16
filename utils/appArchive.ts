import { StoredBookContent, getAllBookContents, getBookContentStorageUsageBytes, replaceAllBookContents } from './bookContentStorage';
import {
  exportChatHistoryForArchive,
  getChatHistoryStorageUsageBytes,
  restoreChatHistoryFromArchive,
} from './chatHistoryStorage';
import {
  clearAllImages,
  exportAllImagesAsDataUrls,
  getAllImageRefsAndSizes,
  isImageRef,
  saveImageBlobByRef,
} from './imageStorage';

export type StorageCategoryKey =
  | 'readingText'
  | 'chatHistory'
  | 'worldBook'
  | 'personaCharacter'
  | 'appearancePresets'
  | 'stats'
  | 'other';

const LOCAL_STORAGE_PREFIXES = ['app_', 'lib_'];
const APP_ARCHIVE_SCHEMA = 'ai-reader-archive';
const APP_ARCHIVE_VERSION = 1;
const APP_ARCHIVE_APP_ID = 'ai-reader-companion';
const LEGACY_CHAT_HISTORY_STORAGE_KEY = 'app_reader_chat_history_v1';

export const STORAGE_CATEGORY_ORDER: StorageCategoryKey[] = [
  'readingText',
  'chatHistory',
  'worldBook',
  'personaCharacter',
  'appearancePresets',
  'stats',
  'other',
];

export const STORAGE_CATEGORY_LABELS: Record<StorageCategoryKey, string> = {
  readingText: '阅读文本信息',
  chatHistory: '聊天记录',
  worldBook: '世界书',
  personaCharacter: '用户与角色人设',
  appearancePresets: '美化预设',
  stats: '统计数据',
  other: '其他',
};

export const STORAGE_CATEGORY_COLORS: Record<StorageCategoryKey, string> = {
  readingText: '#797D62',
  chatHistory: '#9B9B7A',
  worldBook: '#D9AE94',
  personaCharacter: '#F1DCA7',
  appearancePresets: '#FFCB69',
  stats: '#D08C60',
  other: '#997B66',
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const safeParseJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const getUtf8Bytes = (value: string) => new TextEncoder().encode(value).length;

const isArchiveLocalStorageKey = (key: string) => LOCAL_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix));

const classifyLocalStorageKey = (key: string): StorageCategoryKey => {
  if (key === 'app_books') return 'readingText';
  if (key === 'app_reader_chat_history_v1') return 'chatHistory';
  if (key === 'app_worldbook' || key === 'app_wb_categories') return 'worldBook';
  if (
    key === 'app_personas'
    || key === 'app_characters'
    || key === 'app_active_persona_id'
    || key === 'app_active_character_id'
    || key === 'app_user_signature'
  ) {
    return 'personaCharacter';
  }
  if (
    key === 'app_settings'
    || key === 'app_reader_appearance'
    || key === 'app_dark_mode'
    || key === 'app_reader_ai_panel_height_v1'
  ) {
    return 'appearancePresets';
  }
  if (
    key === 'app_daily_reading_ms'
    || key === 'app_completed_book_ids'
    || key === 'app_completed_book_reached_at'
    || key === 'app_reading_ms_by_book_id'
    || key === 'app_stats_goal_book_ids'
    || key.startsWith('app_stats_')
  ) {
    return 'stats';
  }
  return 'other';
};

const collectLocalStorageSnapshot = (): Record<string, string> => {
  const snapshot: Record<string, string> = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !isArchiveLocalStorageKey(key)) continue;
    const value = localStorage.getItem(key);
    if (value === null) continue;
    snapshot[key] = value;
  }
  return snapshot;
};

const buildImageCategoryMap = (localStorageSnapshot: Record<string, string>) => {
  const imageCategoryMap: Record<string, StorageCategoryKey> = {};

  const books = safeParseJson(localStorageSnapshot.app_books || '');
  if (Array.isArray(books)) {
    books.forEach((book) => {
      const coverUrl = isObjectRecord(book) && typeof book.coverUrl === 'string' ? book.coverUrl : '';
      if (isImageRef(coverUrl)) {
        imageCategoryMap[coverUrl] = 'readingText';
      }
    });
  }

  const personas = safeParseJson(localStorageSnapshot.app_personas || '');
  if (Array.isArray(personas)) {
    personas.forEach((persona) => {
      const avatar = isObjectRecord(persona) && typeof persona.avatar === 'string' ? persona.avatar : '';
      if (isImageRef(avatar)) {
        imageCategoryMap[avatar] = 'personaCharacter';
      }
    });
  }

  const characters = safeParseJson(localStorageSnapshot.app_characters || '');
  if (Array.isArray(characters)) {
    characters.forEach((character) => {
      const avatar = isObjectRecord(character) && typeof character.avatar === 'string' ? character.avatar : '';
      if (isImageRef(avatar)) {
        imageCategoryMap[avatar] = 'personaCharacter';
      }
    });
  }

  const settings = safeParseJson(localStorageSnapshot.app_settings || '');
  if (isObjectRecord(settings)) {
    const readerMore = isObjectRecord(settings.readerMore) ? settings.readerMore : null;
    const appearance = readerMore && isObjectRecord(readerMore.appearance) ? readerMore.appearance : null;
    const chatBackgroundImage = appearance && typeof appearance.chatBackgroundImage === 'string'
      ? appearance.chatBackgroundImage
      : '';
    if (isImageRef(chatBackgroundImage)) {
      imageCategoryMap[chatBackgroundImage] = 'appearancePresets';
    }
  }

  return imageCategoryMap;
};

export interface StorageBreakdownItem {
  key: StorageCategoryKey;
  label: string;
  color: string;
  bytes: number;
  percentage: number;
}

export interface StorageAnalysisResult {
  totalBytes: number;
  generatedAt: number;
  items: StorageBreakdownItem[];
}

export const analyzeAppStorageUsage = async (): Promise<StorageAnalysisResult> => {
  const localStorageSnapshot = collectLocalStorageSnapshot();
  const imageCategoryMap = buildImageCategoryMap(localStorageSnapshot);
  const categoryBytes = STORAGE_CATEGORY_ORDER.reduce<Record<StorageCategoryKey, number>>((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {} as Record<StorageCategoryKey, number>);

  Object.entries(localStorageSnapshot).forEach(([key, value]) => {
    const bytes = getUtf8Bytes(key) + getUtf8Bytes(value);
    const category = classifyLocalStorageKey(key);
    categoryBytes[category] += bytes;
  });

  const bookContentUsage = await getBookContentStorageUsageBytes();
  categoryBytes.readingText += bookContentUsage.totalBytes;
  const chatStoreUsage = await getChatHistoryStorageUsageBytes();
  categoryBytes.chatHistory += chatStoreUsage;

  const imageUsage = await getAllImageRefsAndSizes();
  Object.entries(imageUsage).forEach(([imageRef, size]) => {
    const category = imageCategoryMap[imageRef] || 'other';
    categoryBytes[category] += Math.max(0, size);
  });

  const totalBytes = STORAGE_CATEGORY_ORDER.reduce((sum, key) => sum + categoryBytes[key], 0);
  const items = STORAGE_CATEGORY_ORDER.map((key) => {
    const bytes = categoryBytes[key];
    return {
      key,
      label: STORAGE_CATEGORY_LABELS[key],
      color: STORAGE_CATEGORY_COLORS[key],
      bytes,
      percentage: totalBytes > 0 ? (bytes / totalBytes) * 100 : 0,
    };
  });

  return {
    totalBytes,
    generatedAt: Date.now(),
    items,
  };
};

export interface AppArchivePayload {
  meta: {
    schema: string;
    version: number;
    exportedAt: string;
    appId: string;
  };
  localStorage: Record<string, string>;
  indexedDb: {
    bookContents: Record<string, StoredBookContent>;
    images: Record<string, string>;
    chatStore: Record<string, unknown>;
  };
}

export const createAppArchivePayload = async (): Promise<AppArchivePayload> => {
  const localStorageSnapshot = collectLocalStorageSnapshot();
  const bookContents = await getAllBookContents();
  const images = await exportAllImagesAsDataUrls();
  const chatStore = await exportChatHistoryForArchive();

  return {
    meta: {
      schema: APP_ARCHIVE_SCHEMA,
      version: APP_ARCHIVE_VERSION,
      exportedAt: new Date().toISOString(),
      appId: APP_ARCHIVE_APP_ID,
    },
    localStorage: localStorageSnapshot,
    indexedDb: {
      bookContents,
      images,
      chatStore,
    },
  };
};

const normalizeArchivePayload = (raw: unknown): AppArchivePayload => {
  if (!isObjectRecord(raw)) throw new Error('存档文件格式无效');

  const metaSource = isObjectRecord(raw.meta) ? raw.meta : null;
  if (!metaSource) throw new Error('存档文件缺少 meta 字段');
  const schema = typeof metaSource.schema === 'string' ? metaSource.schema : '';
  const version = Number(metaSource.version);
  const exportedAt = typeof metaSource.exportedAt === 'string' ? metaSource.exportedAt : '';
  const appId = typeof metaSource.appId === 'string' ? metaSource.appId : '';
  if (schema !== APP_ARCHIVE_SCHEMA) throw new Error('存档 schema 不匹配');
  if (!Number.isFinite(version) || version < 1) throw new Error('存档版本无效');
  if (!exportedAt) throw new Error('存档导出时间缺失');
  if (appId !== APP_ARCHIVE_APP_ID) throw new Error('存档应用标识不匹配');

  if (!isObjectRecord(raw.localStorage)) throw new Error('存档文件缺少 localStorage 字段');
  const localStorageSource = raw.localStorage;
  const localStorageSnapshot: Record<string, string> = {};
  Object.entries(localStorageSource).forEach(([key, value]) => {
    if (!isArchiveLocalStorageKey(key)) return;
    if (typeof value !== 'string') return;
    localStorageSnapshot[key] = value;
  });

  if (!isObjectRecord(raw.indexedDb)) throw new Error('存档文件缺少 indexedDb 字段');
  const indexedDbSource = raw.indexedDb;
  if (!isObjectRecord(indexedDbSource.bookContents)) throw new Error('存档文件缺少 indexedDb.bookContents 字段');
  if (!isObjectRecord(indexedDbSource.images)) throw new Error('存档文件缺少 indexedDb.images 字段');
  const bookContentsSource = indexedDbSource.bookContents;
  const imagesSource = indexedDbSource.images;
  const chatStoreSource = isObjectRecord(indexedDbSource.chatStore) ? indexedDbSource.chatStore : {};

  const bookContents: Record<string, StoredBookContent> = {};
  Object.entries(bookContentsSource).forEach(([bookId, payload]) => {
    if (!bookId || typeof bookId !== 'string') return;
    if (!isObjectRecord(payload)) return;
    bookContents[bookId] = payload as StoredBookContent;
  });

  const images: Record<string, string> = {};
  Object.entries(imagesSource).forEach(([imageRef, dataUrl]) => {
    if (!isImageRef(imageRef)) return;
    if (typeof dataUrl !== 'string') return;
    if (!dataUrl.startsWith('data:')) return;
    images[imageRef] = dataUrl;
  });

  const chatStore: Record<string, unknown> = {};
  Object.entries(chatStoreSource).forEach(([conversationKey, bucket]) => {
    if (!conversationKey || !isObjectRecord(bucket)) return;
    chatStore[conversationKey] = bucket;
  });
  if (Object.keys(chatStore).length === 0 && typeof localStorageSnapshot[LEGACY_CHAT_HISTORY_STORAGE_KEY] === 'string') {
    try {
      const legacyParsed = JSON.parse(localStorageSnapshot[LEGACY_CHAT_HISTORY_STORAGE_KEY]) as Record<string, unknown>;
      if (legacyParsed && typeof legacyParsed === 'object') {
        Object.entries(legacyParsed).forEach(([conversationKey, bucket]) => {
          if (!conversationKey || !isObjectRecord(bucket)) return;
          chatStore[conversationKey] = bucket;
        });
      }
    } catch {
      // ignore malformed legacy payload
    }
  }
  delete localStorageSnapshot[LEGACY_CHAT_HISTORY_STORAGE_KEY];

  return {
    meta: {
      schema,
      version: Math.floor(version),
      exportedAt,
      appId,
    },
    localStorage: localStorageSnapshot,
    indexedDb: {
      bookContents,
      images,
      chatStore,
    },
  };
};

const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
  const response = await fetch(dataUrl);
  if (!response.ok) {
    throw new Error(`图片数据解析失败(${response.status})`);
  }
  return response.blob();
};

export const restoreAppArchivePayload = async (raw: unknown): Promise<AppArchivePayload> => {
  const archive = normalizeArchivePayload(raw);
  const imageBlobEntries = await Promise.all(
    Object.entries(archive.indexedDb.images).map(async ([imageRef, dataUrl]) => {
      const blob = await dataUrlToBlob(dataUrl);
      return [imageRef, blob] as const;
    })
  );

  await replaceAllBookContents(archive.indexedDb.bookContents);
  await restoreChatHistoryFromArchive(archive.indexedDb.chatStore);
  await clearAllImages();
  for (const [imageRef, blob] of imageBlobEntries) {
    await saveImageBlobByRef(imageRef, blob);
  }

  const removableKeys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !isArchiveLocalStorageKey(key)) continue;
    removableKeys.push(key);
  }
  removableKeys.forEach((key) => localStorage.removeItem(key));
  Object.entries(archive.localStorage).forEach(([key, value]) => {
    localStorage.setItem(key, value);
  });

  return archive;
};

export const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const fixed = unitIndex === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(fixed)} ${units[unitIndex]}`;
};


