import type { PromptTemplate } from "$core";

export const tutorTemplates: PromptTemplate[] = [
  {
    name: "check",
    description: "Check your solution",
    body: `Read /exercise.js and evaluate my solution. Tell me if it's correct. If not, explain what's wrong and give a hint toward the fix — but don't give me the answer directly.`,
  },
  {
    name: "hint",
    description: "Get a hint for the current exercise",
    body: `I'm stuck on the current exercise in /exercise.js. Give me a small hint to nudge me in the right direction. Don't reveal the full solution.`,
  },
  {
    name: "next",
    description: "Move to the next exercise",
    body: `I'm ready for the next exercise. Move to the next concept in the current lesson and write a new exercise to /exercise.js. Briefly explain the new concept first.`,
  },
  {
    name: "explain",
    description: "Explain a concept in more detail",
    body: `Explain this in more detail: $@. Use simple examples.`,
  },
  {
    name: "solution",
    description: "Show the solution (give up)",
    body: `I give up on this one. Show me the solution for /exercise.js, explain how it works step by step, then write the next exercise.`,
  },
];
