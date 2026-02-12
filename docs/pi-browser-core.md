# pi-browser core library

A browser-based AI coding agent framework. The core library provides AI-powered conversations, tool calling, streaming, and thread persistence — all client-side with no server.

## Architecture

```
src/core/             ← core framework (no UI dependencies, pure TypeScript)
  agent.ts            Agent class (main API, implements ExtensionHost)
  types.ts            Message, ToolCall, AgentEvent, PromptResult, etc.
  extensions.ts       Extension system (ExtensionHost interface, ExtensionRegistry)
  skills.ts           On-demand instruction documents + frontmatter parser
  prompt-templates.ts /slash command expansion
  openrouter.ts       OpenRouter streaming client + tool loop
  tools.ts            VirtualFS + built-in filesystem tools
  storage.ts          Thread persistence (IndexedDB + localStorage), agent-level VFS

src/core/plugins/     ← built-in extensions, skills, prompt templates

examples/
  chat/               Minimal chat app (Lit + Vite)
  tutor/              AI tutor with lessons and code editor (Lit + Vite)
  sveltekit-chat/     Chat app built with SvelteKit
  do-i-suck-at-math/  Minimal SvelteKit example
```

## Quick start

### Simple (non-streaming)

```typescript
import { Agent } from "pi-browser";

const agent = await Agent.create({ apiKey: "sk-or-..." });

const result = await agent.send("Write a hello world in Python");
console.log(result.text);       // assistant's response
console.log(result.toolCalls);  // any tool calls made
```

### With streaming updates

```typescript
const result = await agent.send("Write a hello world in Python", {
  onText: (delta, fullText) => updateUI(fullText),
  onToolCallStart: (tc) => showSpinner(tc.name),
  onToolCallEnd: (tc) => showResult(tc.result),
  onError: (err) => showError(err),
});
```

### Low-level streaming (advanced)

For full control over every event, use `prompt()` which returns an `AsyncGenerator<AgentEvent>`:

```typescript
for await (const event of agent.prompt("Write hello world")) {
  switch (event.type) {
    case "text_delta":      process.stdout.write(event.delta); break;
    case "tool_call_start": console.log(`Calling ${event.toolCall.name}...`); break;
    case "tool_call_end":   console.log(`Result: ${event.toolCall.result?.content}`); break;
    case "error":           console.error(event.error); break;
  }
}
```

Everything else — extensions, skills, templates, threads — is opt-in.

---

## Public API

Exported from `pi-browser`:

```typescript
// Classes
Agent, VirtualFS

// Types
AgentConfig, Message, ToolCall, ToolResult, ToolDefinition,
AgentEvent, PromptResult, PromptCallbacks, ThreadMeta,
Extension, ExtensionHost, PiBrowserAPI (deprecated),
UserInputField, UserInputRequest, UserInputResponse,
Skill, PromptTemplate

// Functions
parseSkillMarkdown, serializeSkillMarkdown

// Built-in plugins
askUserExtension, codeReviewSkill, litComponentSkill, piBrowserSkill, builtinTemplates
```

---

## Agent

The `Agent` class is the primary API. It orchestrates messages, tools, extensions, skills, templates, thread management, and persistence. It also implements `ExtensionHost`, so extensions receive the Agent directly.

### Construction

```typescript
// Recommended — creates agent, loads VFS, auto-loads extensions/skills, restores thread
const agent = await Agent.create(config);

// Manual — you must call ready() yourself before prompting
const agent = new Agent(config);
await agent.ready();
```

### AgentConfig

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

### Sending messages

#### `send(text, callbacks?): Promise<PromptResult>` — Recommended

The simplest way to interact with the agent. Sends a message, handles the full tool-use loop internally, and returns the final result. Optional callbacks provide streaming updates.

```typescript
interface PromptResult {
  text: string;         // Full accumulated assistant text
  toolCalls: ToolCall[];  // All tool calls made (with results)
}

interface PromptCallbacks {
  onText?: (delta: string, fullText: string) => void;
  onToolCallStart?: (toolCall: ToolCall) => void;
  onToolCallEnd?: (toolCall: ToolCall) => void;
  onError?: (error: string) => void;
}
```

**Example — no streaming:**

```typescript
const result = await agent.send("What is 2 + 2?");
console.log(result.text); // "4"
```

**Example — with streaming UI:**

```typescript
const result = await agent.send("Create a React component", {
  onText: (_delta, full) => { streamingText = full; },
  onToolCallStart: (tc) => { console.log(`Calling ${tc.name}...`); },
  onToolCallEnd: (tc) => { syncEditorFromFS(); },
  onError: (err) => { showError(err); },
});

// After completion, use result.text and result.toolCalls
displayMessage(result.text, result.toolCalls);
```

If the request is aborted via `agent.abort()`, `send()` resolves with whatever text/toolCalls were accumulated so far (does not throw).

#### `prompt(text): AsyncGenerator<AgentEvent>` — Advanced

Returns a raw event stream for full control. You must manually accumulate text deltas, track tool calls, and handle errors. Use `send()` unless you need event-level control.

```typescript
for await (const event of agent.prompt(text)) {
  // handle each event
}
```

#### `abort()`

Cancel the current streaming response. With `send()`, the promise resolves with partial results. With `prompt()`, the generator throws an `AbortError`.

### Messages

```typescript
agent.getMessages(): Message[]  // Copy of full conversation history
```

```typescript
interface Message {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls?: ToolCall[];     // For assistant messages with tool use
  toolCallId?: string;        // For tool-role messages
}
```

### Tools

```typescript
agent.tools: ToolDefinition[]  // All available tools (builtin + extension + read_skill)
```

### Filesystem

The VFS is **per-agent** (shared across all threads). Thread switching does not affect VFS state.

```typescript
agent.fs: VirtualFS  // Direct access to the virtual filesystem
```

### User input

Extensions can pause and ask the user for input. You must wire up a handler:

```typescript
agent.setUserInputHandler(async (request) => {
  // Show a form to the user, return their response
  return { answer: "user's answer" };
});
```

### Dynamic extension management

Add or remove extensions **after** the agent is initialized. Dynamic extensions are persisted to VFS and auto-loaded on future startups.

#### `addExtension(source, filename): Promise<void>`

Add an extension from JavaScript source code. The source must be a function expression that accepts an `ExtensionHost` (the agent):

```typescript
await agent.addExtension(`(agent) => {
  agent.registerTool({
    name: "fetch_url",
    description: "Fetch a URL and return its text content",
    parameters: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
    execute: async (args) => {
      const text = await (await fetch(args.url)).text();
      return { content: text.slice(0, 5000), isError: false };
    },
  });
}`, "fetch-url");
```

The extension is:
1. Evaluated and executed immediately (tools become available right away)
2. Persisted to `/.pi-browser/extensions/<filename>.js` on the VFS
3. Auto-loaded on future agent startups

#### `removeExtension(name): Promise<void>`

Remove a previously added extension. Unregisters all its tools and removes it from VFS:

```typescript
await agent.removeExtension("fetch-url");
```

### Dynamic skill management

Add or remove skills **after** the agent is initialized. Dynamic skills are persisted to VFS and auto-loaded on future startups.

#### `addSkill(skill): Promise<void>`

```typescript
await agent.addSkill({
  name: "api-design",
  description: "Design RESTful APIs. Use when asked to design or review an API.",
  content: "# API Design Guidelines\n\n## URL Structure\n- Use nouns for resources...",
});
```

The skill is:
1. Registered immediately (available to the model right away)
2. Persisted to `/.pi-browser/skills/<name>.md` as markdown with YAML frontmatter
3. Auto-loaded on future agent startups

#### `removeSkill(name): Promise<void>`

```typescript
await agent.removeSkill("api-design");
```

### Thread management

Threads provide conversation persistence across page reloads using IndexedDB and localStorage. **Threads only persist messages** — VFS is shared across all threads at the agent level.

| Method | Description |
|--------|-------------|
| `agent.activeThreadId` | Current thread ID (or null) |
| `agent.listThreads(): ThreadMeta[]` | All threads, most recent first |
| `agent.newThread(name?): Promise<string>` | Create a new thread, returns its ID |
| `agent.switchThread(id): Promise<void>` | Switch to an existing thread |
| `agent.deleteThread(id): Promise<void>` | Delete a thread |
| `agent.renameThread(id, name): void` | Rename a thread |
| `agent.persist(): Promise<void>` | Manually persist (auto-called after `send`/`prompt`) |
| `agent.serialize()` | Get `{ messages, fs }` snapshot |

```typescript
interface ThreadMeta {
  id: string;
  name: string;
  createdAt: number;  // epoch ms
  updatedAt: number;  // epoch ms
}
```

Threads auto-name themselves from the first user message.

---

## AgentEvent

```typescript
type AgentEvent =
  | { type: "text_delta"; delta: string }            // Incremental model text
  | { type: "tool_call_start"; toolCall: ToolCall }  // Tool invocation started
  | { type: "tool_call_end"; toolCall: ToolCall }    // Tool finished (result attached)
  | { type: "tool_loop_message"; message: Message }  // Internal message added to history
  | { type: "turn_end" }                             // Model finished responding
  | { type: "error"; error: string }                 // Non-fatal error
```

**Typical sequences:**
- Simple text: `text_delta* → turn_end`
- With tools: `tool_call_start → tool_call_end → text_delta* → turn_end`
- Multiple tool calls can happen per turn, and the model may loop (call tools, get results, call more tools, etc.)

---

## Tools

### Built-in filesystem tools

| Tool | Params | Description |
|------|--------|-------------|
| `read` | `path` | Read a file's contents |
| `write` | `path`, `content` | Create or overwrite a file |
| `edit` | `path`, `oldText`, `newText` | Replace exact text in a file |
| `list` | `prefix` (default `/`) | List files under a prefix |

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

### Custom tools via extensions

```typescript
const myExtension: Extension = (agent) => {
  agent.registerTool({
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

---

## VirtualFS

In-memory filesystem. Paths are normalized with leading `/` and collapsed `//`.

The VFS is **per-agent** — shared across all threads and persisted independently in its own IndexedDB store. Thread switching does not save/restore VFS.

```typescript
const fs = new VirtualFS();

fs.write("/src/main.ts", "console.log('hello')");
fs.read("/src/main.ts");     // "console.log('hello')"
fs.exists("/src/main.ts");   // true
fs.list("/src");              // ["/src/main.ts"]
fs.delete("/src/main.ts");   // true

// Serialization
const json = fs.toJSON();                // Record<string, string>
const restored = VirtualFS.fromJSON(json);

// Snapshot / restore
const snap = fs.snapshot();   // Map<string, string>
fs.restore(snap);
```

Pre-populate via `agent.fs` before prompting:

```typescript
agent.fs.write("/data.json", JSON.stringify({ items: [1, 2, 3] }));
const result = await agent.send("Summarize the data in /data.json");
```

### VFS-persisted extensions and skills

Dynamic extensions and skills are stored on the VFS and auto-loaded on startup:

```
/.pi-browser/
  extensions/
    fetch-url.js       ← JavaScript function: (agent) => { ... }
    my-tool.js
  skills/
    api-design.md      ← Markdown with YAML frontmatter
    css-layout.md
```

---

## Extensions

Extensions are functions that receive the Agent (which implements `ExtensionHost`) and add capabilities.

### Extension type

```typescript
type Extension = (agent: ExtensionHost) => void | Promise<void>;
```

### ExtensionHost

The `Agent` class implements `ExtensionHost`:

```typescript
interface ExtensionHost {
  registerTool(tool: ToolDefinition, extensionName?: string): void;
  on(event: "agent_event", handler: (e: AgentEvent) => void): () => void;
  requestUserInput(request: UserInputRequest): Promise<UserInputResponse>;
}
```

### Config extensions vs dynamic extensions

**Config extensions** are passed in `AgentConfig.extensions` and loaded during initialization:

```typescript
const agent = await Agent.create({
  apiKey: "sk-or-...",
  extensions: [askUserExtension, myExtension],
});
```

**Dynamic extensions** are added after initialization and persisted to VFS:

```typescript
await agent.addExtension(`(agent) => {
  agent.registerTool({ name: "my_tool", ... });
}`, "my-tool");
```

### User input from extensions

Extensions can pause execution and ask the user for input via a form:

```typescript
const askExtension: Extension = (agent) => {
  agent.registerTool({
    name: "ask_user",
    description: "Ask the user a question",
    parameters: { /* ... */ },
    execute: async (args) => {
      const response = await agent.requestUserInput({
        question: args.question as string,
        fields: [{ name: "answer", label: "Your answer", type: "text", required: true }],
      });
      return { content: response.answer, isError: false };
    },
  });
};
```

Requires `agent.setUserInputHandler()` to be wired up in the UI layer.

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

### Built-in extension

- **`askUserExtension`** — Registers an `ask_user` tool that prompts the user for input.

---

## Skills

Named instruction documents loaded on-demand. Only names and descriptions appear in the system prompt — full content is loaded when the model calls the auto-registered `read_skill` tool.

```typescript
interface Skill {
  name: string;         // e.g. "code-review"
  description: string;  // When to use this skill (shown in system prompt)
  content: string;      // Full instructions (markdown)
}
```

### Config skills

```typescript
const agent = await Agent.create({
  apiKey: "sk-or-...",
  skills: [
    {
      name: "api-design",
      description: "Design RESTful APIs. Use when asked to design or review an API.",
      content: "# API Design\n\n## Guidelines\n- Use nouns for resources...",
    },
  ],
});
```

### Dynamic skills

```typescript
await agent.addSkill({
  name: "css-layout",
  description: "CSS layout advice for flexbox, grid, responsive design.",
  content: "# CSS Layout\n\n## Flexbox\n...\n## Grid\n...",
});

await agent.removeSkill("css-layout");
```

### Skill markdown format

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

Use `parseSkillMarkdown()` and `serializeSkillMarkdown()` to convert:

```typescript
import { parseSkillMarkdown, serializeSkillMarkdown } from "pi-browser";

const skill = parseSkillMarkdown(markdownString);  // Skill | null
const markdown = serializeSkillMarkdown(skill);     // string
```

When skills are registered, a `read_skill` tool is automatically added. The model reads the skill content when it encounters a matching task.

### Built-in skills

- **`codeReviewSkill`** — Code review guidelines
- **`litComponentSkill`** — Lit web component creation
- **`piBrowserSkill`** — pi-browser usage guide

---

## Prompt templates

`/slash` commands that expand before reaching the model.

```typescript
interface PromptTemplate {
  name: string;         // Command name (no leading slash)
  description: string;  // Shown in autocomplete
  body: string;         // Template body with placeholders
}
```

```typescript
const agent = await Agent.create({
  apiKey: "sk-or-...",
  promptTemplates: [
    {
      name: "scaffold",
      description: "Scaffold a new project",
      body: "Create a new $1 project called $2. Set up the basic file structure. ${@:3}",
    },
  ],
});
```

### Argument placeholders

| Placeholder | Meaning | Example with `/scaffold ts myapp with tests` |
|-------------|---------|-----------------------------------------------|
| `$1` | First argument | `ts` |
| `$2` | Second argument | `myapp` |
| `$@` | All arguments joined | `ts myapp with tests` |
| `${@:2}` | Args from position 2+ | `myapp with tests` |
| `${@:3:2}` | 2 args from position 3 | `with tests` |

Quoted strings are single arguments: `/scaffold ts "my app"` → `$1="ts"`, `$2="my app"`.

### Autocomplete

```typescript
agent.promptTemplates.search("sca");  // [{ name: "scaffold", ... }]
```

### Manual expansion

```typescript
agent.promptTemplates.expand("/scaffold ts myapp");
// → "Create a new ts project called myapp. Set up the basic file structure. "
```

Templates are auto-expanded by `send()` and `prompt()` — the model sees the final expanded text.

### Built-in templates

- **`builtinTemplates`** — Array of common templates (review, refactor, etc.)

---

## Persistence

### VFS persistence (per-agent)

The VFS is persisted independently of threads in its own IndexedDB store (`agent-vfs`). This means:
- Extensions and skills added via `addExtension()` / `addSkill()` survive page reloads
- VFS state is shared across all threads
- Thread switching does not save/restore VFS

### Thread persistence (messages only)

Thread state is persisted automatically:

- **Thread metadata** (id, name, timestamps) → `localStorage`
- **Messages** → `IndexedDB`

Messages are saved after each completed `send()` or `prompt()` turn. On page reload, `Agent.create()` restores the last active thread's messages and the shared VFS.

### Auto-loading on startup

When `Agent.create()` is called:
1. VFS is loaded from its own IndexedDB store
2. Extensions in `/.pi-browser/extensions/*.js` are evaluated and executed
3. Skills in `/.pi-browser/skills/*.md` are parsed (YAML frontmatter) and registered
4. Config extensions from `AgentConfig.extensions` are loaded

```typescript
// Thread lifecycle
const id = await agent.newThread("My project");
await agent.send("Hello!");

// Later, switch between threads
const threads = agent.listThreads();
await agent.switchThread(threads[1].id);

// Delete a thread
await agent.deleteThread(id);
```

---

## Full example

```typescript
import { Agent, askUserExtension, codeReviewSkill, builtinTemplates } from "pi-browser";
import type { Extension, Skill, PromptTemplate } from "pi-browser";

// Custom extension (config-time)
const timestampExtension: Extension = (agent) => {
  agent.registerTool({
    name: "timestamp",
    description: "Get the current ISO timestamp",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: new Date().toISOString(), isError: false }),
  });
};

// Custom skill
const cssSkill: Skill = {
  name: "css-layout",
  description: "CSS layout advice for flexbox, grid, responsive design.",
  content: "# CSS Layout\n\n## Flexbox\n...\n## Grid\n...",
};

// Custom template
const styleTemplate: PromptTemplate = {
  name: "style",
  description: "Style a component",
  body: "Write CSS for $1. Requirements: ${@:2}",
};

// Create agent
const agent = await Agent.create({
  apiKey: "sk-or-...",
  extensions: [askUserExtension, timestampExtension],
  skills: [codeReviewSkill, cssSkill],
  promptTemplates: [...builtinTemplates, styleTemplate],
});

// Pre-populate filesystem
agent.fs.write("/greeting.txt", "Hello, world!");

// Simple usage
const result = await agent.send("Read /greeting.txt and tell me what it says");
console.log(result.text);

// Dynamic extension (persisted, auto-loaded next time)
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

// Dynamic skill (persisted, auto-loaded next time)
await agent.addSkill({
  name: "api-design",
  description: "Design RESTful APIs",
  content: "# API Design\n\n- Use nouns for resources...",
});

// Remove them later
await agent.removeExtension("fetch-url");
await agent.removeSkill("api-design");
```
