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

const DEFAULT_SYSTEM_PROMPT = `You are pi-browser, a coding agent that runs entirely in the browser.

## Environment

You are running inside a web application — there is no server, no Node.js, and no access to the user's local filesystem. Everything happens client-side in the browser tab.

## Capabilities

### Virtual filesystem
You have a virtual in-memory filesystem. Use the built-in tools to work with it:
- **read** — read a file's contents
- **write** — create or overwrite a file
- **edit** — surgically replace exact text in a file
- **list** — list files under a path prefix

All file paths live in this virtual filesystem. Files persist only for the duration of the session (they are lost on page reload).

### Extensions
Your capabilities can be extended at runtime through extensions. Extensions may register additional tools beyond the built-in filesystem tools. Use any tool available to you — the tool descriptions explain what each one does.

### Skills
Specialized instruction sets may be available for specific tasks (e.g. code review, component creation). When available, skill names and descriptions are listed at the end of this prompt. Use the \`read_skill\` tool to load a skill's full instructions before starting a task that matches its description.

### Prompt templates
The user can type \`/name\` commands in the chat input to expand prompt templates. These are expanded before they reach you — you'll see the final expanded text. You don't need to do anything special to handle them.

## Guidelines

- Be concise. Prefer short, direct answers.
- When asked to create or modify code, use the filesystem tools to do so — don't just show code in chat.
- When you need clarification or a decision from the user, use a tool to ask them rather than guessing.
- When a task matches an available skill, load and follow that skill's instructions.
- Remember that files only exist in the virtual filesystem. If the user mentions a file, check if it exists with \`list\` or \`read\` first.`;

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

    const userMessage: Message = { role: "user", content: finalText };
    this.messages.push(userMessage);
    this.abortController = new AbortController();

    // Track how many messages were added during this prompt so we can
    // roll back if the request fails before producing any response.
    const messageCountBefore = this.messages.length;
    let fullResponse = "";
    let hasToolMessages = false;

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
        // Track tool-loop intermediate messages in conversation history
        if (event.type === "tool_loop_message") {
          this.messages.push(event.message);
          hasToolMessages = true;
        }
        // Broadcast to extension listeners
        this.extensions.emit(event);
        yield event;
      }

      // Append final assistant response to history
      if (fullResponse) {
        this.messages.push({ role: "assistant", content: fullResponse });
      }
    } catch (e) {
      // If we got no response at all (no text, no tool messages), roll back
      // the user message to keep conversation history clean.
      if (!fullResponse && !hasToolMessages) {
        this.messages.length = messageCountBefore - 1;
      }
      throw e;
    } finally {
      this.abortController = null;
    }
  }

  abort(): void {
    this.abortController?.abort();
  }
}
