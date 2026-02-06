const IMAGE_REF_PREFIX = 'idb://';
const IMAGE_DB_NAME = 'app_image_store_v1';
const IMAGE_DB_STORE = 'images';
const IMAGE_DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

const openImageDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(IMAGE_DB_NAME, IMAGE_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IMAGE_DB_STORE)) {
        db.createObjectStore(IMAGE_DB_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'));
  });

  return dbPromise;
};

const generateImageId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const imageIdFromRef = (imageRef: string) => imageRef.slice(IMAGE_REF_PREFIX.length);

export const isImageRef = (value?: string | null): value is string => {
  return !!value && value.startsWith(IMAGE_REF_PREFIX);
};

export const saveImageBlob = async (blob: Blob): Promise<string> => {
  const db = await openImageDb();
  const id = generateImageId();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IMAGE_DB_STORE, 'readwrite');
    const store = tx.objectStore(IMAGE_DB_STORE);
    store.put(blob, id);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to save image'));
    tx.onabort = () => reject(tx.error || new Error('Failed to save image'));
  });

  return `${IMAGE_REF_PREFIX}${id}`;
};

export const saveImageFile = async (file: File): Promise<string> => {
  return saveImageBlob(file);
};

export const getImageBlobByRef = async (imageRef: string): Promise<Blob | null> => {
  if (!isImageRef(imageRef)) return null;
  const db = await openImageDb();
  const id = imageIdFromRef(imageRef);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_DB_STORE, 'readonly');
    const store = tx.objectStore(IMAGE_DB_STORE);
    const request = store.get(id);

    request.onsuccess = () => {
      const result = request.result;
      resolve(result instanceof Blob ? result : null);
    };
    request.onerror = () => reject(request.error || new Error('Failed to load image'));
  });
};

export const deleteImageByRef = async (imageRef?: string | null): Promise<void> => {
  if (!isImageRef(imageRef)) return;
  const db = await openImageDb();
  const id = imageIdFromRef(imageRef);

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IMAGE_DB_STORE, 'readwrite');
    const store = tx.objectStore(IMAGE_DB_STORE);
    store.delete(id);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to delete image'));
    tx.onabort = () => reject(tx.error || new Error('Failed to delete image'));
  });
};

const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
  const response = await fetch(dataUrl);
  return response.blob();
};

export const migrateDataUrlToImageRef = async (value: string): Promise<string> => {
  if (!value || !value.startsWith('data:image/')) return value;
  const blob = await dataUrlToBlob(value);
  return saveImageBlob(blob);
};

