/**
 * Tests for storage.ts — ThreadStorage backed by localStorage + IndexedDB.
 *
 * Uses jsdom/happy-dom (via vitest) for localStorage and fake-indexeddb
 * for IndexedDB. If fake-indexeddb is not available, we test the
 * localStorage parts and the graceful fallback behavior.
 */

import { describe, it, expect, beforeEach } from "vitest";

// Provide in-memory localStorage and indexedDB for Node
// vitest doesn't provide these by default, so we polyfill minimally

// --- localStorage polyfill ---
function createLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (index: number) => [...store.keys()][index] ?? null,
  } as Storage;
}

// --- IndexedDB polyfill (minimal, using fake-indexeddb if available) ---
let hasIndexedDB = false;
try {
  const fakeIdb = await import("fake-indexeddb").catch(() => null);
  if (fakeIdb) {
    globalThis.indexedDB = fakeIdb.default;
    if (fakeIdb.IDBKeyRange) {
      globalThis.IDBKeyRange = fakeIdb.IDBKeyRange;
    }
    hasIndexedDB = true;
  }
} catch {
  // No fake-indexeddb available, tests will verify graceful fallback
}

// Set up localStorage before importing storage module
globalThis.localStorage = createLocalStorage();

const { ThreadStorage } = await import("../storage.js");

// ─── Tests ──────────────────────────────────────────────────────────

describe("ThreadStorage", () => {
  let storage: InstanceType<typeof ThreadStorage>;

  beforeEach(async () => {
    globalThis.localStorage = createLocalStorage();
    storage = new ThreadStorage();
    // Wait for IDB to be ready
    await new Promise((r) => setTimeout(r, 50));
  });

  // ── Thread metadata (localStorage) ──────────────────────────────

  describe("thread metadata", () => {
    it("should return empty list initially", () => {
      expect(storage.listThreads()).toEqual([]);
    });

    it("should save and retrieve a thread", () => {
      const meta = { id: "t1", name: "Thread 1", createdAt: 1000, updatedAt: 2000 };
      storage.saveThread(meta);
      expect(storage.getThread("t1")).toEqual(meta);
    });

    it("should update an existing thread", () => {
      storage.saveThread({ id: "t1", name: "Old", createdAt: 1000, updatedAt: 1000 });
      storage.saveThread({ id: "t1", name: "New", createdAt: 1000, updatedAt: 2000 });

      const threads = storage.listThreads();
      expect(threads).toHaveLength(1);
      expect(threads[0].name).toBe("New");
    });

    it("should list threads sorted by updatedAt descending", () => {
      storage.saveThread({ id: "t1", name: "Old", createdAt: 100, updatedAt: 100 });
      storage.saveThread({ id: "t2", name: "New", createdAt: 200, updatedAt: 300 });
      storage.saveThread({ id: "t3", name: "Mid", createdAt: 150, updatedAt: 200 });

      const threads = storage.listThreads();
      expect(threads.map((t) => t.id)).toEqual(["t2", "t3", "t1"]);
    });

    it("should return undefined for unknown thread", () => {
      expect(storage.getThread("nonexistent")).toBeUndefined();
    });

    it("should delete a thread from metadata", async () => {
      storage.saveThread({ id: "t1", name: "Thread", createdAt: 1, updatedAt: 1 });
      await storage.deleteThread("t1");
      expect(storage.getThread("t1")).toBeUndefined();
      expect(storage.listThreads()).toHaveLength(0);
    });
  });

  // ── Active thread (localStorage) ────────────────────────────────

  describe("active thread", () => {
    it("should return null when no active thread is set", () => {
      expect(storage.getActiveThreadId()).toBeNull();
    });

    it("should set and get active thread id", () => {
      storage.setActiveThreadId("t1");
      expect(storage.getActiveThreadId()).toBe("t1");
    });

    it("should clear active thread id", () => {
      storage.setActiveThreadId("t1");
      storage.setActiveThreadId(null);
      expect(storage.getActiveThreadId()).toBeNull();
    });

    it("should clear active thread when deleting it", async () => {
      storage.saveThread({ id: "t1", name: "T", createdAt: 1, updatedAt: 1 });
      storage.setActiveThreadId("t1");
      await storage.deleteThread("t1");
      expect(storage.getActiveThreadId()).toBeNull();
    });

    it("should not clear active thread when deleting a different thread", async () => {
      storage.saveThread({ id: "t1", name: "T1", createdAt: 1, updatedAt: 1 });
      storage.saveThread({ id: "t2", name: "T2", createdAt: 1, updatedAt: 1 });
      storage.setActiveThreadId("t1");
      await storage.deleteThread("t2");
      expect(storage.getActiveThreadId()).toBe("t1");
    });
  });

  // ── Messages (IndexedDB) ────────────────────────────────────────

  describe("messages", () => {
    it("should return empty array for unknown thread", async () => {
      const messages = await storage.getMessages("nonexistent");
      expect(messages).toEqual([]);
    });

    it("should save and retrieve messages", async () => {
      const msgs = [
        { role: "system" as const, content: "You are helpful." },
        { role: "user" as const, content: "Hello" },
      ];
      await storage.saveMessages("t1", msgs);
      const retrieved = await storage.getMessages("t1");
      expect(retrieved).toEqual(msgs);
    });

    it("should overwrite messages on second save", async () => {
      await storage.saveMessages("t1", [{ role: "user" as const, content: "First" }]);
      await storage.saveMessages("t1", [{ role: "user" as const, content: "Second" }]);
      const retrieved = await storage.getMessages("t1");
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].content).toBe("Second");
    });
  });

  // ── VFS (IndexedDB) ─────────────────────────────────────────────

  describe("VFS", () => {
    it("should return empty object when no VFS saved", async () => {
      const vfs = await storage.loadVFS();
      expect(vfs).toEqual({});
    });

    it("should save and load VFS", async () => {
      const files = { "/a.txt": "hello", "/dir/b.txt": "world" };
      await storage.saveVFS(files);
      const loaded = await storage.loadVFS();
      expect(loaded).toEqual(files);
    });

    it("should overwrite VFS on second save", async () => {
      await storage.saveVFS({ "/a.txt": "first" });
      await storage.saveVFS({ "/b.txt": "second" });
      const loaded = await storage.loadVFS();
      expect(loaded).toEqual({ "/b.txt": "second" });
    });
  });

  // ── clearAll ─────────────────────────────────────────────────────

  describe("clearAll", () => {
    it("should clear all data", async () => {
      storage.saveThread({ id: "t1", name: "T", createdAt: 1, updatedAt: 1 });
      storage.setActiveThreadId("t1");
      await storage.saveMessages("t1", [{ role: "user" as const, content: "hi" }]);
      await storage.saveVFS({ "/a.txt": "data" });

      await storage.clearAll();

      expect(storage.listThreads()).toEqual([]);
      expect(storage.getActiveThreadId()).toBeNull();
      const msgs = await storage.getMessages("t1");
      expect(msgs).toEqual([]);
      const vfs = await storage.loadVFS();
      expect(vfs).toEqual({});
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────

  describe("edge cases", () => {
    it("should handle corrupted localStorage gracefully", () => {
      // Write invalid JSON to the thread list key
      localStorage.setItem("tau-threads", "not json");
      const threads = storage.listThreads();
      expect(threads).toEqual([]);
    });
  });
});
