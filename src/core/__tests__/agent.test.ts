import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentEvent, ToolCall, Message } from "../types.js";
import { PromptStream } from "../agent.js";

// ─── Mock openrouter ────────────────────────────────────────────────

const mockRunAgent = vi.fn<() => AsyncGenerator<AgentEvent>>();

vi.mock("../openrouter.js", () => ({
  runAgent: (...args: unknown[]) => mockRunAgent(...(args as [])),
}));

// ─── Mock storage (avoid IndexedDB / localStorage in tests) ────────

// Shared storage state that can be pre-populated for restoration tests
const sharedStorageState = {
  threads: new Map<string, { id: string; name: string; createdAt: number; updatedAt: number }>(),
  messages: new Map<string, unknown[]>(),
  activeId: null as string | null,
  vfs: {} as Record<string, string>,
  reset() {
    this.threads.clear();
    this.messages.clear();
    this.activeId = null;
    this.vfs = {};
  },
};

vi.mock("../storage.js", () => {
  class FakeThreadStorage {
    listThreads() { return [...sharedStorageState.threads.values()].sort((a, b) => b.updatedAt - a.updatedAt); }
    getThread(id: string) { return sharedStorageState.threads.get(id); }
    saveThread(meta: { id: string; name: string; createdAt: number; updatedAt: number }) { sharedStorageState.threads.set(meta.id, meta); }
    async deleteThread(id: string) { sharedStorageState.threads.delete(id); sharedStorageState.messages.delete(id); }
    getActiveThreadId() { return sharedStorageState.activeId; }
    setActiveThreadId(id: string | null) { sharedStorageState.activeId = id; }
    async saveMessages(threadId: string, msgs: unknown[]) { sharedStorageState.messages.set(threadId, msgs); }
    async getMessages(threadId: string) { return sharedStorageState.messages.get(threadId) ?? []; }
    async saveVFS(files: Record<string, string>) { sharedStorageState.vfs = files; }
    async loadVFS() { return sharedStorageState.vfs; }
    async clearAll() { sharedStorageState.reset(); }
  }
  return { ThreadStorage: FakeThreadStorage };
});

// Import Agent after mocks are set up
const { Agent } = await import("../agent.js");

// ─── Helpers ────────────────────────────────────────────────────────

/** Create an async generator from an array of events */
async function* eventsFrom(events: AgentEvent[]): AsyncGenerator<AgentEvent> {
  for (const e of events) {
    yield e;
  }
}

function textDelta(delta: string): AgentEvent {
  return { type: "text_delta", delta };
}

function toolStart(tc: ToolCall): AgentEvent {
  return { type: "tool_call_start", toolCall: tc };
}

function toolEnd(tc: ToolCall): AgentEvent {
  return { type: "tool_call_end", toolCall: tc };
}

function turnEnd(): AgentEvent {
  return { type: "turn_end" };
}

function errorEvent(error: string): AgentEvent {
  return { type: "error", error };
}

function toolLoopMessage(message: Message): AgentEvent {
  return { type: "tool_loop_message", message };
}

const TOOL_CALL: ToolCall = {
  id: "tc_1",
  name: "read",
  arguments: { path: "/hello.txt" },
};

const TOOL_CALL_WITH_RESULT: ToolCall = {
  ...TOOL_CALL,
  result: { content: "hello world", isError: false },
};

// ─── PromptStream (unit tests, no Agent needed) ────────────────────

describe("PromptStream", () => {
  it("should be awaitable and return a PromptResult", async () => {
    const gen = eventsFrom([
      textDelta("Hello"),
      textDelta(" world"),
      turnEnd(),
    ]);
    const stream = new PromptStream(gen);
    const result = await stream;

    expect(result.text).toBe("Hello world");
    expect(result.toolCalls).toEqual([]);
  });

  it("should be async-iterable and yield all events", async () => {
    const events: AgentEvent[] = [
      textDelta("Hi"),
      turnEnd(),
    ];
    const stream = new PromptStream(eventsFrom(events));

    const collected: AgentEvent[] = [];
    for await (const event of stream) {
      collected.push(event);
    }

    expect(collected).toEqual(events);
    expect(stream.result.text).toBe("Hi");
  });

  it("should accumulate tool calls from start/end events", async () => {
    const stream = new PromptStream(eventsFrom([
      toolStart(TOOL_CALL),
      toolEnd(TOOL_CALL_WITH_RESULT),
      textDelta("Done"),
      turnEnd(),
    ]));

    const result = await stream;

    expect(result.text).toBe("Done");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("read");
    expect(result.toolCalls[0].result?.content).toBe("hello world");
  });

  it("should update tool call on tool_call_end (not duplicate)", async () => {
    const stream = new PromptStream(eventsFrom([
      toolStart(TOOL_CALL),
      toolEnd(TOOL_CALL_WITH_RESULT),
      turnEnd(),
    ]));

    const result = await stream;
    expect(result.toolCalls).toHaveLength(1);
  });

  it("should throw when accessing .result before consumption", () => {
    const stream = new PromptStream(eventsFrom([textDelta("x")]));
    expect(() => stream.result).toThrow("not yet consumed");
  });

  it("should return empty text and toolCalls for an empty stream", async () => {
    const stream = new PromptStream(eventsFrom([]));
    const result = await stream;

    expect(result.text).toBe("");
    expect(result.toolCalls).toEqual([]);
  });

  it("should handle multiple tool calls", async () => {
    const tc1: ToolCall = { id: "tc_1", name: "read", arguments: { path: "/a" } };
    const tc2: ToolCall = { id: "tc_2", name: "write", arguments: { path: "/b", content: "x" } };
    const tc1Done: ToolCall = { ...tc1, result: { content: "aaa", isError: false } };
    const tc2Done: ToolCall = { ...tc2, result: { content: "Wrote 1 bytes", isError: false } };

    const result = await new PromptStream(eventsFrom([
      toolStart(tc1),
      toolEnd(tc1Done),
      toolStart(tc2),
      toolEnd(tc2Done),
      textDelta("All done"),
      turnEnd(),
    ]));

    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].id).toBe("tc_1");
    expect(result.toolCalls[1].id).toBe("tc_2");
    expect(result.text).toBe("All done");
  });

  it("should handle error events without throwing", async () => {
    const stream = new PromptStream(eventsFrom([
      textDelta("partial"),
      errorEvent("something went wrong"),
      turnEnd(),
    ]));

    const collected: AgentEvent[] = [];
    for await (const event of stream) {
      collected.push(event);
    }

    expect(collected).toHaveLength(3);
    expect(collected[1]).toEqual({ type: "error", error: "something went wrong" });
    expect(stream.result.text).toBe("partial");
  });

  it("should not yield events on second iteration (consumed guard)", async () => {
    const stream = new PromptStream(eventsFrom([
      textDelta("hello"),
      turnEnd(),
    ]));

    // First iteration
    const first: AgentEvent[] = [];
    for await (const event of stream) {
      first.push(event);
    }
    expect(first).toHaveLength(2);

    // Second iteration should yield nothing
    const second: AgentEvent[] = [];
    for await (const event of stream) {
      second.push(event);
    }
    expect(second).toHaveLength(0);
  });

  it("should handle tool_call_end for unknown id gracefully", async () => {
    const unknownTc: ToolCall = {
      id: "unknown_id",
      name: "read",
      arguments: {},
      result: { content: "ok", isError: false },
    };

    const result = await new PromptStream(eventsFrom([
      toolEnd(unknownTc),
      textDelta("done"),
      turnEnd(),
    ]));

    // Should not crash; the unknown tool_call_end is just ignored
    expect(result.text).toBe("done");
    expect(result.toolCalls).toHaveLength(0);
  });

  it("should handle tool_loop_message events (pass through without special accumulation)", async () => {
    const msg: Message = { role: "assistant", content: "", toolCalls: [] };
    const stream = new PromptStream(eventsFrom([
      toolLoopMessage(msg),
      textDelta("ok"),
      turnEnd(),
    ]));

    const collected: AgentEvent[] = [];
    for await (const event of stream) {
      collected.push(event);
    }
    expect(collected).toHaveLength(3);
    expect(collected[0].type).toBe("tool_loop_message");
    expect(stream.result.text).toBe("ok");
  });
});

// ─── Agent.prompt() integration ─────────────────────────────────────

describe("Agent.prompt()", () => {
  beforeEach(() => {
    mockRunAgent.mockReset();
    sharedStorageState.reset();
  });

  it("should return a PromptStream that can be awaited", async () => {
    mockRunAgent.mockReturnValue(eventsFrom([
      textDelta("Hello from agent"),
      turnEnd(),
    ]));

    const agent = await Agent.create({ apiKey: "test-key" });
    const result = await agent.prompt("Hi");

    expect(result.text).toBe("Hello from agent");
    expect(result.toolCalls).toEqual([]);
  });

  it("should return a PromptStream that can be iterated", async () => {
    mockRunAgent.mockReturnValue(eventsFrom([
      textDelta("chunk1"),
      textDelta("chunk2"),
      turnEnd(),
    ]));

    const agent = await Agent.create({ apiKey: "test-key" });
    const stream = agent.prompt("Hi");

    const deltas: string[] = [];
    for await (const event of stream) {
      if (event.type === "text_delta") deltas.push(event.delta);
    }

    expect(deltas).toEqual(["chunk1", "chunk2"]);
    expect(stream.result.text).toBe("chunk1chunk2");
  });

  it("should add user message to conversation history", async () => {
    mockRunAgent.mockReturnValue(eventsFrom([
      textDelta("response"),
      turnEnd(),
    ]));

    const agent = await Agent.create({ apiKey: "test-key" });
    await agent.prompt("my question");

    const messages = agent.getMessages();
    const userMsg = messages.find(m => m.role === "user");
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).toBe("my question");
  });

  it("should add assistant message to conversation history", async () => {
    mockRunAgent.mockReturnValue(eventsFrom([
      textDelta("my answer"),
      turnEnd(),
    ]));

    const agent = await Agent.create({ apiKey: "test-key" });
    await agent.prompt("question");

    const messages = agent.getMessages();
    const assistantMsg = messages.find(m => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.content).toBe("my answer");
  });

  it("should auto-name thread from first user message", async () => {
    mockRunAgent.mockReturnValue(eventsFrom([textDelta("ok"), turnEnd()]));

    const agent = await Agent.create({ apiKey: "test-key" });
    await agent.prompt("Build me a website");

    const threads = agent.listThreads();
    expect(threads.length).toBeGreaterThan(0);
    expect(threads[0].name).toBe("Build me a website");
  });

  it("should truncate long thread names to 50 chars", async () => {
    mockRunAgent.mockReturnValue(eventsFrom([textDelta("ok"), turnEnd()]));

    const agent = await Agent.create({ apiKey: "test-key" });
    const longMessage = "A".repeat(100);
    await agent.prompt(longMessage);

    const threads = agent.listThreads();
    expect(threads[0].name).toBe("A".repeat(50) + "…");
  });

  it("should expand prompt templates before sending", async () => {
    mockRunAgent.mockReturnValue(eventsFrom([textDelta("ok"), turnEnd()]));

    const agent = await Agent.create({
      apiKey: "test-key",
      promptTemplates: [{
        name: "greet",
        description: "Greet someone",
        body: "Hello $1, nice to meet you!",
      }],
    });

    await agent.prompt("/greet World");

    // The user message should contain the expanded template
    const messages = agent.getMessages();
    const userMsg = messages.find(m => m.role === "user");
    expect(userMsg!.content).toBe("Hello World, nice to meet you!");
  });

  it("should reset all state (threads, VFS, messages)", async () => {
    mockRunAgent.mockReturnValue(eventsFrom([textDelta("hello"), turnEnd()]));

    const agent = await Agent.create({ apiKey: "test-key" });
    const oldThreadId = agent.activeThreadId;

    // Add some data
    await agent.prompt("hi");
    agent.fs.write("/foo.txt", "bar");

    // Verify data exists
    expect(agent.getMessages().some(m => m.role === "user")).toBe(true);
    expect(agent.fs.read("/foo.txt")).toBe("bar");

    // Reset
    await agent.reset();

    // Thread should be new
    expect(agent.activeThreadId).not.toBe(oldThreadId);
    expect(agent.activeThreadId).toBeTruthy();

    // Messages should only have system prompt
    const messages = agent.getMessages();
    expect(messages.length).toBe(1);
    expect(messages[0].role).toBe("system");

    // VFS should be empty
    expect(agent.fs.read("/foo.txt")).toBeUndefined();

    // Should still have exactly one thread
    expect(agent.listThreads().length).toBe(1);
  });

  it("should pass the api key and model to runAgent", async () => {
    mockRunAgent.mockReturnValue(eventsFrom([textDelta("ok"), turnEnd()]));

    const agent = await Agent.create({ apiKey: "my-key", model: "openai/gpt-4" });
    await agent.prompt("test");

    expect(mockRunAgent).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      { apiKey: "my-key", model: "openai/gpt-4" },
      expect.any(AbortSignal),
    );
  });

  it("should pass timeout config to runAgent", async () => {
    mockRunAgent.mockReturnValue(eventsFrom([textDelta("ok"), turnEnd()]));

    const agent = await Agent.create({ apiKey: "key", model: "m", timeout: 5000 });
    await agent.prompt("test");

    expect(mockRunAgent).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      { apiKey: "key", model: "m", timeout: 5000 },
      expect.any(AbortSignal),
    );
  });

  it("should use default model when none is specified", async () => {
    mockRunAgent.mockReturnValue(eventsFrom([textDelta("ok"), turnEnd()]));

    const agent = await Agent.create({ apiKey: "key" });
    await agent.prompt("test");

    expect(mockRunAgent).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      expect.objectContaining({ model: "minimax/minimax-m2.5" }),
      expect.any(AbortSignal),
    );
  });

  it("should not re-name thread on second message", async () => {
    mockRunAgent.mockReturnValue(eventsFrom([textDelta("ok"), turnEnd()]));
    const agent = await Agent.create({ apiKey: "test-key" });

    await agent.prompt("First message");
    const nameAfterFirst = agent.listThreads()[0].name;

    mockRunAgent.mockReturnValue(eventsFrom([textDelta("ok"), turnEnd()]));
    await agent.prompt("Second message");
    const nameAfterSecond = agent.listThreads()[0].name;

    expect(nameAfterFirst).toBe("First message");
    expect(nameAfterSecond).toBe("First message"); // unchanged
  });

  it("should accumulate tool_loop_message events into message history", async () => {
    const assistantToolMsg: Message = {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "tc1", name: "read", arguments: { path: "/x" } }],
    };
    const toolResultMsg: Message = {
      role: "tool",
      content: "file content",
      toolCallId: "tc1",
    };

    mockRunAgent.mockReturnValue(eventsFrom([
      toolLoopMessage(assistantToolMsg),
      toolLoopMessage(toolResultMsg),
      textDelta("Here is the file"),
      turnEnd(),
    ]));

    const agent = await Agent.create({ apiKey: "test-key" });
    await agent.prompt("Read /x");

    const messages = agent.getMessages();
    // system + user + assistant(tool) + tool(result) + assistant(text)
    expect(messages.some(m => m.role === "tool")).toBe(true);
    expect(messages.filter(m => m.role === "assistant").length).toBe(2);
  });

  it("should roll back user message on error when no response was generated", async () => {
    async function* failingGenerator(): AsyncGenerator<AgentEvent> {
      throw new Error("API failure");
    }
    mockRunAgent.mockReturnValue(failingGenerator());

    const agent = await Agent.create({ apiKey: "test-key" });
    const messagesBefore = agent.getMessages().length;

    await expect(agent.prompt("fail")).rejects.toThrow("API failure");

    // The user message should have been rolled back
    expect(agent.getMessages().length).toBe(messagesBefore);
    expect(agent.getMessages().every(m => m.role !== "user")).toBe(true);
  });

  it("should NOT roll back messages on error when partial response exists", async () => {
    async function* partialThenFail(): AsyncGenerator<AgentEvent> {
      yield toolLoopMessage({ role: "assistant", content: "", toolCalls: [] });
      throw new Error("Mid-stream error");
    }
    mockRunAgent.mockReturnValue(partialThenFail());

    const agent = await Agent.create({ apiKey: "test-key" });

    await expect(agent.prompt("test")).rejects.toThrow("Mid-stream error");

    // User message + tool loop message should remain
    const messages = agent.getMessages();
    expect(messages.some(m => m.role === "user")).toBe(true);
  });

  it("should not add assistant message when response is empty", async () => {
    mockRunAgent.mockReturnValue(eventsFrom([turnEnd()]));

    const agent = await Agent.create({ apiKey: "test-key" });
    await agent.prompt("test");

    const messages = agent.getMessages();
    expect(messages.filter(m => m.role === "assistant")).toHaveLength(0);
  });

  it("should not expand non-template input", async () => {
    mockRunAgent.mockReturnValue(eventsFrom([textDelta("ok"), turnEnd()]));

    const agent = await Agent.create({ apiKey: "test-key" });
    await agent.prompt("just a regular message");

    const messages = agent.getMessages();
    const userMsg = messages.find(m => m.role === "user");
    expect(userMsg!.content).toBe("just a regular message");
  });

  it("should use non-matching /command as-is (no template registered)", async () => {
    mockRunAgent.mockReturnValue(eventsFrom([textDelta("ok"), turnEnd()]));

    const agent = await Agent.create({ apiKey: "test-key" });
    await agent.prompt("/unknown command");

    const messages = agent.getMessages();
    const userMsg = messages.find(m => m.role === "user");
    expect(userMsg!.content).toBe("/unknown command");
  });
});

// ─── Agent thread management ────────────────────────────────────────

describe("Agent thread management", () => {
  beforeEach(() => {
    mockRunAgent.mockReset();
    sharedStorageState.reset();
  });

  it("should create a new thread and switch to it", async () => {
    const agent = await Agent.create({ apiKey: "test-key" });
    const originalId = agent.activeThreadId;

    const newId = await agent.newThread("My thread");

    expect(newId).toBeTruthy();
    expect(newId).not.toBe(originalId);
    expect(agent.activeThreadId).toBe(newId);

    // Messages should be fresh (only system prompt)
    const messages = agent.getMessages();
    expect(messages.length).toBe(1);
    expect(messages[0].role).toBe("system");
  });

  it("should create thread with default name", async () => {
    const agent = await Agent.create({ apiKey: "test-key" });
    const newId = await agent.newThread();

    const threads = agent.listThreads();
    const thread = threads.find(t => t.id === newId);
    expect(thread).toBeDefined();
    expect(thread!.name).toBe("New thread");
  });

  it("should switch between threads and restore messages", async () => {
    mockRunAgent.mockReturnValue(eventsFrom([textDelta("reply1"), turnEnd()]));

    const agent = await Agent.create({ apiKey: "test-key" });
    const thread1Id = agent.activeThreadId!;

    // Send a message in thread 1
    await agent.prompt("Hello thread 1");

    // Create thread 2
    const thread2Id = await agent.newThread("Thread 2");
    expect(agent.getMessages().length).toBe(1); // only system

    // Switch back to thread 1
    await agent.switchThread(thread1Id);
    expect(agent.activeThreadId).toBe(thread1Id);

    const messages = agent.getMessages();
    expect(messages.some(m => m.role === "user" && m.content === "Hello thread 1")).toBe(true);
  });

  it("should no-op when switching to already active thread", async () => {
    const agent = await Agent.create({ apiKey: "test-key" });
    const id = agent.activeThreadId!;

    // Should not throw or change anything
    await agent.switchThread(id);
    expect(agent.activeThreadId).toBe(id);
  });

  it("should throw when switching to non-existent thread", async () => {
    const agent = await Agent.create({ apiKey: "test-key" });

    await expect(agent.switchThread("non-existent")).rejects.toThrow("Thread not found");
  });

  it("should delete a thread", async () => {
    const agent = await Agent.create({ apiKey: "test-key" });
    const thread1 = agent.activeThreadId!;
    const thread2 = await agent.newThread("Thread 2");

    // Delete thread 2 (non-active)
    await agent.deleteThread(thread2);
    const threads = agent.listThreads();
    expect(threads.find(t => t.id === thread2)).toBeUndefined();
  });

  it("should create a new thread when deleting the active thread", async () => {
    const agent = await Agent.create({ apiKey: "test-key" });
    const activeId = agent.activeThreadId!;

    await agent.deleteThread(activeId);

    // Should have a new active thread
    expect(agent.activeThreadId).toBeTruthy();
    expect(agent.activeThreadId).not.toBe(activeId);
    expect(agent.listThreads().length).toBe(1);
  });

  it("should rename a thread", async () => {
    const agent = await Agent.create({ apiKey: "test-key" });
    const id = agent.activeThreadId!;

    agent.renameThread(id, "Renamed thread");

    const threads = agent.listThreads();
    expect(threads.find(t => t.id === id)?.name).toBe("Renamed thread");
  });

  it("should silently handle renaming a non-existent thread", async () => {
    const agent = await Agent.create({ apiKey: "test-key" });
    // Should not throw
    agent.renameThread("non-existent", "whatever");
  });

  it("should list multiple threads", async () => {
    const agent = await Agent.create({ apiKey: "test-key" });

    await agent.newThread("Thread 2");
    await agent.newThread("Thread 3");

    const threads = agent.listThreads();
    expect(threads.length).toBe(3);

    const names = threads.map(t => t.name);
    expect(names).toContain("Thread 2");
    expect(names).toContain("Thread 3");
  });
});

// ─── Agent tools & extensions ───────────────────────────────────────

describe("Agent tools", () => {
  beforeEach(() => {
    mockRunAgent.mockReset();
    sharedStorageState.reset();
  });

  it("should include builtin VFS tools", async () => {
    const agent = await Agent.create({ apiKey: "test-key" });
    const toolNames = agent.tools.map(t => t.name);
    expect(toolNames).toContain("read");
    expect(toolNames).toContain("write");
    expect(toolNames).toContain("edit");
    expect(toolNames).toContain("list");
  });

  it("should include read_skill tool when skills are registered", async () => {
    const agent = await Agent.create({
      apiKey: "test-key",
      skills: [{
        name: "test-skill",
        description: "A test skill",
        content: "# Test instructions",
      }],
    });

    const toolNames = agent.tools.map(t => t.name);
    expect(toolNames).toContain("read_skill");
  });

  it("should NOT include read_skill tool when no skills are registered", async () => {
    const agent = await Agent.create({ apiKey: "test-key" });
    const toolNames = agent.tools.map(t => t.name);
    expect(toolNames).not.toContain("read_skill");
  });

  it("should include tools registered by extensions", async () => {
    const agent = await Agent.create({
      apiKey: "test-key",
      extensions: [
        (host) => {
          host.registerTool({
            name: "custom_tool",
            description: "A custom tool",
            parameters: { type: "object", properties: {} },
            execute: async () => ({ content: "ok", isError: false }),
          });
        },
      ],
    });

    const toolNames = agent.tools.map(t => t.name);
    expect(toolNames).toContain("custom_tool");
  });
});

describe("Agent dynamic extensions", () => {
  beforeEach(() => {
    mockRunAgent.mockReset();
    sharedStorageState.reset();
  });

  it("should add an extension dynamically from source code", async () => {
    const agent = await Agent.create({ apiKey: "test-key" });

    const source = `(agent) => {
      agent.registerTool({
        name: "hello_tool",
        description: "Says hello",
        parameters: { type: "object", properties: {} },
        execute: async () => ({ content: "hello!", isError: false }),
      });
    }`;

    await agent.addExtension(source, "hello-ext");

    const toolNames = agent.tools.map(t => t.name);
    expect(toolNames).toContain("hello_tool");

    // Should persist to VFS
    const vfsContent = agent.fs.read("/.tau/extensions/hello-ext.js");
    expect(vfsContent).toBe(source);
  });

  it("should reject extension source that is not a function", async () => {
    const agent = await Agent.create({ apiKey: "test-key" });

    await expect(agent.addExtension('"not a function"', "bad")).rejects.toThrow(
      "must evaluate to a function"
    );
  });

  it("should remove a dynamically added extension", async () => {
    const agent = await Agent.create({ apiKey: "test-key" });

    const source = `(agent) => {
      agent.registerTool({
        name: "removable_tool",
        description: "Will be removed",
        parameters: { type: "object", properties: {} },
        execute: async () => ({ content: "ok", isError: false }),
      });
    }`;

    await agent.addExtension(source, "removable");
    expect(agent.tools.map(t => t.name)).toContain("removable_tool");

    await agent.removeExtension("removable");
    expect(agent.tools.map(t => t.name)).not.toContain("removable_tool");

    // VFS file should be gone
    expect(agent.fs.read("/.tau/extensions/removable.js")).toBeUndefined();
  });
});

// ─── Agent dynamic skills ───────────────────────────────────────────

describe("Agent dynamic skills", () => {
  beforeEach(() => {
    mockRunAgent.mockReset();
    sharedStorageState.reset();
  });

  it("should add a skill dynamically and persist to VFS", async () => {
    const agent = await Agent.create({ apiKey: "test-key" });

    await agent.addSkill({
      name: "new-skill",
      description: "A dynamically added skill",
      content: "# Dynamic skill content",
    });

    expect(agent.skills.get("new-skill")).toBeDefined();
    expect(agent.tools.map(t => t.name)).toContain("read_skill");

    // Should persist to VFS
    const vfsContent = agent.fs.read("/.tau/skills/new-skill.md");
    expect(vfsContent).toContain("new-skill");
    expect(vfsContent).toContain("# Dynamic skill content");
  });

  it("should remove a skill dynamically and remove from VFS", async () => {
    const agent = await Agent.create({ apiKey: "test-key" });

    await agent.addSkill({
      name: "temp-skill",
      description: "Temporary",
      content: "# Temp",
    });

    await agent.removeSkill("temp-skill");

    expect(agent.skills.get("temp-skill")).toBeUndefined();
    expect(agent.fs.read("/.tau/skills/temp-skill.md")).toBeUndefined();
  });
});

// ─── Agent serialize ────────────────────────────────────────────────

describe("Agent.serialize()", () => {
  beforeEach(() => {
    mockRunAgent.mockReset();
    sharedStorageState.reset();
  });

  it("should serialize messages and filesystem state", async () => {
    mockRunAgent.mockReturnValue(eventsFrom([textDelta("ok"), turnEnd()]));

    const agent = await Agent.create({ apiKey: "test-key" });
    agent.fs.write("/test.txt", "content");
    await agent.prompt("hello");

    const serialized = agent.serialize();

    expect(serialized.messages).toBeInstanceOf(Array);
    expect(serialized.messages.length).toBeGreaterThan(1);
    expect(serialized.fs).toHaveProperty("/test.txt", "content");
  });

  it("should return a copy (not a reference) of messages", async () => {
    const agent = await Agent.create({ apiKey: "test-key" });
    const serialized = agent.serialize();

    serialized.messages.push({ role: "user", content: "injected" });
    expect(agent.getMessages().length).toBe(1); // still just system
  });
});

// ─── Agent abort ────────────────────────────────────────────────────

describe("Agent.abort()", () => {
  beforeEach(() => {
    mockRunAgent.mockReset();
    sharedStorageState.reset();
  });

  it("should abort an in-flight request", async () => {
    let signalReceived: AbortSignal | undefined;

    async function* slowGenerator(): AsyncGenerator<AgentEvent> {
      // Capture the signal from the mock call
      signalReceived = mockRunAgent.mock.calls[0]?.[3] as AbortSignal;
      yield textDelta("partial");
      // Simulate slow response
      await new Promise(resolve => setTimeout(resolve, 100));
      yield textDelta(" more");
      yield turnEnd();
    }

    mockRunAgent.mockReturnValue(slowGenerator());

    const agent = await Agent.create({ apiKey: "test-key" });
    const stream = agent.prompt("test");

    // Start iterating but abort quickly
    const events: AgentEvent[] = [];
    try {
      for await (const event of stream) {
        events.push(event);
        if (events.length === 1) {
          agent.abort();
        }
      }
    } catch {
      // Expected: abort may cause an error
    }

    // The signal should have been aborted
    expect(signalReceived?.aborted).toBe(true);
  });

  it("should be safe to call abort when nothing is running", async () => {
    const agent = await Agent.create({ apiKey: "test-key" });
    // Should not throw
    agent.abort();
  });
});

// ─── Agent event subscription ───────────────────────────────────────

describe("Agent event handling", () => {
  beforeEach(() => {
    mockRunAgent.mockReset();
    sharedStorageState.reset();
  });

  it("should emit events to subscribers via on()", async () => {
    mockRunAgent.mockReturnValue(eventsFrom([
      textDelta("hello"),
      turnEnd(),
    ]));

    const agent = await Agent.create({ apiKey: "test-key" });

    const received: AgentEvent[] = [];
    agent.on("agent_event", (e) => received.push(e));

    await agent.prompt("test");

    expect(received.length).toBeGreaterThanOrEqual(2);
    expect(received[0]).toEqual({ type: "text_delta", delta: "hello" });
  });

  it("should support unsubscribing from events", async () => {
    mockRunAgent.mockReturnValue(eventsFrom([
      textDelta("hello"),
      turnEnd(),
    ]));

    const agent = await Agent.create({ apiKey: "test-key" });

    const received: AgentEvent[] = [];
    const unsub = agent.on("agent_event", (e) => received.push(e));
    unsub(); // unsubscribe immediately

    await agent.prompt("test");

    expect(received).toHaveLength(0);
  });
});

// ─── Agent user input handler ───────────────────────────────────────

describe("Agent user input", () => {
  beforeEach(() => {
    sharedStorageState.reset();
  });

  it("should delegate requestUserInput to the handler", async () => {
    const agent = await Agent.create({ apiKey: "test-key" });

    agent.setUserInputHandler(async (req) => {
      return { answer: "42" };
    });

    const response = await agent.requestUserInput({
      question: "What is the answer?",
    });

    expect(response).toEqual({ answer: "42" });
  });

  it("should reject requestUserInput when no handler is set", async () => {
    const agent = await Agent.create({ apiKey: "test-key" });

    await expect(agent.requestUserInput({ question: "test" })).rejects.toThrow(
      "No user input handler"
    );
  });
});

// ─── Agent system prompt with skills ────────────────────────────────

describe("Agent system prompt", () => {
  beforeEach(() => {
    mockRunAgent.mockReset();
    sharedStorageState.reset();
  });

  it("should include skill descriptions in system prompt", async () => {
    const agent = await Agent.create({
      apiKey: "test-key",
      skills: [{
        name: "code-review",
        description: "Review code for quality",
        content: "# Review instructions",
      }],
    });

    const messages = agent.getMessages();
    const systemMsg = messages[0];
    expect(systemMsg.role).toBe("system");
    expect(systemMsg.content).toContain("code-review");
    expect(systemMsg.content).toContain("Review code for quality");
  });

  it("should use custom system prompt when provided", async () => {
    const agent = await Agent.create({
      apiKey: "test-key",
      systemPrompt: "You are a helpful bot.",
    });

    const messages = agent.getMessages();
    expect(messages[0].content).toBe("You are a helpful bot.");
  });

  it("should rebuild system prompt on each prompt to reflect new skills", async () => {
    mockRunAgent.mockReturnValue(eventsFrom([textDelta("ok"), turnEnd()]));

    const agent = await Agent.create({ apiKey: "test-key" });

    // Initially no skills in system prompt
    expect(agent.getMessages()[0].content).not.toContain("available_skills");

    // Add a skill dynamically
    await agent.addSkill({
      name: "dynamic",
      description: "Dynamic skill",
      content: "# Dynamic",
    });

    // Prompt to trigger system prompt rebuild
    await agent.prompt("test");

    const messages = agent.getMessages();
    expect(messages[0].content).toContain("dynamic");
    expect(messages[0].content).toContain("available_skills");
  });
});

// ─── Agent.fs access ────────────────────────────────────────────────

describe("Agent.fs", () => {
  beforeEach(() => {
    sharedStorageState.reset();
  });

  it("should expose the virtual filesystem", async () => {
    const agent = await Agent.create({ apiKey: "test-key" });

    agent.fs.write("/test.txt", "hello");
    expect(agent.fs.read("/test.txt")).toBe("hello");
  });
});

// ─── Agent config extensions ────────────────────────────────────────

describe("Agent config extensions", () => {
  beforeEach(() => {
    mockRunAgent.mockReset();
    sharedStorageState.reset();
  });

  it("should load config extensions on create", async () => {
    let extensionLoaded = false;

    const agent = await Agent.create({
      apiKey: "test-key",
      extensions: [
        (host) => {
          extensionLoaded = true;
        },
      ],
    });

    expect(extensionLoaded).toBe(true);
  });

  it("should re-load config extensions after reset", async () => {
    let loadCount = 0;

    const agent = await Agent.create({
      apiKey: "test-key",
      extensions: [
        (host) => {
          loadCount++;
        },
      ],
    });

    expect(loadCount).toBe(1);

    await agent.reset();
    expect(loadCount).toBe(2);
  });

  it("should support async extensions", async () => {
    let extensionLoaded = false;

    const agent = await Agent.create({
      apiKey: "test-key",
      extensions: [
        async (host) => {
          await new Promise(resolve => setTimeout(resolve, 10));
          extensionLoaded = true;
        },
      ],
    });

    expect(extensionLoaded).toBe(true);
  });
});

// ─── Persistence and restoration ────────────────────────────────────

describe("Agent persistence and restoration", () => {
  beforeEach(() => {
    mockRunAgent.mockReset();
    sharedStorageState.reset();
  });

  it("should restore VFS extensions on create when VFS has persisted extensions", async () => {
    // Pre-populate storage with VFS containing an extension
    const extensionSource = `(agent) => {
      agent.registerTool({
        name: "restored_tool",
        description: "Restored from VFS",
        parameters: { type: "object", properties: {} },
        execute: async () => ({ content: "restored!", isError: false }),
      });
    }`;

    sharedStorageState.vfs = {
      "/.tau/extensions/restored-ext.js": extensionSource,
    };

    const agent = await Agent.create({ apiKey: "test-key" });

    const toolNames = agent.tools.map(t => t.name);
    expect(toolNames).toContain("restored_tool");
  });

  it("should restore VFS skills on create when VFS has persisted skills", async () => {
    // Pre-populate storage with VFS containing a skill
    sharedStorageState.vfs = {
      "/.tau/skills/persisted-skill.md": "---\nname: persisted-skill\ndescription: A persisted skill\n---\n# Persisted skill content\n",
    };

    const agent = await Agent.create({ apiKey: "test-key" });

    expect(agent.skills.get("persisted-skill")).toBeDefined();
    expect(agent.skills.get("persisted-skill")!.content).toBe("# Persisted skill content");
    expect(agent.tools.map(t => t.name)).toContain("read_skill");
  });

  it("should gracefully handle invalid extension in VFS", async () => {
    // Pre-populate with broken extension source
    sharedStorageState.vfs = {
      "/.tau/extensions/broken.js": "this is not valid JS function",
    };

    // Should not throw
    const agent = await Agent.create({ apiKey: "test-key" });

    // Agent should still work, broken extension just skipped
    const toolNames = agent.tools.map(t => t.name);
    expect(toolNames).toContain("read"); // builtins still work
  });

  it("should skip non-.js files in extensions directory", async () => {
    sharedStorageState.vfs = {
      "/.tau/extensions/readme.txt": "not an extension",
    };

    const agent = await Agent.create({ apiKey: "test-key" });
    // Should not throw, and no extra tools
    expect(agent.tools.map(t => t.name)).not.toContain("readme");
  });

  it("should skip non-.md files in skills directory", async () => {
    sharedStorageState.vfs = {
      "/.tau/skills/notes.txt": "not a skill",
    };

    const agent = await Agent.create({ apiKey: "test-key" });
    expect(agent.skills.getAll()).toHaveLength(0);
  });

  it("should restore active thread with messages from storage", async () => {
    // Pre-populate storage with an existing thread and messages
    const threadId = "test-thread";
    sharedStorageState.threads.set(threadId, {
      id: threadId,
      name: "Restored thread",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    sharedStorageState.messages.set(threadId, [
      { role: "system", content: "System prompt" },
      { role: "user", content: "Previous question" },
      { role: "assistant", content: "Previous answer" },
    ]);
    sharedStorageState.activeId = threadId;

    const agent = await Agent.create({ apiKey: "test-key" });

    expect(agent.activeThreadId).toBe(threadId);
    const messages = agent.getMessages();
    expect(messages.length).toBe(3);
    expect(messages[1].content).toBe("Previous question");
    expect(messages[2].content).toBe("Previous answer");
  });

  it("should mark _isFirstUserMessage=false when restoring thread with user messages", async () => {
    // Pre-populate with a thread that already has a user message
    const threadId = "existing-thread";
    sharedStorageState.threads.set(threadId, {
      id: threadId,
      name: "Existing thread",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    sharedStorageState.messages.set(threadId, [
      { role: "system", content: "System prompt" },
      { role: "user", content: "Already asked" },
    ]);
    sharedStorageState.activeId = threadId;

    mockRunAgent.mockReturnValue(eventsFrom([textDelta("ok"), turnEnd()]));

    const agent = await Agent.create({ apiKey: "test-key" });
    await agent.prompt("Second message");

    // Thread name should NOT have been renamed to "Second message"
    // because it's not the first user message
    const thread = agent.listThreads().find(t => t.id === threadId);
    expect(thread!.name).toBe("Existing thread");
  });

  it("should create fresh thread if stored active thread does not exist", async () => {
    // Set an active ID that doesn't have a matching thread
    sharedStorageState.activeId = "deleted-thread-id";

    const agent = await Agent.create({ apiKey: "test-key" });

    // Should have created a new thread
    expect(agent.activeThreadId).toBeTruthy();
    expect(agent.activeThreadId).not.toBe("deleted-thread-id");
    expect(agent.listThreads().length).toBe(1);
  });

  it("should restore VFS and rebuild builtin tools from persisted VFS", async () => {
    // Pre-populate VFS with a file
    sharedStorageState.vfs = {
      "/hello.txt": "world",
    };

    const agent = await Agent.create({ apiKey: "test-key" });

    // The VFS should have been restored
    expect(agent.fs.read("/hello.txt")).toBe("world");

    // Builtin tools should work against the restored VFS
    const readTool = agent.tools.find(t => t.name === "read");
    const result = await readTool!.execute({ path: "/hello.txt" });
    expect(result.content).toBe("world");
    expect(result.isError).toBe(false);
  });

  it("should persist messages after each prompt turn", async () => {
    mockRunAgent.mockReturnValue(eventsFrom([textDelta("reply"), turnEnd()]));

    const agent = await Agent.create({ apiKey: "test-key" });
    const threadId = agent.activeThreadId!;

    await agent.prompt("hello");

    // Check that messages were saved to storage
    const savedMessages = sharedStorageState.messages.get(threadId) as any[];
    expect(savedMessages).toBeDefined();
    expect(savedMessages.length).toBeGreaterThan(1);
    expect(savedMessages.some((m: any) => m.role === "user" && m.content === "hello")).toBe(true);
  });

  it("should switch thread and restore messages from storage (empty thread)", async () => {
    const agent = await Agent.create({ apiKey: "test-key" });
    const thread1 = agent.activeThreadId!;

    // Create a second thread with no messages in storage
    const thread2Id = "empty-thread";
    sharedStorageState.threads.set(thread2Id, {
      id: thread2Id,
      name: "Empty thread",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    // Don't put any messages in storage for this thread

    await agent.switchThread(thread2Id);

    // Should have fresh messages (just system prompt)
    const messages = agent.getMessages();
    expect(messages.length).toBe(1);
    expect(messages[0].role).toBe("system");
  });

  it("should update thread updatedAt on persist", async () => {
    mockRunAgent.mockReturnValue(eventsFrom([textDelta("ok"), turnEnd()]));

    const agent = await Agent.create({ apiKey: "test-key" });
    const threadId = agent.activeThreadId!;
    const initialUpdatedAt = sharedStorageState.threads.get(threadId)!.updatedAt;

    // Wait a tiny bit to ensure timestamp changes
    await new Promise(resolve => setTimeout(resolve, 5));
    await agent.prompt("update time");

    const finalUpdatedAt = sharedStorageState.threads.get(threadId)!.updatedAt;
    expect(finalUpdatedAt).toBeGreaterThanOrEqual(initialUpdatedAt);
  });

  it("should persist VFS when adding/removing extensions", async () => {
    const agent = await Agent.create({ apiKey: "test-key" });

    const source = `(agent) => {
      agent.registerTool({
        name: "vfs_tool",
        description: "test",
        parameters: { type: "object", properties: {} },
        execute: async () => ({ content: "ok", isError: false }),
      });
    }`;

    await agent.addExtension(source, "vfs-ext");

    // VFS should be persisted to storage
    expect(sharedStorageState.vfs["/.tau/extensions/vfs-ext.js"]).toBe(source);

    await agent.removeExtension("vfs-ext");
    expect(sharedStorageState.vfs["/.tau/extensions/vfs-ext.js"]).toBeUndefined();
  });

  it("should persist VFS when adding/removing skills", async () => {
    const agent = await Agent.create({ apiKey: "test-key" });

    await agent.addSkill({
      name: "vfs-skill",
      description: "A skill",
      content: "# Content",
    });

    expect(sharedStorageState.vfs["/.tau/skills/vfs-skill.md"]).toContain("vfs-skill");

    await agent.removeSkill("vfs-skill");
    expect(sharedStorageState.vfs["/.tau/skills/vfs-skill.md"]).toBeUndefined();
  });
});

// ─── Assertions on what's sent to the LLM ───────────────────────────

describe("Agent → runAgent call verification", () => {
  beforeEach(() => {
    mockRunAgent.mockReset();
    sharedStorageState.reset();
  });

  it("should send system + user messages to runAgent", async () => {
    mockRunAgent.mockReturnValue(eventsFrom([textDelta("ok"), turnEnd()]));

    const agent = await Agent.create({ apiKey: "test-key" });
    await agent.prompt("Hello there");

    expect(mockRunAgent).toHaveBeenCalledOnce();
    const [messages] = mockRunAgent.mock.calls[0] as [Message[], any, any, any];
    // system + user (the user message is pushed before calling runAgent)
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages[0].role).toBe("system");
    // Find the user message (it may be at index 1 or later)
    const userMsg = messages.find((m: Message) => m.role === "user");
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).toBe("Hello there");
  });

  it("should send expanded template text, not raw /command", async () => {
    mockRunAgent.mockReturnValue(eventsFrom([textDelta("ok"), turnEnd()]));

    const agent = await Agent.create({
      apiKey: "test-key",
      promptTemplates: [{
        name: "greet",
        description: "Greet someone",
        body: "Hello $1!",
      }],
    });

    await agent.prompt("/greet World");

    const [messages] = mockRunAgent.mock.calls[0] as [Message[], any, any, any];
    const userMsg = messages.find((m: Message) => m.role === "user");
    expect(userMsg!.content).toBe("Hello World!");
  });

  it("should include all registered tools in the tools array", async () => {
    mockRunAgent.mockReturnValue(eventsFrom([textDelta("ok"), turnEnd()]));

    const agent = await Agent.create({
      apiKey: "test-key",
      extensions: [
        (host) => {
          host.registerTool({
            name: "custom_tool",
            description: "Custom",
            parameters: { type: "object", properties: {} },
            execute: async () => ({ content: "ok", isError: false }),
          });
        },
      ],
    });
    await agent.prompt("test");

    const [, tools] = mockRunAgent.mock.calls[0] as [any, any[], any, any];
    const toolNames = tools.map((t: any) => t.name);
    expect(toolNames).toContain("read");
    expect(toolNames).toContain("write");
    expect(toolNames).toContain("edit");
    expect(toolNames).toContain("list");
    expect(toolNames).toContain("custom_tool");
  });

  it("should include read_skill tool when skills are present", async () => {
    mockRunAgent.mockReturnValue(eventsFrom([textDelta("ok"), turnEnd()]));

    const agent = await Agent.create({
      apiKey: "test-key",
      skills: [{
        name: "my-skill",
        description: "My skill",
        content: "# Content",
      }],
    });
    await agent.prompt("test");

    const [, tools] = mockRunAgent.mock.calls[0] as [any, any[], any, any];
    const toolNames = tools.map((t: any) => t.name);
    expect(toolNames).toContain("read_skill");
  });

  it("should NOT include read_skill tool when no skills exist", async () => {
    mockRunAgent.mockReturnValue(eventsFrom([textDelta("ok"), turnEnd()]));

    const agent = await Agent.create({ apiKey: "test-key" });
    await agent.prompt("test");

    const [, tools] = mockRunAgent.mock.calls[0] as [any, any[], any, any];
    const toolNames = tools.map((t: any) => t.name);
    expect(toolNames).not.toContain("read_skill");
  });

  it("should pass correct options (apiKey, model, timeout)", async () => {
    mockRunAgent.mockReturnValue(eventsFrom([textDelta("ok"), turnEnd()]));

    const agent = await Agent.create({
      apiKey: "my-key",
      model: "anthropic/claude-sonnet-4",
      timeout: 30000,
    });
    await agent.prompt("test");

    const [, , options] = mockRunAgent.mock.calls[0] as [any, any, any, any];
    expect(options).toEqual({
      apiKey: "my-key",
      model: "anthropic/claude-sonnet-4",
      timeout: 30000,
    });
  });

  it("should send conversation history on second prompt", async () => {
    // Capture the messages at the time runAgent is called (before mutation)
    const capturedMessages: Message[][] = [];
    mockRunAgent.mockImplementation((...args: any[]) => {
      capturedMessages.push([...(args[0] as Message[])]);
      return eventsFrom([textDelta("First reply"), turnEnd()]);
    });

    const agent = await Agent.create({ apiKey: "test-key" });
    await agent.prompt("First question");

    mockRunAgent.mockImplementation((...args: any[]) => {
      capturedMessages.push([...(args[0] as Message[])]);
      return eventsFrom([textDelta("Second reply"), turnEnd()]);
    });
    await agent.prompt("Second question");

    // Second call should have: system + user1 + assistant1 + user2
    const msgs = capturedMessages[1];
    expect(msgs).toHaveLength(4);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].role).toBe("user");
    expect(msgs[1].content).toBe("First question");
    expect(msgs[2].role).toBe("assistant");
    expect(msgs[2].content).toBe("First reply");
    expect(msgs[3].role).toBe("user");
    expect(msgs[3].content).toBe("Second question");
  });

  it("should include tool loop messages in history for subsequent calls", async () => {
    const assistantToolMsg: Message = {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "tc1", name: "read", arguments: { path: "/x" } }],
    };
    const toolResultMsg: Message = {
      role: "tool",
      content: "file content",
      toolCallId: "tc1",
    };

    mockRunAgent.mockReturnValue(eventsFrom([
      toolLoopMessage(assistantToolMsg),
      toolLoopMessage(toolResultMsg),
      textDelta("Here is the file"),
      turnEnd(),
    ]));

    const agent = await Agent.create({ apiKey: "test-key" });
    await agent.prompt("Read /x");

    mockRunAgent.mockReturnValue(eventsFrom([textDelta("Sure"), turnEnd()]));
    await agent.prompt("Thanks");

    const [messages] = mockRunAgent.mock.calls[1] as [Message[], any, any, any];
    // Verify the conversation history contains tool loop messages
    const assistantMsgs = messages.filter((m: Message) => m.role === "assistant");
    const toolMsgs = messages.filter((m: Message) => m.role === "tool");
    const userMsgs = messages.filter((m: Message) => m.role === "user");

    // Should have 2 assistant messages (one with toolCalls, one with text)
    expect(assistantMsgs.length).toBeGreaterThanOrEqual(2);
    // The first assistant message should have tool calls
    const assistantWithTools = assistantMsgs.find((m: Message) => m.toolCalls && m.toolCalls.length > 0);
    expect(assistantWithTools).toBeDefined();
    expect(assistantWithTools!.toolCalls![0].name).toBe("read");

    // Should have the tool result
    expect(toolMsgs).toHaveLength(1);
    expect(toolMsgs[0].toolCallId).toBe("tc1");

    // Should have the final assistant text
    const textAssistant = assistantMsgs.find((m: Message) => m.content === "Here is the file");
    expect(textAssistant).toBeDefined();

    // Should have 2 user messages
    expect(userMsgs).toHaveLength(2);
  });

  it("should pass an AbortSignal to runAgent", async () => {
    mockRunAgent.mockReturnValue(eventsFrom([textDelta("ok"), turnEnd()]));

    const agent = await Agent.create({ apiKey: "test-key" });
    await agent.prompt("test");

    const [, , , signal] = mockRunAgent.mock.calls[0] as [any, any, any, AbortSignal];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
  });

  it("should include skill descriptions in system prompt sent to runAgent", async () => {
    mockRunAgent.mockReturnValue(eventsFrom([textDelta("ok"), turnEnd()]));

    const agent = await Agent.create({
      apiKey: "test-key",
      skills: [{
        name: "code-review",
        description: "Review code for quality",
        content: "# Review instructions",
      }],
    });
    await agent.prompt("test");

    const [messages] = mockRunAgent.mock.calls[0] as [Message[], any, any, any];
    const systemMsg = messages[0];
    expect(systemMsg.role).toBe("system");
    expect(systemMsg.content).toContain("code-review");
    expect(systemMsg.content).toContain("available_skills");
  });

  it("should reflect dynamically added skills in system prompt on next prompt", async () => {
    mockRunAgent.mockReturnValue(eventsFrom([textDelta("ok"), turnEnd()]));

    const agent = await Agent.create({ apiKey: "test-key" });
    await agent.prompt("before skill");

    // System prompt should NOT mention any skills
    const [messagesBefore] = mockRunAgent.mock.calls[0] as [Message[], any, any, any];
    expect(messagesBefore[0].content).not.toContain("available_skills");

    // Add skill dynamically
    await agent.addSkill({
      name: "dynamic-skill",
      description: "Dynamically added",
      content: "# Dynamic",
    });

    mockRunAgent.mockReturnValue(eventsFrom([textDelta("ok"), turnEnd()]));
    await agent.prompt("after skill");

    // Now system prompt should include the skill
    const [messagesAfter] = mockRunAgent.mock.calls[1] as [Message[], any, any, any];
    expect(messagesAfter[0].content).toContain("dynamic-skill");
    expect(messagesAfter[0].content).toContain("available_skills");
  });
});
