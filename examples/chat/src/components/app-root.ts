import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Agent, addExtensionExtension, askUserExtension, runJavascriptExtension, codeReviewSkill, litComponentSkill, builtinTemplates } from "tau";
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
  @state() private apiKey = localStorage.getItem("tau-api-key") ?? "";
  @state() private agentVersion = 0; // bump to force chat-view re-render on thread switch
  private agent: Agent | null = null;

  connectedCallback() {
    super.connectedCallback();
    if (this.apiKey) {
      this.startWithKey(this.apiKey);
    }
  }

  private async startWithKey(key: string) {
    localStorage.setItem("tau-api-key", key);
    this.apiKey = key;

    this.agent = await Agent.create({
      apiKey: key,
      extensions: [addExtensionExtension, askUserExtension, runJavascriptExtension],
      skills: [codeReviewSkill, litComponentSkill],
      promptTemplates: builtinTemplates,
    });
    this.started = true;
  }

  private handleStart(e: CustomEvent<string>) {
    this.startWithKey(e.detail);
  }

  private async handleThreadChanged() {
    // Agent has already switched internally — just force re-render
    this.agentVersion++;
  }

  render() {
    if (!this.started) {
      return html`<api-key-screen
        .initialKey=${this.apiKey}
        @start-agent=${this.handleStart}
      ></api-key-screen>`;
    }
    return html`<chat-view
      .agent=${this.agent!}
      .agentVersion=${this.agentVersion}
      @thread-changed=${this.handleThreadChanged}
    ></chat-view>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "app-root": AppRoot;
  }
}
