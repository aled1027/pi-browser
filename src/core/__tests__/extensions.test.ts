import { describe, it, expect } from "vitest";
import { ExtensionRegistry } from "../extensions.js";
import type { Extension, ExtensionHost } from "../extensions.js";
import type { ToolDefinition, AgentEvent } from "../types.js";

function makeTool(name: string): ToolDefinition {
  return {
    name,
    description: `Tool: ${name}`,
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: "ok", isError: false }),
  };
}

describe("ExtensionRegistry", () => {
  describe("tool registration", () => {
    it("should register and retrieve tools", () => {
      const reg = new ExtensionRegistry();
      reg.registerTool(makeTool("a"));
      reg.registerTool(makeTool("b"));
      const tools = reg.getTools();
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toEqual(["a", "b"]);
    });

    it("should track tool ownership by extension name", () => {
      const reg = new ExtensionRegistry();
      reg.registerTool(makeTool("t1"), "ext-a");
      reg.registerTool(makeTool("t2"), "ext-a");
      reg.registerTool(makeTool("t3"), "ext-b");

      reg.unregisterToolsByExtension("ext-a");
      const tools = reg.getTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("t3");
    });

    it("should handle unregistering unknown extension gracefully", () => {
      const reg = new ExtensionRegistry();
      reg.registerTool(makeTool("t1"));
      reg.unregisterToolsByExtension("nonexistent");
      expect(reg.getTools()).toHaveLength(1);
    });
  });

  describe("event system", () => {
    it("should emit events to listeners", () => {
      const reg = new ExtensionRegistry();
      const events: AgentEvent[] = [];
      reg.on("agent_event", (e) => events.push(e));

      reg.emit({ type: "text_delta", delta: "hello" });
      reg.emit({ type: "turn_end" });

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ type: "text_delta", delta: "hello" });
      expect(events[1]).toEqual({ type: "turn_end" });
    });

    it("should support unsubscribing", () => {
      const reg = new ExtensionRegistry();
      const events: AgentEvent[] = [];
      const unsub = reg.on("agent_event", (e) => events.push(e));

      reg.emit({ type: "turn_end" });
      unsub();
      reg.emit({ type: "turn_end" });

      expect(events).toHaveLength(1);
    });

    it("should support multiple listeners", () => {
      const reg = new ExtensionRegistry();
      const a: AgentEvent[] = [];
      const b: AgentEvent[] = [];
      reg.on("agent_event", (e) => a.push(e));
      reg.on("agent_event", (e) => b.push(e));

      reg.emit({ type: "turn_end" });
      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
    });
  });

  describe("user input", () => {
    it("should reject when no handler is set", async () => {
      const reg = new ExtensionRegistry();
      await expect(
        reg.requestUserInput({ question: "Name?" })
      ).rejects.toThrow("No user input handler");
    });

    it("should delegate to the registered handler", async () => {
      const reg = new ExtensionRegistry();
      reg.setUserInputHandler(async (_req) => ({ answer: "42" }));

      const result = await reg.requestUserInput({ question: "Answer?" });
      expect(result).toEqual({ answer: "42" });
    });
  });

  describe("load extensions", () => {
    it("should call each extension with the host", async () => {
      const reg = new ExtensionRegistry();
      const calls: string[] = [];

      const ext1: Extension = async (host) => {
        calls.push("ext1");
        host.registerTool(makeTool("from-ext1"));
      };
      const ext2: Extension = async (_host) => {
        calls.push("ext2");
      };

      const host: ExtensionHost = {
        registerTool: (tool, name) => reg.registerTool(tool, name),
        on: (event, handler) => reg.on(event, handler),
        requestUserInput: (req) => reg.requestUserInput(req),
        addExtension: async () => {},
        removeExtension: async () => {},
      };

      await reg.load([ext1, ext2], host);

      expect(calls).toEqual(["ext1", "ext2"]);
      expect(reg.getTools()).toHaveLength(1);
      expect(reg.getTools()[0].name).toBe("from-ext1");
    });
  });
});
