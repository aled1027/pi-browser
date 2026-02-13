import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";

const SUGGESTED_TOPICS = [
  { icon: "🐍", label: "Python basics" },
  { icon: "🇪🇸", label: "Spanish" },
  { icon: "📐", label: "Linear algebra" },
  { icon: "🎹", label: "Music theory" },
  { icon: "🧪", label: "Chemistry" },
  { icon: "🌍", label: "World history" },
  { icon: "🧠", label: "Psychology" },
  { icon: "📊", label: "Statistics" },
  { icon: "🇫🇷", label: "French" },
  { icon: "⚡", label: "JavaScript" },
  { icon: "🎨", label: "Color theory" },
  { icon: "🪐", label: "Astronomy" },
];

@customElement("lesson-picker")
export class LessonPicker extends LitElement {
  static styles = css`
    :host {
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 32px;
      max-width: 600px;
      width: 90vw;
    }

    .heading {
      text-align: center;
    }

    h1 {
      font-size: 28px;
      color: var(--accent);
      margin: 0 0 8px;
    }

    .subtitle {
      color: var(--text-muted);
      font-size: 14px;
      margin: 0;
    }

    .input-row {
      display: flex;
      gap: 8px;
      width: 100%;
    }

    .topic-input {
      flex: 1;
      padding: 12px 16px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--bg-input);
      color: var(--text);
      font-family: inherit;
      font-size: 15px;
      outline: none;
    }

    .topic-input:focus {
      border-color: var(--accent);
    }

    .topic-input::placeholder {
      color: var(--text-muted);
    }

    .start-btn {
      padding: 12px 24px;
      border: none;
      border-radius: 8px;
      background: var(--accent);
      color: var(--bg);
      font-family: inherit;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      transition: opacity 0.15s;
    }

    .start-btn:hover {
      opacity: 0.9;
    }

    .start-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .suggestions-label {
      color: var(--text-muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin: 0;
      align-self: flex-start;
    }

    .suggestions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      width: 100%;
    }

    .suggestion {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border: 1px solid var(--border);
      border-radius: 20px;
      background: var(--bg-secondary);
      cursor: pointer;
      font-size: 13px;
      color: var(--text);
      transition: all 0.15s;
    }

    .suggestion:hover {
      border-color: var(--accent);
      color: var(--accent);
    }

    .suggestion-icon {
      font-size: 16px;
    }
  `;

  @state() private topic = "";

  private handleSubmit() {
    const trimmed = this.topic.trim();
    if (!trimmed) return;
    this.dispatchEvent(new CustomEvent("lesson-pick", {
      detail: trimmed,
      bubbles: true,
      composed: true,
    }));
  }

  private handleSuggestionClick(label: string) {
    this.topic = label;
    this.dispatchEvent(new CustomEvent("lesson-pick", {
      detail: label,
      bubbles: true,
      composed: true,
    }));
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      this.handleSubmit();
    }
  }

  render() {
    return html`
      <div class="container">
        <div class="heading">
          <h1>τ tutor</h1>
          <p class="subtitle">What would you like to learn today?</p>
        </div>

        <div class="input-row">
          <input
            class="topic-input"
            type="text"
            .value=${this.topic}
            @input=${(e: Event) => { this.topic = (e.target as HTMLInputElement).value; }}
            @keydown=${this.handleKeyDown}
            placeholder="Type any topic — e.g. &quot;Spanish verbs&quot;, &quot;calculus&quot;, &quot;guitar chords&quot;…"
            autofocus
          />
          <button class="start-btn" @click=${this.handleSubmit} ?disabled=${!this.topic.trim()}>
            Start →
          </button>
        </div>

        <p class="suggestions-label">Or pick a suggestion</p>
        <div class="suggestions">
          ${SUGGESTED_TOPICS.map(t => html`
            <div class="suggestion" @click=${() => this.handleSuggestionClick(t.label)}>
              <span class="suggestion-icon">${t.icon}</span>
              ${t.label}
            </div>
          `)}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "lesson-picker": LessonPicker;
  }
}
