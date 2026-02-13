/**
 * run-javascript extension
 *
 * Registers a `run_javascript` tool that lets the model execute arbitrary
 * JavaScript code in the browser. This replaces the need to create individual
 * extensions for simple tasks — instead of writing an extension that registers
 * a `current_time` tool, the model can simply run `new Date().toLocaleString()`.
 *
 * The code runs in the browser context via `new Function()` and has access to
 * all browser APIs (Date, fetch, crypto, DOM, etc.).
 *
 * Usage by the model:
 *   run_javascript({ code: "new Date().toLocaleString()" })
 *   run_javascript({ code: "const resp = await fetch('https://api.example.com/data'); return await resp.json();" })
 */

import type { Extension } from "../../extensions.js";

export const runJavascriptExtension: Extension = (agent) => {
  agent.registerTool({
    name: "run_javascript",
    description: `Execute JavaScript code in the browser and return the result.

The code runs in an async context — you can use \`await\` and \`return\` directly.
The last expression's value (or explicit \`return\`) becomes the result.
If the result is an object/array, it will be JSON-stringified.

The code has access to all browser APIs: Date, fetch, crypto, localStorage,
document, navigator, URL, TextEncoder/TextDecoder, etc.

Examples:
  - Get current time: \`return new Date().toLocaleString()\`
  - Fetch data: \`const r = await fetch('https://api.example.com/data'); return await r.text()\`
  - Generate UUID: \`return crypto.randomUUID()\`
  - Math: \`return Math.sqrt(144)\`
  - DOM query: \`return document.title\`
  - Access the tau agent: \`return window.__TAU_AGENT__.getMessages().length\`

The tau Agent instance is available at \`window.__TAU_AGENT__\`. You can use it to
modify yourself at runtime — register tools, add extensions, add skills, listen to events, etc.
See the Agent/ExtensionHost API for available methods (registerTool, addExtension, addSkill, on, etc.).`,
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description:
            "JavaScript code to execute. Runs in an async function body — use `return` for the result and `await` for promises.",
        },
      },
      required: ["code"],
      additionalProperties: false,
    },
    execute: async (args) => {
      const code = args.code as string;
      try {
        // Wrap in async function so await works
        const fn = new Function("return (async () => {" + code + "\n})()");
        const result = await fn();

        // Convert result to string
        let content: string;
        if (result === undefined || result === null) {
          content = String(result);
        } else if (typeof result === "string") {
          content = result;
        } else {
          try {
            content = JSON.stringify(result, null, 2);
          } catch {
            content = String(result);
          }
        }

        return { content, isError: false };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { content: `JavaScript error: ${message}`, isError: true };
      }
    },
  });
};
