---
name: tau
description: Learn about tau itself: its architecture, how to write and register extensions, skills, prompt templates, and how the core API works. Use when asked about tau, how it works, or how to extend it.
---
# tau

tau is a browser-based AI coding agent framework. It provides AI-powered conversations, tool calling, streaming, and thread persistence — all client-side with no server. It communicates with LLMs via OpenRouter.

## Architecture

```
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
```

## Core Concepts

### Agent
The `Agent` class is the primary API. Create one with `Agent.create({ apiKey })`. Use `agent.prompt(text)` to send messages and get responses — it returns a `PromptStream` that can be both awaited (simple) and async-iterated (streaming). The agent manages messages, tools, extensions, skills, templates, threads, and persistence. It implements `ExtensionHost`, so extensions receive the agent directly.

### VirtualFS
An in-memory filesystem shared across all threads (per-agent). The agent's built-in tools (read, write, edit, list) operate on it. Access via `agent.fs`. VFS is persisted independently of threads. Dynamic extensions and skills are stored in `/.tau/` on VFS and auto-loaded on startup.

### Tools
Built-in tools: `read`, `write`, `edit`, `list` — all operate on VirtualFS. Extensions can register additional tools. Skills add a `read_skill` tool automatically.

### Threads
Conversations are persisted as threads using IndexedDB + localStorage. Threads only persist messages (not VFS). Threads auto-save after each turn and restore on page reload.

---

## How to Write an Extension

Extensions are functions that receive the Agent (which implements `ExtensionHost`) and use it to register tools, listen to events, and request user input. They run once during agent initialization.

### Extension signature

```typescript
import type { Extension } from "tau";

export const myExtension: Extension = (agent) => {
  // agent.registerTool(...)    — register a tool the model can call
  // agent.on("agent_event", handler) — subscribe to events
  // agent.requestUserInput(request) — ask the user for input (from within a tool)
};
```

### Registering a tool

```typescript
import type { Extension } from "tau";

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
        return { content: `Fetch failed: ${e}`, isError: true };
      }
    },
  });
};
```

### Requesting user input from a tool

```typescript
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
        question: `Confirm: ${args.action}`,
        fields: [{ name: "ok", label: "Proceed?", type: "confirm", required: true }],
      });
      return { content: JSON.stringify(response), isError: false };
    },
  });
};
```

### Listening to agent events

```typescript
export const loggerExtension: Extension = (agent) => {
  agent.on("agent_event", (event) => {
    if (event.type === "tool_call_end") {
      console.log(`Tool ${event.toolCall.name} finished`);
    }
  });
};
```

### Adding extensions to the agent

#### Config-time (at creation)

```typescript
import { Agent, askUserExtension } from "tau";

const agent = await Agent.create({
  apiKey: "sk-or-...",
  extensions: [askUserExtension, fetchExtension, loggerExtension],
});
```

#### Dynamic (post-initialization, persisted to VFS)

```typescript
await agent.addExtension(`(agent) => {
  agent.registerTool({
    name: "fetch_url",
    description: "Fetch a URL",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    execute: async (args) => {
      const text = await (await fetch(args.url)).text();
      return { content: text.slice(0, 5000), isError: false };
    },
  });
}`, "fetch-url");

// Remove later
await agent.removeExtension("fetch-url");
```

### ToolDefinition interface

```typescript
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
```

### ExtensionHost interface

```typescript
interface ExtensionHost {
  registerTool(tool: ToolDefinition, extensionName?: string): void;
  on(event: "agent_event", handler: (e: AgentEvent) => void): () => void;
  requestUserInput(request: UserInputRequest): Promise<UserInputResponse>;
}
```

---

## How to Write a Skill

Skills are named instruction documents loaded on-demand. Only their name and description appear in the system prompt. The model loads the full content by calling the `read_skill` tool when a task matches.

### Skill interface

```typescript
interface Skill {
  name: string;         // Unique, lowercase with hyphens (e.g. "api-design")
  description: string;  // When to use this skill (shown in system prompt)
  content: string;      // Full instructions in markdown
}
```

### Example skill

```typescript
import type { Skill } from "tau";

export const apiDesignSkill: Skill = {
  name: "api-design",
  description: "Design RESTful APIs. Use when asked to design, review, or document an API.",
  content: `# API Design Guidelines

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
`,
};
```

### Adding skills

#### Config-time

```typescript
import { Agent, codeReviewSkill } from "tau";

const agent = await Agent.create({
  apiKey: "sk-or-...",
  skills: [codeReviewSkill, apiDesignSkill],
});
```

#### Dynamic (post-initialization, persisted to VFS)

```typescript
await agent.addSkill({
  name: "css-layout",
  description: "CSS layout advice for flexbox, grid, responsive design.",
  content: "# CSS Layout\n\n## Flexbox\n...\n## Grid\n...",
});

// Remove later
await agent.removeSkill("css-layout");
```

### Skill markdown format (VFS persistence)

Skills persisted to VFS use YAML frontmatter:

```markdown
---
name: api-design
description: Design RESTful APIs. Use when asked to design or review an API.
---
# API Design Guidelines

## URL Structure
- Use nouns for resources...
```

### Adding a built-in skill

To add a skill to the tau library itself:

1. Create a new `.md` file in `src/core/plugins/skills/` with YAML frontmatter (name, description) and markdown content
2. Import it in `src/core/plugins/skills/index.ts` and parse it with `parseSkillMarkdown`
3. Re-export the parsed skill from `src/core/plugins/index.ts`
4. Export it from `src/core/index.ts` so consumers can import it

---

## How to Write a Prompt Template

Prompt templates are /slash commands that expand before reaching the model.

### PromptTemplate interface

```typescript
interface PromptTemplate {
  name: string;         // Command name without leading slash
  description: string;  // Shown in autocomplete
  body: string;         // Template with $1, $2, $@, ${@:N} placeholders
}
```

### Placeholders

| Placeholder | Meaning |
|-------------|---------|
| `$1`, `$2` | Positional arguments |
| `$@` | All arguments joined |
| `${@:N}` | Arguments from position N onward |
| `${@:N:M}` | M arguments starting from position N |

### Example

```typescript
const scaffoldTemplate: PromptTemplate = {
  name: "scaffold",
  description: "Scaffold a new project",
  body: "Create a new $1 project called $2. Set up the basic structure. ${@:3}",
};
```

Usage: `/scaffold typescript myapp with tests and linting`

---

## Self-Modification via `window.__TAU_AGENT__`

The running Agent instance is exposed at `window.__TAU_AGENT__`. You can access it from the `run_javascript` tool to modify yourself at runtime — no need to ask the user to write code or reload the page.

### What you can do

- **Register new tools**: `window.__TAU_AGENT__.registerTool({ name, description, parameters, execute })`
- **Add extensions dynamically**: `await window.__TAU_AGENT__.addExtension(\`(agent) => { ... }\`, "my-ext")`
- **Remove extensions**: `await window.__TAU_AGENT__.removeExtension("my-ext")`
- **Add skills**: `await window.__TAU_AGENT__.addSkill({ name, description, content })`
- **Remove skills**: `await window.__TAU_AGENT__.removeSkill("skill-name")`
- **Read messages**: `window.__TAU_AGENT__.getMessages()`
- **Access VFS**: `window.__TAU_AGENT__.fs`
- **Listen to events**: `window.__TAU_AGENT__.on("agent_event", (e) => { ... })`

### Persistence

Not all changes via `window.__TAU_AGENT__` survive a page reload:

| Method | Persisted? | Notes |
|--------|-----------|-------|
| `addExtension()` / `removeExtension()` | ✅ Yes | Writes to VFS and flushes to IndexedDB automatically |
| `addSkill()` / `removeSkill()` | ✅ Yes | Writes to VFS and flushes to IndexedDB automatically |
| `registerTool()` | ❌ No | In-memory only; lost on reload. Use `addExtension()` to persist a tool. |
| `on("agent_event", ...)` | ❌ No | Event listeners are in-memory only |
| `fs.write(...)` / `fs.delete(...)` | ❌ No | VFS changes are in-memory until flushed. Call `await agent.persist()` to save to IndexedDB. |
| `config.model = "..."` etc. | ❌ No | Config changes take effect immediately but are not persisted; lost on reload. |

**Rule of thumb:** `addExtension()` and `addSkill()` persist automatically. Everything else is ephemeral unless you call `await window.__TAU_AGENT__.persist()` (for VFS changes) or wrap the tool in an extension (for tools).

### Examples via `run_javascript`

Register a tool on the fly:
```javascript
const agent = window.__TAU_AGENT__;
agent.registerTool({
  name: "current_time",
  description: "Return the current date and time",
  parameters: { type: "object", properties: {}, required: [] },
  execute: async () => ({ content: new Date().toLocaleString(), isError: false }),
});
return "Tool registered";
```

Add a skill dynamically:
```javascript
await window.__TAU_AGENT__.addSkill({
  name: "my-guide",
  description: "Custom guidelines for this project",
  content: "# My Guide\n\n- Always use TypeScript\n- Prefer composition over inheritance",
});
return "Skill added";
```

Add a full extension (persisted to VFS):
```javascript
await window.__TAU_AGENT__.addExtension(`(agent) => {
  agent.registerTool({
    name: "word_count",
    description: "Count words in text",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    execute: async (args) => ({ content: String(args.text.split(/\\s+/).length), isError: false }),
  });
}`, "word-count");
return "Extension added";
```

---

## Key Types Reference

### AgentConfig
```typescript
interface AgentConfig {
  apiKey: string;
  model?: string;                      // Default: "anthropic/claude-sonnet-4"
  systemPrompt?: string;
  extensions?: Extension[];
  skills?: Skill[];
  promptTemplates?: PromptTemplate[];
}
```

### AgentEvent
```typescript
type AgentEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call_start"; toolCall: ToolCall }
  | { type: "tool_call_end"; toolCall: ToolCall }
  | { type: "tool_loop_message"; message: Message }
  | { type: "turn_end" }
  | { type: "error"; error: string };
```

### UserInputRequest
```typescript
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
```
