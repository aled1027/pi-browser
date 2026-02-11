/**
 * OpenRouter API client.
 *
 * Uses the OpenAI-compatible chat completions endpoint with streaming.
 * Handles tool calls and multi-turn tool loops.
 */

import type { Message, ToolDefinition, AgentEvent, ToolCall, ToolResult } from "./types.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-sonnet-4";

interface OpenRouterOptions {
  apiKey: string;
  model?: string;
}

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
  const model = options.model ?? DEFAULT_MODEL;

  // Build OpenAI-format messages
  const openaiMessages = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Tool loop: keep going until the model responds with just text
  while (true) {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": window.location.origin,
        "X-Title": "pi-browser",
      },
      body: JSON.stringify({
        model,
        messages: openaiMessages,
        tools: tools.length > 0 ? toolsToOpenAI(tools) : undefined,
        stream: true,
      }),
      signal,
    });

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

    // Append assistant message with tool_calls + tool results, then loop
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
      openaiMessages.push(tr as any);
    }
  }
}
