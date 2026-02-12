import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Agent } from "$core";
import { askUserExtension, codeReviewSkill, litComponentSkill, builtinTemplates } from "../../../../src/plugins/index.js";
import "./api-key-screen.js";
import "./chat-view.js";

@customElement("app-root")
export class AppRoot extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
  `;

  @state() private started = false;
  @state() private apiKey = localStorage.getItem("pi-browser-api-key") ?? "";
  private agent: Agent | null = null;

  private handleStart(e: CustomEvent<string>) {
    const key = e.detail;
    localStorage.setItem("pi-browser-api-key", key);
    this.apiKey = key;
    this.agent = new Agent({
      apiKey: key,
      extensions: [askUserExtension],
      skills: [codeReviewSkill, litComponentSkill],
      promptTemplates: builtinTemplates,
    });
    this.started = true;
  }

  render() {
    if (!this.started) {
      return html`<api-key-screen
        .initialKey=${this.apiKey}
        @start-agent=${this.handleStart}
      ></api-key-screen>`;
    }
    return html`<chat-view .agent=${this.agent!}></chat-view>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "app-root": AppRoot;
  }
}
