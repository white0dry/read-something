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

export const saveImageBlobByRef = async (imageRef: string, blob: Blob): Promise<void> => {
  if (!isImageRef(imageRef)) {
    throw new Error('Invalid imageRef');
  }
  const db = await openImageDb();
  const id = imageIdFromRef(imageRef);

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IMAGE_DB_STORE, 'readwrite');
    const store = tx.objectStore(IMAGE_DB_STORE);
    store.put(blob, id);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to save image by ref'));
    tx.onabort = () => reject(tx.error || new Error('Failed to save image by ref'));
  });
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

export const clearAllImages = async (): Promise<void> => {
  const db = await openImageDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IMAGE_DB_STORE, 'readwrite');
    const store = tx.objectStore(IMAGE_DB_STORE);
    store.clear();

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to clear image store'));
    tx.onabort = () => reject(tx.error || new Error('Failed to clear image store'));
  });
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Failed to convert blob to data URL'));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to convert blob to data URL'));
    reader.readAsDataURL(blob);
  });

export const getAllImageRefsAndSizes = async (): Promise<Record<string, number>> => {
  const db = await openImageDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_DB_STORE, 'readonly');
    const store = tx.objectStore(IMAGE_DB_STORE);
    const request = store.openCursor();
    const result: Record<string, number> = {};

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(result);
        return;
      }
      if (cursor.value instanceof Blob) {
        const imageRef = `${IMAGE_REF_PREFIX}${cursor.key}`;
        result[imageRef] = cursor.value.size;
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error || new Error('Failed to read image sizes'));
  });
};

export const exportAllImagesAsDataUrls = async (): Promise<Record<string, string>> => {
  const db = await openImageDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_DB_STORE, 'readonly');
    const store = tx.objectStore(IMAGE_DB_STORE);
    const request = store.openCursor();
    const result: Record<string, string> = {};
    const pending: Array<Promise<void>> = [];

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        Promise.all(pending)
          .then(() => resolve(result))
          .catch(reject);
        return;
      }
      if (cursor.value instanceof Blob) {
        const imageRef = `${IMAGE_REF_PREFIX}${cursor.key}`;
        const blob = cursor.value;
        pending.push(
          blobToDataUrl(blob).then((dataUrl) => {
            result[imageRef] = dataUrl;
          })
        );
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error || new Error('Failed to export images'));
  });
};
