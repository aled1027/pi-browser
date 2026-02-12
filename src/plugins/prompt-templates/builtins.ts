import type { PromptTemplate } from "$core";

export const builtinTemplates: PromptTemplate[] = [
  {
    name: "review",
    description: "Review code in a file for issues",
    body: `Review the code in $1. Focus on bugs, security issues, and maintainability. Be specific about line numbers and suggest fixes.`,
  },
  {
    name: "explain",
    description: "Explain how code works",
    body: `Explain how the code in $1 works. Walk through the logic step by step. $\{@:2\}`,
  },
  {
    name: "refactor",
    description: "Refactor code for improvement",
    body: `Refactor the code in $1 to improve $\{@:2\}. Show the changes using the edit tool.`,
  },
  {
    name: "test",
    description: "Write tests for a file",
    body: `Write tests for $1. Cover the main functionality, edge cases, and error conditions.`,
  },
  {
    name: "component",
    description: "Create a Lit web component",
    body: `Create a Lit web component named $1. Requirements: $\{@:2\}

Use TypeScript with decorators. Put styles in static styles using css tagged template.`,
  },
  {
    name: "fix",
    description: "Fix a bug or issue",
    body: `Fix the following issue: $@

Read the relevant files, identify the root cause, and apply the fix using the edit tool.`,
  },
  {
    name: "help",
    description: "Show available prompt templates",
    body: `List all the prompt templates I can use. For each one, show the /command name, what it does, and example usage.`,
  },
];
