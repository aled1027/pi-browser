/**
 * Tests for plugin extensions: add-extension, ask-user, run-javascript.
 *
 * Each plugin is an Extension function that registers tools.
 * We test the tools' execute() functions in isolation by creating
 * a fake ExtensionHost, loading the extension, and calling the tools.
 */

import { describe, it, expect, vi } from "vitest";
import type { ToolDefinition, AgentEvent } from "../types.js";
import type { ExtensionHost, UserInputRequest, UserInputResponse } from "../extensions.js";
import { addExtensionExtension } from "../plugins/extensions/add-extension.js";
import { askUserExtension } from "../plugins/extensions/ask-user.js";
import { runJavascriptExtension } from "../plugins/extensions/run-javascript.js";
import { builtinTemplates } from "../plugins/prompt-templates/builtins.js";

// ─── Helpers ────────────────────────────────────────────────────────

function createFakeHost() {
  const tools: ToolDefinition[] = [];
  const addExtensionFn = vi.fn<(source: string, filename: string) => Promise<void>>();
  const removeExtensionFn = vi.fn<(name: string) => Promise<void>>();
  const requestUserInputFn = vi.fn<(req: UserInputRequest) => Promise<UserInputResponse>>();

  const host: ExtensionHost = {
    registerTool: (tool: ToolDefinition) => { tools.push(tool); },
    on: (_event: "agent_event", _handler: (e: AgentEvent) => void) => () => {},
    requestUserInput: requestUserInputFn,
    addExtension: addExtensionFn,
    removeExtension: removeExtensionFn,
  };

  function getTool(name: string): ToolDefinition {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`Tool "${name}" not found. Registered: ${tools.map(t => t.name).join(", ")}`);
    return tool;
  }

  return { host, tools, getTool, addExtensionFn, removeExtensionFn, requestUserInputFn };
}

// ─── add-extension plugin ───────────────────────────────────────────

describe("addExtensionExtension", () => {
  it("should register add_extension and remove_extension tools", () => {
    const { host, tools } = createFakeHost();
    addExtensionExtension(host);

    const names = tools.map((t) => t.name);
    expect(names).toContain("add_extension");
    expect(names).toContain("remove_extension");
  });

  describe("add_extension tool", () => {
    it("should call host.addExtension with source and filename", async () => {
      const { host, getTool, addExtensionFn } = createFakeHost();
      addExtensionFn.mockResolvedValue(undefined);
      addExtensionExtension(host);

      const tool = getTool("add_extension");
      const result = await tool.execute({
        source: '(agent) => { agent.registerTool({ name: "x", description: "x", parameters: {}, execute: async () => ({ content: "ok", isError: false }) }); }',
        filename: "my-ext",
      });

      expect(result.isError).toBe(false);
      expect(result.content).toContain("my-ext");
      expect(result.content).toContain("added successfully");
      expect(addExtensionFn).toHaveBeenCalledWith(
        expect.stringContaining("(agent) =>"),
        "my-ext"
      );
    });

    it("should return error when addExtension throws", async () => {
      const { host, getTool, addExtensionFn } = createFakeHost();
      addExtensionFn.mockRejectedValue(new Error("invalid source"));
      addExtensionExtension(host);

      const tool = getTool("add_extension");
      const result = await tool.execute({
        source: "bad code",
        filename: "broken",
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain("Failed to add extension");
      expect(result.content).toContain("invalid source");
    });
  });

  describe("remove_extension tool", () => {
    it("should call host.removeExtension with the name", async () => {
      const { host, getTool, removeExtensionFn } = createFakeHost();
      removeExtensionFn.mockResolvedValue(undefined);
      addExtensionExtension(host);

      const tool = getTool("remove_extension");
      const result = await tool.execute({ name: "my-ext" });

      expect(result.isError).toBe(false);
      expect(result.content).toContain("my-ext");
      expect(result.content).toContain("removed successfully");
      expect(removeExtensionFn).toHaveBeenCalledWith("my-ext");
    });

    it("should return error when removeExtension throws", async () => {
      const { host, getTool, removeExtensionFn } = createFakeHost();
      removeExtensionFn.mockRejectedValue(new Error("not found"));
      addExtensionExtension(host);

      const tool = getTool("remove_extension");
      const result = await tool.execute({ name: "nonexistent" });

      expect(result.isError).toBe(true);
      expect(result.content).toContain("Failed to remove extension");
    });
  });
});

// ─── ask-user plugin ────────────────────────────────────────────────

describe("askUserExtension", () => {
  it("should register an ask_user tool", () => {
    const { host, tools } = createFakeHost();
    askUserExtension(host);
    expect(tools.map((t) => t.name)).toContain("ask_user");
  });

  it("should delegate simple question to requestUserInput with default text field", async () => {
    const { host, getTool, requestUserInputFn } = createFakeHost();
    requestUserInputFn.mockResolvedValue({ answer: "TypeScript" });
    askUserExtension(host);

    const tool = getTool("ask_user");
    const result = await tool.execute({ question: "What language?" });

    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.content);
    expect(parsed.answer).toBe("TypeScript");

    expect(requestUserInputFn).toHaveBeenCalledWith({
      question: "What language?",
      description: undefined,
      fields: [{ name: "answer", label: "What language?", type: "text", required: true }],
    });
  });

  it("should pass custom fields to requestUserInput", async () => {
    const { host, getTool, requestUserInputFn } = createFakeHost();
    requestUserInputFn.mockResolvedValue({ lang: "Rust", confirm: "true" });
    askUserExtension(host);

    const tool = getTool("ask_user");
    const fields = [
      { name: "lang", label: "Language", type: "select", options: ["TS", "Rust"] },
      { name: "confirm", label: "Sure?", type: "confirm" },
    ];
    const result = await tool.execute({
      question: "Setup",
      description: "Configure the project",
      fields,
    });

    expect(result.isError).toBe(false);
    expect(requestUserInputFn).toHaveBeenCalledWith({
      question: "Setup",
      description: "Configure the project",
      fields,
    });
  });

  it("should return error when requestUserInput rejects", async () => {
    const { host, getTool, requestUserInputFn } = createFakeHost();
    requestUserInputFn.mockRejectedValue(new Error("User cancelled"));
    askUserExtension(host);

    const tool = getTool("ask_user");
    const result = await tool.execute({ question: "Name?" });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("cancelled or failed");
  });
});

// ─── run-javascript plugin ──────────────────────────────────────────

describe("runJavascriptExtension", () => {
  it("should register a run_javascript tool", () => {
    const { host, tools } = createFakeHost();
    runJavascriptExtension(host);
    expect(tools.map((t) => t.name)).toContain("run_javascript");
  });

  it("should execute code and return the result", async () => {
    const { host, getTool } = createFakeHost();
    runJavascriptExtension(host);

    const tool = getTool("run_javascript");
    const result = await tool.execute({ code: "return 2 + 2" });

    expect(result.isError).toBe(false);
    expect(result.content).toBe("4");
  });

  it("should handle string results directly", async () => {
    const { host, getTool } = createFakeHost();
    runJavascriptExtension(host);

    const tool = getTool("run_javascript");
    const result = await tool.execute({ code: 'return "hello world"' });

    expect(result.isError).toBe(false);
    expect(result.content).toBe("hello world");
  });

  it("should JSON-stringify object results", async () => {
    const { host, getTool } = createFakeHost();
    runJavascriptExtension(host);

    const tool = getTool("run_javascript");
    const result = await tool.execute({ code: 'return { a: 1, b: "two" }' });

    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.content);
    expect(parsed).toEqual({ a: 1, b: "two" });
  });

  it("should handle undefined result", async () => {
    const { host, getTool } = createFakeHost();
    runJavascriptExtension(host);

    const tool = getTool("run_javascript");
    const result = await tool.execute({ code: "let x = 1;" });

    expect(result.isError).toBe(false);
    expect(result.content).toBe("undefined");
  });

  it("should handle null result", async () => {
    const { host, getTool } = createFakeHost();
    runJavascriptExtension(host);

    const tool = getTool("run_javascript");
    const result = await tool.execute({ code: "return null" });

    expect(result.isError).toBe(false);
    expect(result.content).toBe("null");
  });

  it("should support async/await in code", async () => {
    const { host, getTool } = createFakeHost();
    runJavascriptExtension(host);

    const tool = getTool("run_javascript");
    const result = await tool.execute({
      code: "const val = await Promise.resolve(42); return val",
    });

    expect(result.isError).toBe(false);
    expect(result.content).toBe("42");
  });

  it("should return error for code that throws", async () => {
    const { host, getTool } = createFakeHost();
    runJavascriptExtension(host);

    const tool = getTool("run_javascript");
    const result = await tool.execute({
      code: 'throw new Error("boom")',
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("JavaScript error");
    expect(result.content).toContain("boom");
  });

  it("should return error for syntax errors", async () => {
    const { host, getTool } = createFakeHost();
    runJavascriptExtension(host);

    const tool = getTool("run_javascript");
    const result = await tool.execute({
      code: "this is not valid javascript }{",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("JavaScript error");
  });
});

// ─── Builtin prompt templates ───────────────────────────────────────

describe("builtinTemplates", () => {
  it("should export an array of templates", () => {
    expect(Array.isArray(builtinTemplates)).toBe(true);
    expect(builtinTemplates.length).toBeGreaterThan(0);
  });

  it("should have required fields on every template", () => {
    for (const tmpl of builtinTemplates) {
      expect(tmpl.name).toBeTruthy();
      expect(tmpl.description).toBeTruthy();
      expect(tmpl.body).toBeTruthy();
    }
  });

  it("should include expected template names", () => {
    const names = builtinTemplates.map((t) => t.name);
    expect(names).toContain("review");
    expect(names).toContain("explain");
    expect(names).toContain("refactor");
    expect(names).toContain("test");
    expect(names).toContain("fix");
    expect(names).toContain("help");
  });

  it("should have most templates reference $1 or $@ for argument substitution", () => {
    // All templates except "help" (which takes no arguments) should use argument placeholders
    const templatesWithArgs = builtinTemplates.filter((t) => t.name !== "help");
    for (const tmpl of templatesWithArgs) {
      const hasArg = tmpl.body.includes("$1") || tmpl.body.includes("$@") || tmpl.body.includes("${@:");
      expect(hasArg, `Template "${tmpl.name}" should reference $1, $@, or \${@:}`).toBe(true);
    }
  });

  it("should have help template that takes no arguments", () => {
    const help = builtinTemplates.find((t) => t.name === "help");
    expect(help).toBeDefined();
    // help template has no argument placeholders — it's a static prompt
    expect(help!.body).not.toContain("$1");
  });
});
