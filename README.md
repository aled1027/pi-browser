# pi-browser

A browser-based AI coding agent powered by [OpenRouter](https://openrouter.ai/). Includes a core agent library and several example applications.

Inspired by the real [pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent).

## TODO:

- Add the ability for pi-browser to writes its own extension and load them
    - It needs to know how to write its own extension (via default skill)
    - It needs to be able to load them on the fly

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

Examples import the library as `"pi-browser"` via `file:` references resolved through npm workspaces.

To run the examples:

```bash
npm run build

# In a separate terminal:
cd examples/chat
npm run dev
```

