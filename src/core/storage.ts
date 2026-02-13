/**
 * Persistence layer for tau threads and agent-level VFS.
 *
 * Uses IndexedDB for large data (messages, filesystem) and
 * localStorage for small metadata (thread list, active thread).
 *
 * VFS is stored per-agent (not per-thread) in its own IndexedDB store.
 * Threads only persist messages.
 */

import type { Message } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThreadMeta {
  id: string;
  name: string;
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

const LS_ACTIVE_THREAD = "tau-active-thread";
const LS_THREAD_LIST = "tau-threads";

function readThreadList(): ThreadMeta[] {
  try {
    const raw = localStorage.getItem(LS_THREAD_LIST);
    return raw ? (JSON.parse(raw) as ThreadMeta[]) : [];
  } catch {
    return [];
  }
}

function writeThreadList(list: ThreadMeta[]): void {
  localStorage.setItem(LS_THREAD_LIST, JSON.stringify(list));
}

// ---------------------------------------------------------------------------
// IndexedDB helpers
// ---------------------------------------------------------------------------

const DB_NAME = "tau";
const DB_VERSION = 3; // v3: removed legacy per-thread "fs" store
const STORE_MESSAGES = "messages"; // key: threadId, value: Message[]
const STORE_AGENT_VFS = "agent-vfs"; // key: "vfs", value: Record<string,string>

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
        db.createObjectStore(STORE_MESSAGES);
      }
      // Remove legacy per-thread "fs" store from v1/v2
      if (db.objectStoreNames.contains("fs")) {
        db.deleteObjectStore("fs");
      }
      if (!db.objectStoreNames.contains(STORE_AGENT_VFS)) {
        db.createObjectStore(STORE_AGENT_VFS);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, store: string, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbDelete(db: IDBDatabase, store: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbClear(db: IDBDatabase, store: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------
// ThreadStorage
// ---------------------------------------------------------------------------

export class ThreadStorage {
  private dbPromise: Promise<IDBDatabase | null>;

  constructor() {
    this.dbPromise = openDB().catch((e) => {
      console.warn(
        "[storage] IndexedDB unavailable, falling back to in-memory storage:",
        e
      );
      return null;
    });
  }

  private async getDB(): Promise<IDBDatabase | null> {
    return this.dbPromise;
  }

  // --- Thread metadata (localStorage) ---

  listThreads(): ThreadMeta[] {
    return readThreadList().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getThread(id: string): ThreadMeta | undefined {
    return readThreadList().find((t) => t.id === id);
  }

  saveThread(meta: ThreadMeta): void {
    const list = readThreadList();
    const idx = list.findIndex((t) => t.id === meta.id);
    if (idx >= 0) {
      list[idx] = meta;
    } else {
      list.push(meta);
    }
    writeThreadList(list);
  }

  async deleteThread(id: string): Promise<void> {
    // Remove metadata
    const list = readThreadList().filter((t) => t.id !== id);
    writeThreadList(list);

    // Remove IndexedDB data (messages only; VFS is agent-level now)
    const db = await this.getDB();
    if (db) {
      await idbDelete(db, STORE_MESSAGES, id);
    }

    // Clear active if it was this thread
    if (this.getActiveThreadId() === id) {
      this.setActiveThreadId(null);
    }
  }

  // --- Active thread (localStorage) ---

  getActiveThreadId(): string | null {
    return localStorage.getItem(LS_ACTIVE_THREAD);
  }

  setActiveThreadId(id: string | null): void {
    if (id) {
      localStorage.setItem(LS_ACTIVE_THREAD, id);
    } else {
      localStorage.removeItem(LS_ACTIVE_THREAD);
    }
  }

  // --- Messages (IndexedDB) ---

  async saveMessages(threadId: string, messages: Message[]): Promise<void> {
    const db = await this.getDB();
    if (db) {
      await idbPut(db, STORE_MESSAGES, threadId, messages);
    }
  }

  async getMessages(threadId: string): Promise<Message[]> {
    const db = await this.getDB();
    if (!db) return [];
    return (await idbGet<Message[]>(db, STORE_MESSAGES, threadId)) ?? [];
  }

  // --- Agent-level VFS (IndexedDB) ---

  async saveVFS(files: Record<string, string>): Promise<void> {
    const db = await this.getDB();
    if (db) {
      await idbPut(db, STORE_AGENT_VFS, "vfs", files);
    }
  }

  async loadVFS(): Promise<Record<string, string>> {
    const db = await this.getDB();
    if (!db) return {};
    return (await idbGet<Record<string, string>>(db, STORE_AGENT_VFS, "vfs")) ?? {};
  }

  /**
   * Delete all threads (metadata + messages) and the VFS store.
   * Clears localStorage thread list and active thread, and wipes
   * all IndexedDB object stores.
   */
  async clearAll(): Promise<void> {
    // Clear localStorage
    localStorage.removeItem(LS_THREAD_LIST);
    localStorage.removeItem(LS_ACTIVE_THREAD);

    // Clear all IndexedDB stores (if available)
    const db = await this.getDB();
    if (db) {
      await Promise.all([
        idbClear(db, STORE_MESSAGES),
        idbClear(db, STORE_AGENT_VFS),
      ]);
    }
  }
}
