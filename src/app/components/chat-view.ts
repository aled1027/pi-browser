import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import type { Agent, PromptTemplate, UserInputRequest, UserInputResponse, ToolCall } from "../../lib/index.js";
import "./user-input-form.js";

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
}

let nextId = 0;

@customElement("chat-view")
export class ChatView extends LitElement {
  static styles = css`
    :host {
      height: 100%;
      display: flex;
      flex-direction: column;
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

  @state() private messages: ChatMessage[] = [];
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
    this.agent.setUserInputHandler((request) => {
      return new Promise<UserInputResponse>((resolve) => {
        this.pendingInput = { request, resolve };
      });
    });
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
      { id: nextId++, role: "user", content: text },
    ];
    this.streaming = true;
    this.streamText = "";
    this.streamToolCalls = [];

    let fullText = "";
    const toolCalls: ToolCall[] = [];

    try {
      for await (const event of this.agent.prompt(text)) {
        switch (event.type) {
          case "text_delta":
            fullText += event.delta;
            this.streamText = fullText;
            break;
          case "tool_call_start":
            toolCalls.push(event.toolCall);
            this.streamToolCalls = [...toolCalls];
            break;
          case "tool_call_end": {
            const idx = toolCalls.findIndex(
              (tc) => tc.id === event.toolCall.id
            );
            if (idx >= 0) {
              toolCalls[idx] = event.toolCall;
              this.streamToolCalls = [...toolCalls];
            }
            break;
          }
          case "error":
            fullText += `\n\n**Error:** ${event.error}`;
            this.streamText = fullText;
            break;
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        fullText += `\n\n**Error:** ${e}`;
      }
    }

    this.messages = [
      ...this.messages,
      {
        id: nextId++,
        role: "assistant",
        content: fullText,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      },
    ];
    this.streamText = "";
    this.streamToolCalls = [];
    this.streaming = false;
  }

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

  render() {
    return html`
      <div class="header">
        <span class="title">π browser</span>
        <span class="model">anthropic/claude-sonnet-4</span>
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
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "chat-view": ChatView;
  }
}
