/**
 * OpenRouter API client.
 *
 * Uses the OpenAI-compatible chat completions endpoint with streaming.
 * Handles tool calls and multi-turn tool loops.
 */

import type { Message, ToolDefinition, AgentEvent, ToolCall, ToolResult } from "./types.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

interface OpenRouterOptions {
  apiKey: string;
  model: string;
  /** Per-request timeout in milliseconds. Default: 120000 (2 minutes). */
  timeout?: number;
}

const DEFAULT_TIMEOUT = 120_000;

/** Convert our ToolDefinition[] to OpenAI function-calling format */
function toolsToOpenAI(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/**
 * Send a prompt through OpenRouter with tool-use support.
 *
 * Streams text deltas and executes tool calls in a loop until the model
 * produces a final text response (no more tool calls).
 */
export async function* runAgent(
  messages: Message[],
  tools: ToolDefinition[],
  options: OpenRouterOptions,
  signal?: AbortSignal
): AsyncGenerator<AgentEvent> {
  const model = options.model;
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;

  // Build OpenAI-format messages, preserving tool_calls and tool_call_id
  const openaiMessages = messages.map((m) => {
    const msg: Record<string, unknown> = {
      role: m.role,
      content: m.content,
    };
    // Assistant messages with tool calls need the tool_calls array
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      msg.tool_calls = m.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: {
          name: tc.name,
          arguments:
            typeof tc.arguments === "string"
              ? tc.arguments
              : JSON.stringify(tc.arguments),
        },
      }));
      // OpenAI requires content to be null (not empty string) when there are tool calls and no text
      if (!m.content) msg.content = null;
    }
    // Tool result messages need tool_call_id
    if (m.role === "tool" && m.toolCallId) {
      msg.tool_call_id = m.toolCallId;
    }
    return msg;
  });

  const referer =
    typeof window !== "undefined" && window.location
      ? window.location.origin
      : "https://tau";

  // Tool loop: keep going until the model responds with just text
  while (true) {
    // Combine caller signal with a per-request timeout
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), timeout);
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal;

    let response: Response;
    try {
      response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": referer,
          "X-Title": "tau",
        },
        body: JSON.stringify({
          model,
          messages: openaiMessages,
          tools: tools.length > 0 ? toolsToOpenAI(tools) : undefined,
          stream: true,
        }),
        signal: combinedSignal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const body = await response.text();
      yield { type: "error", error: `OpenRouter ${response.status}: ${body}` };
      return;
    }

    // Parse SSE stream
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullContent = "";
    const pendingToolCalls: Map<
      number,
      { id: string; name: string; argsJson: string }
    > = new Map();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }

        const delta = parsed.choices?.[0]?.delta;
        if (!delta) continue;

        // Text content
        if (delta.content) {
          fullContent += delta.content;
          yield { type: "text_delta", delta: delta.content };
        }

        // Tool calls (streamed incrementally)
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!pendingToolCalls.has(idx)) {
              pendingToolCalls.set(idx, {
                id: tc.id ?? `call_${idx}`,
                name: tc.function?.name ?? "",
                argsJson: "",
              });
            }
            const entry = pendingToolCalls.get(idx)!;
            if (tc.id) entry.id = tc.id;
            if (tc.function?.name) entry.name = tc.function.name;
            if (tc.function?.arguments) entry.argsJson += tc.function.arguments;
          }
        }
      }
    }

    // If no tool calls, we're done
    if (pendingToolCalls.size === 0) {
      yield { type: "turn_end" };
      return;
    }

    // Execute tool calls
    const toolResults: Array<{ tool_call_id: string; role: "tool"; content: string }> = [];

    for (const [, entry] of pendingToolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(entry.argsJson);
      } catch {
        // If args don't parse, pass empty
      }

      const toolCall: ToolCall = {
        id: entry.id,
        name: entry.name,
        arguments: args,
      };

      yield { type: "tool_call_start", toolCall };

      const tool = tools.find((t) => t.name === entry.name);
      let result: ToolResult;
      if (tool) {
        try {
          result = await tool.execute(args);
        } catch (e) {
          result = { content: `Tool error: ${e}`, isError: true };
        }
      } else {
        result = { content: `Unknown tool: ${entry.name}`, isError: true };
      }

      toolCall.result = result;
      yield { type: "tool_call_end", toolCall };

      toolResults.push({
        tool_call_id: entry.id,
        role: "tool",
        content: result.content,
      });
    }

    // Build the assistant message with tool_calls
    const assistantToolCalls = [...pendingToolCalls.values()].map((tc) => {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(tc.argsJson || "{}");
      } catch {
        // If args don't parse, use empty object
      }
      return {
        id: tc.id,
        name: tc.name,
        arguments: parsedArgs,
      };
    });

    const assistantMsg = {
      role: "assistant" as const,
      content: fullContent || "",
      toolCalls: assistantToolCalls,
    };
    yield { type: "tool_loop_message", message: assistantMsg };

    openaiMessages.push({
      role: "assistant",
      content: fullContent || null,
      tool_calls: [...pendingToolCalls.values()].map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.argsJson },
      })),
    } as any);

    for (const tr of toolResults) {
      const toolMsg = {
        role: "tool" as const,
        content: tr.content,
        toolCallId: tr.tool_call_id,
      };
      yield { type: "tool_loop_message", message: toolMsg };
      openaiMessages.push(tr as any);
    }
  }
}
