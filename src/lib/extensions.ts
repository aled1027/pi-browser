/**
 * Extension system for pi-browser.
 *
 * Extensions are functions that receive a PiBrowserAPI and use it to
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

// ─── Extension API ──────────────────────────────────────────────────

export interface PiBrowserAPI {
  /** Register a tool the model can call */
  registerTool(tool: ToolDefinition): void;

  /** Subscribe to agent events (returns unsubscribe fn) */
  on(event: "agent_event", handler: (e: AgentEvent) => void): () => void;

  /**
   * Request input from the user via a browser form.
   * Pauses tool execution until the user submits.
   */
  requestUserInput(request: UserInputRequest): Promise<UserInputResponse>;
}

/** An extension is a function that receives the API and sets things up */
export type Extension = (api: PiBrowserAPI) => void | Promise<void>;

// ─── Extension registry ─────────────────────────────────────────────

export class ExtensionRegistry {
  private tools: ToolDefinition[] = [];
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

  /** Build the PiBrowserAPI that gets passed to each extension */
  private createAPI(): PiBrowserAPI {
    return {
      registerTool: (tool) => {
        this.tools.push(tool);
      },
      on: (event, handler) => {
        if (event === "agent_event") {
          this.eventListeners.push(handler);
          return () => {
            this.eventListeners = this.eventListeners.filter(
              (h) => h !== handler
            );
          };
        }
        return () => {};
      },
      requestUserInput: (req) => {
        if (!this._requestUserInput) {
          return Promise.reject(
            new Error("No user input handler registered")
          );
        }
        return this._requestUserInput(req);
      },
    };
  }

  /** Load an array of extensions */
  async load(extensions: Extension[]): Promise<void> {
    const api = this.createAPI();
    for (const ext of extensions) {
      await ext(api);
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
