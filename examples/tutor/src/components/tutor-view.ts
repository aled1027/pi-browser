import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import type { Agent, PromptTemplate, UserInputRequest, UserInputResponse, ThreadMeta } from "$core";
import "./user-input-form.js";
import "./code-editor.js";
import "./output-panel.js";
import "./lesson-picker.js";

@customElement("tutor-view")
export class TutorView extends LitElement {
  static styles = css`
    :host {
      height: 100%;
      display: flex;
      flex-direction: row;
    }

    /* Thread sidebar */
    .sidebar {
      width: 200px;
      min-width: 200px;
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
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
    }

    .sidebar-title {
      font-size: 11px;
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
      font-size: 14px;
      cursor: pointer;
      padding: 1px 7px;
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
      padding: 6px 12px;
      cursor: pointer;
      font-size: 12px;
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
      font-size: 13px;
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

    /* Main content */
    .main-wrapper {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    /* Header */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 16px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-secondary);
      flex-shrink: 0;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .title {
      font-weight: 600;
      color: var(--accent);
      font-size: 15px;
    }

    .lesson-name {
      font-size: 12px;
      color: var(--text-muted);
      padding: 2px 8px;
      border: 1px solid var(--border);
      border-radius: 4px;
    }

    .header-actions {
      display: flex;
      gap: 6px;
    }

    .header-btn {
      padding: 4px 10px;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: transparent;
      color: var(--text-muted);
      font-family: inherit;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s;
    }

    .header-btn:hover {
      border-color: var(--accent);
      color: var(--accent);
    }

    /* Main layout */
    .main {
      flex: 1;
      display: flex;
      min-height: 0;
    }

    /* Tutor panel (left) */
    .tutor-panel {
      width: 420px;
      min-width: 320px;
      display: flex;
      flex-direction: column;
      border-right: 1px solid var(--border);
    }

    .tutor-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .tutor-msg {
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .tutor-msg-user {
      color: var(--text-muted);
      font-size: 12px;
      padding: 4px 8px;
      background: var(--bg-input);
      border-radius: 4px;
    }

    .cursor {
      animation: blink 1s step-end infinite;
      color: var(--accent);
    }

    @keyframes blink {
      50% { opacity: 0; }
    }

    /* Input bar */
    .input-bar {
      display: flex;
      gap: 6px;
      padding: 10px 12px;
      border-top: 1px solid var(--border);
      background: var(--bg-secondary);
      flex-shrink: 0;
    }

    .input-wrapper {
      flex: 1;
      position: relative;
    }

    .input-bar input {
      width: 100%;
      padding: 8px 10px;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: var(--bg-input);
      color: var(--text);
      font-family: inherit;
      font-size: 13px;
      outline: none;
    }

    .input-bar input:focus {
      border-color: var(--accent);
    }

    .send-btn {
      padding: 8px 14px;
      border: none;
      border-radius: 4px;
      background: var(--accent);
      color: var(--bg);
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
    }

    .send-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    /* Right side: editor + output */
    .right-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    /* Quick action buttons */
    .quick-actions {
      display: flex;
      gap: 4px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-secondary);
      flex-shrink: 0;
      flex-wrap: wrap;
    }

    .action-btn {
      padding: 4px 12px;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: transparent;
      color: var(--text);
      font-family: inherit;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s;
    }

    .action-btn:hover {
      border-color: var(--accent);
      color: var(--accent);
    }

    .action-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .action-btn.primary {
      background: var(--accent);
      color: var(--bg);
      border-color: var(--accent);
    }

    .action-btn.primary:hover {
      opacity: 0.9;
    }

    .action-btn.run-btn {
      background: var(--accent-green);
      color: var(--bg);
      border-color: var(--accent-green);
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
    }

    .autocomplete-item {
      display: flex;
      gap: 8px;
      padding: 6px 10px;
      cursor: pointer;
      font-size: 12px;
    }

    .autocomplete-item:hover,
    .autocomplete-item.selected {
      background: var(--bg-input);
    }

    .autocomplete-name {
      color: var(--accent);
      font-weight: 600;
    }

    .autocomplete-desc {
      color: var(--text-muted);
    }
  `;

  @property({ attribute: false }) agent!: Agent;
  @property({ type: Number }) agentVersion = 0;

  @state() private lessonStarted = false;
  @state() private currentLesson = "";
  @state() private messages: Array<{ role: "user" | "tutor"; text: string }> = [];
  @state() private threads: ThreadMeta[] = [];
  @state() private streaming = false;
  @state() private streamText = "";
  @state() private editorCode = "// Pick a lesson to get started!\n";
  @state() private output = "";
  @state() private input = "";
  @state() private suggestions: PromptTemplate[] = [];
  @state() private selectedSuggestion = 0;
  @state() private pendingInput: {
    request: UserInputRequest;
    resolve: (response: UserInputResponse) => void;
  } | null = null;

  @query(".tutor-messages") private messagesEl!: HTMLDivElement;

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
    this.syncEditorFromFS();
    this.refreshThreadList();

    // Determine if a lesson is already in progress
    const agentMessages = this.agent.getMessages();
    const hasUserMessages = agentMessages.some((m) => m.role === "user");
    this.lessonStarted = hasUserMessages;
    if (hasUserMessages) {
      const firstUser = agentMessages.find((m) => m.role === "user");
      if (firstUser) {
        const match = firstUser.content.match(/learn about:\s*(.+?)(\n|$)/);
        this.currentLesson = match ? match[1].trim() : "Lesson";
      }
    } else {
      this.currentLesson = "";
    }
  }

  private rebuildMessages() {
    const agentMessages = this.agent.getMessages();
    const display: Array<{ role: "user" | "tutor"; text: string }> = [];
    for (const m of agentMessages) {
      if (m.role === "user") {
        display.push({ role: "user", text: m.content });
      } else if (m.role === "assistant") {
        display.push({ role: "tutor", text: m.content });
      }
    }
    this.messages = display;
  }

  private refreshThreadList() {
    this.threads = this.agent.listThreads();
  }

  private scrollTutorToBottom() {
    requestAnimationFrame(() => {
      if (this.messagesEl) {
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      }
    });
  }

  updated() {
    this.scrollTutorToBottom();
  }

  // --- Lesson picker ---

  private async handleLessonPick(e: CustomEvent<string>) {
    const topic = e.detail;
    this.currentLesson = topic;
    this.lessonStarted = true;
    await this.sendMessage(`I want to learn about: ${topic}\n\nDesign a lesson plan for this topic, explain the first concept briefly, then write an exercise to /exercise.js.`);
  }

  // --- Send message to agent ---

  private async sendMessage(text: string) {
    if (this.streaming) return;

    this.messages = [...this.messages, { role: "user", text }];
    this.streaming = true;
    this.streamText = "";

    let fullText = "";

    try {
      for await (const event of this.agent.prompt(text)) {
        switch (event.type) {
          case "text_delta":
            fullText += event.delta;
            this.streamText = fullText;
            break;
          case "tool_call_end":
            this.syncEditorFromFS();
            break;
          case "error":
            fullText += `\n❌ Error: ${event.error}`;
            this.streamText = fullText;
            break;
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        fullText += `\n❌ Error: ${e}`;
      }
    }

    this.messages = [...this.messages, { role: "tutor", text: fullText }];
    this.streamText = "";
    this.streaming = false;
    this.syncEditorFromFS();
    this.refreshThreadList();
  }

  private syncEditorFromFS() {
    if (this.agent.fs.exists("/exercise.js")) {
      this.editorCode = this.agent.fs.read("/exercise.js")!;
    }
  }

  // --- Quick actions ---

  private handleCheck() {
    this.agent.fs.write("/exercise.js", this.editorCode);
    this.sendMessage("/check");
  }

  private handleHint() {
    this.sendMessage("/hint");
  }

  private handleNext() {
    this.sendMessage("/next");
  }

  private handleSolution() {
    this.sendMessage("/solution");
  }

  private async handleRun() {
    this.agent.fs.write("/exercise.js", this.editorCode);
    this.output = "Running...\n";
    try {
      const result = await this.runInSandbox(this.editorCode);
      this.output = result || "(no output)";
    } catch (e) {
      this.output = `Error: ${e}`;
    }
  }

  private runInSandbox(code: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const iframe = document.createElement("iframe");
      iframe.sandbox.add("allow-scripts");
      iframe.style.display = "none";
      document.body.appendChild(iframe);

      const logs: string[] = [];
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out (5s)"));
      }, 5000);

      function cleanup() {
        clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        iframe.remove();
      }

      function onMessage(e: MessageEvent) {
        if (e.source !== iframe.contentWindow) return;
        if (e.data?.type === "console") logs.push(e.data.text);
        else if (e.data?.type === "done") { cleanup(); resolve(logs.join("\n")); }
        else if (e.data?.type === "error") { cleanup(); resolve(logs.join("\n") + (logs.length ? "\n" : "") + "Error: " + e.data.text); }
      }

      window.addEventListener("message", onMessage);

      iframe.srcdoc = `<script>
        console.log = (...a) => parent.postMessage({ type: 'console', text: a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') }, '*');
        console.warn = (...a) => parent.postMessage({ type: 'console', text: 'warn: ' + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') }, '*');
        console.error = (...a) => parent.postMessage({ type: 'console', text: 'error: ' + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') }, '*');
        try { ${code.replace(/<\/script>/gi, "<\\/script>")}; parent.postMessage({ type: 'done' }, '*'); }
        catch(e) { parent.postMessage({ type: 'error', text: e.message }, '*'); }
      </script>`;
    });
  }

  // --- Code editor ---

  private handleCodeChange(e: CustomEvent<string>) {
    this.editorCode = e.detail;
  }

  // --- Input ---

  private handleInput(e: Event) {
    this.input = (e.target as HTMLInputElement).value;
    this.updateSuggestions();
  }

  private updateSuggestions() {
    const trimmed = this.input.trim();
    if (trimmed.startsWith("/") && !trimmed.includes(" ")) {
      this.suggestions = this.agent.promptTemplates.search(trimmed.slice(1));
      this.selectedSuggestion = 0;
    } else {
      this.suggestions = [];
    }
  }

  private acceptSuggestion(t: PromptTemplate) {
    this.input = `/${t.name} `;
    this.suggestions = [];
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (this.suggestions.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); this.selectedSuggestion = (this.selectedSuggestion + 1) % this.suggestions.length; return; }
      if (e.key === "ArrowUp") { e.preventDefault(); this.selectedSuggestion = (this.selectedSuggestion - 1 + this.suggestions.length) % this.suggestions.length; return; }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) { e.preventDefault(); this.acceptSuggestion(this.suggestions[this.selectedSuggestion]); return; }
      if (e.key === "Escape") { this.suggestions = []; return; }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      this.handleSubmit();
    }
  }

  private handleSubmit() {
    const text = this.input.trim();
    if (!text || this.streaming) return;
    this.input = "";
    this.suggestions = [];
    this.agent.fs.write("/exercise.js", this.editorCode);
    this.sendMessage(text);
  }

  private handleUserInputSubmit(e: CustomEvent<UserInputResponse>) {
    if (this.pendingInput) {
      this.pendingInput.resolve(e.detail);
      this.pendingInput = null;
    }
  }

  private handleChangeTopic() {
    this.lessonStarted = false;
    this.currentLesson = "";
  }

  // --- Thread actions (all via agent) ---

  private async handleNewThread() {
    await this.agent.newThread();
    this.setupAgent();
    this.dispatchEvent(new CustomEvent("thread-changed", { bubbles: true, composed: true }));
  }

  private async handleSwitchThread(threadId: string) {
    if (threadId === this.agent.activeThreadId) return;
    await this.agent.switchThread(threadId);
    this.setupAgent();
    this.dispatchEvent(new CustomEvent("thread-changed", { bubbles: true, composed: true }));
  }

  private async handleDeleteThread(e: Event, threadId: string) {
    e.stopPropagation();
    await this.agent.deleteThread(threadId);
    this.setupAgent();
    this.dispatchEvent(new CustomEvent("thread-changed", { bubbles: true, composed: true }));
  }

  // --- Render ---

  private renderSidebar() {
    return html`
      <div class="sidebar">
        <div class="sidebar-header">
          <span class="sidebar-title">Sessions</span>
          <button
            class="new-thread-btn"
            @click=${this.handleNewThread}
            title="New session"
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
                  title="Delete session"
                >×</button>
              </div>
            `
          )}
        </div>
      </div>
    `;
  }

  render() {
    if (!this.lessonStarted) {
      return html`
        ${this.renderSidebar()}
        <div class="main-wrapper">
          <lesson-picker @lesson-pick=${this.handleLessonPick}></lesson-picker>
        </div>
      `;
    }

    return html`
      ${this.renderSidebar()}
      <div class="main-wrapper">
        <div class="header">
          <div class="header-left">
            <span class="title">π tutor</span>
            <span class="lesson-name">${this.currentLesson}</span>
          </div>
          <div class="header-actions">
            <button class="header-btn" @click=${this.handleChangeTopic}>Change topic</button>
          </div>
        </div>

        <div class="main">
          <div class="tutor-panel">
            <div class="tutor-messages">
              ${this.messages.map(m =>
                m.role === "user"
                  ? html`<div class="tutor-msg tutor-msg-user">▸ ${m.text.length > 100 ? m.text.slice(0, 100) + "…" : m.text}</div>`
                  : html`<div class="tutor-msg">${m.text}</div>`
              )}
              ${this.streaming && this.streamText
                ? html`<div class="tutor-msg">${this.streamText}<span class="cursor">▊</span></div>`
                : nothing}
            </div>

            <div class="input-bar">
              <div class="input-wrapper">
                ${this.suggestions.length > 0
                  ? html`<div class="autocomplete">
                      ${this.suggestions.map((t, i) => html`
                        <div class="autocomplete-item ${i === this.selectedSuggestion ? "selected" : ""}"
                             @mouseenter=${() => { this.selectedSuggestion = i; }}
                             @click=${() => this.acceptSuggestion(t)}>
                          <span class="autocomplete-name">/${t.name}</span>
                          <span class="autocomplete-desc">${t.description}</span>
                        </div>
                      `)}
                    </div>`
                  : nothing}
                <input
                  .value=${this.input}
                  @input=${this.handleInput}
                  @keydown=${this.handleKeyDown}
                  placeholder="Ask a question or type / for commands…"
                  ?disabled=${this.streaming}
                />
              </div>
              <button class="send-btn"
                @click=${this.streaming ? () => this.agent.abort() : () => this.handleSubmit()}
                ?disabled=${!this.streaming && !this.input.trim()}>
                ${this.streaming ? "Stop" : "Send"}
              </button>
            </div>
          </div>

          <div class="right-panel">
            <div class="quick-actions">
              <button class="action-btn run-btn" @click=${this.handleRun} ?disabled=${this.streaming}>▶ Run</button>
              <button class="action-btn primary" @click=${this.handleCheck} ?disabled=${this.streaming}>✓ Check</button>
              <button class="action-btn" @click=${this.handleHint} ?disabled=${this.streaming}>💡 Hint</button>
              <button class="action-btn" @click=${this.handleNext} ?disabled=${this.streaming}>→ Next</button>
              <button class="action-btn" @click=${this.handleSolution} ?disabled=${this.streaming}>🔓 Solution</button>
            </div>
            <code-editor
              .code=${this.editorCode}
              @code-change=${this.handleCodeChange}
            ></code-editor>
            <output-panel .output=${this.output}></output-panel>
          </div>
        </div>
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
    "tutor-view": TutorView;
  }
}
