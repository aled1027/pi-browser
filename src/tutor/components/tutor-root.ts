import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Agent } from "../../lib/index.js";
import { tutorLessons, tutorTemplates, runCodeExtension } from "../../plugins/tutor/index.js";
import { askUserExtension } from "../../plugins/extensions/ask-user.js";
import "../../app/components/api-key-screen.js";
import "./tutor-view.js";

const TUTOR_SYSTEM_PROMPT = `You are π tutor, a friendly and patient tutor running in the browser. You teach programming and languages.

## Your role
You teach by guiding, not by giving answers. You explain concepts clearly, write exercises, check student work, and give encouraging feedback.

## Environment
You have a virtual filesystem. The student's exercise file is always at /exercise.js.
You have a run_code tool to execute JavaScript and see the output.
All exercises are written as .js files — even language exercises use console.log() for answers so the student can run them.

## How to teach
1. When a lesson begins, briefly explain the first concept, then write an exercise to /exercise.js
2. When the student edits their code and uses /check, read /exercise.js, run it with run_code, and evaluate
3. Give specific feedback — point to the exact issue, don't just say "wrong"
4. Celebrate correct solutions! Then ask if they want to continue with /next
5. When giving hints, give the SMALLEST useful nudge. Never show the full answer for /hint.
6. Keep explanations short and example-driven

## Language lessons (Spanish, etc.)
- Exercises use console.log("answer") so they can be run and checked
- Be lenient with accents/punctuation but always show the correct form
- Include pronunciation tips in parentheses
- Mix translation directions (English→Spanish and Spanish→English)
- Keep a warm, encouraging tone — language learning takes practice!

## Formatting
- Use short paragraphs
- Use \`inline code\` for identifiers and foreign words
- Use code blocks for examples
- Use ✅ for correct, ❌ for incorrect, 💡 for hints`;

@customElement("tutor-root")
export class TutorRoot extends LitElement {
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
      systemPrompt: TUTOR_SYSTEM_PROMPT,
      extensions: [runCodeExtension, askUserExtension],
      skills: tutorLessons,
      promptTemplates: tutorTemplates,
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
    return html`<tutor-view .agent=${this.agent!}></tutor-view>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "tutor-root": TutorRoot;
  }
}
