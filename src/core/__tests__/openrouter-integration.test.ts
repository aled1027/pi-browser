/**
 * Integration test that talks to the real OpenRouter API.
 *
 * NOT run by default — requires the OPENROUTER_API_KEY environment variable.
 *
 * Run with:
 *   OPENROUTER_API_KEY=sk-or-... npx vitest run src/core/__tests__/openrouter-integration.test.ts
 *
 * Or to run only integration tests:
 *   OPENROUTER_API_KEY=sk-or-... npx vitest run --testPathPattern integration
 */

import { describe, it, expect } from "vitest";

// Skip the entire suite if no API key is provided
// TODO: figure this out
// const apiKey = process.env.OPENROUTER_API_KEY;
const apiKey = "foo"
const describeIntegration = apiKey ? describe : describe.skip;

// We need to mock storage (no IndexedDB/localStorage in Node)
// but use the REAL openrouter module (no mock).
vi.mock("../storage.js", () => {
  class FakeThreadStorage {
    private threads = new Map<string, { id: string; name: string; createdAt: number; updatedAt: number }>();
    private messages = new Map<string, unknown[]>();
    private activeId: string | null = null;
    private vfs: Record<string, string> = {};

    listThreads() { return [...this.threads.values()].sort((a, b) => b.updatedAt - a.updatedAt); }
    getThread(id: string) { return this.threads.get(id); }
    saveThread(meta: { id: string; name: string; createdAt: number; updatedAt: number }) { this.threads.set(meta.id, meta); }
    async deleteThread(id: string) { this.threads.delete(id); this.messages.delete(id); }
    getActiveThreadId() { return this.activeId; }
    setActiveThreadId(id: string | null) { this.activeId = id; }
    async saveMessages(threadId: string, msgs: unknown[]) { this.messages.set(threadId, msgs); }
    async getMessages(threadId: string) { return this.messages.get(threadId) ?? []; }
    async saveVFS(files: Record<string, string>) { this.vfs = files; }
    async loadVFS() { return this.vfs; }
    async clearAll() { this.threads.clear(); this.messages.clear(); this.activeId = null; this.vfs = {}; }
  }
  return { ThreadStorage: FakeThreadStorage };
});

import { vi } from "vitest";
const { Agent } = await import("../agent.js");
const { addExtensionExtension } = await import("../plugins/extensions/add-extension.js");

describeIntegration("OpenRouter Integration", () => {
  /**
   * This test asks the agent to dynamically create an extension that
   * registers a "get_model" tool, then calls that tool and verifies
   * it returns the expected model name.
   *
   * This exercises:
   * - Real OpenRouter API communication
   * - The agent's ability to call addExtension() via a tool
   * - Dynamic extension registration at runtime
   * - Using a dynamically-added tool in a follow-up prompt
   */
  it("should dynamically add an extension via chat and use its tool", async () => {
    const model = "anthropic/claude-sonnet-4";

    const agent = await Agent.create({
      apiKey: apiKey!,
      model,
      timeout: 60_000,
      extensions: [addExtensionExtension],
    });

    // Step 1: Ask the agent to create an extension with a get_model tool
    // Be very explicit about the tool shape to avoid the LLM using wrong property names
    const step1 = await agent.prompt(
      `Use the add_extension tool to create an extension called "model-info". ` +
      `The source must be exactly this function:\n\n` +
      `(agent) => { agent.registerTool({ name: "get_model", description: "Returns the model name", parameters: { type: "object", properties: {} }, execute: async () => ({ content: "${model}", isError: false }) }); }\n\n` +
      `Pass this exact source string to the add_extension tool with filename "model-info".`
    );

    // Verify the agent called add_extension
    const addExtCalls = step1.toolCalls.filter(tc => tc.name === "add_extension");
    expect(addExtCalls.length).toBeGreaterThanOrEqual(1);
    expect(addExtCalls[0].result?.isError).toBe(false);

    // Verify the get_model tool now exists
    const toolNames = agent.tools.map(t => t.name);
    expect(toolNames).toContain("get_model");

    // Step 2: Ask the agent to use the new tool
    const step2 = await agent.prompt(
      `Now call the get_model tool and tell me exactly what it returns.`
    );

    // Verify the agent called get_model
    const getModelCalls = step2.toolCalls.filter(tc => tc.name === "get_model");
    expect(getModelCalls.length).toBeGreaterThanOrEqual(1);
    expect(getModelCalls[0].result?.isError).toBe(false);
    expect(getModelCalls[0].result?.content).toBe(model);
  }, 120_000); // generous timeout for two API round-trips
});
