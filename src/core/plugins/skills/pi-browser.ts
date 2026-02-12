import type { Skill } from "../../skills.js";

export const piBrowserSkill: Skill = {
  name: "pi-browser",
  description:
    "Learn about pi-browser itself: its architecture, how to write and register extensions, skills, prompt templates, and how the core API works. Use when asked about pi-browser, how it works, or how to extend it.",
  content: `# pi-browser

pi-browser is a browser-based AI coding agent framework. It provides AI-powered conversations, tool calling, streaming, and thread persistence — all client-side with no server. It communicates with LLMs via OpenRouter.

## Architecture

\`\`\`
src/core/
  agent.ts            Agent class (main API, implements ExtensionHost)
  types.ts            Message, ToolCall, AgentEvent, PromptResult, etc.
  extensions.ts       Extension system (ExtensionHost interface, ExtensionRegistry)
  skills.ts           On-demand instruction documents + frontmatter parser
  prompt-templates.ts /slash command expansion
  openrouter.ts       OpenRouter streaming client + tool loop
  tools.ts            VirtualFS + built-in filesystem tools
  storage.ts          Thread persistence (IndexedDB + localStorage), agent-level VFS

src/core/plugins/
  extensions/         Built-in extensions (e.g. ask-user)
  skills/             Built-in skills (e.g. code-review, lit-component, this skill)
  prompt-templates/   Built-in prompt templates
\`\`\`

## Core Concepts

### Agent
The \`Agent\` class is the primary API. Create one with \`Agent.create({ apiKey })\`. Use \`agent.send(text)\` to send messages and get responses. The agent manages messages, tools, extensions, skills, templates, threads, and persistence. It implements \`ExtensionHost\`, so extensions receive the agent directly.

### VirtualFS
An in-memory filesystem shared across all threads (per-agent). The agent's built-in tools (read, write, edit, list) operate on it. Access via \`agent.fs\`. VFS is persisted independently of threads. Dynamic extensions and skills are stored in \`/.pi-browser/\` on VFS and auto-loaded on startup.

### Tools
Built-in tools: \`read\`, \`write\`, \`edit\`, \`list\` — all operate on VirtualFS. Extensions can register additional tools. Skills add a \`read_skill\` tool automatically.

### Threads
Conversations are persisted as threads using IndexedDB + localStorage. Threads only persist messages (not VFS). Threads auto-save after each turn and restore on page reload.

---

## How to Write an Extension

Extensions are functions that receive the Agent (which implements \`ExtensionHost\`) and use it to register tools, listen to events, and request user input. They run once during agent initialization.

### Extension signature

\`\`\`typescript
import type { Extension } from "pi-browser";

export const myExtension: Extension = (agent) => {
  // agent.registerTool(...)    — register a tool the model can call
  // agent.on("agent_event", handler) — subscribe to events
  // agent.requestUserInput(request) — ask the user for input (from within a tool)
};
\`\`\`

### Registering a tool

\`\`\`typescript
import type { Extension } from "pi-browser";

export const fetchExtension: Extension = (agent) => {
  agent.registerTool({
    name: "fetch_url",
    description: "Fetch a URL and return its text content (first 5000 chars)",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch" },
      },
      required: ["url"],
    },
    execute: async (args) => {
      try {
        const resp = await fetch(args.url as string);
        const text = await resp.text();
        return { content: text.slice(0, 5000), isError: false };
      } catch (e) {
        return { content: \`Fetch failed: \${e}\`, isError: true };
      }
    },
  });
};
\`\`\`

### Requesting user input from a tool

\`\`\`typescript
export const confirmExtension: Extension = (agent) => {
  agent.registerTool({
    name: "confirm_action",
    description: "Ask the user to confirm before proceeding",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", description: "What action to confirm" },
      },
      required: ["action"],
    },
    execute: async (args) => {
      const response = await agent.requestUserInput({
        question: \`Confirm: \${args.action}\`,
        fields: [{ name: "ok", label: "Proceed?", type: "confirm", required: true }],
      });
      return { content: JSON.stringify(response), isError: false };
    },
  });
};
\`\`\`

### Listening to agent events

\`\`\`typescript
export const loggerExtension: Extension = (agent) => {
  agent.on("agent_event", (event) => {
    if (event.type === "tool_call_end") {
      console.log(\`Tool \${event.toolCall.name} finished\`);
    }
  });
};
\`\`\`

### Adding extensions to the agent

#### Config-time (at creation)

\`\`\`typescript
import { Agent, askUserExtension } from "pi-browser";

const agent = await Agent.create({
  apiKey: "sk-or-...",
  extensions: [askUserExtension, fetchExtension, loggerExtension],
});
\`\`\`

#### Dynamic (post-initialization, persisted to VFS)

\`\`\`typescript
await agent.addExtension(\`(agent) => {
  agent.registerTool({
    name: "fetch_url",
    description: "Fetch a URL",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    execute: async (args) => {
      const text = await (await fetch(args.url)).text();
      return { content: text.slice(0, 5000), isError: false };
    },
  });
}\`, "fetch-url");

// Remove later
await agent.removeExtension("fetch-url");
\`\`\`

### ToolDefinition interface

\`\`\`typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema object
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
}

interface ToolResult {
  content: string;   // text content returned to the model
  isError: boolean;  // whether this is an error result
}
\`\`\`

### ExtensionHost interface

\`\`\`typescript
interface ExtensionHost {
  registerTool(tool: ToolDefinition, extensionName?: string): void;
  on(event: "agent_event", handler: (e: AgentEvent) => void): () => void;
  requestUserInput(request: UserInputRequest): Promise<UserInputResponse>;
}
\`\`\`

---

## How to Write a Skill

Skills are named instruction documents loaded on-demand. Only their name and description appear in the system prompt. The model loads the full content by calling the \`read_skill\` tool when a task matches.

### Skill interface

\`\`\`typescript
interface Skill {
  name: string;         // Unique, lowercase with hyphens (e.g. "api-design")
  description: string;  // When to use this skill (shown in system prompt)
  content: string;      // Full instructions in markdown
}
\`\`\`

### Example skill

\`\`\`typescript
import type { Skill } from "pi-browser";

export const apiDesignSkill: Skill = {
  name: "api-design",
  description: "Design RESTful APIs. Use when asked to design, review, or document an API.",
  content: \`# API Design Guidelines

## URL Structure
- Use nouns for resources: /users, /posts
- Use HTTP methods for actions: GET, POST, PUT, DELETE
- Nest for relationships: /users/:id/posts

## Response Format
- Always return JSON
- Include pagination metadata for lists
- Use consistent error format: { error: { code, message } }

## Versioning
- Use URL prefix: /v1/users
- Never break backwards compatibility within a version
\`,
};
\`\`\`

### Adding skills

#### Config-time

\`\`\`typescript
import { Agent, codeReviewSkill } from "pi-browser";

const agent = await Agent.create({
  apiKey: "sk-or-...",
  skills: [codeReviewSkill, apiDesignSkill],
});
\`\`\`

#### Dynamic (post-initialization, persisted to VFS)

\`\`\`typescript
await agent.addSkill({
  name: "css-layout",
  description: "CSS layout advice for flexbox, grid, responsive design.",
  content: "# CSS Layout\\n\\n## Flexbox\\n...\\n## Grid\\n...",
});

// Remove later
await agent.removeSkill("css-layout");
\`\`\`

### Skill markdown format (VFS persistence)

Skills persisted to VFS use YAML frontmatter:

\`\`\`markdown
---
name: api-design
description: Design RESTful APIs. Use when asked to design or review an API.
---
# API Design Guidelines

## URL Structure
- Use nouns for resources...
\`\`\`

### Adding a built-in skill

To add a skill to the pi-browser library itself:

1. Create a new file in \`src/core/plugins/skills/\` (e.g. \`my-skill.ts\`)
2. Export a \`Skill\` object
3. Re-export it from \`src/core/plugins/index.ts\`
4. Export it from \`src/core/index.ts\` so consumers can import it

---

## How to Write a Prompt Template

Prompt templates are /slash commands that expand before reaching the model.

### PromptTemplate interface

\`\`\`typescript
interface PromptTemplate {
  name: string;         // Command name without leading slash
  description: string;  // Shown in autocomplete
  body: string;         // Template with $1, $2, $@, \${@:N} placeholders
}
\`\`\`

### Placeholders

| Placeholder | Meaning |
|-------------|---------|
| \`$1\`, \`$2\` | Positional arguments |
| \`$@\` | All arguments joined |
| \`\${@:N}\` | Arguments from position N onward |
| \`\${@:N:M}\` | M arguments starting from position N |

### Example

\`\`\`typescript
const scaffoldTemplate: PromptTemplate = {
  name: "scaffold",
  description: "Scaffold a new project",
  body: "Create a new $1 project called $2. Set up the basic structure. \${@:3}",
};
\`\`\`

Usage: \`/scaffold typescript myapp with tests and linting\`

---

## Key Types Reference

### AgentConfig
\`\`\`typescript
interface AgentConfig {
  apiKey: string;
  model?: string;                      // Default: "anthropic/claude-sonnet-4"
  systemPrompt?: string;
  extensions?: Extension[];
  skills?: Skill[];
  promptTemplates?: PromptTemplate[];
}
\`\`\`

### AgentEvent
\`\`\`typescript
type AgentEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call_start"; toolCall: ToolCall }
  | { type: "tool_call_end"; toolCall: ToolCall }
  | { type: "tool_loop_message"; message: Message }
  | { type: "turn_end" }
  | { type: "error"; error: string };
\`\`\`

### UserInputRequest
\`\`\`typescript
interface UserInputRequest {
  question: string;
  description?: string;
  fields?: UserInputField[];
}

interface UserInputField {
  name: string;
  label: string;
  type: "text" | "textarea" | "select" | "confirm";
  placeholder?: string;
  options?: string[];       // for "select"
  defaultValue?: string;
  required?: boolean;
}
\`\`\`
`,
};
