import type { Skill } from "../skills";

export const reactComponentSkill: Skill = {
  name: "react-component",
  description:
    "Create well-structured React components with TypeScript. Use when asked to build UI components, pages, or React features.",
  content: `# React Component Creation

## Guidelines

When creating React components:

### Structure
- One component per file
- Use functional components with hooks
- Export the component as a named export
- Co-locate CSS in a \`.css\` file with the same name
- Use TypeScript interfaces for props

### Props
\`\`\`typescript
interface Props {
  /** Document all props with JSDoc */
  title: string;
  /** Optional props should have defaults */
  variant?: "primary" | "secondary";
  /** Event handlers follow onXxx naming */
  onClick?: () => void;
  /** Children when the component wraps content */
  children?: React.ReactNode;
}
\`\`\`

### State Management
- Keep state as local as possible
- Lift state up only when shared between siblings
- Use \`useCallback\` for event handlers passed to children
- Use \`useMemo\` only for expensive computations

### Accessibility
- Use semantic HTML elements
- Add ARIA labels where needed
- Ensure keyboard navigation works
- Maintain sufficient color contrast

### Patterns
- Loading states: show skeleton or spinner
- Error states: show error message with retry option
- Empty states: show helpful message or call to action

## File Template

\`\`\`
/components/MyComponent.tsx   — Component + types
/components/MyComponent.css   — Styles
\`\`\`

Write both files using the write tool.`,
};
