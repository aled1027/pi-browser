/**
 * Extension system for pi-browser.
 *
 * Extensions are functions that receive an Agent instance and use it to
 * register tools, subscribe to agent events, and request UI interactions.
 *
 * This mirrors pi's extension model: the agent provides a surface,
 * extensions plug capabilities into it.
 */

import type { ToolDefinition, AgentEvent } from "./types.js";

// ─── User input requests ────────────────────────────────────────────

export interface UserInputField {
  name: string;
  label: string;
  type: "text" | "textarea" | "select" | "confirm";
  placeholder?: string;
  options?: string[]; // for select
  defaultValue?: string;
  required?: boolean;
}

export interface UserInputRequest {
  /** Headline shown above the form */
  question: string;
  /** Optional longer description */
  description?: string;
  /** Form fields. If omitted, defaults to a single text input. */
  fields?: UserInputField[];
}

export type UserInputResponse = Record<string, string>;

// ─── Extension API surface (exposed on Agent) ───────────────────────

/**
 * Methods that Agent exposes for extensions. Extensions receive the
 * Agent instance directly and call these methods.
 */
export interface ExtensionHost {
  /** Register a tool the model can call */
  registerTool(tool: ToolDefinition, extensionName?: string): void;

  /** Subscribe to agent events (returns unsubscribe fn) */
  on(event: "agent_event", handler: (e: AgentEvent) => void): () => void;

  /**
   * Request input from the user via a browser form.
   * Pauses tool execution until the user submits.
   */
  requestUserInput(request: UserInputRequest): Promise<UserInputResponse>;
}

/**
 * An extension is a function that receives the Agent (which implements
 * ExtensionHost) and sets things up.
 */
export type Extension = (agent: ExtensionHost) => void | Promise<void>;

// ─── Legacy PiBrowserAPI (deprecated, kept for compatibility) ───────

/** @deprecated Use Extension = (agent: ExtensionHost) => void instead */
export interface PiBrowserAPI {
  registerTool(tool: ToolDefinition): void;
  on(event: "agent_event", handler: (e: AgentEvent) => void): () => void;
  requestUserInput(request: UserInputRequest): Promise<UserInputResponse>;
}

// ─── Extension registry ─────────────────────────────────────────────

export class ExtensionRegistry {
  private tools: ToolDefinition[] = [];
  private toolOwnership = new Map<string, string[]>(); // extensionName -> toolNames[]
  private eventListeners: Array<(e: AgentEvent) => void> = [];
  private _requestUserInput:
    | ((req: UserInputRequest) => Promise<UserInputResponse>)
    | null = null;

  /** Called by the Agent/UI layer to provide the user-input handler */
  setUserInputHandler(
    handler: (req: UserInputRequest) => Promise<UserInputResponse>
  ) {
    this._requestUserInput = handler;
  }

  /**
   * Register a tool, optionally tracking which extension owns it.
   */
  registerTool(tool: ToolDefinition, extensionName?: string): void {
    this.tools.push(tool);
    if (extensionName) {
      const owned = this.toolOwnership.get(extensionName) ?? [];
      owned.push(tool.name);
      this.toolOwnership.set(extensionName, owned);
    }
  }

  /**
   * Remove all registered tools and ownership tracking.
   * Event listeners and the user-input handler are preserved.
   */
  clear(): void {
    this.tools = [];
    this.toolOwnership.clear();
  }

  /**
   * Unregister all tools owned by an extension.
   */
  unregisterToolsByExtension(extensionName: string): void {
    const toolNames = this.toolOwnership.get(extensionName);
    if (!toolNames) return;
    this.tools = this.tools.filter((t) => !toolNames.includes(t.name));
    this.toolOwnership.delete(extensionName);
  }

  /** Subscribe to agent events */
  on(event: "agent_event", handler: (e: AgentEvent) => void): () => void {
    if (event === "agent_event") {
      this.eventListeners.push(handler);
      return () => {
        this.eventListeners = this.eventListeners.filter((h) => h !== handler);
      };
    }
    return () => {};
  }

  /** Request user input (delegates to handler set by Agent) */
  requestUserInput(req: UserInputRequest): Promise<UserInputResponse> {
    if (!this._requestUserInput) {
      return Promise.reject(new Error("No user input handler registered"));
    }
    return this._requestUserInput(req);
  }

  /**
   * Load an array of extensions. Each extension receives the agent (ExtensionHost).
   */
  async load(extensions: Extension[], host: ExtensionHost): Promise<void> {
    for (const ext of extensions) {
      await ext(host);
    }
  }

  /** Get all tools registered by extensions */
  getTools(): ToolDefinition[] {
    return [...this.tools];
  }

  /** Broadcast an agent event to all listeners */
  emit(event: AgentEvent): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }
}
