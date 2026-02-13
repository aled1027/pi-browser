/**
 * Tests for openrouter.ts — SSE parsing, request construction, error handling,
 * tool call execution, and the tool loop.
 *
 * We mock `fetch` globally so no real network calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AgentEvent, Message, ToolDefinition } from "../types.js";

// We need to import after setting up the fetch mock
const { runAgent } = await import("../openrouter.js");

// ─── Helpers ────────────────────────────────────────────────────────

/** Build a ReadableStream that yields SSE lines from an array of data payloads */
function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const lines = chunks.map((c) => `data: ${c}\n\n`);
  lines.push("data: [DONE]\n\n");
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line));
      }
      controller.close();
    },
  });
}

/** Build a single SSE chunk with a text delta */
function textChunk(content: string) {
  return JSON.stringify({
    choices: [{ delta: { content } }],
  });
}

/** Build an SSE chunk that starts a tool call */
function toolCallStartChunk(index: number, id: string, name: string, argsFragment = "") {
  return JSON.stringify({
    choices: [{
      delta: {
        tool_calls: [{
          index,
          id,
          function: { name, arguments: argsFragment },
        }],
      },
    }],
  });
}

/** Build an SSE chunk that continues a tool call's arguments */
function toolCallArgsChunk(index: number, argsFragment: string) {
  return JSON.stringify({
    choices: [{
      delta: {
        tool_calls: [{
          index,
          function: { arguments: argsFragment },
        }],
      },
    }],
  });
}

function makeTool(name: string, result = "ok"): ToolDefinition {
  return {
    name,
    description: `Tool ${name}`,
    parameters: { type: "object", properties: {} },
    execute: vi.fn(async () => ({ content: result, isError: false })),
  };
}

function makeMessages(): Message[] {
  return [
    { role: "system", content: "You are helpful." },
    { role: "user", content: "Hello" },
  ];
}

/** Collect all events from runAgent */
async function collectEvents(
  messages: Message[],
  tools: ToolDefinition[],
  options: { apiKey: string; model: string; timeout?: number },
  signal?: AbortSignal
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of runAgent(messages, tools, options, signal)) {
    events.push(event);
  }
  return events;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("runAgent", () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ── Request construction ─────────────────────────────────────────

  describe("request construction", () => {
    it("should send correct headers and body to OpenRouter", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: sseStream([textChunk("hi")]),
      });

      await collectEvents(makeMessages(), [], { apiKey: "sk-test", model: "openai/gpt-4" });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect(init.method).toBe("POST");
      expect(init.headers.Authorization).toBe("Bearer sk-test");
      expect(init.headers["Content-Type"]).toBe("application/json");
      expect(init.headers["X-Title"]).toBe("tau");

      const body = JSON.parse(init.body);
      expect(body.model).toBe("openai/gpt-4");
      expect(body.stream).toBe(true);
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[1].role).toBe("user");
    });

    it("should include tools in OpenAI format when provided", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: sseStream([textChunk("done")]),
      });

      const tool = makeTool("read_file");
      await collectEvents(makeMessages(), [tool], { apiKey: "k", model: "m" });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0].type).toBe("function");
      expect(body.tools[0].function.name).toBe("read_file");
    });

    it("should omit tools field when no tools provided", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: sseStream([textChunk("hi")]),
      });

      await collectEvents(makeMessages(), [], { apiKey: "k", model: "m" });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools).toBeUndefined();
    });

    it("should convert assistant messages with toolCalls to OpenAI format", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: sseStream([textChunk("ok")]),
      });

      const messages: Message[] = [
        { role: "system", content: "sys" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "tc_1", name: "read", arguments: { path: "/a" } }],
        },
        { role: "tool", content: "file content", toolCallId: "tc_1" },
        { role: "user", content: "thanks" },
      ];

      await collectEvents(messages, [], { apiKey: "k", model: "m" });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      // Assistant message should have tool_calls and null content
      const assistantMsg = body.messages[1];
      expect(assistantMsg.tool_calls).toHaveLength(1);
      expect(assistantMsg.tool_calls[0].id).toBe("tc_1");
      expect(assistantMsg.tool_calls[0].function.name).toBe("read");
      expect(assistantMsg.tool_calls[0].function.arguments).toBe('{"path":"/a"}');
      expect(assistantMsg.content).toBeNull();

      // Tool message should have tool_call_id
      const toolMsg = body.messages[2];
      expect(toolMsg.tool_call_id).toBe("tc_1");
    });
  });

  // ── SSE parsing ──────────────────────────────────────────────────

  describe("SSE parsing", () => {
    it("should yield text_delta events from streamed content", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: sseStream([textChunk("Hello"), textChunk(" world")]),
      });

      const events = await collectEvents(makeMessages(), [], { apiKey: "k", model: "m" });

      expect(events.filter((e) => e.type === "text_delta")).toHaveLength(2);
      expect(events[0]).toEqual({ type: "text_delta", delta: "Hello" });
      expect(events[1]).toEqual({ type: "text_delta", delta: " world" });
      expect(events[2]).toEqual({ type: "turn_end" });
    });

    it("should handle empty stream gracefully", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: sseStream([]),
      });

      const events = await collectEvents(makeMessages(), [], { apiKey: "k", model: "m" });
      expect(events).toEqual([{ type: "turn_end" }]);
    });

    it("should skip malformed JSON in SSE chunks", async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode("data: {invalid json}\n\n"));
          controller.enqueue(encoder.encode(`data: ${textChunk("ok")}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });

      mockFetch.mockResolvedValue({ ok: true, body: stream });

      const events = await collectEvents(makeMessages(), [], { apiKey: "k", model: "m" });
      const textDeltas = events.filter((e) => e.type === "text_delta");
      expect(textDeltas).toHaveLength(1);
    });

    it("should skip SSE lines that don't start with 'data: '", async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(": comment\n\n"));
          controller.enqueue(encoder.encode("event: ping\n\n"));
          controller.enqueue(encoder.encode(`data: ${textChunk("hi")}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });

      mockFetch.mockResolvedValue({ ok: true, body: stream });

      const events = await collectEvents(makeMessages(), [], { apiKey: "k", model: "m" });
      expect(events.filter((e) => e.type === "text_delta")).toHaveLength(1);
    });

    it("should handle chunks split across read() boundaries", async () => {
      const encoder = new TextEncoder();
      const full = `data: ${textChunk("Hello")}\n\ndata: ${textChunk(" world")}\n\ndata: [DONE]\n\n`;
      // Split in the middle of a line
      const mid = Math.floor(full.length / 2);

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(full.slice(0, mid)));
          controller.enqueue(encoder.encode(full.slice(mid)));
          controller.close();
        },
      });

      mockFetch.mockResolvedValue({ ok: true, body: stream });

      const events = await collectEvents(makeMessages(), [], { apiKey: "k", model: "m" });
      const deltas = events.filter((e) => e.type === "text_delta");
      expect(deltas).toHaveLength(2);
    });

    it("should skip chunks where delta is missing", async () => {
      const noChoices = JSON.stringify({ choices: [{}] });
      mockFetch.mockResolvedValue({
        ok: true,
        body: sseStream([noChoices, textChunk("ok")]),
      });

      const events = await collectEvents(makeMessages(), [], { apiKey: "k", model: "m" });
      expect(events.filter((e) => e.type === "text_delta")).toHaveLength(1);
    });
  });

  // ── Error handling ───────────────────────────────────────────────

  describe("error handling", () => {
    it("should yield error event on non-ok HTTP response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => "Rate limited",
      });

      const events = await collectEvents(makeMessages(), [], { apiKey: "k", model: "m" });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("error");
      expect((events[0] as any).error).toContain("429");
      expect((events[0] as any).error).toContain("Rate limited");
    });

    it("should yield error on 401 unauthorized", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "Invalid API key",
      });

      const events = await collectEvents(makeMessages(), [], { apiKey: "bad-key", model: "m" });
      expect(events[0].type).toBe("error");
      expect((events[0] as any).error).toContain("401");
    });

    it("should yield error on 500 server error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      const events = await collectEvents(makeMessages(), [], { apiKey: "k", model: "m" });
      expect(events[0].type).toBe("error");
      expect((events[0] as any).error).toContain("500");
    });
  });

  // ── Tool call parsing and execution ──────────────────────────────

  describe("tool calls", () => {
    it("should parse streamed tool calls and execute them", async () => {
      const tool = makeTool("get_time", "2024-01-01");

      // First request: model calls tool
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: sseStream([
          toolCallStartChunk(0, "call_1", "get_time", "{}"),
        ]),
      });
      // Second request: model responds with text after tool result
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: sseStream([textChunk("The time is 2024-01-01")]),
      });

      const events = await collectEvents(makeMessages(), [tool], { apiKey: "k", model: "m" });

      // Should have tool_call_start, tool_call_end, tool_loop_messages, then text
      const starts = events.filter((e) => e.type === "tool_call_start");
      const ends = events.filter((e) => e.type === "tool_call_end");
      expect(starts).toHaveLength(1);
      expect(ends).toHaveLength(1);
      expect((ends[0] as any).toolCall.result.content).toBe("2024-01-01");

      expect(tool.execute).toHaveBeenCalledOnce();
    });

    it("should accumulate tool call arguments across multiple chunks", async () => {
      const tool: ToolDefinition = {
        name: "search",
        description: "Search",
        parameters: { type: "object", properties: {} },
        execute: vi.fn(async (args) => ({
          content: `Found: ${(args as any).query}`,
          isError: false,
        })),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: sseStream([
          toolCallStartChunk(0, "call_1", "search", '{"q'),
          toolCallArgsChunk(0, 'uery":'),
          toolCallArgsChunk(0, '"hello"}'),
        ]),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: sseStream([textChunk("Done")]),
      });

      const events = await collectEvents(makeMessages(), [tool], { apiKey: "k", model: "m" });

      expect(tool.execute).toHaveBeenCalledWith({ query: "hello" });
    });

    it("should handle multiple parallel tool calls", async () => {
      const tool1 = makeTool("tool_a", "result_a");
      const tool2 = makeTool("tool_b", "result_b");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: sseStream([
          toolCallStartChunk(0, "call_a", "tool_a", "{}"),
          toolCallStartChunk(1, "call_b", "tool_b", "{}"),
        ]),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: sseStream([textChunk("Both done")]),
      });

      const events = await collectEvents(makeMessages(), [tool1, tool2], { apiKey: "k", model: "m" });

      const starts = events.filter((e) => e.type === "tool_call_start");
      expect(starts).toHaveLength(2);
      expect(tool1.execute).toHaveBeenCalledOnce();
      expect(tool2.execute).toHaveBeenCalledOnce();
    });

    it("should return error result for unknown tool", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: sseStream([
          toolCallStartChunk(0, "call_1", "nonexistent_tool", "{}"),
        ]),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: sseStream([textChunk("ok")]),
      });

      const events = await collectEvents(makeMessages(), [], { apiKey: "k", model: "m" });

      const ends = events.filter((e) => e.type === "tool_call_end");
      expect(ends).toHaveLength(1);
      expect((ends[0] as any).toolCall.result.isError).toBe(true);
      expect((ends[0] as any).toolCall.result.content).toContain("Unknown tool");
    });

    it("should catch tool execution errors and return error result", async () => {
      const failingTool: ToolDefinition = {
        name: "fail",
        description: "Fails",
        parameters: { type: "object", properties: {} },
        execute: vi.fn(async () => { throw new Error("kaboom"); }),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: sseStream([
          toolCallStartChunk(0, "call_1", "fail", "{}"),
        ]),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: sseStream([textChunk("handled")]),
      });

      const events = await collectEvents(makeMessages(), [failingTool], { apiKey: "k", model: "m" });

      const ends = events.filter((e) => e.type === "tool_call_end");
      expect(ends).toHaveLength(1);
      expect((ends[0] as any).toolCall.result.isError).toBe(true);
      expect((ends[0] as any).toolCall.result.content).toContain("Tool error");
      expect((ends[0] as any).toolCall.result.content).toContain("kaboom");
    });

    it("should handle unparseable tool call arguments gracefully", async () => {
      const tool = makeTool("my_tool", "ok");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: sseStream([
          toolCallStartChunk(0, "call_1", "my_tool", "not valid json"),
        ]),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: sseStream([textChunk("done")]),
      });

      const events = await collectEvents(makeMessages(), [tool], { apiKey: "k", model: "m" });

      // Should still call the tool with empty args
      expect(tool.execute).toHaveBeenCalledWith({});
    });

    it("should yield tool_loop_message events for assistant and tool messages", async () => {
      const tool = makeTool("read", "file content");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: sseStream([
          toolCallStartChunk(0, "call_1", "read", '{"path":"/a"}'),
        ]),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: sseStream([textChunk("Here it is")]),
      });

      const events = await collectEvents(makeMessages(), [tool], { apiKey: "k", model: "m" });

      const loopMsgs = events.filter((e) => e.type === "tool_loop_message");
      // Should have assistant message (with tool_calls) + tool result message
      expect(loopMsgs).toHaveLength(2);

      const assistantMsg = (loopMsgs[0] as any).message;
      expect(assistantMsg.role).toBe("assistant");
      expect(assistantMsg.toolCalls).toHaveLength(1);
      expect(assistantMsg.toolCalls[0].name).toBe("read");

      const toolMsg = (loopMsgs[1] as any).message;
      expect(toolMsg.role).toBe("tool");
      expect(toolMsg.content).toBe("file content");
      expect(toolMsg.toolCallId).toBe("call_1");
    });

    it("should send tool results back in the next request", async () => {
      const tool = makeTool("ping", "pong");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: sseStream([
          toolCallStartChunk(0, "call_1", "ping", "{}"),
        ]),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: sseStream([textChunk("Got pong")]),
      });

      await collectEvents(makeMessages(), [tool], { apiKey: "k", model: "m" });

      // Second fetch call should include the assistant + tool messages
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body);

      // Should have: system, user, assistant (with tool_calls), tool (result)
      expect(secondBody.messages).toHaveLength(4);
      const assistantMsg = secondBody.messages[2];
      expect(assistantMsg.role).toBe("assistant");
      expect(assistantMsg.tool_calls).toHaveLength(1);

      const toolResult = secondBody.messages[3];
      expect(toolResult.role).toBe("tool");
      expect(toolResult.content).toBe("pong");
      expect(toolResult.tool_call_id).toBe("call_1");
    });
  });

  // ── Signal / abort ───────────────────────────────────────────────

  describe("abort signal", () => {
    it("should pass signal to fetch", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: sseStream([textChunk("hi")]),
      });

      const controller = new AbortController();
      await collectEvents(makeMessages(), [], { apiKey: "k", model: "m" }, controller.signal);

      const init = mockFetch.mock.calls[0][1];
      // The signal should be present (it's a combined signal)
      expect(init.signal).toBeDefined();
    });
  });
});
