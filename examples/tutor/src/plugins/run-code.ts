/**
 * run_code extension
 *
 * Registers a `run_code` tool that executes JavaScript in a sandboxed iframe
 * and returns the console output. Used by the tutor to verify student solutions.
 */

import type { Extension } from "pi-browser";

export const runCodeExtension: Extension = (agent) => {
  agent.registerTool({
    name: "run_code",
    description: `Execute JavaScript code in a sandboxed browser iframe and return the console output.
Use this to test student solutions or demonstrate code behavior.
Returns all console.log/warn/error output as text. Execution has a 5-second timeout.

Example: run_code({ code: "console.log(2 + 2)" }) → "4"`,
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "JavaScript code to execute",
        },
      },
      required: ["code"],
    },
    execute: async (args) => {
      const code = args.code as string;
      try {
        const output = await executeInSandbox(code);
        return { content: output || "(no output)", isError: false };
      } catch (e) {
        return { content: `Error: ${e}`, isError: true };
      }
    },
  });
};

function executeInSandbox(code: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.sandbox.add("allow-scripts");
    iframe.style.display = "none";
    document.body.appendChild(iframe);

    const logs: string[] = [];
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Execution timed out (5s)"));
    }, 5000);

    function cleanup() {
      clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      iframe.remove();
    }

    function onMessage(e: MessageEvent) {
      if (e.source !== iframe.contentWindow) return;
      const data = e.data;
      if (data?.type === "console") {
        logs.push(data.text);
      } else if (data?.type === "done") {
        cleanup();
        resolve(logs.join("\n"));
      } else if (data?.type === "error") {
        cleanup();
        resolve(logs.join("\n") + (logs.length ? "\n" : "") + "Error: " + data.text);
      }
    }

    window.addEventListener("message", onMessage);

    const wrappedCode = `
      <script>
        const _logs = [];
        const _origLog = console.log;
        const _origWarn = console.warn;
        const _origError = console.error;

        function _capture(level, args) {
          const text = args.map(a => {
            try { return typeof a === 'string' ? a : JSON.stringify(a); }
            catch { return String(a); }
          }).join(' ');
          parent.postMessage({ type: 'console', text: (level === 'log' ? '' : level + ': ') + text }, '*');
        }

        console.log = (...a) => _capture('log', a);
        console.warn = (...a) => _capture('warn', a);
        console.error = (...a) => _capture('error', a);

        try {
          ${code.replace(/<\/script>/gi, "<\\/script>")}
          parent.postMessage({ type: 'done' }, '*');
        } catch(e) {
          parent.postMessage({ type: 'error', text: e.message }, '*');
        }
      </script>
    `;

    iframe.srcdoc = wrappedCode;
  });
}
