import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";

@customElement("api-key-screen")
export class ApiKeyScreen extends LitElement {
  static styles = css`
    :host {
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .card {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 32px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--bg-secondary);
      width: 400px;
      max-width: 90vw;
    }

    h1 {
      font-size: 24px;
      color: var(--accent);
      margin: 0;
    }

    .subtitle {
      color: var(--text-muted);
      margin-bottom: 8px;
    }

    label {
      font-size: 12px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    input {
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: var(--bg-input);
      color: var(--text);
      font-family: inherit;
      font-size: 14px;
      outline: none;
    }

    input:focus {
      border-color: var(--accent);
    }

    button {
      padding: 10px;
      border: none;
      border-radius: 4px;
      background: var(--accent);
      color: var(--bg);
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }

    button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .hint {
      font-size: 12px;
      color: var(--text-muted);
    }

    .hint a {
      color: var(--accent);
    }
  `;

  @property() initialKey = "";
  @state() private key = "";

  connectedCallback() {
    super.connectedCallback();
    this.key = this.initialKey;
  }

  private handleInput(e: Event) {
    this.key = (e.target as HTMLInputElement).value;
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && this.key.trim()) {
      this.fireStart();
    }
  }

  private fireStart() {
    this.dispatchEvent(
      new CustomEvent("start-agent", {
        detail: this.key.trim(),
        bubbles: true,
        composed: true,
      })
    );
  }

  render() {
    return html`
      <div class="card">
        <h1>π browser</h1>
        <p class="subtitle">A browser-based coding agent</p>
        <label for="api-key">OpenRouter API Key</label>
        <input
          id="api-key"
          type="password"
          .value=${this.key}
          @input=${this.handleInput}
          @keydown=${this.handleKeyDown}
          placeholder="sk-or-..."
          autofocus
        />
        <button ?disabled=${!this.key.trim()} @click=${this.fireStart}>
          Start
        </button>
        <p class="hint">
          Key is stored in localStorage. Get one at
          <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer"
            >openrouter.ai/keys</a
          >
        </p>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "api-key-screen": ApiKeyScreen;
  }
}
