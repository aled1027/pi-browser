# pi-browser

A browser-only coding agent inspired by [pi](https://github.com/badlogic/pi-mono). Users provide an OpenRouter API key and interact with an LLM that can read, write, and edit files in a virtual in-memory filesystem — all running entirely in the browser with no backend.

## Quick Start

```bash
npm install
npm run dev
```

Open the local URL, paste your [OpenRouter API key](https://openrouter.ai/keys), and start chatting.

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│  Browser                                        │
│                                                 │
│  ┌───────────┐    ┌───────────┐                 │
│  │  App.tsx   │───▶│  Chat.tsx  │  React UI      │
│  └───────────┘    └─────┬─────┘                 │
│                         │                       │
│                    ┌────▼────┐                   │
│                    │  Agent  │  Session state     │
│                    └────┬────┘                   │
│                    ┌────▼────────┐               │
│                    │ openrouter  │  Streaming API │
│                    └────┬───────┘               │
│                         │ tool calls             │
│                    ┌────▼────┐                   │
│                    │  Tools  │──▶ VirtualFS      │
│                    └─────────┘                   │
│                                                 │
└─────────────────────────────────────────────────┘
          │
          │ HTTPS (SSE streaming)
          ▼
   OpenRouter API
```

There are four layers:

1. **UI** (`App.tsx`, `Chat.tsx`, `ApiKeyScreen.tsx`) — React components for the chat interface.
2. **Agent** (`agent.ts`) — Holds conversation history, the virtual filesystem, and tools. Exposes an async-generator `prompt()` method that streams events.
3. **OpenRouter client** (`openrouter.ts`) — Calls OpenRouter's OpenAI-compatible chat completions endpoint with SSE streaming. Implements the tool-call loop.
4. **Tools** (`tools.ts`) — Browser-based tool implementations operating on an in-memory `VirtualFS`.

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

### `src/openrouter.ts` — OpenRouter API Client

The `runAgent()` async generator is the core streaming engine. It:

1. Converts `Message[]` and `ToolDefinition[]` to OpenAI chat-completions format.
2. Sends a streaming request to `https://openrouter.ai/api/v1/chat/completions`.
3. Parses the SSE stream, yielding `text_delta` events as text arrives.
4. Collects tool calls that arrive incrementally across SSE chunks.
5. When the stream ends with pending tool calls, executes each tool and yields `tool_call_start`/`tool_call_end` events.
6. Appends the assistant message (with tool calls) and tool results to the message list, then loops back to step 2.
7. When the model responds with only text (no tool calls), yields `turn_end` and returns.

This loop means the model can chain multiple rounds of tool use before giving its final answer, matching the agentic pattern in pi.

**Key details:**
- Default model: `anthropic/claude-sonnet-4`.
- Accepts an `AbortSignal` for cancellation.
- Sends `HTTP-Referer` and `X-Title` headers as required by OpenRouter.

### `src/tools.ts` — Tool Implementations & VirtualFS

#### `VirtualFS`

A `Map<string, string>`-backed in-memory filesystem. All paths are normalized to start with `/` with collapsed slashes.

Methods:
- `read(path)` → `string | undefined`
- `write(path, content)` → `void`
- `delete(path)` → `boolean`
- `list(prefix)` → `string[]` (all paths matching the prefix)
- `exists(path)` → `boolean`

#### Built-in Tools

Created by `createTools(fs)`:

| Tool | Description |
|------|-------------|
| `read` | Read a file's contents. Returns error if file not found. |
| `write` | Write content to a file. Creates or overwrites. |
| `edit` | Find-and-replace exact text in a file. Errors if the file doesn't exist or `oldText` isn't found. |
| `list` | List all files matching a directory prefix. |

Each tool follows the `ToolDefinition` interface: a JSON Schema for parameters and an `execute` function returning a `ToolResult`.

### `src/agent.ts` — Agent Session

The `Agent` class ties everything together:

- **Constructor** — Takes an `AgentConfig` (API key, optional model, optional system prompt). Creates a `VirtualFS` and the default tool set. Initializes the message history with the system prompt.
- **`prompt(text)`** — Async generator that appends a user message, calls `runAgent()`, yields all events, and appends the final assistant message to history.
- **`abort()`** — Cancels the in-flight request via `AbortController`.
- **`getMessages()`** — Returns a copy of the conversation history.

### `src/App.tsx` — Root Component

Two-screen flow:
1. **API key screen** — shown initially. Key is persisted to `localStorage` under `pi-browser-api-key`.
2. **Chat screen** — shown after the user clicks Start. Creates an `Agent` instance and passes it to `<Chat>`.

### `src/components/ApiKeyScreen.tsx` — API Key Entry

Simple form: password input + Start button. Pressing Enter submits. Links to OpenRouter's key management page.

### `src/components/Chat.tsx` — Chat Interface

The main interaction surface:

- Displays the message history as a scrollable list.
- Streams assistant responses in real time with a blinking cursor.
- Shows tool calls inline with their results (truncated for readability).
- Input area: textarea (Enter to send, Shift+Enter for newline).
- Send/Stop button toggles based on streaming state.

State management:
- `messages` — completed messages (user + assistant).
- `streamText` / `streamToolCalls` — the in-progress assistant response, displayed as a temporary message bubble during streaming.
- Auto-scrolls to bottom on new content.

## Adding a New Tool

1. Write a function in `src/tools.ts` that returns a `ToolDefinition`:

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
      // Do something
      return { content: `Result: ${input}`, isError: false };
    },
  };
}
```

2. Add it to the array returned by `createTools()`.

The model will automatically see it in its tool list and can call it.

## Future Directions

- **Bash alternative** — A sandboxed JavaScript evaluator or WebContainers integration for running code.
- **Persistent filesystem** — Back `VirtualFS` with IndexedDB so files survive page reloads.
- **Model picker** — Let users choose from OpenRouter's model list instead of the hardcoded default.
- **Session management** — Save/restore conversation history.
- **Markdown rendering** — Render assistant messages as formatted markdown.
- **File browser panel** — Show the VirtualFS contents in a sidebar.

## Tech Stack

- **Vite** — Build tool and dev server.
- **React 19** — UI framework.
- **TypeScript** — Strict mode, no runtime dependencies beyond React.
- **OpenRouter** — LLM API gateway (OpenAI-compatible chat completions with streaming).
