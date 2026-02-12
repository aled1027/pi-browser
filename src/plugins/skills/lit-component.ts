import type { Skill } from "$core";

export const litComponentSkill: Skill = {
  name: "lit-component",
  description:
    "Create well-structured Lit web components with TypeScript. Use when asked to build UI components, pages, or web component features.",
  content: `# Lit Web Component Creation

## Guidelines

When creating Lit web components:

### Structure
- One component per file
- Use the \`@customElement\` decorator
- Extend \`LitElement\`
- Use \`static styles = css\\\`...\\\`\` for scoped styles
- Use TypeScript decorators for properties and state

### Properties & State
\`\`\`typescript
import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";

@customElement("my-component")
export class MyComponent extends LitElement {
  /** Public reactive properties (set via attributes/properties) */
  @property() title = "";
  @property({ type: Boolean }) disabled = false;

  /** Internal reactive state */
  @state() private count = 0;
}
\`\`\`

### Events
- Dispatch CustomEvents for parent communication
- Use \`bubbles: true, composed: true\` to cross shadow DOM boundaries
\`\`\`typescript
this.dispatchEvent(new CustomEvent("my-event", {
  detail: { value: 42 },
  bubbles: true,
  composed: true,
}));
\`\`\`

### Accessibility
- Use semantic HTML elements
- Add ARIA labels where needed
- Ensure keyboard navigation works
- Maintain sufficient color contrast

### Patterns
- Loading states: show skeleton or spinner
- Error states: show error message with retry option
- Empty states: show helpful message or call to action
- Use \`nothing\` from lit for conditional rendering
- Use \`repeat\` directive for keyed lists

## File Template

Write each component as a single .ts file with styles co-located using \`static styles\`.`,
};
