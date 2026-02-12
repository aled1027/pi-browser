# pi-browser core library

A browser-based coding agent framework. The core library (`src/lib/`) provides AI-powered conversations, tool calling, and streaming — all client-side with no server.

## Architecture

```
src/lib/          ← core framework (no UI dependencies, pure TypeScript)
src/plugins/      ← extensions, skills, prompt templates (depend on lib)
examples/chat/    ← chatbot example app (depends on lib + plugins)
examples/tutor/   ← tutor example app (depends on lib + plugins)
```

Each example is self-contained with its own components. Any application can import from `src/lib/index.ts` and build on top of it.

## Quick start

```typescript
import { Agent } from "./lib/index.js";

const agent = new Agent({ apiKey: "sk-or-..." });

for await (const event of agent.prompt("Write a hello world in Python")) {
  switch (event.type) {
    case "text_delta":       process.stdout.write(event.delta); break;
    case "tool_call_start":  console.log(`Calling ${event.toolCall.name}...`); break;
    case "tool_call_end":    console.log(`Result: ${event.toolCall.result?.content}`); break;
    case "error":            console.error(event.error); break;
  }
}
```

Everything else — extensions, skills, templates — is opt-in.

## Public API

Exported from `src/lib/index.ts`:

```typescript
// Classes
Agent, ExtensionRegistry, SkillRegistry, PromptTemplateRegistry, VirtualFS
// Functions
createTools, runAgent
// Types
AgentConfig, Message, ToolCall, ToolResult, ToolDefinition, AgentEvent,
Extension, PiBrowserAPI, UserInputField, UserInputRequest, UserInputResponse,
Skill, PromptTemplate
```

---

## Agent

### `new Agent(config: AgentConfig)`

```typescript
interface AgentConfig {
  apiKey: string;                      // OpenRouter API key (required)
  model?: string;                      // Default: "anthropic/claude-sonnet-4"
  systemPrompt?: string;               // Override default system prompt
  extensions?: Extension[];            // Add tools + event listeners
  skills?: Skill[];                    // On-demand instruction documents
  promptTemplates?: PromptTemplate[];  // /slash command templates
}
```

The constructor creates a `VirtualFS` with 4 built-in tools, registers skills/templates, builds the system prompt, and begins loading extensions asynchronously.

### Key methods

| Method | Description |
|--------|-------------|
| `prompt(text): AsyncGenerator<AgentEvent>` | Send a message, stream back events. Handles the full tool-use loop internally — executes tool calls and feeds results back until the model produces a final response. Auto-expands `/templates` and manages conversation history. |
| `abort()` | Cancel current streaming response (throws `AbortError`). |
| `setUserInputHandler(handler)` | Wire up a UI callback so extensions can request user input. Handler: `(UserInputRequest) => Promise<UserInputResponse>`. |
| `ready(): Promise<void>` | Wait for extensions to finish loading. Called automatically by `prompt()`. |

### Key properties

| Property | Description |
|----------|-------------|
| `tools: ToolDefinition[]` | All available tools (built-in + extension + `read_skill`). |
| `getMessages(): Message[]` | Copy of full conversation history. |
| `fs: VirtualFS` | Direct access to the virtual filesystem. |
| `promptTemplates: PromptTemplateRegistry` | For autocomplete: `agent.promptTemplates.search("re")` → `["review", "refactor"]`. |

---

## AgentEvent

```typescript
type AgentEvent =
  | { type: "text_delta"; delta: string }            // Incremental model text
  | { type: "tool_call_start"; toolCall: ToolCall }  // Tool invocation started
  | { type: "tool_call_end"; toolCall: ToolCall }    // Tool finished (result attached)
  | { type: "turn_end" }                             // Model finished responding
  | { type: "error"; error: string }                 // Error occurred
```

**Typical sequences:** Simple text: `text_delta* → turn_end`. With tools: `text_delta* → tool_call_start → tool_call_end → text_delta* → turn_end`. Multiple tool calls can happen per turn.

---

## Tools

### Built-in filesystem tools

| Tool | Params | Description |
|------|--------|-------------|
| `read` | `path` | Read a file's contents |
| `write` | `path`, `content` | Create or overwrite a file |
| `edit` | `path`, `oldText`, `newText` | Replace exact text in a file |
| `list` | `prefix` (default: `/`) | List files under a prefix |

### ToolDefinition

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
}

interface ToolResult {
  content: string;
  isError: boolean;
}
```

### Custom tools via extensions (preferred)

```typescript
const myExtension: Extension = (api) => {
  api.registerTool({
    name: "fetch_url",
    description: "Fetch a URL and return its contents",
    parameters: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
    execute: async (args) => {
      const text = await (await fetch(args.url as string)).text();
      return { content: text.slice(0, 5000), isError: false };
    },
  });
};
```

### `createTools(fs)` for standalone use

```typescript
const tools = createTools(new VirtualFS());  // returns [read, write, edit, list]
```

---

## VirtualFS

In-memory filesystem. Paths are normalized with leading `/` and collapsed `//`.

```typescript
const fs = new VirtualFS();
fs.write("/src/main.ts", "console.log('hello')");
fs.read("/src/main.ts");    // "console.log('hello')"
fs.exists("/src/main.ts");  // true
fs.list("/src");             // ["/src/main.ts"]
fs.delete("/src/main.ts");  // true
```

Pre-populate via `agent.fs` before prompting.

---

## Extensions

Functions that receive a `PiBrowserAPI` and add capabilities. Run once at agent construction.

### PiBrowserAPI

```typescript
interface PiBrowserAPI {
  registerTool(tool: ToolDefinition): void;
  on(event: "agent_event", handler: (e: AgentEvent) => void): () => void;
  requestUserInput(request: UserInputRequest): Promise<UserInputResponse>;
}
```

### User input

Extensions can pause execution and ask the user for input. Requires `agent.setUserInputHandler()` to be wired up.

```typescript
interface UserInputRequest {
  question: string;
  description?: string;
  fields?: UserInputField[];  // Defaults to single text input
}

interface UserInputField {
  name: string;
  label: string;
  type: "text" | "textarea" | "select" | "confirm";
  placeholder?: string;
  options?: string[];       // Required for "select"
  defaultValue?: string;
  required?: boolean;
}

type UserInputResponse = Record<string, string>;
```

---

## Skills

Named instruction documents loaded on-demand. Only names/descriptions appear in the system prompt; full content is loaded when the model calls `read_skill`.

```typescript
const mySkill: Skill = {
  name: "api-design",
  description: "Design RESTful APIs. Use when asked to design or review an API.",
  content: "# API Design\n\n## Guidelines\n- Use nouns for resources...",
};
```

Pass via `AgentConfig.skills`.

---

## Prompt templates

`/slash` commands expanded before reaching the model.

```typescript
const myTemplate: PromptTemplate = {
  name: "scaffold",
  description: "Scaffold a new project",
  body: "Create a new $1 project called $2. Set up the basic file structure. ${@:3}",
};
```

### Argument syntax

| Placeholder | Meaning | `/scaffold ts myapp with tests` |
|-------------|---------|----------------------------------|
| `$1` | First argument | `ts` |
| `$2` | Second argument | `myapp` |
| `$@` | All arguments joined | `ts myapp with tests` |
| `${@:2}` | Args from position 2+ | `myapp with tests` |
| `${@:3:2}` | 2 args from position 3 | `with tests` |

Quoted strings are single arguments: `/scaffold ts "my app"` → `$1="ts"`, `$2="my app"`.

Pass via `AgentConfig.promptTemplates`. For autocomplete: `agent.promptTemplates.search("sca")`. For manual expansion: `agent.promptTemplates.expand("/scaffold ts myapp")`.

---

## `runAgent` (advanced)

Low-level streaming function. Most apps should use `Agent.prompt()` instead.

```typescript
for await (const event of runAgent(messages, tools, { apiKey, model }, abortSignal)) {
  // raw streaming events
}
```

Handles SSE streaming, incremental tool call assembly, automatic tool execution, and multi-turn loops.

---

## Full example

```typescript
import { Agent } from "./lib/index.js";
import type { Extension, Skill, PromptTemplate } from "./lib/index.js";

const timestampExtension: Extension = (api) => {
  api.registerTool({
    name: "timestamp",
    description: "Get the current ISO timestamp",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: new Date().toISOString(), isError: false }),
  });
};

const cssSkill: Skill = {
  name: "css-layout",
  description: "CSS layout advice for flexbox, grid, responsive design.",
  content: "# CSS Layout\n\n## Flexbox\n...\n## Grid\n...",
};

const styleTemplate: PromptTemplate = {
  name: "style",
  description: "Style a component",
  body: "Write CSS for $1. Requirements: ${@:2}",
};

const agent = new Agent({
  apiKey: "sk-or-...",
  extensions: [timestampExtension],
  skills: [cssSkill],
  promptTemplates: [styleTemplate],
});

// Pre-populate filesystem
agent.fs.write("/greeting.txt", "Hello, world!");

for await (const event of agent.prompt("/style .card responsive with dark theme")) {
  if (event.type === "text_delta") process.stdout.write(event.delta);
  if (event.type === "tool_call_end") {
    console.log(`[tool] ${event.toolCall.name} → ${event.toolCall.result?.content}`);
  }
}
```

---

## Project structure

```
src/lib/
  index.ts              Barrel export
  agent.ts              Agent class
  types.ts              Message, ToolCall, ToolResult, ToolDefinition, AgentEvent
  extensions.ts         Extension, PiBrowserAPI, ExtensionRegistry
  skills.ts             Skill, SkillRegistry
  prompt-templates.ts   PromptTemplate, PromptTemplateRegistry
  openrouter.ts         OpenRouter streaming client + tool loop
  tools.ts              VirtualFS + built-in filesystem tools

src/plugins/
  index.ts              Barrel export for all plugins
  extensions/           Extension implementations (ask-user, etc.)
  skills/               Skill definitions (code-review, lit-component)
  prompt-templates/     Prompt template sets
  tutor/                Tutor-specific plugins (lessons, templates, run-code)

examples/
  chat/                 Chat example app (self-contained)
  tutor/                Tutor example app (self-contained)
```
