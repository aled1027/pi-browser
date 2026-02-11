# pi-browser

A browser-only coding agent inspired by [pi](https://github.com/badlogic/pi-mono). Users provide an OpenRouter API key and interact with an LLM that can read, write, and edit files in a virtual in-memory filesystem — all running entirely in the browser with no backend.

Like pi, pi-browser supports **extensions**, **tools**, **skills**, and **prompt templates**.

## Quick Start

```bash
npm install
npm run dev
```

Open the local URL, paste your [OpenRouter API key](https://openrouter.ai/keys), and start chatting.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser                                                        │
│                                                                 │
│  ┌───────────┐    ┌───────────┐    ┌────────────────┐           │
│  │  App.tsx   │───▶│  Chat.tsx  │───▶│ UserInputForm  │           │
│  └───────────┘    └─────┬─────┘    └────────────────┘           │
│                         │  ▲ autocomplete                       │
│                         │  │                                    │
│                    ┌────▼──┴────┐                                │
│                    │   Agent    │                                │
│                    └──┬──┬──┬──┘                                │
│           ┌───────────┘  │  └───────────┐                       │
│           │              │              │                       │
│   ┌───────▼───────┐ ┌───▼────────┐ ┌───▼──────────────┐        │
│   │  openrouter.ts │ │   Skills   │ │ Prompt Templates │        │
│   │  Streaming API │ │  Registry  │ │    Registry      │        │
│   └───────┬───────┘ └───┬────────┘ └──────────────────┘        │
│           │ tool calls   │ read_skill tool                      │
│   ┌───────▼──────────────▼──────────────────────┐               │
│   │    Tools (builtin + skills + extensions)     │──▶ VirtualFS │
│   └──────────────────────┬──────────────────────┘               │
│                          │                                      │
│                  ┌───────▼──────────┐                            │
│                  │ ExtensionRegistry │                            │
│                  │  loads extensions │                            │
│                  └──────────────────┘                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
          │
          │ HTTPS (SSE streaming)
          ▼
   OpenRouter API
```

There are six layers:

1. **UI** (`App.tsx`, `Chat.tsx`, `ApiKeyScreen.tsx`, `UserInputForm.tsx`) — React components for the chat interface, extension-driven forms, and prompt template autocomplete.
2. **Agent** (`agent.ts`) — Holds conversation history, the virtual filesystem, tools, skills, and prompt templates. Exposes an async-generator `prompt()` method that streams events.
3. **Skills** (`skills.ts`, `skills/`) — Specialized instruction sets the model loads on-demand. Descriptions are listed in the system prompt; full content is fetched via the `read_skill` tool.
4. **Prompt Templates** (`prompt-templates.ts`, `prompt-templates/`) — Named markdown snippets that expand when the user types `/name` in the input, with autocomplete and positional arguments.
5. **Extensions** (`extensions.ts`, `extensions/`) — Plugin system. Extensions receive a `PiBrowserAPI` and can register tools, listen to events, and request user input via browser forms.
6. **OpenRouter client** (`openrouter.ts`) — Calls OpenRouter's OpenAI-compatible chat completions endpoint with SSE streaming. Implements the tool-call loop.

## Comparison with pi

| Feature | pi | pi-browser |
|---------|-----|------------|
| **Tools** | `read`, `bash`, `edit`, `write` on real filesystem | `read`, `write`, `edit`, `list` on in-memory VirtualFS |
| **Extensions** | Loaded from disk, register tools/commands/hooks | Loaded programmatically, register tools/events/UI |
| **Skills** | Discovered from `~/.pi/agent/skills/` and `.pi/skills/` | Registered in code, same system prompt injection |
| **Prompt Templates** | Discovered from `~/.pi/agent/prompts/` and `.pi/prompts/` | Registered in code, same `/name args` expansion |
| **Runtime** | Node.js terminal | Browser, no backend |
| **LLM access** | Multiple providers, subscriptions, API keys | OpenRouter API key |
| **Filesystem** | Real OS filesystem | In-memory `Map<string, string>` |
| **Shell** | Real bash | Not yet (future: WebContainers or JS eval) |

## Source Files

### `src/types.ts` — Core Type Definitions

All shared types live here.

- **`Message`** — A conversation message (`user`, `assistant`, or `system`) with optional `toolCalls`.
- **`ToolCall`** — A tool invocation requested by the model: `id`, `name`, `arguments`, and optional `result`.
- **`ToolResult`** — The output of a tool execution: `content` string and `isError` flag.
- **`ToolDefinition`** — How a tool is registered: `name`, `description`, JSON Schema `parameters`, and an `execute` function.
- **`AgentEvent`** — A discriminated union of events emitted during agent processing:
  - `text_delta` — Incremental text from the model.
  - `tool_call_start` / `tool_call_end` — Bracket tool execution.
  - `turn_end` — The model finished without requesting more tool calls.
  - `error` — Something went wrong.

---

## Skills

Skills are specialized instruction sets the model can load on-demand. Like pi, only names and descriptions appear in the system prompt — full content is loaded when the model decides the task matches, using the `read_skill` tool. This is progressive disclosure: minimal context cost until a skill is actually needed.

Since pi-browser runs in the browser with no filesystem, skills are registered programmatically rather than discovered from disk.

### `src/skills.ts` — Skill System

#### `Skill` interface

```typescript
interface Skill {
  name: string;        // Unique identifier (lowercase, hyphens)
  description: string; // When to use this skill (shown in system prompt)
  content: string;     // Full instruction markdown (loaded on-demand)
}
```

#### `SkillRegistry`

- `register(skill)` / `registerAll(skills)` — Add skills.
- `get(name)` — Look up a skill by name.
- `getAll()` — List all registered skills.
- `systemPromptFragment()` — Generates the XML block injected into the system prompt listing available skills and their descriptions.
- `createReadSkillTool()` — Returns a `ToolDefinition` for `read_skill` that the model uses to load a skill's full content.

#### System prompt injection

When skills are registered, the system prompt is appended with:

```xml
The following skills provide specialized instructions for specific tasks.
Use the read_skill tool to load a skill's full content when the task matches its description.

<available_skills>
  <skill>
    <name>code-review</name>
    <description>Review code for bugs, security issues, ...</description>
  </skill>
  ...
</available_skills>
```

The model sees this and decides when to call `read_skill` to load the full instructions.

### Built-in skills

| Skill | File | Description |
|-------|------|-------------|
| `code-review` | `src/skills/code-review.ts` | Review code for bugs, security, performance, style |
| `react-component` | `src/skills/react-component.ts` | Create well-structured React components with TypeScript |

### Writing a skill

```typescript
import type { Skill } from "../skills";

export const mySkill: Skill = {
  name: "my-skill",
  description: "When to use this skill. Be specific — this text determines when the model loads it.",
  content: `# My Skill

## Instructions

Step-by-step instructions for the model...

## Rules

- Rule 1
- Rule 2
`,
};
```

Register in `App.tsx`:
```typescript
agentRef.current = new Agent({
  apiKey: key,
  skills: [codeReviewSkill, reactComponentSkill, mySkill],
  // ...
});
```

**Tips:**
- The `description` is critical — it's all the model sees until it loads the skill. Be specific about when it applies.
- The `content` can be as long as needed since it's only loaded on demand.
- Use markdown formatting for structure.
- Reference tool names the model can use (e.g., `read`, `write`, `edit`).

---

## Prompt Templates

Prompt templates are named markdown snippets that expand when the user types `/name` in the chat input. They support positional arguments, matching pi's template system.

### `src/prompt-templates.ts` — Template System

#### `PromptTemplate` interface

```typescript
interface PromptTemplate {
  name: string;        // Command name (no leading slash)
  description: string; // Shown in autocomplete
  body: string;        // Template body with argument placeholders
}
```

#### Argument placeholders

| Placeholder | Meaning |
|-------------|---------|
| `$1`, `$2`, ... | Positional arguments |
| `$@` or `$ARGUMENTS` | All arguments joined with spaces |
| `${@:N}` | Arguments from position N onward (1-indexed) |
| `${@:N:L}` | L arguments starting at position N |

#### `PromptTemplateRegistry`

- `register(template)` / `registerAll(templates)` — Add templates.
- `get(name)` — Look up by name.
- `getAll()` — List all templates.
- `search(prefix)` — Find templates matching a prefix (for autocomplete).
- `expand(input)` — If input starts with `/name`, look up the template and expand placeholders. Returns `null` if no match.

#### Argument parsing

Quoted strings are supported:
```
/component Button "click handler"
→ $1 = "Button", $2 = "click handler", $@ = "Button click handler"
```

### Built-in templates

| Template | Usage | Description |
|----------|-------|-------------|
| `/review` | `/review /path/to/file` | Review code for issues |
| `/explain` | `/explain /path/to/file` | Explain how code works |
| `/refactor` | `/refactor /path/to/file readability` | Refactor code |
| `/test` | `/test /path/to/file` | Write tests |
| `/component` | `/component Button "handles clicks"` | Create a React component |
| `/fix` | `/fix the login form crashes on empty input` | Fix a bug |
| `/help` | `/help` | List available templates |

### Autocomplete

When the user types `/` in the chat input (without a space), an autocomplete dropdown appears above the input showing matching templates with their descriptions. Navigate with arrow keys, accept with Tab or Enter.

### Writing a prompt template

```typescript
import type { PromptTemplate } from "../prompt-templates";

const myTemplate: PromptTemplate = {
  name: "deploy",
  description: "Prepare code for deployment",
  body: `Prepare the code in $1 for deployment. Check for:
- Hardcoded dev URLs
- Console.log statements
- Missing error handling
- Environment-specific config

Target environment: ${@:2}`,
};
```

Register in `App.tsx`:
```typescript
import { builtinTemplates } from "./prompt-templates/builtins";

agentRef.current = new Agent({
  apiKey: key,
  promptTemplates: [...builtinTemplates, myTemplate],
  // ...
});
```

---

## Extensions

Extensions are functions that receive a `PiBrowserAPI` and use it to register tools, subscribe to agent events, and request interactive user input.

### `src/extensions.ts` — Extension System

#### Key types

- **`Extension`** — A function `(api: PiBrowserAPI) => void | Promise<void>` that receives the API and sets things up.
- **`PiBrowserAPI`** — The surface available to extensions:
  - `registerTool(tool)` — Add a tool the model can call.
  - `on("agent_event", handler)` — Subscribe to streaming agent events. Returns an unsubscribe function.
  - `requestUserInput(request)` — Show a browser form to the user and await their response. Returns a `Promise<UserInputResponse>`.
- **`UserInputRequest`** — Describes a form: a `question` headline, optional `description`, and an array of `fields`.
- **`UserInputField`** — A single form field with `name`, `label`, `type` (`text` | `textarea` | `select` | `confirm`), and optional `placeholder`, `options`, `defaultValue`, `required`.
- **`UserInputResponse`** — A `Record<string, string>` mapping field names to the user's answers.

#### `ExtensionRegistry`

Manages extension lifecycle:
- `load(extensions)` — Instantiates each extension with a `PiBrowserAPI`.
- `getTools()` — Returns all tools registered by extensions.
- `emit(event)` — Broadcasts an agent event to extension listeners.
- `setUserInputHandler(handler)` — Called by the UI layer to wire up the form display. When an extension calls `requestUserInput()`, this handler is invoked.

### `src/extensions/ask-user.ts` — Ask User Extension

The first built-in extension. Registers an `ask_user` tool that lets the model present a form to the user mid-conversation.

**How it works:**
1. The model calls `ask_user` with a question and optional field definitions.
2. The tool calls `api.requestUserInput()`, which pauses tool execution.
3. The Chat component detects the pending request and renders `<UserInputForm>`.
4. The user fills in the form and clicks Submit.
5. The promise resolves with the user's answers, and the tool returns them as JSON to the model.
6. The model continues with the user's input.

**Tool parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `question` | string | yes | Headline shown above the form |
| `description` | string | no | Longer description text |
| `fields` | array | no | Form field definitions (defaults to single text input) |

**Field types:**

| Type | Renders as | Notes |
|------|-----------|-------|
| `text` | Single-line input | Default if no fields specified |
| `textarea` | Multi-line input | Resizable, min 4 rows |
| `select` | Dropdown | Requires `options` array |
| `confirm` | Yes/No toggle | Returns `"yes"` or `"no"` |

**Example tool calls by the model:**

Simple question (single text input):
```json
{ "question": "What should the project be called?" }
```

Multi-field form:
```json
{
  "question": "Project setup",
  "description": "I need a few details before I start.",
  "fields": [
    { "name": "name", "label": "Project name", "type": "text", "required": true },
    { "name": "desc", "label": "Description", "type": "textarea" },
    { "name": "lang", "label": "Language", "type": "select", "options": ["TypeScript", "Python", "Rust"] },
    { "name": "ready", "label": "Ready to start?", "type": "confirm" }
  ]
}
```

### Writing extensions

#### Minimal: tool-only extension

```typescript
import type { Extension } from "../extensions";

export const myExtension: Extension = (api) => {
  api.registerTool({
    name: "greet",
    description: "Greet someone by name.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name to greet" },
      },
      required: ["name"],
    },
    execute: async (args) => ({
      content: `Hello, ${args.name}!`,
      isError: false,
    }),
  });
};
```

#### Extension with user interaction

```typescript
import type { Extension } from "../extensions";

export const confirmExtension: Extension = (api) => {
  api.registerTool({
    name: "confirm_action",
    description: "Ask the user to confirm before proceeding.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", description: "What you're about to do" },
      },
      required: ["action"],
    },
    execute: async (args) => {
      const response = await api.requestUserInput({
        question: "Confirm action",
        description: args.action as string,
        fields: [
          { name: "confirm", label: "Proceed?", type: "confirm", required: true },
        ],
      });
      return {
        content: response.confirm === "yes" ? "User confirmed." : "User declined.",
        isError: false,
      };
    },
  });
};
```

#### Extension with event listening

```typescript
import type { Extension } from "../extensions";

export const loggerExtension: Extension = (api) => {
  api.on("agent_event", (event) => {
    if (event.type === "tool_call_end") {
      console.log(`[logger] Tool ${event.toolCall.name} completed`);
    }
  });
};
```

Register extensions in `App.tsx`:
```typescript
agentRef.current = new Agent({
  apiKey: key,
  extensions: [askUserExtension, myExtension, loggerExtension],
});
```

---

## Tools

Tools are the low-level actions the model can take. They come from three sources:

1. **Built-in tools** (`src/tools.ts`) — `read`, `write`, `edit`, `list` operating on VirtualFS.
2. **Skill tools** — `read_skill` is auto-added when skills are registered.
3. **Extension tools** — registered by extensions via `api.registerTool()`.

The Agent merges all three into a single tool list passed to the model on every request.

### `src/tools.ts` — Built-in Tools & VirtualFS

#### `VirtualFS`

A `Map<string, string>`-backed in-memory filesystem. All paths are normalized to start with `/` with collapsed slashes.

Methods:
- `read(path)` → `string | undefined`
- `write(path, content)` → `void`
- `delete(path)` → `boolean`
- `list(prefix)` → `string[]` (all paths matching the prefix)
- `exists(path)` → `boolean`

#### Built-in tools

| Tool | Description |
|------|-------------|
| `read` | Read a file's contents. Returns error if not found. |
| `write` | Write content to a file. Creates or overwrites. |
| `edit` | Find-and-replace exact text. Errors if file missing or `oldText` not found. |
| `list` | List all files matching a directory prefix. |

### Adding a built-in tool

For tools that don't need the extension API, add them directly in `src/tools.ts`:

```typescript
function myTool(): ToolDefinition {
  return {
    name: "my_tool",
    description: "Does something useful.",
    parameters: {
      type: "object",
      properties: {
        input: { type: "string", description: "The input" },
      },
      required: ["input"],
    },
    execute: async (args) => {
      const input = args.input as string;
      return { content: `Result: ${input}`, isError: false };
    },
  };
}
```

Add it to the array returned by `createTools()`. For tools needing user interaction or event access, write an extension instead.

---

## Other Source Files

### `src/openrouter.ts` — OpenRouter API Client

The `runAgent()` async generator is the core streaming engine. It:

1. Converts `Message[]` and `ToolDefinition[]` to OpenAI chat-completions format.
2. Sends a streaming request to `https://openrouter.ai/api/v1/chat/completions`.
3. Parses the SSE stream, yielding `text_delta` events as text arrives.
4. Collects tool calls that arrive incrementally across SSE chunks.
5. When the stream ends with pending tool calls, executes each tool and yields `tool_call_start`/`tool_call_end` events.
6. Appends the assistant message (with tool calls) and tool results to the message list, then loops back to step 2.
7. When the model responds with only text (no tool calls), yields `turn_end` and returns.

**Key details:**
- Default model: `anthropic/claude-sonnet-4`.
- Accepts an `AbortSignal` for cancellation.
- Sends `HTTP-Referer` and `X-Title` headers as required by OpenRouter.

### `src/agent.ts` — Agent Session

The `Agent` class ties everything together:

- **Constructor** — Takes an `AgentConfig` with API key, optional model, system prompt, extensions, skills, and prompt templates. Creates VirtualFS, tools, registries, and builds the system prompt with skill listings.
- **`ready()`** — Awaits extension loading. Called automatically before the first prompt.
- **`tools`** (getter) — Returns built-in tools + skill tools + extension tools.
- **`setUserInputHandler(handler)`** — Called by Chat to wire up form display.
- **`prompt(text)`** — Expands prompt templates if applicable, appends user message, streams through `runAgent()`, broadcasts events, and records the assistant response.
- **`abort()`** — Cancels the in-flight request.
- **`getMessages()`** — Returns a copy of conversation history.

### `src/App.tsx` — Root Component

Two-screen flow:
1. **API key screen** — key persisted to `localStorage`.
2. **Chat screen** — creates an `Agent` with extensions, skills, and templates.

### `src/components/Chat.tsx` — Chat Interface

- Streams assistant responses with blinking cursor.
- Shows tool calls inline with results.
- Autocomplete dropdown for prompt templates when typing `/`.
- Navigate suggestions with ↑↓, accept with Tab/Enter, dismiss with Escape.
- Wires up the user input handler for extension forms.

### `src/components/UserInputForm.tsx` — Extension-Driven User Input

Modal overlay form for extension-requested user input. Supports text, textarea, select, and confirm fields. Animated, auto-focuses, validates required fields.

---

## Future Directions

- **Bash alternative** — A sandboxed JavaScript evaluator or WebContainers integration for running code.
- **Persistent filesystem** — Back `VirtualFS` with IndexedDB so files survive page reloads.
- **Model picker** — Let users choose from OpenRouter's model list instead of the hardcoded default.
- **Session management** — Save/restore conversation history.
- **Markdown rendering** — Render assistant messages as formatted markdown.
- **File browser panel** — Show the VirtualFS contents in a sidebar.
- **Extension discovery** — Load extensions from URLs or npm packages.
- **Skill discovery** — Load skills from URLs or a skill marketplace.

## Tech Stack

- **Vite** — Build tool and dev server.
- **React 19** — UI framework.
- **TypeScript** — Strict mode, no runtime dependencies beyond React.
- **OpenRouter** — LLM API gateway (OpenAI-compatible chat completions with streaming).
