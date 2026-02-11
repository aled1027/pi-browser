# pi-browser core library

pi-browser is a browser-based coding agent framework. The core library (`src/lib/`) provides everything needed to build an AI-powered application that can hold conversations, call tools, and stream responses — all running client-side with no server.

## Architecture

```
src/lib/          ← you are here (core framework, no dependencies on app code)
src/plugins/      ← extensions, skills, prompt templates (depend on lib)
src/app/          ← the chatbot UI (depends on lib + plugins)
```

The core has **zero UI dependencies**. It's pure TypeScript. Any application — Lit, vanilla JS, React, a CLI over a local server, anything — can import from `src/lib/index.ts` and build on top of it.

## Quick start

```typescript
import { Agent } from "./lib/index.js";
import type { AgentEvent } from "./lib/index.js";

const agent = new Agent({
  apiKey: "sk-or-...",        // OpenRouter API key (required)
  model: "anthropic/claude-sonnet-4",  // optional, this is the default
});

// Send a message and consume the stream
for await (const event of agent.prompt("Write a hello world in Python")) {
  switch (event.type) {
    case "text_delta":
      process.stdout.write(event.delta);  // or append to a DOM element
      break;
    case "tool_call_start":
      console.log(`Calling ${event.toolCall.name}...`);
      break;
    case "tool_call_end":
      console.log(`Result: ${event.toolCall.result?.content}`);
      break;
    case "error":
      console.error(event.error);
      break;
    case "turn_end":
      break;
  }
}
```

That's the entire integration surface. Everything else — extensions, skills, templates — is opt-in.

## Public API

Everything is exported from `src/lib/index.ts`:

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

The `Agent` class is the main entry point. It holds conversation history, manages tools, and drives the streaming response loop.

### `new Agent(config: AgentConfig)`

```typescript
interface AgentConfig {
  apiKey: string;              // OpenRouter API key (required)
  model?: string;              // Model ID (default: "anthropic/claude-sonnet-4")
  systemPrompt?: string;       // Override the default system prompt
  extensions?: Extension[];    // Extensions to load (registers tools, event listeners)
  skills?: Skill[];            // Skills the model can load on-demand
  promptTemplates?: PromptTemplate[];  // /slash command templates
}
```

The constructor:
1. Creates a `VirtualFS` and the 4 built-in filesystem tools (`read`, `write`, `edit`, `list`)
2. Registers all provided skills and prompt templates
3. Builds the system prompt (base prompt + skill listing fragment)
4. Begins loading extensions asynchronously

### `agent.prompt(text: string): AsyncGenerator<AgentEvent>`

The core method. Send a user message and stream back events. Handles the full tool-use loop internally — if the model calls tools, they're executed and the model continues until it produces a final text response.

The method automatically:
- Expands prompt templates if the text starts with `/name`
- Appends the user message to conversation history
- Appends the final assistant response to conversation history
- Executes tool calls and feeds results back to the model

```typescript
for await (const event of agent.prompt("Create a utils.ts file")) {
  // handle events
}
```

### `agent.abort(): void`

Cancel the current streaming response. The `prompt()` generator will throw an `AbortError`.

### `agent.setUserInputHandler(handler)`

Wire up a UI callback so extensions can request input from the user. The handler receives a `UserInputRequest` and must return a `Promise<UserInputResponse>` (resolves when the user submits the form).

```typescript
agent.setUserInputHandler(async (request) => {
  // Show a form to the user, return their answers
  return { answer: "TypeScript" };
});
```

If no handler is set and an extension calls `requestUserInput()`, it rejects with an error.

### `agent.tools: ToolDefinition[]` (getter)

Returns all available tools: built-in filesystem tools + extension-registered tools + the `read_skill` tool (if skills are registered).

### `agent.getMessages(): Message[]`

Returns a copy of the full conversation history (system + user + assistant messages).

### `agent.fs: VirtualFS`

Direct access to the virtual filesystem. Useful if your app needs to pre-populate files or read agent output.

### `agent.promptTemplates: PromptTemplateRegistry`

Direct access to the template registry. Useful for building autocomplete UI:

```typescript
const matches = agent.promptTemplates.search("re");  // finds "review", "refactor"
```

### `agent.ready(): Promise<void>`

Wait for all extensions to finish loading. Called automatically by `prompt()`, but useful if you need to inspect tools before the first prompt.

---

## AgentEvent

Events yielded by `agent.prompt()`. Your application consumes these to update the UI.

```typescript
type AgentEvent =
  | { type: "text_delta"; delta: string }       // Incremental text from the model
  | { type: "tool_call_start"; toolCall: ToolCall }  // Model is calling a tool
  | { type: "tool_call_end"; toolCall: ToolCall }    // Tool finished (result attached)
  | { type: "turn_end" }                        // Model finished responding
  | { type: "error"; error: string }            // Something went wrong
```

### Typical event sequence

A simple text response:
```
text_delta → text_delta → ... → turn_end
```

A response with tool use:
```
text_delta → tool_call_start → tool_call_end → text_delta → ... → turn_end
```

Multiple tool calls can happen in one turn. The model may call tools, get results, then call more tools before finally responding with text.

---

## Tools

### Built-in tools

The agent ships with 4 filesystem tools that operate on the in-memory `VirtualFS`:

| Tool    | Description                                      |
|---------|--------------------------------------------------|
| `read`  | Read a file's contents. Params: `path`           |
| `write` | Create or overwrite a file. Params: `path`, `content` |
| `edit`  | Replace exact text in a file. Params: `path`, `oldText`, `newText` |
| `list`  | List files under a prefix. Params: `prefix` (default: `/`) |

### Custom tools

You can add tools two ways:

**Via extensions** (preferred — tools are registered at load time):
```typescript
const myExtension: Extension = (api) => {
  api.registerTool({
    name: "fetch_url",
    description: "Fetch a URL and return its contents",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch" },
      },
      required: ["url"],
    },
    execute: async (args) => {
      const resp = await fetch(args.url as string);
      const text = await resp.text();
      return { content: text.slice(0, 5000), isError: false };
    },
  });
};
```

**Via `createTools()`** (if you need to customize the built-in set):
```typescript
import { VirtualFS, createTools } from "./lib/index.js";

const fs = new VirtualFS();
const tools = createTools(fs);  // returns [read, write, edit, list]
```

### ToolDefinition

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema (OpenAI function calling format)
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
}

interface ToolResult {
  content: string;   // Text returned to the model
  isError: boolean;  // If true, the model sees this as an error
}
```

---

## VirtualFS

A simple in-memory filesystem. All paths are normalized to have a leading `/` and collapsed `//`.

```typescript
const fs = new VirtualFS();

fs.write("/src/main.ts", "console.log('hello')");
fs.read("/src/main.ts");          // "console.log('hello')"
fs.exists("/src/main.ts");        // true
fs.list("/src");                   // ["/src/main.ts"]
fs.delete("/src/main.ts");        // true
```

The agent's `VirtualFS` instance is accessible via `agent.fs`. You can pre-populate it before the first prompt:

```typescript
const agent = new Agent({ apiKey: "..." });
agent.fs.write("/README.md", "# My Project\nThis is a starter.");
agent.fs.write("/src/index.ts", "export function hello() { return 'hi'; }");

// Now the model can read and edit these files
for await (const event of agent.prompt("Add a greet function to /src/index.ts")) {
  // ...
}
```

---

## Extensions

Extensions are functions that receive a `PiBrowserAPI` and use it to add capabilities. They run once at agent construction time.

### Writing an extension

```typescript
import type { Extension } from "./lib/index.js";

export const myExtension: Extension = (api) => {
  // Register a tool
  api.registerTool({ name: "...", description: "...", parameters: {}, execute: async () => ... });

  // Listen to agent events
  const unsub = api.on("agent_event", (event) => {
    if (event.type === "turn_end") console.log("Agent finished a turn");
  });

  // Request user input (pauses tool execution until user responds)
  // Only callable from within a tool's execute() function
  const response = await api.requestUserInput({
    question: "What language?",
    fields: [
      { name: "lang", label: "Language", type: "select", options: ["TS", "Python"] },
    ],
  });
};
```

### PiBrowserAPI

```typescript
interface PiBrowserAPI {
  registerTool(tool: ToolDefinition): void;
  on(event: "agent_event", handler: (e: AgentEvent) => void): () => void;
  requestUserInput(request: UserInputRequest): Promise<UserInputResponse>;
}
```

### User input

Extensions can pause and ask the user for input via `requestUserInput()`. This only works if the application has wired up a handler via `agent.setUserInputHandler()`.

```typescript
interface UserInputRequest {
  question: string;            // Headline
  description?: string;        // Longer description
  fields?: UserInputField[];   // Form fields (defaults to single text input)
}

interface UserInputField {
  name: string;                // Key in the response object
  label: string;               // Displayed label
  type: "text" | "textarea" | "select" | "confirm";
  placeholder?: string;
  options?: string[];          // Required for "select" type
  defaultValue?: string;
  required?: boolean;
}

type UserInputResponse = Record<string, string>;  // field name → value
```

### Loading extensions

Pass them in the `AgentConfig`:

```typescript
const agent = new Agent({
  apiKey: "...",
  extensions: [myExtension, anotherExtension],
});
```

---

## Skills

Skills are named instruction documents the model can load on-demand. Only names and descriptions appear in the system prompt — the full content is loaded when the model calls the `read_skill` tool.

### Writing a skill

```typescript
import type { Skill } from "./lib/index.js";

export const mySkill: Skill = {
  name: "api-design",
  description: "Design RESTful APIs. Use when asked to design or review an API.",
  content: `# API Design

## Guidelines
- Use nouns for resources, verbs for actions
- Return appropriate status codes
- ...full instructions here...`,
};
```

### How it works

1. Skills are passed in `AgentConfig.skills`
2. The `SkillRegistry` generates a system prompt fragment listing all skill names + descriptions
3. This fragment is appended to the system prompt automatically
4. The model sees a `read_skill` tool and calls it when a task matches
5. The full `content` is returned as the tool result

### Loading skills

```typescript
const agent = new Agent({
  apiKey: "...",
  skills: [mySkill, anotherSkill],
});
```

---

## Prompt templates

Templates are `/slash` commands the user types in the chat. They're expanded **before** the text reaches the model.

### Writing a template

```typescript
import type { PromptTemplate } from "./lib/index.js";

export const myTemplate: PromptTemplate = {
  name: "scaffold",
  description: "Scaffold a new project",
  body: `Create a new $1 project called $2. Set up the basic file structure. $\{@:3\}`,
};
```

### Argument syntax

| Placeholder   | Meaning                                  | Example input: `/scaffold ts myapp with tests` |
|---------------|------------------------------------------|------------------------------------------------|
| `$1`          | First argument                           | `ts`                                           |
| `$2`          | Second argument                          | `myapp`                                        |
| `$@`          | All arguments joined                     | `ts myapp with tests`                          |
| `${@:2}`      | Arguments from position 2 onward         | `myapp with tests`                             |
| `${@:3:2}`    | 2 arguments starting at position 3       | `with tests`                                   |

Quoted strings are treated as single arguments: `/scaffold ts "my app"` → `$1 = "ts"`, `$2 = "my app"`.

### Using templates

Pass them in `AgentConfig`:

```typescript
const agent = new Agent({
  apiKey: "...",
  promptTemplates: [myTemplate, ...otherTemplates],
});
```

For autocomplete UI, use the registry directly:

```typescript
// Search for templates matching a prefix
const matches = agent.promptTemplates.search("sca");  // finds "scaffold"

// Expand manually (returns null if no match)
const expanded = agent.promptTemplates.expand("/scaffold ts myapp");
```

---

## OpenRouter client

The `runAgent` function is exported for advanced use cases. Most applications should use `Agent.prompt()` instead — it wraps `runAgent` and handles history, extensions, and template expansion.

```typescript
import { runAgent } from "./lib/index.js";

for await (const event of runAgent(messages, tools, { apiKey, model }, abortSignal)) {
  // raw streaming events
}
```

It handles:
- SSE streaming from OpenRouter's OpenAI-compatible endpoint
- Incremental tool call argument assembly
- Automatic tool execution and multi-turn tool loops
- The model defaults to `anthropic/claude-sonnet-4`

---

## Full example: minimal app

A complete application in ~30 lines (no UI framework needed):

```typescript
import { Agent } from "./lib/index.js";

const agent = new Agent({ apiKey: "sk-or-..." });

// Pre-populate the filesystem
agent.fs.write("/greeting.txt", "Hello, world!");

// Send a prompt and collect the response
let response = "";
for await (const event of agent.prompt("Read /greeting.txt and translate it to French")) {
  if (event.type === "text_delta") {
    response += event.delta;
  }
  if (event.type === "tool_call_end") {
    console.log(`[tool] ${event.toolCall.name} → ${event.toolCall.result?.content}`);
  }
}

console.log("\nAgent:", response);

// Check what the agent wrote
const files = agent.fs.list("/");
for (const path of files) {
  console.log(`\n--- ${path} ---\n${agent.fs.read(path)}`);
}
```

## Full example: with plugins

```typescript
import { Agent } from "./lib/index.js";
import type { Extension, Skill, PromptTemplate } from "./lib/index.js";

// Define an extension
const timestampExtension: Extension = (api) => {
  api.registerTool({
    name: "timestamp",
    description: "Get the current ISO timestamp",
    parameters: { type: "object", properties: {} },
    execute: async () => ({
      content: new Date().toISOString(),
      isError: false,
    }),
  });
};

// Define a skill
const cssSkill: Skill = {
  name: "css-layout",
  description: "Expert CSS layout advice. Use when asked about flexbox, grid, or responsive design.",
  content: "# CSS Layout\n\n## Flexbox\n...\n## Grid\n...",
};

// Define a template
const styleTemplate: PromptTemplate = {
  name: "style",
  description: "Style a component",
  body: "Write CSS for $1. Requirements: $\\{@:2\\}",
};

// Wire it all together
const agent = new Agent({
  apiKey: "sk-or-...",
  extensions: [timestampExtension],
  skills: [cssSkill],
  promptTemplates: [styleTemplate],
});

// Use it
for await (const event of agent.prompt("/style .card responsive with dark theme")) {
  if (event.type === "text_delta") process.stdout.write(event.delta);
}
```

---

## Project structure reference

```
src/lib/
  index.ts              Barrel export — import everything from here
  agent.ts              Agent class (main entry point)
  types.ts              Message, ToolCall, ToolResult, ToolDefinition, AgentEvent
  extensions.ts         Extension, PiBrowserAPI, ExtensionRegistry
  skills.ts             Skill, SkillRegistry
  prompt-templates.ts   PromptTemplate, PromptTemplateRegistry
  openrouter.ts         OpenRouter streaming client + tool loop
  tools.ts              VirtualFS + built-in filesystem tools
```
