import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { marked } from "marked";
import type { Agent, PromptTemplate, UserInputRequest, UserInputResponse, ToolCall, ThreadMeta } from "tau";
import "./user-input-form.js";
import "./file-browser.js";

// Configure marked for sensible defaults
marked.setOptions({
  breaks: true,
  gfm: true,
});

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
      word-break: break-word;
      line-height: 1.6;
    }

    .message-content p {
      margin: 0 0 0.75em 0;
    }

    .message-content p:last-child {
      margin-bottom: 0;
    }

    .message-content pre {
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 10px 12px;
      overflow-x: auto;
      font-size: 13px;
      margin: 0.5em 0;
    }

    .message-content code {
      background: var(--bg-input);
      border-radius: 3px;
      padding: 1px 4px;
      font-size: 0.9em;
    }

    .message-content pre code {
      background: none;
      padding: 0;
      border-radius: 0;
      font-size: inherit;
    }

    .message-content ul,
    .message-content ol {
      margin: 0.5em 0;
      padding-left: 1.5em;
    }

    .message-content li {
      margin: 0.25em 0;
    }

    .message-content blockquote {
      border-left: 3px solid var(--accent-dim);
      margin: 0.5em 0;
      padding: 0.25em 0.75em;
      color: var(--text-muted);
    }

    .message-content h1,
    .message-content h2,
    .message-content h3,
    .message-content h4 {
      margin: 0.75em 0 0.25em 0;
      line-height: 1.3;
    }

    .message-content h1 { font-size: 1.4em; }
    .message-content h2 { font-size: 1.2em; }
    .message-content h3 { font-size: 1.1em; }

    .message-content table {
      border-collapse: collapse;
      margin: 0.5em 0;
    }

    .message-content th,
    .message-content td {
      border: 1px solid var(--border);
      padding: 4px 8px;
      text-align: left;
    }

    .message-content th {
      background: var(--bg-input);
      font-weight: 600;
    }

    .message-content a {
      color: var(--accent);
      text-decoration: underline;
    }

    .message-content hr {
      border: none;
      border-top: 1px solid var(--border);
      margin: 1em 0;
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

    /* Loading indicator */
    .loading {
      max-width: 800px;
      width: 100%;
      margin: 0 auto;
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--text-muted);
      font-size: 13px;
    }

    .loading-dots {
      display: inline-flex;
      gap: 4px;
    }

    .loading-dots span {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent);
      animation: loading-bounce 1.4s ease-in-out infinite;
    }

    .loading-dots span:nth-child(2) {
      animation-delay: 0.16s;
    }

    .loading-dots span:nth-child(3) {
      animation-delay: 0.32s;
    }

    @keyframes loading-bounce {
      0%, 80%, 100% {
        opacity: 0.3;
        transform: scale(0.8);
      }
      40% {
        opacity: 1;
        transform: scale(1);
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
      overflow-y: auto;
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

    .clear-btn {
      padding: 4px 12px;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: none;
      color: var(--text-muted);
      font-family: inherit;
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
    }

    .clear-btn:hover {
      color: var(--error);
      border-color: var(--error);
    }

    .clear-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    /* File browser sidebar */
    .file-sidebar-wrapper {
      display: flex;
      flex-direction: row;
      overflow: hidden;
    }

    .resize-handle {
      width: 4px;
      cursor: col-resize;
      background: var(--border);
      transition: background 0.15s;
      flex-shrink: 0;
    }

    .resize-handle:hover,
    .resize-handle.dragging {
      background: var(--accent);
    }

    .file-sidebar {
      flex: 1;
      min-width: 0;
      background: var(--bg-secondary);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .file-sidebar-toggle {
      background: none;
      border: 1px solid var(--border);
      border-radius: 4px;
      color: var(--text-muted);
      font-family: inherit;
      font-size: 12px;
      cursor: pointer;
      padding: 4px 10px;
      white-space: nowrap;
    }

    .file-sidebar-toggle:hover {
      color: var(--accent);
      border-color: var(--accent);
    }

    .file-sidebar-toggle.active {
      color: var(--accent);
      border-color: var(--accent);
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
  @state() private showFiles = false;
  @state() private filesVersion = 0;
  @state() private fileSidebarWidth = 280;
  @state() private isResizing = false;

  private resizeStartX = 0;
  private resizeStartWidth = 0;
  private boundResizeMove = this.handleResizeMove.bind(this);
  private boundResizeEnd = this.handleResizeEnd.bind(this);

  private handleResizeStart(e: MouseEvent) {
    e.preventDefault();
    this.isResizing = true;
    this.resizeStartX = e.clientX;
    this.resizeStartWidth = this.fileSidebarWidth;
    document.addEventListener("mousemove", this.boundResizeMove);
    document.addEventListener("mouseup", this.boundResizeEnd);
  }

  private handleResizeMove(e: MouseEvent) {
    const delta = this.resizeStartX - e.clientX; // dragging left = wider
    const newWidth = Math.max(150, Math.min(600, this.resizeStartWidth + delta));
    this.fileSidebarWidth = newWidth;
  }

  private handleResizeEnd() {
    this.isResizing = false;
    document.removeEventListener("mousemove", this.boundResizeMove);
    document.removeEventListener("mouseup", this.boundResizeEnd);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("mousemove", this.boundResizeMove);
    document.removeEventListener("mouseup", this.boundResizeEnd);
  }
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

  private static readonly MAX_TEXTAREA_ROWS = 10;

  private handleInputChange(e: Event) {
    const textarea = e.target as HTMLTextAreaElement;
    this.input = textarea.value;
    this.autoResizeTextarea(textarea);
    this.updateSuggestions();
  }

  private autoResizeTextarea(textarea: HTMLTextAreaElement) {
    // Reset to single row to get correct scrollHeight
    textarea.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 19.6;
    const padding =
      parseFloat(getComputedStyle(textarea).paddingTop) +
      parseFloat(getComputedStyle(textarea).paddingBottom);
    const maxHeight = lineHeight * ChatView.MAX_TEXTAREA_ROWS + padding;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
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
    // Reset textarea height
    const textarea = this.shadowRoot?.querySelector("textarea");
    if (textarea) textarea.style.height = "auto";
    this.messages = [
      ...this.messages,
      { id: ChatView.nextId++, role: "user", content: text },
    ];
    this.streaming = true;
    this.streamText = "";
    this.streamToolCalls = [];

    const streamToolCalls: ToolCall[] = [];
    const stream = this.agent.prompt(text);
    for await (const event of stream) {
      switch (event.type) {
        case "text_delta":
          this.streamText += event.delta;
          break;
        case "tool_call_start":
          streamToolCalls.push(event.toolCall);
          this.streamToolCalls = [...streamToolCalls];
          break;
        case "tool_call_end": {
          const idx = streamToolCalls.findIndex((t) => t.id === event.toolCall.id);
          if (idx >= 0) streamToolCalls[idx] = event.toolCall;
          this.streamToolCalls = [...streamToolCalls];
          break;
        }
        case "error":
          this.streamText += `\n\n**Error:** ${event.error}`;
          break;
      }
    }
    const result = stream.result;

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
    this.filesVersion++;

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

  private async handleClear() {
    await this.agent.reset();
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
          ${unsafeHTML(marked.parse(msg.content) as string)}${isStreaming
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
          <span class="title">τ browser</span>
          <span>
            <button
              class="file-sidebar-toggle ${this.showFiles ? "active" : ""}"
              @click=${() => { this.showFiles = !this.showFiles; }}
              title="Toggle file browser"
            >📁 Files</button>
            <button
              class="clear-btn"
              @click=${this.handleClear}
              ?disabled=${this.streaming}
              title="Clear all threads and reset agent"
              style="margin-left: 8px;"
            >Clear</button>
            <span class="model" style="margin-left: 12px;">${this.agent?.config?.model ?? "default model"}</span>
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
          ${this.streaming && !this.streamText && this.streamToolCalls.length === 0
            ? html`<div class="loading">
                <div class="loading-dots">
                  <span></span><span></span><span></span>
                </div>
                Thinking…
              </div>`
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
      ${this.showFiles
        ? html`<div class="file-sidebar-wrapper" style="width: ${this.fileSidebarWidth}px;">
            <div
              class="resize-handle ${this.isResizing ? "dragging" : ""}"
              @mousedown=${this.handleResizeStart}
            ></div>
            <div class="file-sidebar">
              <file-browser
                .agent=${this.agent}
                .agentVersion=${this.agentVersion + this.filesVersion}
              ></file-browser>
            </div>
          </div>`
        : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "chat-view": ChatView;
  }
}
