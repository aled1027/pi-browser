import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import type { Agent, PromptTemplate, UserInputRequest, UserInputResponse, ToolCall, ThreadMeta } from "pi-browser";
import "./user-input-form.js";

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
}

@customElement("chat-view")
export class ChatView extends LitElement {
  private static nextId = 0;
  static styles = css`
    :host {
      height: 100%;
      display: flex;
      flex-direction: row;
    }

    /* Thread sidebar */
    .sidebar {
      width: 220px;
      min-width: 220px;
      background: var(--bg-secondary);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .sidebar-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px;
      border-bottom: 1px solid var(--border);
    }

    .sidebar-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
    }

    .new-thread-btn {
      background: none;
      border: 1px solid var(--border);
      border-radius: 4px;
      color: var(--accent);
      font-size: 16px;
      cursor: pointer;
      padding: 2px 8px;
      line-height: 1;
    }

    .new-thread-btn:hover {
      background: var(--bg-input);
    }

    .thread-list {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
    }

    .thread-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      cursor: pointer;
      font-size: 13px;
      color: var(--text);
      transition: background 0.1s;
    }

    .thread-item:hover {
      background: var(--bg-input);
    }

    .thread-item.active {
      background: var(--bg-input);
      border-left: 2px solid var(--accent);
      padding-left: 10px;
    }

    .thread-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }

    .thread-delete {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 14px;
      padding: 0 2px;
      opacity: 0;
      transition: opacity 0.1s;
    }

    .thread-item:hover .thread-delete {
      opacity: 1;
    }

    .thread-delete:hover {
      color: var(--error);
    }

    /* Main chat area */
    .chat-main {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-secondary);
    }

    .title {
      font-weight: 600;
      color: var(--accent);
    }

    .model {
      font-size: 12px;
      color: var(--text-muted);
    }

    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .message {
      max-width: 800px;
      width: 100%;
      margin: 0 auto;
    }

    .message-role {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 4px;
    }

    .message-user .message-role {
      color: var(--accent);
    }

    .message-content {
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.5;
    }

    .cursor {
      animation: blink 1s step-end infinite;
      color: var(--accent);
    }

    @keyframes blink {
      50% {
        opacity: 0;
      }
    }

    /* Tool calls */
    .tool-calls {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 8px;
    }

    .tool-call {
      padding: 8px 10px;
      border-radius: 4px;
      background: var(--tool-bg);
      border-left: 3px solid var(--accent-dim);
      font-size: 12px;
    }

    .tool-call-name {
      color: var(--accent);
      font-weight: 600;
      margin-bottom: 4px;
    }

    .tool-call-result {
      color: var(--text-muted);
      white-space: pre-wrap;
    }

    .tool-call-result.tool-error {
      color: var(--error);
    }

    /* Input area */
    .input-area {
      display: flex;
      gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid var(--border);
      background: var(--bg-secondary);
    }

    .input-wrapper {
      flex: 1;
      position: relative;
    }

    textarea {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: var(--bg-input);
      color: var(--text);
      font-family: inherit;
      font-size: 14px;
      resize: none;
      outline: none;
      line-height: 1.4;
      box-sizing: border-box;
    }

    textarea:focus {
      border-color: var(--accent);
    }

    .send-btn {
      padding: 10px 20px;
      border: none;
      border-radius: 4px;
      background: var(--accent);
      color: var(--bg);
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
    }

    .send-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    /* Autocomplete */
    .autocomplete {
      position: absolute;
      bottom: 100%;
      left: 0;
      right: 0;
      margin-bottom: 4px;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
      box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.3);
      z-index: 50;
      max-height: 240px;
      overflow-y: auto;
    }

    .autocomplete-item {
      display: flex;
      align-items: baseline;
      gap: 10px;
      padding: 8px 12px;
      cursor: pointer;
      transition: background 0.1s;
    }

    .autocomplete-item:hover,
    .autocomplete-item.selected {
      background: var(--bg-input);
    }

    .autocomplete-name {
      color: var(--accent);
      font-weight: 600;
      white-space: nowrap;
    }

    .autocomplete-desc {
      color: var(--text-muted);
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `;

  @property({ attribute: false }) agent!: Agent;
  @property({ type: Number }) agentVersion = 0;

  @state() private messages: ChatMessage[] = [];
  @state() private threads: ThreadMeta[] = [];
  @state() private input = "";
  @state() private streaming = false;
  @state() private streamText = "";
  @state() private streamToolCalls: ToolCall[] = [];
  @state() private suggestions: PromptTemplate[] = [];
  @state() private selectedSuggestion = 0;
  @state() private pendingInput: {
    request: UserInputRequest;
    resolve: (response: UserInputResponse) => void;
  } | null = null;

  @query(".messages") private messagesEl!: HTMLDivElement;

  connectedCallback() {
    super.connectedCallback();
    this.setupAgent();
  }

  willUpdate(changed: Map<string, unknown>) {
    if (changed.has("agent") || changed.has("agentVersion")) {
      this.setupAgent();
    }
  }

  private setupAgent() {
    if (!this.agent) return;

    this.agent.setUserInputHandler((request) => {
      return new Promise<UserInputResponse>((resolve) => {
        this.pendingInput = { request, resolve };
      });
    });

    this.rebuildMessages();
    this.refreshThreadList();
  }

  private rebuildMessages() {
    const agentMessages = this.agent.getMessages();
    const display: ChatMessage[] = [];
    for (const m of agentMessages) {
      if (m.role === "user") {
        display.push({ id: ChatView.nextId++, role: "user", content: m.content });
      } else if (m.role === "assistant") {
        display.push({
          id: ChatView.nextId++,
          role: "assistant",
          content: m.content,
          toolCalls: m.toolCalls,
        });
      }
    }
    this.messages = display;
  }

  private refreshThreadList() {
    this.threads = this.agent.listThreads();
  }

  private scrollToBottom() {
    requestAnimationFrame(() => {
      if (this.messagesEl) {
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      }
    });
  }

  updated() {
    this.scrollToBottom();
  }

  private handleInputChange(e: Event) {
    this.input = (e.target as HTMLTextAreaElement).value;
    this.updateSuggestions();
  }

  private updateSuggestions() {
    const trimmed = this.input.trim();
    if (trimmed.startsWith("/") && !trimmed.includes(" ")) {
      const prefix = trimmed.slice(1);
      this.suggestions = this.agent.promptTemplates.search(prefix);
      this.selectedSuggestion = 0;
    } else {
      this.suggestions = [];
    }
  }

  private acceptSuggestion(template: PromptTemplate) {
    this.input = `/${template.name} `;
    this.suggestions = [];
  }

  private handleUserInputSubmit(e: CustomEvent<UserInputResponse>) {
    if (this.pendingInput) {
      this.pendingInput.resolve(e.detail);
      this.pendingInput = null;
    }
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (this.suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.selectedSuggestion =
          this.selectedSuggestion < this.suggestions.length - 1
            ? this.selectedSuggestion + 1
            : 0;
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        this.selectedSuggestion =
          this.selectedSuggestion > 0
            ? this.selectedSuggestion - 1
            : this.suggestions.length - 1;
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        this.acceptSuggestion(this.suggestions[this.selectedSuggestion]);
        return;
      }
      if (e.key === "Escape") {
        this.suggestions = [];
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this.handleSubmit();
    }
  }

  private async handleSubmit() {
    const text = this.input.trim();
    if (!text || this.streaming) return;

    this.input = "";
    this.suggestions = [];
    this.messages = [
      ...this.messages,
      { id: ChatView.nextId++, role: "user", content: text },
    ];
    this.streaming = true;
    this.streamText = "";
    this.streamToolCalls = [];

    const streamToolCalls: ToolCall[] = [];
    const result = await this.agent.send(text, {
      onText: (_delta, full) => { this.streamText = full; },
      onToolCallStart: (tc) => {
        streamToolCalls.push(tc);
        this.streamToolCalls = [...streamToolCalls];
      },
      onToolCallEnd: (tc) => {
        const idx = streamToolCalls.findIndex((t) => t.id === tc.id);
        if (idx >= 0) streamToolCalls[idx] = tc;
        this.streamToolCalls = [...streamToolCalls];
      },
      onError: (err) => { this.streamText += `\n\n**Error:** ${err}`; },
    });

    this.messages = [
      ...this.messages,
      {
        id: ChatView.nextId++,
        role: "assistant",
        content: result.text,
        toolCalls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
      },
    ];
    this.streamText = "";
    this.streamToolCalls = [];
    this.streaming = false;

    // Refresh thread list (name may have changed)
    this.refreshThreadList();
  }

  // --- Thread actions (all via agent) ---

  private async handleNewThread() {
    await this.agent.newThread();
    this.rebuildMessages();
    this.refreshThreadList();
    this.dispatchEvent(new CustomEvent("thread-changed", { bubbles: true, composed: true }));
  }

  private async handleSwitchThread(threadId: string) {
    if (threadId === this.agent.activeThreadId) return;
    await this.agent.switchThread(threadId);
    this.rebuildMessages();
    this.refreshThreadList();
    this.dispatchEvent(new CustomEvent("thread-changed", { bubbles: true, composed: true }));
  }

  private async handleDeleteThread(e: Event, threadId: string) {
    e.stopPropagation();
    await this.agent.deleteThread(threadId);
    this.rebuildMessages();
    this.refreshThreadList();
    this.dispatchEvent(new CustomEvent("thread-changed", { bubbles: true, composed: true }));
  }

  // --- Rendering ---

  private renderToolCalls(toolCalls: ToolCall[]) {
    return html`
      <div class="tool-calls">
        ${toolCalls.map(
          (tc) => html`
            <div class="tool-call">
              <div class="tool-call-name">
                🔧 ${tc.name}(${JSON.stringify(tc.arguments).slice(0, 80)}${JSON.stringify(tc.arguments).length > 80 ? "…" : ""})
              </div>
              ${tc.result
                ? html`<div
                    class="tool-call-result ${tc.result.isError
                      ? "tool-error"
                      : ""}"
                  >
                    ${tc.result.content.slice(0, 200)}${tc.result.content
                      .length > 200
                      ? "…"
                      : ""}
                  </div>`
                : nothing}
            </div>
          `
        )}
      </div>
    `;
  }

  private renderMessage(msg: ChatMessage, isStreaming = false) {
    return html`
      <div class="message message-${msg.role}">
        <div class="message-role">
          ${msg.role === "user" ? "you" : "assistant"}
        </div>
        ${msg.toolCalls && msg.toolCalls.length > 0
          ? this.renderToolCalls(msg.toolCalls)
          : nothing}
        <div class="message-content">
          ${msg.content}${isStreaming
            ? html`<span class="cursor">▊</span>`
            : nothing}
        </div>
      </div>
    `;
  }

  private renderSidebar() {
    return html`
      <div class="sidebar">
        <div class="sidebar-header">
          <span class="sidebar-title">Threads</span>
          <button
            class="new-thread-btn"
            @click=${this.handleNewThread}
            title="New thread"
          >+</button>
        </div>
        <div class="thread-list">
          ${this.threads.map(
            (t) => html`
              <div
                class="thread-item ${t.id === this.agent.activeThreadId ? "active" : ""}"
                @click=${() => this.handleSwitchThread(t.id)}
              >
                <span class="thread-name">${t.name}</span>
                <button
                  class="thread-delete"
                  @click=${(e: Event) => this.handleDeleteThread(e, t.id)}
                  title="Delete thread"
                >×</button>
              </div>
            `
          )}
        </div>
      </div>
    `;
  }

  render() {
    return html`
      ${this.renderSidebar()}
      <div class="chat-main">
        <div class="header">
          <span class="title">π browser</span>
          <span>
            <span class="model">anthropic/claude-sonnet-4</span>
            <span style="font-size: 12px; margin-left: 12px; color: var(--text-muted); opacity: 0.7;">chat</span>
          </span>
        </div>

        <div class="messages">
          ${repeat(
            this.messages,
            (m) => m.id,
            (m) => this.renderMessage(m)
          )}
          ${this.streaming && (this.streamText || this.streamToolCalls.length > 0)
            ? this.renderMessage(
                {
                  id: -1,
                  role: "assistant",
                  content: this.streamText,
                  toolCalls:
                    this.streamToolCalls.length > 0
                      ? this.streamToolCalls
                      : undefined,
                },
                true
              )
            : nothing}
        </div>

        <div class="input-area">
          <div class="input-wrapper">
            ${this.suggestions.length > 0
              ? html`
                  <div class="autocomplete">
                    ${this.suggestions.map(
                      (t, i) => html`
                        <div
                          class="autocomplete-item ${i ===
                          this.selectedSuggestion
                            ? "selected"
                            : ""}"
                          @mouseenter=${() => {
                            this.selectedSuggestion = i;
                          }}
                          @click=${() => this.acceptSuggestion(t)}
                        >
                          <span class="autocomplete-name">/${t.name}</span>
                          <span class="autocomplete-desc">${t.description}</span>
                        </div>
                      `
                    )}
                  </div>
                `
              : nothing}
            <textarea
              .value=${this.input}
              @input=${this.handleInputChange}
              placeholder="Send a message… (type / for templates)"
              rows="1"
              @keydown=${this.handleKeyDown}
              ?disabled=${this.streaming}
            ></textarea>
          </div>
          <button
            class="send-btn"
            @click=${this.streaming
              ? () => this.agent.abort()
              : () => this.handleSubmit()}
            ?disabled=${!this.streaming && !this.input.trim()}
          >
            ${this.streaming ? "Stop" : "Send"}
          </button>
        </div>

        ${this.pendingInput
          ? html`<user-input-form
              .request=${this.pendingInput.request}
              @user-input-submit=${this.handleUserInputSubmit}
            ></user-input-form>`
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "chat-view": ChatView;
  }
}
