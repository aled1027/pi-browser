import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { UserInputRequest, UserInputField } from "$core";

@customElement("user-input-form")
export class UserInputFormEl extends LitElement {
  static styles = css`
    :host {
      position: fixed;
      inset: 0;
      background: rgba(10, 10, 20, 0.7);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
      animation: overlay-in 0.15s ease-out;
    }

    @keyframes overlay-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    form {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 28px 32px;
      width: 480px;
      max-width: 90vw;
      max-height: 80vh;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 20px;
      animation: form-in 0.2s ease-out;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
    }

    @keyframes form-in {
      from { opacity: 0; transform: translateY(12px) scale(0.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .header {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .icon { font-size: 20px; }

    h2 {
      font-size: 18px;
      font-weight: 600;
      color: var(--text);
      line-height: 1.3;
      margin: 0;
    }

    .description {
      color: var(--text-muted);
      font-size: 13px;
      line-height: 1.5;
      margin-top: -8px;
    }

    .fields {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .field-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .field-required {
      color: var(--accent);
      margin-left: 3px;
    }

    input[type="text"],
    textarea,
    select {
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--bg-input);
      color: var(--text);
      font-family: inherit;
      font-size: 14px;
      outline: none;
      transition: border-color 0.15s;
    }

    input[type="text"]:focus,
    textarea:focus,
    select:focus {
      border-color: var(--accent);
    }

    textarea {
      resize: vertical;
      min-height: 80px;
      line-height: 1.5;
    }

    select {
      cursor: pointer;
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%238888aa' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 12px center;
      padding-right: 32px;
    }

    .field-confirm {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }

    .confirm-toggle {
      display: flex;
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
    }

    .confirm-btn {
      padding: 8px 20px;
      border: none;
      background: var(--bg-input);
      color: var(--text-muted);
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
    }

    .confirm-btn + .confirm-btn {
      border-left: 1px solid var(--border);
    }

    .confirm-btn.active {
      background: var(--accent);
      color: var(--bg);
    }

    .submit-btn {
      padding: 12px;
      border: none;
      border-radius: 6px;
      background: var(--accent);
      color: var(--bg);
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;
    }

    .submit-btn:hover { opacity: 0.9; }
    .submit-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  `;

  @property({ attribute: false }) request!: UserInputRequest;
  @state() private values: Record<string, string> = {};

  private get fields(): UserInputField[] {
    return (
      this.request.fields ?? [
        {
          name: "answer",
          label: this.request.question,
          type: "text" as const,
          required: true,
        },
      ]
    );
  }

  connectedCallback() {
    super.connectedCallback();
    const initial: Record<string, string> = {};
    for (const f of this.fields) {
      if (f.type === "confirm") {
        initial[f.name] = f.defaultValue ?? "no";
      } else if (f.type === "select" && f.options?.length) {
        initial[f.name] = f.defaultValue ?? f.options[0];
      } else {
        initial[f.name] = f.defaultValue ?? "";
      }
    }
    this.values = initial;
  }

  private setValue(name: string, value: string) {
    this.values = { ...this.values, [name]: value };
  }

  private get canSubmit(): boolean {
    return this.fields
      .filter((f) => f.required)
      .every((f) => this.values[f.name]?.trim());
  }

  private handleSubmit(e: Event) {
    e.preventDefault();
    if (this.canSubmit) {
      this.dispatchEvent(
        new CustomEvent("user-input-submit", {
          detail: this.values,
          bubbles: true,
          composed: true,
        })
      );
    }
  }

  private renderField(field: UserInputField) {
    const label = html`
      <span class="field-label">
        ${field.label}${field.required
          ? html`<span class="field-required">*</span>`
          : nothing}
      </span>
    `;

    switch (field.type) {
      case "textarea":
        return html`
          <div class="field">
            ${label}
            <textarea
              .value=${this.values[field.name] ?? ""}
              @input=${(e: Event) =>
                this.setValue(
                  field.name,
                  (e.target as HTMLTextAreaElement).value
                )}
              placeholder=${field.placeholder ?? ""}
              rows="4"
            ></textarea>
          </div>
        `;

      case "select":
        return html`
          <div class="field">
            ${label}
            <select
              .value=${this.values[field.name] ?? ""}
              @change=${(e: Event) =>
                this.setValue(
                  field.name,
                  (e.target as HTMLSelectElement).value
                )}
            >
              ${(field.options ?? []).map(
                (opt) => html`<option value=${opt}>${opt}</option>`
              )}
            </select>
          </div>
        `;

      case "confirm":
        return html`
          <div class="field field-confirm">
            ${label}
            <div class="confirm-toggle">
              <button
                type="button"
                class="confirm-btn ${this.values[field.name] === "yes"
                  ? "active"
                  : ""}"
                @click=${() => this.setValue(field.name, "yes")}
              >
                Yes
              </button>
              <button
                type="button"
                class="confirm-btn ${this.values[field.name] === "no"
                  ? "active"
                  : ""}"
                @click=${() => this.setValue(field.name, "no")}
              >
                No
              </button>
            </div>
          </div>
        `;

      case "text":
      default:
        return html`
          <div class="field">
            ${label}
            <input
              type="text"
              .value=${this.values[field.name] ?? ""}
              @input=${(e: Event) =>
                this.setValue(
                  field.name,
                  (e.target as HTMLInputElement).value
                )}
              placeholder=${field.placeholder ?? ""}
            />
          </div>
        `;
    }
  }

  render() {
    return html`
      <form @submit=${this.handleSubmit}>
        <div class="header">
          <span class="icon">💬</span>
          <h2>${this.request.question}</h2>
        </div>

        ${this.request.description
          ? html`<p class="description">${this.request.description}</p>`
          : nothing}

        <div class="fields">
          ${this.fields.map((f) => this.renderField(f))}
        </div>

        <button type="submit" class="submit-btn" ?disabled=${!this.canSubmit}>
          Submit
        </button>
      </form>
    `;
  }
}


