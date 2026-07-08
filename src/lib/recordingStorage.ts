// IndexedDB-backed storage for pending recording segments.
// Ensures no data loss if the browser tab crashes, sleeps, or the network drops
// mid-upload. Segments are removed as soon as they're confirmed uploaded.

const DB_NAME = "telehealth-recorder";
const DB_VERSION = 1;
const STORE = "segments";

export interface StoredSegment {
  sessionId: string;
  index: number;
  blob: Blob;
  createdAt: number;
  // Notes/context so a segment can be uploaded/finalized after a crash/reload.
  notes?: { motivo?: string; anotacoes?: string; agentId?: string };
  final?: boolean; // true when this segment was the last one before stop
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: ["sessionId", "index"] });
        store.createIndex("sessionId", "sessionId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result: any;
    Promise.resolve(fn(store))
      .then((r) => {
        if (r && typeof (r as IDBRequest).onsuccess === "object") {
          const req = r as IDBRequest;
          req.onsuccess = () => { result = req.result; };
          req.onerror = () => reject(req.error);
        } else {
          result = r;
        }
      })
      .catch(reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const recordingStorage = {
  async put(segment: StoredSegment): Promise<void> {
    await withStore("readwrite", (store) => store.put(segment));
  },

  async remove(sessionId: string, index: number): Promise<void> {
    await withStore("readwrite", (store) => store.delete([sessionId, index]));
  },

  async listBySession(sessionId: string): Promise<StoredSegment[]> {
    return withStore<StoredSegment[]>("readonly", (store) => {
      return new Promise<StoredSegment[]>((resolve, reject) => {
        const idx = store.index("sessionId");
        const req = idx.getAll(IDBKeyRange.only(sessionId));
        req.onsuccess = () => resolve((req.result as StoredSegment[]) || []);
        req.onerror = () => reject(req.error);
      }) as any;
    });
  },

  async listOrphanSessionIds(): Promise<string[]> {
    return withStore<string[]>("readonly", (store) => {
      return new Promise<string[]>((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => {
          const rows = (req.result as StoredSegment[]) || [];
          const ids = Array.from(new Set(rows.map((r) => r.sessionId)));
          resolve(ids);
        };
        req.onerror = () => reject(req.error);
      }) as any;
    });
  },

  async clearSession(sessionId: string): Promise<void> {
    const segs = await this.listBySession(sessionId);
    await Promise.all(segs.map((s) => this.remove(sessionId, s.index)));
  },
};
