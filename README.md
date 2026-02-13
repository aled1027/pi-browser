# tau

A browser-based AI coding agent powered by [OpenRouter](https://openrouter.ai/). Includes a core agent library and several example applications.

Inspired by the real [pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent).

WARNING: THIS TOOL COULD RESULT IN HARMFUL CODE RUNNING IN YOUR BROWSER TAB.

## TODO:

- Later: sync state or export. export would be download a zip and maybe could
- Add CSP for security
- Make sure the default extension are loaded by default instead of explicitly in the examples

## Quick start

```typescript
import { Agent } from "tau";

const agent = await Agent.create({ apiKey: "sk-or-..." });

// Simple — just await it
const result = await agent.prompt("Write hello world in Python");
console.log(result.text);

// Streaming — iterate for events, then read the result
const stream = agent.prompt("Build a React component");
for await (const event of stream) {
  if (event.type === "text_delta") updateUI(event.delta);
}
console.log(stream.result.text);
```

See [docs/tau-core.md](docs/tau-core.md) for the full API reference.



## Setup

```bash
npm install    # installs root + all examples via workspaces
npm run build  # builds the core library to dist/
```

## Development

Run the library build in watch mode alongside an example:

```bash
npm run build:watch          # rebuild library on changes

# If you want to test with an app, then do:
cd your/app/path/
npm run dev
```

## Examples

- **Chat** (`npm run dev:chat`) — Minimal chat interface (Lit + Vite)
- **Tutor** (`npm run dev:tutor`) — AI tutor with skills and prompt templates (Lit + Vite)
- **SvelteKit Chat** (`npm run dev:sveltekit`) — Chat app built with SvelteKit

Examples import the library as `"tau"` via `file:` references resolved through npm workspaces.

To run the examples:

```bash
npm run build

# In a separate terminal:
cd examples/chat
npm run dev
```

