import { LitElement, html, css } from "lit";
import { customElement, property, query } from "lit/decorators.js";

@customElement("code-editor")
export class CodeEditor extends LitElement {
  static styles = css`
    :host {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }

    .editor-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 12px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }

    .filename {
      font-size: 12px;
      color: var(--accent);
      font-weight: 600;
    }

    .editor-hint {
      font-size: 11px;
      color: var(--text-muted);
    }

    textarea {
      flex: 1;
      width: 100%;
      padding: 16px;
      border: none;
      background: var(--bg-editor, var(--bg));
      color: var(--text);
      font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
      font-size: 13px;
      line-height: 1.6;
      resize: none;
      outline: none;
      tab-size: 2;
      white-space: pre;
      overflow: auto;
    }
  `;

  @property() code = "";
  @query("textarea") private textarea!: HTMLTextAreaElement;

  private handleInput() {
    this.dispatchEvent(new CustomEvent("code-change", {
      detail: this.textarea.value,
      bubbles: true,
      composed: true,
    }));
  }

  private handleKeyDown(e: KeyboardEvent) {
    // Tab inserts 2 spaces instead of moving focus
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = this.textarea;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const val = ta.value;
      ta.value = val.substring(0, start) + "  " + val.substring(end);
      ta.selectionStart = ta.selectionEnd = start + 2;
      this.handleInput();
    }
  }

  render() {
    return html`
      <div class="editor-header">
        <span class="filename">/exercise.js</span>
        <span class="editor-hint">Edit your solution here</span>
      </div>
      <textarea
        .value=${this.code}
        @input=${this.handleInput}
        @keydown=${this.handleKeyDown}
        spellcheck="false"
      ></textarea>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "code-editor": CodeEditor;
  }
}
