/**
 * Agent — orchestrates messages, tools, and the OpenRouter API.
 *
 * This is the core "session" object. It holds conversation history,
 * manages the tool set, and drives the streaming tool loop.
 */

import type { Message, AgentEvent, ToolDefinition } from "./types";
import { runAgent } from "./openrouter";
import { VirtualFS, createTools } from "./tools";

export interface AgentConfig {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
}

const DEFAULT_SYSTEM_PROMPT = `You are a helpful coding assistant running in a browser environment.

You have access to a virtual in-memory filesystem. You can read, write, edit, and list files.

When the user asks you to create or modify code, use the tools to do so.
Be concise in your responses.`;

export class Agent {
  readonly fs: VirtualFS;
  readonly tools: ToolDefinition[];
  private messages: Message[] = [];
  private config: AgentConfig;
  private abortController: AbortController | null = null;

  constructor(config: AgentConfig) {
    this.config = config;
    this.fs = new VirtualFS();
    this.tools = createTools(this.fs);
    this.messages = [
      {
        role: "system",
        content: config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      },
    ];
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  /** Send a user message and stream back agent events */
  async *prompt(text: string): AsyncGenerator<AgentEvent> {
    this.messages.push({ role: "user", content: text });

    this.abortController = new AbortController();

    let fullResponse = "";

    try {
      for await (const event of runAgent(
        this.messages,
        this.tools,
        { apiKey: this.config.apiKey, model: this.config.model },
        this.abortController.signal
      )) {
        if (event.type === "text_delta") {
          fullResponse += event.delta;
        }
        yield event;
      }

      // Append assistant response to history
      if (fullResponse) {
        this.messages.push({ role: "assistant", content: fullResponse });
      }
    } finally {
      this.abortController = null;
    }
  }

  abort(): void {
    this.abortController?.abort();
  }
}
