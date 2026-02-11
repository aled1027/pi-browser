/**
 * Agent — orchestrates messages, tools, extensions, skills, and templates.
 *
 * This is the core "session" object. It holds conversation history,
 * manages the tool set, and drives the streaming tool loop.
 */

import type { Message, AgentEvent, ToolDefinition } from "./types.js";
import type { Extension, UserInputRequest, UserInputResponse } from "./extensions.js";
import type { Skill } from "./skills.js";
import type { PromptTemplate } from "./prompt-templates.js";
import { ExtensionRegistry } from "./extensions.js";
import { SkillRegistry } from "./skills.js";
import { PromptTemplateRegistry } from "./prompt-templates.js";
import { runAgent } from "./openrouter.js";
import { VirtualFS, createTools } from "./tools.js";

export interface AgentConfig {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  extensions?: Extension[];
  skills?: Skill[];
  promptTemplates?: PromptTemplate[];
}

const DEFAULT_SYSTEM_PROMPT = `You are a helpful coding assistant running in a browser environment.

You have access to a virtual in-memory filesystem. You can read, write, edit, and list files.
You can also ask the user questions using the ask_user tool when you need clarification.

When the user asks you to create or modify code, use the tools to do so.
Be concise in your responses.`;

export class Agent {
  readonly fs: VirtualFS;
  readonly extensions: ExtensionRegistry;
  readonly skills: SkillRegistry;
  readonly promptTemplates: PromptTemplateRegistry;
  private builtinTools: ToolDefinition[];
  private messages: Message[] = [];
  private config: AgentConfig;
  private abortController: AbortController | null = null;
  private _ready: Promise<void>;

  constructor(config: AgentConfig) {
    this.config = config;
    this.fs = new VirtualFS();
    this.builtinTools = createTools(this.fs);
    this.extensions = new ExtensionRegistry();

    // Skills
    this.skills = new SkillRegistry();
    if (config.skills) {
      this.skills.registerAll(config.skills);
    }

    // Prompt templates
    this.promptTemplates = new PromptTemplateRegistry();
    if (config.promptTemplates) {
      this.promptTemplates.registerAll(config.promptTemplates);
    }

    // Build system prompt with skill listings
    const basePrompt = config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    const skillFragment = this.skills.systemPromptFragment();
    const systemPrompt = skillFragment
      ? basePrompt + "\n" + skillFragment
      : basePrompt;

    this.messages = [
      {
        role: "system",
        content: systemPrompt,
      },
    ];

    // Load extensions asynchronously
    this._ready = this.extensions.load(config.extensions ?? []);
  }

  /** Wait for extensions to finish loading */
  async ready(): Promise<void> {
    await this._ready;
  }

  /** All tools: builtins + skill tools + extension-registered */
  get tools(): ToolDefinition[] {
    const tools = [...this.builtinTools, ...this.extensions.getTools()];
    // Add read_skill tool if there are skills registered
    if (this.skills.getAll().length > 0) {
      tools.push(this.skills.createReadSkillTool());
    }
    return tools;
  }

  /**
   * Set the handler that fulfills requestUserInput() calls from extensions.
   * The Chat component calls this to wire up the form UI.
   */
  setUserInputHandler(
    handler: (req: UserInputRequest) => Promise<UserInputResponse>
  ) {
    this.extensions.setUserInputHandler(handler);
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * Send a user message and stream back agent events.
   *
   * If the text starts with `/template`, it's expanded before sending.
   */
  async *prompt(text: string): AsyncGenerator<AgentEvent> {
    await this._ready;

    // Try prompt template expansion
    const expanded = this.promptTemplates.expand(text);
    const finalText = expanded ?? text;

    this.messages.push({ role: "user", content: finalText });
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
        // Broadcast to extension listeners
        this.extensions.emit(event);
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
