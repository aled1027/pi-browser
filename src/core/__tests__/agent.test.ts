import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentEvent, ToolCall } from "../types.js";
import { PromptStream } from "../agent.js";

// ─── Mock openrouter ────────────────────────────────────────────────

const mockRunAgent = vi.fn<() => AsyncGenerator<AgentEvent>>();

vi.mock("../openrouter.js", () => ({
  runAgent: (...args: unknown[]) => mockRunAgent(...(args as [])),
}));

// ─── Mock storage (avoid IndexedDB / localStorage in tests) ────────

vi.mock("../storage.js", () => {
  class FakeThreadStorage {
    private threads = new Map<string, { id: string; name: string; createdAt: number; updatedAt: number }>();
    private messages = new Map<string, unknown[]>();
    private activeId: string | null = null;
    private vfs: Record<string, string> = {};

    listThreads() { return [...this.threads.values()].sort((a, b) => b.updatedAt - a.updatedAt); }
    getThread(id: string) { return this.threads.get(id); }
    saveThread(meta: { id: string; name: string; createdAt: number; updatedAt: number }) { this.threads.set(meta.id, meta); }
    async deleteThread(id: string) { this.threads.delete(id); this.messages.delete(id); }
    getActiveThreadId() { return this.activeId; }
    setActiveThreadId(id: string | null) { this.activeId = id; }
    async saveMessages(threadId: string, msgs: unknown[]) { this.messages.set(threadId, msgs); }
    async getMessages(threadId: string) { return this.messages.get(threadId) ?? []; }
    async saveVFS(files: Record<string, string>) { this.vfs = files; }
    async loadVFS() { return this.vfs; }
    async clearAll() { this.threads.clear(); this.messages.clear(); this.activeId = null; this.vfs = {}; }
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
});

// ─── Agent.prompt() integration ─────────────────────────────────────

describe("Agent.prompt()", () => {
  beforeEach(() => {
    mockRunAgent.mockReset();
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
      expect.any(Function),
      { apiKey: "my-key", model: "openai/gpt-4" },
      expect.any(AbortSignal),
    );
  });
});
