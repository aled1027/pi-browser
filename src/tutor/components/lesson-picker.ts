import { LitElement, html, css } from "lit";
import { customElement } from "lit/decorators.js";
import { tutorLessons } from "../../plugins/tutor/index.js";

const LESSON_ICONS: Record<string, string> = {
  arrays: "📦",
  functions: "⚡",
  async: "⏳",
  dom: "🖱️",
  objects: "🧱",
  "spanish-basics": "🇪🇸",
  "spanish-verbs": "🔤",
  "spanish-vocab": "🗣️",
  "spanish-sentences": "💬",
};

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
    }

    .lessons {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 12px;
      width: 100%;
    }

    .lesson-card {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--bg-secondary);
      cursor: pointer;
      transition: all 0.15s;
    }

    .lesson-card:hover {
      border-color: var(--accent);
      background: var(--bg-input);
    }

    .lesson-icon {
      font-size: 24px;
      flex-shrink: 0;
    }

    .lesson-info {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .lesson-name {
      font-weight: 600;
      color: var(--text);
      font-size: 14px;
      text-transform: capitalize;
    }

    .lesson-desc {
      color: var(--text-muted);
      font-size: 12px;
      line-height: 1.4;
    }
  `;

  private handlePick(name: string) {
    this.dispatchEvent(new CustomEvent("lesson-pick", {
      detail: name,
      bubbles: true,
      composed: true,
    }));
  }

  render() {
    return html`
      <div class="container">
        <div class="heading">
          <h1>π tutor</h1>
          <p class="subtitle">Pick a topic to start learning</p>
        </div>
        <div class="lessons">
          ${tutorLessons.map(lesson => html`
            <div class="lesson-card" @click=${() => this.handlePick(lesson.name)}>
              <span class="lesson-icon">${LESSON_ICONS[lesson.name] ?? "📘"}</span>
              <div class="lesson-info">
                <span class="lesson-name">${lesson.name}</span>
                <span class="lesson-desc">${lesson.description}</span>
              </div>
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
