import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("output-panel")
export class OutputPanel extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 160px;
      min-height: 100px;
      flex-shrink: 0;
      border-top: 1px solid var(--border);
    }

    .panel-header {
      display: flex;
      align-items: center;
      padding: 6px 12px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }

    .panel-title {
      font-size: 12px;
      color: var(--text-muted);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .output {
      flex: 1;
      overflow-y: auto;
      padding: 10px 12px;
      background: var(--bg-editor, var(--bg));
      font-size: 12px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--accent-green, #2ecc71);
    }

    .empty {
      color: var(--text-muted);
      font-style: italic;
    }
  `;

  @property() output = "";

  render() {
    return html`
      <div class="panel-header">
        <span class="panel-title">▸ Output</span>
      </div>
      <div class="output ${this.output ? "" : "empty"}">
        ${this.output || "Click ▶ Run to see output here"}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "output-panel": OutputPanel;
  }
}
