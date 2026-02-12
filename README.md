# pi-browser

A browser-based AI coding agent powered by [OpenRouter](https://openrouter.ai/). Includes a core agent library and several example applications.

Inspired by the real [pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent).

## Setup

Requires [Node.js](https://nodejs.org/) (v18+).

```bash
npm install    # installs root + all examples via workspaces
npm run build  # builds the core library to dist/
```

You'll need an [OpenRouter API key](https://openrouter.ai/keys) to use the agent.

## Development

Run the library build in watch mode alongside an example:

```bash
npm run build:watch          # rebuild library on changes
npm run dev:chat             # or dev:tutor, dev:sveltekit
```

## Examples

- **Chat** (`npm run dev:chat`) — Minimal chat interface (Lit + Vite)
- **Tutor** (`npm run dev:tutor`) — AI tutor with skills and prompt templates (Lit + Vite)
- **SvelteKit Chat** (`npm run dev:sveltekit`) — Chat app built with SvelteKit

Examples import the library as `"pi-browser"` via `file:` references resolved through npm workspaces.

