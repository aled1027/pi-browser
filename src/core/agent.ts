/**
 * Agent — the single public API for pi-browser.
 *
 * Orchestrates messages, tools, extensions, skills, templates,
 * thread management, and persistence. This is the only class
 * that examples need to interact with.
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
import { ThreadStorage, type ThreadMeta } from "./storage.js";

export type { ThreadMeta };

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
  readonly extensions: ExtensionRegistry;
  readonly skills: SkillRegistry;
  readonly promptTemplates: PromptTemplateRegistry;

  private _fs!: VirtualFS;
  private builtinTools!: ToolDefinition[];
  private messages: Message[] = [];
  private config: AgentConfig;
  private abortController: AbortController | null = null;
  private _ready: Promise<void>;

  // Thread state
  private storage: ThreadStorage;
  private _activeThreadId: string | null = null;
  private _isFirstUserMessage = true;

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  constructor(config: AgentConfig) {
    this.config = config;
    this.storage = new ThreadStorage();

    this._fs = new VirtualFS();
    this.builtinTools = createTools(this._fs);
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

    this.initFreshMessages();

    // Load extensions asynchronously
    this._ready = this.extensions.load(config.extensions ?? []);
  }

  /**
   * Create an agent and restore the active thread (or create a new one).
   * This is the recommended way to create an Agent.
   */
  static async create(config: AgentConfig): Promise<Agent> {
    const agent = new Agent(config);
    await agent.restoreOrCreateThread();
    return agent;
  }

  // ---------------------------------------------------------------------------
  // Public accessors
  // ---------------------------------------------------------------------------

  get fs(): VirtualFS {
    return this._fs;
  }

  get activeThreadId(): string | null {
    return this._activeThreadId;
  }

  /** Wait for extensions to finish loading */
  async ready(): Promise<void> {
    await this._ready;
  }

  /** All tools: builtins + skill tools + extension-registered */
  get tools(): ToolDefinition[] {
    const tools = [...this.builtinTools, ...this.extensions.getTools()];
    if (this.skills.getAll().length > 0) {
      tools.push(this.skills.createReadSkillTool());
    }
    return tools;
  }

  /**
   * Set the handler that fulfills requestUserInput() calls from extensions.
   */
  setUserInputHandler(
    handler: (req: UserInputRequest) => Promise<UserInputResponse>
  ) {
    this.extensions.setUserInputHandler(handler);
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  // ---------------------------------------------------------------------------
  // Thread management
  // ---------------------------------------------------------------------------

  /** List all threads, most recently updated first */
  listThreads(): ThreadMeta[] {
    return this.storage.listThreads();
  }

  /**
   * Create a new thread, clear state, and set it as active.
   * Returns the new thread ID.
   */
  async newThread(name?: string): Promise<string> {
    // Persist current thread before switching
    await this.persist();

    const id = crypto.randomUUID().slice(0, 8);
    const now = Date.now();
    const meta: ThreadMeta = {
      id,
      name: name ?? "New thread",
      createdAt: now,
      updatedAt: now,
    };
    this.storage.saveThread(meta);
    this.storage.setActiveThreadId(id);
    this._activeThreadId = id;

    // Reset state
    this.resetState();
    await this.persist();

    return id;
  }

  /**
   * Switch to an existing thread, loading its state from storage.
   */
  async switchThread(threadId: string): Promise<void> {
    if (threadId === this._activeThreadId) return;

    const meta = this.storage.getThread(threadId);
    if (!meta) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    // Persist current thread before switching
    await this.persist();

    // Load new thread state
    const [messages, fsData] = await Promise.all([
      this.storage.getMessages(threadId),
      this.storage.getFS(threadId),
    ]);

    this.storage.setActiveThreadId(threadId);
    this._activeThreadId = threadId;

    if (messages.length > 0) {
      this.messages = messages;
      this._isFirstUserMessage = !messages.some((m) => m.role === "user");
    } else {
      this.initFreshMessages();
    }

    if (Object.keys(fsData).length > 0) {
      this._fs = VirtualFS.fromJSON(fsData);
    } else {
      this._fs = new VirtualFS();
    }
    this.builtinTools = createTools(this._fs);
  }

  /** Delete a thread. If it's the active thread, creates a new one. */
  async deleteThread(threadId: string): Promise<void> {
    await this.storage.deleteThread(threadId);

    if (threadId === this._activeThreadId) {
      // Reset and create a fresh thread
      this._activeThreadId = null;
      await this.restoreOrCreateThread();
    }
  }

  /** Rename a thread */
  renameThread(threadId: string, name: string): void {
    const meta = this.storage.getThread(threadId);
    if (meta) {
      meta.name = name;
      this.storage.saveThread(meta);
    }
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  /** Persist the current thread's state to storage */
  async persist(): Promise<void> {
    if (!this._activeThreadId) return;

    const meta = this.storage.getThread(this._activeThreadId);
    if (meta) {
      meta.updatedAt = Date.now();
      this.storage.saveThread(meta);
    }

    await Promise.all([
      this.storage.saveMessages(this._activeThreadId, [...this.messages]),
      this.storage.saveFS(this._activeThreadId, this._fs.toJSON()),
    ]);
  }

  /** Serialize agent state (messages + fs) */
  serialize(): { messages: Message[]; fs: Record<string, string> } {
    return {
      messages: [...this.messages],
      fs: this._fs.toJSON(),
    };
  }

  // ---------------------------------------------------------------------------
  // Prompt
  // ---------------------------------------------------------------------------

  /**
   * Send a user message and stream back agent events.
   * Auto-persists after completion. Auto-names thread on first message.
   */
  async *prompt(text: string): AsyncGenerator<AgentEvent> {
    await this._ready;

    // Try prompt template expansion
    const expanded = this.promptTemplates.expand(text);
    const finalText = expanded ?? text;

    // Auto-name thread from first user message
    if (this._isFirstUserMessage && this._activeThreadId) {
      const name = text.length > 50 ? text.slice(0, 50) + "…" : text;
      this.renameThread(this._activeThreadId, name);
      this._isFirstUserMessage = false;
    }

    const userMessage: Message = { role: "user", content: finalText };
    this.messages.push(userMessage);
    this.abortController = new AbortController();

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
        if (event.type === "tool_loop_message") {
          this.messages.push(event.message);
          hasToolMessages = true;
        }
        this.extensions.emit(event);
        yield event;
      }

      if (fullResponse) {
        this.messages.push({ role: "assistant", content: fullResponse });
      }
    } catch (e) {
      if (!fullResponse && !hasToolMessages) {
        this.messages.length = messageCountBefore - 1;
      }
      throw e;
    } finally {
      this.abortController = null;
    }

    // Auto-persist after each completed turn
    await this.persist();
  }

  abort(): void {
    this.abortController?.abort();
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /** Build fresh system message + reset FS */
  private resetState(): void {
    this.initFreshMessages();
    this._fs = new VirtualFS();
    this.builtinTools = createTools(this._fs);
  }

  /** Initialize messages with system prompt */
  private initFreshMessages(): void {
    const basePrompt = this.config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    const skillFragment = this.skills.systemPromptFragment();
    const systemPrompt = skillFragment
      ? basePrompt + "\n" + skillFragment
      : basePrompt;

    this.messages = [{ role: "system", content: systemPrompt }];
    this._isFirstUserMessage = true;
  }

  /**
   * Restore the active thread from storage, or create a new one.
   */
  private async restoreOrCreateThread(): Promise<void> {
    const activeId = this.storage.getActiveThreadId();

    if (activeId && this.storage.getThread(activeId)) {
      // Load existing thread
      const [messages, fsData] = await Promise.all([
        this.storage.getMessages(activeId),
        this.storage.getFS(activeId),
      ]);

      this._activeThreadId = activeId;

      if (messages.length > 0) {
        this.messages = messages;
        this._isFirstUserMessage = !messages.some((m) => m.role === "user");
      }

      if (Object.keys(fsData).length > 0) {
        this._fs = VirtualFS.fromJSON(fsData);
        this.builtinTools = createTools(this._fs);
      }
    } else {
      // Create fresh thread
      const id = crypto.randomUUID().slice(0, 8);
      const now = Date.now();
      this.storage.saveThread({
        id,
        name: "New thread",
        createdAt: now,
        updatedAt: now,
      });
      this.storage.setActiveThreadId(id);
      this._activeThreadId = id;
      await this.persist();
    }
  }
}
