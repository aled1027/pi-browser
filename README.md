# tau

A browser-based AI coding agent powered by [OpenRouter](https://openrouter.ai/). Includes a core agent library and several example applications.

Inspired by the real [pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent).

<div style="background: #ffcccc; color: #b20000; font-weight: bold; padding: 16px; border-radius: 8px; border: 2px solid #b20000; font-size: 1.2em; margin: 16px 0;">
  ⚠️ WARNING: This tool allows execution of <u>arbitrary code</u> in your browser tab.<br>
  Running untrusted code may be dangerous and could harm your system.<br>
  <strong>Use with caution!</strong>
</div>

## TODO:

- Later: sync state or export. export would be download a zip and maybe could

## Quick start

```typescript
import { Agent } from "tau";

const openrouterApiKey = "sk-or-...."
const agent = await Agent.create({ apiKey: openrouterApiKey });

const res1 = await agent.prompt("Write hello world in Python");
console.log(res1.text);

const res2 = await agent.prompt("What time is it?");
console.log(res2.text);
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

