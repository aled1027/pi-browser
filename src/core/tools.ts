/**
 * Browser-based tool implementations.
 *
 * These are stubs/sketches — real implementations will come later.
 * The tool system mirrors pi's approach: the model gets tool definitions
 * and can call them during its response.
 */

import type { ToolDefinition, ToolResult } from "./types.js";

function ok(content: string): ToolResult {
  return { content, isError: false };
}

function err(content: string): ToolResult {
  return { content, isError: true };
}

/**
 * A simple in-memory filesystem for the browser.
 * Tools read/write/edit against this.
 */
export class VirtualFS {
  private files = new Map<string, string>();

  read(path: string): string | undefined {
    return this.files.get(this.normalize(path));
  }

  write(path: string, content: string): void {
    this.files.set(this.normalize(path), content);
  }

  delete(path: string): boolean {
    return this.files.delete(this.normalize(path));
  }

  list(prefix = "/"): string[] {
    const norm = this.normalize(prefix);
    // Ensure the prefix ends with "/" for directory matching,
    // so that list("/src") doesn't match "/srclib/foo.ts".
    const dirPrefix = norm === "/" ? "/" : norm.endsWith("/") ? norm : norm + "/";
    return [...this.files.keys()].filter(
      (k) => k === norm || k.startsWith(dirPrefix)
    );
  }

  exists(path: string): boolean {
    return this.files.has(this.normalize(path));
  }

  private normalize(path: string): string {
    // Simple normalization: ensure leading slash, collapse //
    let p = path.startsWith("/") ? path : "/" + path;
    p = p.replace(/\/+/g, "/");
    return p;
  }
}

/** Create the default set of browser tools */
export function createTools(fs: VirtualFS): ToolDefinition[] {
  return [readTool(fs), writeTool(fs), editTool(fs), listTool(fs)];
}

function readTool(fs: VirtualFS): ToolDefinition {
  return {
    name: "read",
    description:
      "Read the contents of a file from the virtual filesystem.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to read" },
      },
      required: ["path"],
    },
    execute: async (args) => {
      const path = args.path as string;
      const content = fs.read(path);
      if (content === undefined) {
        return err(`File not found: ${path}`);
      }
      return ok(content);
    },
  };
}

function writeTool(fs: VirtualFS): ToolDefinition {
  return {
    name: "write",
    description:
      "Write content to a file in the virtual filesystem. Creates or overwrites.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to write to" },
        content: { type: "string", description: "Content to write" },
      },
      required: ["path", "content"],
    },
    execute: async (args) => {
      const path = args.path as string;
      const content = args.content as string;
      fs.write(path, content);
      return ok(`Wrote ${content.length} bytes to ${path}`);
    },
  };
}

function editTool(fs: VirtualFS): ToolDefinition {
  return {
    name: "edit",
    description:
      "Edit a file by replacing exact text. The oldText must match exactly. Only the first occurrence is replaced.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to edit" },
        oldText: {
          type: "string",
          description: "Exact text to find and replace",
        },
        newText: {
          type: "string",
          description: "Replacement text",
        },
      },
      required: ["path", "oldText", "newText"],
    },
    execute: async (args) => {
      const path = args.path as string;
      const oldText = args.oldText as string;
      const newText = args.newText as string;
      const content = fs.read(path);
      if (content === undefined) {
        return err(`File not found: ${path}`);
      }
      if (!content.includes(oldText)) {
        return err(`oldText not found in ${path}`);
      }
      fs.write(path, content.replace(oldText, newText));
      return ok(`Edited ${path}`);
    },
  };
}

function listTool(fs: VirtualFS): ToolDefinition {
  return {
    name: "list",
    description: "List files in the virtual filesystem.",
    parameters: {
      type: "object",
      properties: {
        prefix: {
          type: "string",
          description: "Directory prefix to list (default: /)",
        },
      },
    },
    execute: async (args) => {
      const prefix = (args.prefix as string) ?? "/";
      const files = fs.list(prefix);
      if (files.length === 0) {
        return ok("No files found.");
      }
      return ok(files.join("\n"));
    },
  };
}
