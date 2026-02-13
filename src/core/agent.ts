/**
 * Agent — the single public API for pi-browser.
 *
 * Orchestrates messages, tools, extensions, skills, templates,
 * thread management, and persistence. This is the only class
 * that examples need to interact with.
 *
 * VFS is per-agent (shared across threads), persisted independently.
 * Threads only persist messages.
 *
 * The Agent implements ExtensionHost so extensions receive the Agent
 * directly and can call registerTool(), on(), requestUserInput().
 */

import type { Message, AgentEvent, ToolDefinition, PromptResult, ToolCall } from "./types.js";
import type { Extension, UserInputRequest, UserInputResponse, ExtensionHost } from "./extensions.js";
import type { Skill } from "./skills.js";
import type { PromptTemplate } from "./prompt-templates.js";
import { ExtensionRegistry } from "./extensions.js";
import { SkillRegistry, parseSkillMarkdown, serializeSkillMarkdown } from "./skills.js";
import { PromptTemplateRegistry } from "./prompt-templates.js";
import { runAgent } from "./openrouter.js";
import { VirtualFS, createTools } from "./tools.js";
import { ThreadStorage, type ThreadMeta } from "./storage.js";

export type { ThreadMeta };

const DEFAULT_MODEL = "minimax/minimax-m2.5";

export interface AgentConfig {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  extensions?: Extension[];
  skills?: Skill[];
  promptTemplates?: PromptTemplate[];
  /** Per-request timeout in milliseconds for OpenRouter API calls. Default: 120000 (2 minutes). */
  timeout?: number;
}

const PI_BROWSER_DIR = "/.pi-browser";
const EXTENSIONS_DIR = `${PI_BROWSER_DIR}/extensions`;
const SKILLS_DIR = `${PI_BROWSER_DIR}/skills`;

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

/**
 * A stream of agent events that is both async-iterable and awaitable.
 *
 * - **Await it** to get the final `PromptResult` (simple case):
 *   ```ts
 *   const result = await agent.prompt("Hello");
 *   console.log(result.text);
 *   ```
 *
 * - **Iterate it** for streaming updates, then read `.result`:
 *   ```ts
 *   const stream = agent.prompt("Hello");
 *   for await (const event of stream) {
 *     if (event.type === "text_delta") updateUI(event.delta);
 *   }
 *   console.log(stream.result.text);
 *   ```
 */
export class PromptStream implements AsyncIterable<AgentEvent>, PromiseLike<PromptResult> {
  private _result: PromptResult | null = null;
  private _promise: Promise<PromptResult> | null = null;
  private _generator: AsyncGenerator<AgentEvent>;
  private _consumed = false;

  constructor(generator: AsyncGenerator<AgentEvent>) {
    this._generator = generator;
  }

  /** The accumulated result. Available after iteration completes. */
  get result(): PromptResult {
    if (!this._result) {
      throw new Error("PromptStream not yet consumed. Await or iterate it first.");
    }
    return this._result;
  }

  /** Async-iterate over events for streaming. */
  async *[Symbol.asyncIterator](): AsyncGenerator<AgentEvent> {
    if (this._consumed) {
      return;
    }
    this._consumed = true;

    let fullText = "";
    const toolCalls: ToolCall[] = [];

    for await (const event of this._generator) {
      switch (event.type) {
        case "text_delta":
          fullText += event.delta;
          break;
        case "tool_call_start":
          toolCalls.push(event.toolCall);
          break;
        case "tool_call_end": {
          const idx = toolCalls.findIndex((tc) => tc.id === event.toolCall.id);
          if (idx >= 0) toolCalls[idx] = event.toolCall;
          break;
        }
      }
      yield event;
    }

    this._result = { text: fullText, toolCalls };
  }

  /**
   * Makes PromptStream awaitable. Consumes the entire stream and returns
   * the accumulated result.
   */
  then<TResult1 = PromptResult, TResult2 = never>(
    onfulfilled?: ((value: PromptResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (!this._promise) {
      // Attach a no-op catch to prevent unhandled rejection warnings
      // when the caller only uses iteration instead of .then()
      const p = this.consume();
      p.catch(() => {});
      this._promise = p;
    }
    return this._promise.then(onfulfilled, onrejected);
  }

  private async consume(): Promise<PromptResult> {
    // Drain the iterator, which populates this._result
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _event of this) {
      // just consume
    }
    return this._result!;
  }
}

export class Agent implements ExtensionHost {
  readonly extensions: ExtensionRegistry;
  readonly skills: SkillRegistry;
  readonly promptTemplates: PromptTemplateRegistry;

  private _fs!: VirtualFS;
  private builtinTools!: ToolDefinition[];
  private messages: Message[] = [];
  private abortController: AbortController | null = null;
  private _ready: Promise<void>;

  // Thread state
  private storage: ThreadStorage;
  private _activeThreadId: string | null = null;
  private _isFirstUserMessage = true;

  // Public config
  config: AgentConfig;

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  private constructor(config: AgentConfig) {
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

    // Load VFS from storage, then auto-load extensions/skills from VFS,
    // then load config extensions
    this._ready = this.initAsync();
  }

  /**
   * Create an agent and restore the active thread (or create a new one).
   * This is the recommended way to create an Agent.
   */
  static async create(config: AgentConfig): Promise<Agent> {
    if (!config.model) {
      config.model = DEFAULT_MODEL;
    }
    const agent = new Agent(config);
    await agent.ready();
    await agent.restoreOrCreateThread();
    if (typeof window !== "undefined") {
      (window as any).__PI_AGENT__ = agent;
    }
    return agent;
  }

  // ---------------------------------------------------------------------------
  // ExtensionHost implementation
  // ---------------------------------------------------------------------------

  /**
   * Register a tool the model can call.
   * Extensions call this to add tools. Optionally pass extensionName for tracking.
   */
  registerTool(tool: ToolDefinition, extensionName?: string): void {
    this.extensions.registerTool(tool, extensionName);
  }

  /**
   * Subscribe to agent events (returns unsubscribe fn).
   */
  on(event: "agent_event", handler: (e: AgentEvent) => void): () => void {
    return this.extensions.on(event, handler);
  }

  /**
   * Request input from the user via a browser form.
   */
  requestUserInput(request: UserInputRequest): Promise<UserInputResponse> {
    return this.extensions.requestUserInput(request);
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
  // Dynamic extension management
  // ---------------------------------------------------------------------------

  /**
   * Add an extension from source code, execute it immediately, and persist
   * to VFS for automatic future loading.
   *
   * @param source - JavaScript source of the extension function.
   *                 Must be a function expression: `(agent) => { ... }`
   * @param filename - Name for the extension file (without path/extension).
   *                   Used as the extension identifier.
   */
  async addExtension(source: string, filename: string): Promise<void> {
    // Eval and execute immediately
    const fn = new Function("return " + source)() as Extension;
    if (typeof fn !== "function") {
      throw new Error(`Extension source must evaluate to a function`);
    }

    // Create a scoped host that tracks tools under this extension name
    const scopedHost: ExtensionHost = {
      registerTool: (tool: ToolDefinition) => {
        this.registerTool(tool, filename);
      },
      on: (event: "agent_event", handler: (e: AgentEvent) => void) => {
        return this.on(event, handler);
      },
      requestUserInput: (req: UserInputRequest) => {
        return this.requestUserInput(req);
      },
      addExtension: (src: string, name: string) => {
        return this.addExtension(src, name);
      },
      removeExtension: (name: string) => {
        return this.removeExtension(name);
      },
    };

    await fn(scopedHost);

    // Persist to VFS
    this._fs.write(`${EXTENSIONS_DIR}/${filename}.js`, source);
    await this.persistVFS();
  }

  /**
   * Remove a previously added extension by name.
   * Unregisters its tools and removes from VFS.
   */
  async removeExtension(name: string): Promise<void> {
    this.extensions.unregisterToolsByExtension(name);
    this._fs.delete(`${EXTENSIONS_DIR}/${name}.js`);
    await this.persistVFS();
  }

  // ---------------------------------------------------------------------------
  // Dynamic skill management
  // ---------------------------------------------------------------------------

  /**
   * Add a skill, register it immediately, and persist to VFS.
   */
  async addSkill(skill: Skill): Promise<void> {
    this.skills.register(skill);
    this._fs.write(
      `${SKILLS_DIR}/${skill.name}.md`,
      serializeSkillMarkdown(skill)
    );
    await this.persistVFS();
  }

  /**
   * Remove a skill by name, unregister it, and remove from VFS.
   */
  async removeSkill(name: string): Promise<void> {
    this.skills.unregister(name);
    this._fs.delete(`${SKILLS_DIR}/${name}.md`);
    await this.persistVFS();
  }

  // ---------------------------------------------------------------------------
  // Thread management
  // ---------------------------------------------------------------------------

  /** List all threads, most recently updated first */
  listThreads(): ThreadMeta[] {
    return this.storage.listThreads();
  }

  /**
   * Create a new thread, clear message state, and set it as active.
   * VFS is shared and not reset on thread change.
   * Returns the new thread ID.
   */
  async newThread(name?: string): Promise<string> {
    // Persist current thread messages before switching
    await this.persistMessages();

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

    // Reset messages only (VFS is shared)
    this.initFreshMessages();
    await this.persistMessages();

    return id;
  }

  /**
   * Switch to an existing thread, loading its messages from storage.
   * VFS is shared and not affected by thread switching.
   */
  async switchThread(threadId: string): Promise<void> {
    if (threadId === this._activeThreadId) return;

    const meta = this.storage.getThread(threadId);
    if (!meta) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    // Persist current thread messages before switching
    await this.persistMessages();

    // Load new thread messages
    const messages = await this.storage.getMessages(threadId);

    this.storage.setActiveThreadId(threadId);
    this._activeThreadId = threadId;

    if (messages.length > 0) {
      this.messages = messages;
      this._isFirstUserMessage = !messages.some((m) => m.role === "user");
    } else {
      this.initFreshMessages();
    }
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

  /**
   * Reset the agent to a clean state: delete all threads and clear the
   * virtual filesystem. After reset, a fresh empty thread is created
   * and set as active.
   */
  async reset(): Promise<void> {
    // Abort any in-flight request
    this.abort();

    // Wipe all persisted data (threads + VFS)
    await this.storage.clearAll();

    // Reset in-memory VFS
    this._fs = new VirtualFS();
    this.builtinTools = createTools(this._fs);

    // Clear extension-registered tools (extensions from VFS are gone)
    this.extensions.clear();

    // Re-load config extensions (non-VFS ones)
    await this.extensions.load(this.config.extensions ?? [], this);

    // Reset messages and create a fresh thread
    this._activeThreadId = null;
    this.initFreshMessages();
    await this.restoreOrCreateThread();
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

  /** Persist the current thread's messages to storage */
  async persist(): Promise<void> {
    await Promise.all([this.persistMessages(), this.persistVFS()]);
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
   * Send a message to the agent. Returns a `PromptStream` that can be
   * both awaited (simple) and async-iterated (streaming).
   *
   * **Simple — just await it:**
   * ```ts
   * const result = await agent.prompt("Hello");
   * console.log(result.text);
   * ```
   *
   * **Streaming — iterate for events, then read the result:**
   * ```ts
   * const stream = agent.prompt("Hello");
   * for await (const event of stream) {
   *   if (event.type === "text_delta") updateUI(event.delta);
   * }
   * console.log(stream.result.text);
   * ```
   */
  prompt(text: string): PromptStream {
    return new PromptStream(this.runPrompt(text));
  }

  private async *runPrompt(text: string): AsyncGenerator<AgentEvent> {
    await this._ready;

    // Rebuild system prompt so it reflects any dynamically added skills
    this.rebuildSystemPrompt();

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
        { apiKey: this.config.apiKey, model: this.config.model!, timeout: this.config.timeout },
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

  /** Build the full system prompt string from base prompt + current skills */
  private buildSystemPrompt(): string {
    const basePrompt = this.config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    const skillFragment = this.skills.systemPromptFragment();
    return skillFragment ? basePrompt + "\n" + skillFragment : basePrompt;
  }

  /** Initialize messages with system prompt */
  private initFreshMessages(): void {
    this.messages = [{ role: "system", content: this.buildSystemPrompt() }];
    this._isFirstUserMessage = true;
  }

  /**
   * Update the system message in the current conversation to reflect
   * any skills added/removed since the thread was created.
   */
  private rebuildSystemPrompt(): void {
    const newPrompt = this.buildSystemPrompt();
    if (this.messages.length > 0 && this.messages[0].role === "system") {
      this.messages[0] = { role: "system", content: newPrompt };
    }
  }

  /** Persist only messages for the current thread */
  private async persistMessages(): Promise<void> {
    if (!this._activeThreadId) return;

    const meta = this.storage.getThread(this._activeThreadId);
    if (meta) {
      meta.updatedAt = Date.now();
      this.storage.saveThread(meta);
    }

    await this.storage.saveMessages(this._activeThreadId, [...this.messages]);
  }

  /** Persist VFS to agent-level storage */
  private async persistVFS(): Promise<void> {
    await this.storage.saveVFS(this._fs.toJSON());
  }

  /**
   * Async initialization: load VFS from storage, auto-load extensions/skills
   * from VFS, then load config extensions.
   */
  private async initAsync(): Promise<void> {
    // 1. Load persisted VFS
    const vfsData = await this.storage.loadVFS();
    if (Object.keys(vfsData).length > 0) {
      this._fs = VirtualFS.fromJSON(vfsData);
      this.builtinTools = createTools(this._fs);
    }

    // 2. Auto-load extensions from VFS
    const extensionFiles = this._fs.list(EXTENSIONS_DIR);
    for (const path of extensionFiles) {
      if (!path.endsWith(".js")) continue;
      const source = this._fs.read(path);
      if (!source) continue;

      // Extract filename (without extension) as the extension name
      const filename = path.split("/").pop()!.replace(/\.js$/, "");

      try {
        const fn = new Function("return " + source)() as Extension;
        if (typeof fn === "function") {
          const scopedHost: ExtensionHost = {
            registerTool: (tool: ToolDefinition) => {
              this.registerTool(tool, filename);
            },
            on: (event: "agent_event", handler: (e: AgentEvent) => void) => {
              return this.on(event, handler);
            },
            requestUserInput: (req: UserInputRequest) => {
              return this.requestUserInput(req);
            },
            addExtension: (src: string, name: string) => {
              return this.addExtension(src, name);
            },
            removeExtension: (name: string) => {
              return this.removeExtension(name);
            },
          };
          await fn(scopedHost);
        }
      } catch (e) {
        console.warn(`[agent] Failed to load extension "${filename}" from VFS:`, e);
      }
    }

    // 3. Auto-load skills from VFS
    const skillFiles = this._fs.list(SKILLS_DIR);
    for (const path of skillFiles) {
      if (!path.endsWith(".md")) continue;
      const content = this._fs.read(path);
      if (!content) continue;

      try {
        const skill = parseSkillMarkdown(content);
        if (skill) {
          this.skills.register(skill);
        }
      } catch (e) {
        console.warn(`[agent] Failed to load skill from VFS (${path}):`, e);
      }
    }

    // 4. Load config extensions (these receive the Agent directly)
    await this.extensions.load(this.config.extensions ?? [], this);
  }

  /**
   * Restore the active thread from storage, or create a new one.
   * Only restores messages — VFS is already loaded from agent-level storage.
   */
  private async restoreOrCreateThread(): Promise<void> {
    const activeId = this.storage.getActiveThreadId();

    if (activeId && this.storage.getThread(activeId)) {
      // Load existing thread messages
      const messages = await this.storage.getMessages(activeId);

      this._activeThreadId = activeId;

      if (messages.length > 0) {
        this.messages = messages;
        this._isFirstUserMessage = !messages.some((m) => m.role === "user");
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
      await this.persistMessages();
    }
  }
}
