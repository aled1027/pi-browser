/**
 * ask-user extension
 *
 * Registers an `ask_user` tool that lets the model ask the user a question
 * via a browser-friendly form. Supports free-text, textarea, select, and
 * confirm field types. The model can ask a single question or build a
 * multi-field form.
 *
 * Usage by the model:
 *   ask_user({ question: "What language?", fields: [{ name: "lang", label: "Language", type: "select", options: ["TypeScript", "Python", "Rust"] }] })
 *   ask_user({ question: "What should the app do?" })                         // single text input
 *   ask_user({ question: "Proceed with deletion?", fields: [{ name: "ok", label: "Confirm", type: "confirm" }] })
 */

import type { Extension } from "../../extensions.js";

export const askUserExtension: Extension = (agent) => {
  agent.registerTool({
    name: "ask_user",
    description: `Ask the user a question and wait for their answer via a browser form.
Use this whenever you need clarification, a decision, or any input from the user.

The simplest form is a single question (renders as a text input):
  { "question": "What should the project be called?" }

For structured input, provide fields:
  {
    "question": "Project setup",
    "description": "I need a few details before I start.",
    "fields": [
      { "name": "name", "label": "Project name", "type": "text", "required": true },
      { "name": "description", "label": "Describe the project", "type": "textarea" },
      { "name": "language", "label": "Language", "type": "select", "options": ["TypeScript", "Python", "Rust"] },
      { "name": "confirm", "label": "Ready to start?", "type": "confirm" }
    ]
  }

Field types:
  - "text": single-line text input
  - "textarea": multi-line text input
  - "select": dropdown (requires "options" array)
  - "confirm": yes/no toggle

Returns a JSON object mapping field names to the user's answers.
If no fields are specified, returns { "answer": "<user's text>" }.`,
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The headline question to show the user",
        },
        description: {
          type: "string",
          description: "Optional longer description shown below the question",
        },
        fields: {
          type: "array",
          description:
            "Form fields. If omitted, a single text input is shown.",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Field key in the response" },
              label: { type: "string", description: "Label shown to the user" },
              type: {
                type: "string",
                enum: ["text", "textarea", "select", "confirm"],
                description: "Input type",
              },
              placeholder: { type: "string", description: "Placeholder text" },
              options: {
                type: "array",
                items: { type: "string" },
                description: "Options for select fields",
              },
              defaultValue: { type: "string", description: "Default value" },
              required: { type: "boolean", description: "Whether field is required" },
            },
            required: ["name", "label", "type"],
          },
        },
      },
      required: ["question"],
    },
    execute: async (args) => {
      const question = args.question as string;
      const description = args.description as string | undefined;
      const fields = args.fields as Array<{
        name: string;
        label: string;
        type: "text" | "textarea" | "select" | "confirm";
        placeholder?: string;
        options?: string[];
        defaultValue?: string;
        required?: boolean;
      }> | undefined;

      try {
        const response = await agent.requestUserInput({
          question,
          description,
          fields: fields ?? [
            {
              name: "answer",
              label: question,
              type: "text",
              required: true,
            },
          ],
        });

        return {
          content: JSON.stringify(response, null, 2),
          isError: false,
        };
      } catch (e) {
        return {
          content: `User input cancelled or failed: ${e}`,
          isError: true,
        };
      }
    },
  });
};
