/**
 * add-extension extension
 *
 * Registers `add_extension` and `remove_extension` tools that let the model
 * dynamically add or remove extensions at runtime. Extensions are persisted
 * to the virtual filesystem and auto-loaded on future sessions.
 *
 * The model provides a JavaScript function expression `(agent) => { ... }`
 * that receives an ExtensionHost and can call agent.registerTool(), etc.
 *
 * Usage by the model:
 *   add_extension({ source: "(agent) => { agent.registerTool({ ... }) }", filename: "my-ext" })
 *   remove_extension({ name: "my-ext" })
 */

import type { Extension } from "../../extensions.js";

export const addExtensionExtension: Extension = (agent) => {
  agent.registerTool({
    name: "add_extension",
    description: `Dynamically add an extension to the agent at runtime. The extension is persisted and auto-loaded in future sessions.

The source must be a JavaScript function expression that receives an ExtensionHost:
  (agent) => {
    agent.registerTool({
      name: "my_tool",
      description: "What the tool does",
      parameters: { type: "object", properties: { ... }, required: [...] },
      execute: async (args) => ({ content: "result string", isError: false })
    });
  }

Important: tools must have an \`execute\` function (not \`handler\`) that returns { content: string, isError: boolean }.`,
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description:
            "JavaScript source code of the extension. Must be a function expression like `(agent) => { ... }`.",
        },
        filename: {
          type: "string",
          description:
            "Short identifier for the extension (no path or .js extension). Used to reference it later for removal.",
        },
      },
      required: ["source", "filename"],
      additionalProperties: false,
    },
    execute: async (args) => {
      const source = args.source as string;
      const filename = args.filename as string;
      try {
        await agent.addExtension(source, filename);
        return {
          content: `Extension "${filename}" added successfully.`,
          isError: false,
        };
      } catch (e) {
        return {
          content: `Failed to add extension: ${e}`,
          isError: true,
        };
      }
    },
  });

  agent.registerTool({
    name: "remove_extension",
    description:
      "Remove a previously added extension by name. Unregisters its tools and removes it from persistence.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The filename/identifier of the extension to remove.",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
    execute: async (args) => {
      const name = args.name as string;
      try {
        await agent.removeExtension(name);
        return {
          content: `Extension "${name}" removed successfully.`,
          isError: false,
        };
      } catch (e) {
        return {
          content: `Failed to remove extension: ${e}`,
          isError: true,
        };
      }
    },
  });
};
