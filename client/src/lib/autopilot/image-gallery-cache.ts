/**
 * ImageGalleryCache — Phase 1 effect preview gallery 24-LRU IndexedDB cache.
 *
 * Storage shape:
 * - 单独的 IndexedDB 数据库 `autopilot-image-gallery-cache`，version 1。
 * - 单个 object store `entries`，`keyPath = "key"`，并对 `storedAt` 建索引以便淘汰最早条目。
 *
 * Semantics:
 * - `get(key)` 命中时刷新 `storedAt = clock()`（LRU touch）并返回**更新后**的 entry；未命中返回 `null`。
 * - `put(entry)` 写入后若 `count > IMAGE_GALLERY_CACHE_CAP`，按 `storedAt` 升序淘汰最早一条（每次 put 最多淘汰 1 条）。
 * - `size()` 返回当前 entry 数量，仅供测试与诊断。
 * - `clear()` 清空 store，仅供测试。
 *
 * SSR / no-indexeddb fallback:
 * - 当 `indexedDB` 不可用时（SSR、隐私模式异常等）：`get` 返回 `null`，`put` / `clear` 为静默 no-op，`size` 返回 0。
 *
 * 参考 `client/src/lib/browser-runtime-storage.ts` 与 `client/src/lib/browser-telemetry-store.ts` 既有 IndexedDB 约定。
 *
 * Validates: Requirements 9.3, 9.4
 */

export const IMAGE_GALLERY_CACHE_CAP = 24;

const DB_NAME = "autopilot-image-gallery-cache";
const DB_VERSION = 1;
const STORE_NAME = "entries";
const STORED_AT_INDEX = "storedAt";

export interface ImageGalleryCacheEntry {
  /** 复合主键，推荐格式 `${missionId}:${nodeId}:${version}`。 */
  readonly key: string;
  readonly missionId: string;
  readonly nodeId: string;
  readonly version: number;
  readonly b64: string;
  readonly mimeType: string;
  readonly promptUsed: string;
  /** ISO8601 时间戳，记录上游图像服务返回时刻。 */
  readonly generatedAt: string;
  /** epoch ms，用于 LRU 淘汰；命中 `get` 时会被刷新。 */
  readonly storedAt: number;
}

export interface ImageGalleryCache {
  /** 命中则刷新 `storedAt = now()`（LRU touch）并返回 entry；未命中返回 `null`。 */
  get(key: string): Promise<ImageGalleryCacheEntry | null>;
  /** 写入 entry；若写入后容量 > 24，按 `storedAt` 升序淘汰最早一条。 */
  put(entry: ImageGalleryCacheEntry): Promise<void>;
  /** 当前 entry 数量；测试与诊断使用。 */
  size(): Promise<number>;
  /** 清空 store；测试使用。 */
  clear(): Promise<void>;
}

export interface CreateImageGalleryCacheOptions {
  /** 注入时钟，便于测试确定性 LRU 顺序；默认 `Date.now`。 */
  readonly clock?: () => number;
  /** 注入 IndexedDB 工厂，便于测试使用 `fake-indexeddb`；默认 `globalThis.indexedDB`。 */
  readonly indexedDB?: IDBFactory;
  /** 自定义数据库名，便于测试隔离；默认 `autopilot-image-gallery-cache`。 */
  readonly databaseName?: string;
}

function resolveIndexedDB(options?: CreateImageGalleryCacheOptions): IDBFactory | null {
  if (options?.indexedDB) {
    return options.indexedDB;
  }
  if (typeof globalThis !== "undefined" && (globalThis as { indexedDB?: IDBFactory }).indexedDB) {
    return (globalThis as { indexedDB?: IDBFactory }).indexedDB ?? null;
  }
  if (typeof window !== "undefined" && typeof window.indexedDB !== "undefined") {
    return window.indexedDB;
  }
  return null;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionToPromise(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function createImageGalleryCache(
  options?: CreateImageGalleryCacheOptions,
): ImageGalleryCache {
  const factory = resolveIndexedDB(options);
  const clock = options?.clock ?? Date.now;
  const dbName = options?.databaseName ?? DB_NAME;

  if (!factory) {
    // SSR / 缺少 indexedDB：所有方法静默降级，不抛错。
    return {
      async get(): Promise<ImageGalleryCacheEntry | null> {
        return null;
      },
      async put(): Promise<void> {
        /* no-op */
      },
      async size(): Promise<number> {
        return 0;
      },
      async clear(): Promise<void> {
        /* no-op */
      },
    };
  }

  let dbPromise: Promise<IDBDatabase> | null = null;

  function openDatabase(): Promise<IDBDatabase> {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = factory!.open(dbName, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
            store.createIndex(STORED_AT_INDEX, "storedAt", { unique: false });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("IndexedDB upgrade blocked"));
      });
    }
    return dbPromise;
  }

  async function get(key: string): Promise<ImageGalleryCacheEntry | null> {
    let db: IDBDatabase;
    try {
      db = await openDatabase();
    } catch {
      return null;
    }
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const existing = await requestToPromise(
      store.get(key) as IDBRequest<ImageGalleryCacheEntry | undefined>,
    );
    if (!existing) {
      // 仍需等待 tx 完成以释放 transaction 资源。
      await transactionToPromise(tx);
      return null;
    }
    const refreshed: ImageGalleryCacheEntry = { ...existing, storedAt: clock() };
    store.put(refreshed);
    await transactionToPromise(tx);
    return refreshed;
  }

  async function put(entry: ImageGalleryCacheEntry): Promise<void> {
    let db: IDBDatabase;
    try {
      db = await openDatabase();
    } catch {
      return;
    }
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(entry);

    const count = await requestToPromise(store.count() as IDBRequest<number>);
    if (count > IMAGE_GALLERY_CACHE_CAP) {
      // 按 storedAt 升序游标定位最早一条；只淘汰一条以保持 size === CAP。
      const index = store.index(STORED_AT_INDEX);
      const cursorRequest = index.openCursor(null, "next");
      await new Promise<void>((resolve, reject) => {
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (cursor) {
            cursor.delete();
          }
          resolve();
        };
        cursorRequest.onerror = () => reject(cursorRequest.error);
      });
    }

    await transactionToPromise(tx);
  }

  async function size(): Promise<number> {
    let db: IDBDatabase;
    try {
      db = await openDatabase();
    } catch {
      return 0;
    }
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const count = await requestToPromise(store.count() as IDBRequest<number>);
    await transactionToPromise(tx);
    return count;
  }

  async function clear(): Promise<void> {
    let db: IDBDatabase;
    try {
      db = await openDatabase();
    } catch {
      return;
    }
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    await transactionToPromise(tx);
  }

  return { get, put, size, clear };
}
