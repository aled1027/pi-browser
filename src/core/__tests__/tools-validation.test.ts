/**
 * Tests for tool parameter validation and edge cases.
 *
 * Verifies behavior when tools receive missing, malformed,
 * or unexpected arguments.
 */

import { describe, it, expect } from "vitest";
import { VirtualFS, createTools } from "../tools.js";
import type { ToolDefinition } from "../types.js";

function getToolByName(name: string, fs: VirtualFS): ToolDefinition {
  const tools = createTools(fs);
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool "${name}" not found`);
  return tool;
}

// ─── read tool validation ───────────────────────────────────────────

describe("read tool validation", () => {
  it("should throw on undefined path (no input validation)", async () => {
    const fs = new VirtualFS();
    const tool = getToolByName("read", fs);
    // Current implementation does not validate — it crashes on undefined
    await expect(tool.execute({})).rejects.toThrow();
  });

  it("should handle empty string path", async () => {
    const fs = new VirtualFS();
    const tool = getToolByName("read", fs);
    const result = await tool.execute({ path: "" });
    expect(result.isError).toBe(true);
  });

  it("should handle path with special characters", async () => {
    const fs = new VirtualFS();
    fs.write("/file with spaces.txt", "content");
    const tool = getToolByName("read", fs);
    const result = await tool.execute({ path: "/file with spaces.txt" });
    expect(result.isError).toBe(false);
    expect(result.content).toBe("content");
  });

  it("should throw on numeric path argument (no input validation)", async () => {
    const fs = new VirtualFS();
    const tool = getToolByName("read", fs);
    // LLMs sometimes pass wrong types — current implementation crashes
    await expect(tool.execute({ path: 123 as any })).rejects.toThrow();
  });

  it("should handle deeply nested paths", async () => {
    const fs = new VirtualFS();
    fs.write("/a/b/c/d/e/f.txt", "deep");
    const tool = getToolByName("read", fs);
    const result = await tool.execute({ path: "/a/b/c/d/e/f.txt" });
    expect(result.isError).toBe(false);
    expect(result.content).toBe("deep");
  });

  it("should handle path with double slashes", async () => {
    const fs = new VirtualFS();
    fs.write("/dir/file.txt", "data");
    const tool = getToolByName("read", fs);
    const result = await tool.execute({ path: "//dir//file.txt" });
    expect(result.isError).toBe(false);
    expect(result.content).toBe("data");
  });
});

// ─── write tool validation ──────────────────────────────────────────

describe("write tool validation", () => {
  it("should throw on undefined content (no input validation)", async () => {
    const fs = new VirtualFS();
    const tool = getToolByName("write", fs);
    // Current implementation crashes when content is undefined
    await expect(tool.execute({ path: "/test.txt" })).rejects.toThrow();
  });

  it("should handle empty content", async () => {
    const fs = new VirtualFS();
    const tool = getToolByName("write", fs);
    const result = await tool.execute({ path: "/empty.txt", content: "" });
    expect(result.isError).toBe(false);
    expect(result.content).toContain("0 bytes");
    expect(fs.read("/empty.txt")).toBe("");
  });

  it("should handle very large content", async () => {
    const fs = new VirtualFS();
    const tool = getToolByName("write", fs);
    const bigContent = "x".repeat(1_000_000);
    const result = await tool.execute({ path: "/big.txt", content: bigContent });
    expect(result.isError).toBe(false);
    expect(result.content).toContain("1000000 bytes");
    expect(fs.read("/big.txt")).toBe(bigContent);
  });

  it("should throw on undefined path (no input validation)", async () => {
    const fs = new VirtualFS();
    const tool = getToolByName("write", fs);
    // Current implementation crashes when path is undefined
    await expect(tool.execute({ content: "hello" })).rejects.toThrow();
  });

  it("should handle content with special unicode characters", async () => {
    const fs = new VirtualFS();
    const tool = getToolByName("write", fs);
    const unicode = "Hello 🌍 Ñ 日本語 中文";
    const result = await tool.execute({ path: "/unicode.txt", content: unicode });
    expect(result.isError).toBe(false);
    expect(fs.read("/unicode.txt")).toBe(unicode);
  });

  it("should handle content with newlines and tabs", async () => {
    const fs = new VirtualFS();
    const tool = getToolByName("write", fs);
    const content = "line1\n\tline2\n\t\tline3";
    const result = await tool.execute({ path: "/indented.txt", content });
    expect(result.isError).toBe(false);
    expect(fs.read("/indented.txt")).toBe(content);
  });
});

// ─── edit tool validation ───────────────────────────────────────────

describe("edit tool validation", () => {
  it("should throw on missing path (no input validation)", async () => {
    const fs = new VirtualFS();
    const tool = getToolByName("edit", fs);
    // Current implementation crashes when path is undefined
    await expect(tool.execute({ oldText: "a", newText: "b" })).rejects.toThrow();
  });

  it("should handle missing oldText", async () => {
    const fs = new VirtualFS();
    fs.write("/test.txt", "hello world");
    const tool = getToolByName("edit", fs);
    // oldText is undefined, which won't match in the file
    const result = await tool.execute({ path: "/test.txt", newText: "b" });
    expect(result.isError).toBe(true);
  });

  it("should handle empty oldText (matches at start of file)", async () => {
    const fs = new VirtualFS();
    fs.write("/test.txt", "hello");
    const tool = getToolByName("edit", fs);
    const result = await tool.execute({ path: "/test.txt", oldText: "", newText: "prefix" });
    // Empty string is found in every string, so replace should work
    expect(result.isError).toBe(false);
    expect(fs.read("/test.txt")).toBe("prefixhello");
  });

  it("should handle empty newText (deletion)", async () => {
    const fs = new VirtualFS();
    fs.write("/test.txt", "hello world");
    const tool = getToolByName("edit", fs);
    const result = await tool.execute({ path: "/test.txt", oldText: " world", newText: "" });
    expect(result.isError).toBe(false);
    expect(fs.read("/test.txt")).toBe("hello");
  });

  it("should handle multiline oldText", async () => {
    const fs = new VirtualFS();
    fs.write("/test.txt", "line1\nline2\nline3");
    const tool = getToolByName("edit", fs);
    const result = await tool.execute({
      path: "/test.txt",
      oldText: "line1\nline2",
      newText: "replaced",
    });
    expect(result.isError).toBe(false);
    expect(fs.read("/test.txt")).toBe("replaced\nline3");
  });

  it("should handle oldText with regex special characters", async () => {
    const fs = new VirtualFS();
    fs.write("/test.txt", "value = foo.bar(1+2)");
    const tool = getToolByName("edit", fs);
    const result = await tool.execute({
      path: "/test.txt",
      oldText: "foo.bar(1+2)",
      newText: "baz(3)",
    });
    expect(result.isError).toBe(false);
    expect(fs.read("/test.txt")).toBe("value = baz(3)");
  });

  it("should only replace first occurrence", async () => {
    const fs = new VirtualFS();
    fs.write("/test.txt", "aaa bbb aaa");
    const tool = getToolByName("edit", fs);
    const result = await tool.execute({
      path: "/test.txt",
      oldText: "aaa",
      newText: "ccc",
    });
    expect(result.isError).toBe(false);
    expect(fs.read("/test.txt")).toBe("ccc bbb aaa");
  });
});

// ─── list tool validation ───────────────────────────────────────────

describe("list tool validation", () => {
  it("should handle undefined prefix (default to /)", async () => {
    const fs = new VirtualFS();
    fs.write("/a.txt", "a");
    const tool = getToolByName("list", fs);
    const result = await tool.execute({});
    expect(result.isError).toBe(false);
    expect(result.content).toContain("/a.txt");
  });

  it("should handle empty string prefix", async () => {
    const fs = new VirtualFS();
    fs.write("/a.txt", "a");
    const tool = getToolByName("list", fs);
    const result = await tool.execute({ prefix: "" });
    // Empty prefix normalizes to "/" in VirtualFS
    expect(result).toBeDefined();
  });

  it("should handle prefix with trailing slash", async () => {
    const fs = new VirtualFS();
    fs.write("/src/a.ts", "a");
    const tool = getToolByName("list", fs);
    const result = await tool.execute({ prefix: "/src/" });
    expect(result.isError).toBe(false);
    expect(result.content).toContain("/src/a.ts");
  });

  it("should handle prefix without leading slash", async () => {
    const fs = new VirtualFS();
    fs.write("/src/a.ts", "a");
    const tool = getToolByName("list", fs);
    const result = await tool.execute({ prefix: "src" });
    expect(result.isError).toBe(false);
    expect(result.content).toContain("/src/a.ts");
  });

  it("should handle filesystem with many files", async () => {
    const fs = new VirtualFS();
    for (let i = 0; i < 100; i++) {
      fs.write(`/dir/file${i}.txt`, `content ${i}`);
    }
    const tool = getToolByName("list", fs);
    const result = await tool.execute({ prefix: "/dir" });
    expect(result.isError).toBe(false);
    const lines = result.content.split("\n");
    expect(lines).toHaveLength(100);
  });
});
