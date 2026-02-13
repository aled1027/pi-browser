<script lang="ts">
  import { onMount } from "svelte";
  import { createAgent } from "$lib/agent";
  import type { Agent, PromptTemplate, ToolCall, ThreadMeta, UserInputRequest, UserInputResponse, AgentEvent } from "tau";

  // --- State ---

  interface ChatMessage {
    id: number;
    role: "user" | "assistant";
    content: string;
    toolCalls?: ToolCall[];
  }

  let nextId = 0;

  let apiKey = $state("");
  let started = $state(false);
  let agent: Agent | null = $state(null);

  let messages: ChatMessage[] = $state([]);
  let threads: ThreadMeta[] = $state([]);
  let input = $state("");
  let streaming = $state(false);
  let streamText = $state("");
  let streamToolCalls: ToolCall[] = $state([]);
  let suggestions: PromptTemplate[] = $state([]);
  let selectedSuggestion = $state(0);

  let pendingInput: {
    request: UserInputRequest;
    resolve: (response: UserInputResponse) => void;
  } | null = $state(null);

  let messagesEl: HTMLDivElement | undefined = $state();
  let inputEl: HTMLTextAreaElement | undefined = $state();

  // --- Lifecycle ---

  onMount(() => {
    const saved = localStorage.getItem("tau-api-key") ?? "";
    apiKey = saved;
    if (saved) {
      startWithKey(saved);
    }
  });

  // --- Agent setup ---

  async function startWithKey(key: string) {
    localStorage.setItem("tau-api-key", key);
    apiKey = key;
    agent = await createAgent(key);
    setupAgent();
    started = true;
  }

  function setupAgent() {
    if (!agent) return;

    agent.setUserInputHandler((request) => {
      return new Promise<UserInputResponse>((resolve) => {
        pendingInput = { request, resolve };
      });
    });

    rebuildMessages();
    refreshThreadList();
  }

  function rebuildMessages() {
    if (!agent) return;
    const agentMessages = agent.getMessages();
    const display: ChatMessage[] = [];
    for (const m of agentMessages) {
      if (m.role === "user") {
        display.push({ id: nextId++, role: "user", content: m.content });
      } else if (m.role === "assistant") {
        display.push({
          id: nextId++,
          role: "assistant",
          content: m.content,
          toolCalls: m.toolCalls,
        });
      }
    }
    messages = display;
  }

  function refreshThreadList() {
    if (!agent) return;
    threads = agent.listThreads();
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      if (messagesEl) {
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    });
  }

  $effect(() => {
    // Re-scroll whenever messages or streamText change
    messages;
    streamText;
    scrollToBottom();
  });

  // --- Input handling ---

  function updateSuggestions() {
    if (!agent) return;
    const trimmed = input.trim();
    if (trimmed.startsWith("/") && !trimmed.includes(" ")) {
      suggestions = agent.promptTemplates.search(trimmed.slice(1));
      selectedSuggestion = 0;
    } else {
      suggestions = [];
    }
  }

  function acceptSuggestion(template: PromptTemplate) {
    input = `/${template.name} `;
    suggestions = [];
    inputEl?.focus();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        selectedSuggestion = (selectedSuggestion + 1) % suggestions.length;
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        selectedSuggestion = (selectedSuggestion - 1 + suggestions.length) % suggestions.length;
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        acceptSuggestion(suggestions[selectedSuggestion]);
        return;
      }
      if (e.key === "Escape") {
        suggestions = [];
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  // --- Submit ---

  async function handleSubmit() {
    if (!agent) return;
    const text = input.trim();
    if (!text || streaming) return;

    input = "";
    suggestions = [];
    messages = [...messages, { id: nextId++, role: "user", content: text }];
    streaming = true;
    streamText = "";
    streamToolCalls = [];

    const localToolCalls: ToolCall[] = [];
    const stream = agent.prompt(text);
    for await (const event of stream) {
      switch (event.type) {
        case "text_delta":
          streamText += event.delta;
          break;
        case "tool_call_start":
          localToolCalls.push(event.toolCall);
          streamToolCalls = [...localToolCalls];
          break;
        case "tool_call_end": {
          const idx = localToolCalls.findIndex((t: ToolCall) => t.id === event.toolCall.id);
          if (idx >= 0) localToolCalls[idx] = event.toolCall;
          streamToolCalls = [...localToolCalls];
          break;
        }
        case "error":
          streamText += `\n\n**Error:** ${event.error}`;
          break;
      }
    }
    const result = stream.result;

    messages = [
      ...messages,
      {
        id: nextId++,
        role: "assistant",
        content: result.text,
        toolCalls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
      },
    ];
    streamText = "";
    streamToolCalls = [];
    streaming = false;

    refreshThreadList();
  }

  // --- Thread management ---

  async function handleNewThread() {
    if (!agent) return;
    await agent.newThread();
    rebuildMessages();
    refreshThreadList();
  }

  async function switchThread(threadId: string) {
    if (!agent || threadId === agent.activeThreadId) return;
    await agent.switchThread(threadId);
    rebuildMessages();
    refreshThreadList();
  }

  async function deleteThread(e: MouseEvent, threadId: string) {
    e.stopPropagation();
    if (!agent) return;
    await agent.deleteThread(threadId);
    rebuildMessages();
    refreshThreadList();
  }

  // --- User input modal ---

  function handleUserInputSubmit(values: Record<string, string>) {
    if (pendingInput) {
      pendingInput.resolve(values);
      pendingInput = null;
    }
  }
</script>

{#if !started}
  <!-- API Key Screen -->
  <div class="api-key-screen">
    <div class="card">
      <h1>τ browser</h1>
      <p class="subtitle">A browser-based coding agent — SvelteKit</p>
      <label for="api-key">OpenRouter API Key</label>
      <input
        id="api-key"
        type="password"
        bind:value={apiKey}
        onkeydown={(e) => { if (e.key === "Enter" && apiKey.trim()) startWithKey(apiKey.trim()); }}
        placeholder="sk-or-..."
        autofocus
      />
      <button disabled={!apiKey.trim()} onclick={() => startWithKey(apiKey.trim())}>
        Start
      </button>
      <p class="hint">
        Key is stored in localStorage. Get one at
        <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">openrouter.ai/keys</a>
      </p>
    </div>
  </div>
{:else}
  <!-- Chat UI -->
  <div class="chat-layout">
    <!-- Sidebar -->
    <div class="sidebar">
      <div class="sidebar-header">
        <span class="sidebar-title">Threads</span>
        <button class="new-thread-btn" onclick={handleNewThread} title="New thread">+</button>
      </div>
      <div class="thread-list">
        {#each threads as t (t.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="thread-item"
            class:active={agent?.activeThreadId === t.id}
            onclick={() => switchThread(t.id)}
          >
            <span class="thread-name">{t.name}</span>
            <button
              class="thread-delete"
              onclick={(e) => deleteThread(e, t.id)}
              title="Delete thread"
            >×</button>
          </div>
        {/each}
      </div>
    </div>

    <!-- Main chat -->
    <div class="chat-main">
      <div class="header">
        <span class="title">τ browser</span>
        <span class="model">hardcoded model goes here · SvelteKit</span>
      </div>

      <div class="messages" bind:this={messagesEl}>
        {#each messages as msg (msg.id)}
          <div class="message message-{msg.role}">
            <div class="message-role">
              {msg.role === "user" ? "you" : "assistant"}
            </div>
            {#if msg.toolCalls?.length}
              <div class="tool-calls">
                {#each msg.toolCalls as tc}
                  <div class="tool-call">
                    <div class="tool-call-name">
                      🔧 {tc.name}({JSON.stringify(tc.arguments).slice(0, 80)}{JSON.stringify(tc.arguments).length > 80 ? "…" : ""})
                    </div>
                    {#if tc.result}
                      <div class="tool-call-result" class:tool-error={tc.result.isError}>
                        {tc.result.content.slice(0, 200)}{tc.result.content.length > 200 ? "…" : ""}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
            <div class="message-content">{msg.content}</div>
          </div>
        {/each}

        {#if streaming && (streamText || streamToolCalls.length > 0)}
          <div class="message message-assistant">
            <div class="message-role">assistant</div>
            {#if streamToolCalls.length > 0}
              <div class="tool-calls">
                {#each streamToolCalls as tc}
                  <div class="tool-call">
                    <div class="tool-call-name">
                      🔧 {tc.name}({JSON.stringify(tc.arguments).slice(0, 80)}{JSON.stringify(tc.arguments).length > 80 ? "…" : ""})
                    </div>
                    {#if tc.result}
                      <div class="tool-call-result" class:tool-error={tc.result.isError}>
                        {tc.result.content.slice(0, 200)}{tc.result.content.length > 200 ? "…" : ""}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
            <div class="message-content">
              {streamText}<span class="cursor">▊</span>
            </div>
          </div>
        {/if}
      </div>

      <!-- Input area -->
      <div class="input-area">
        <div class="input-wrapper">
          {#if suggestions.length > 0}
            <div class="autocomplete">
              {#each suggestions as t, i}
                <button
                  class="autocomplete-item"
                  class:selected={i === selectedSuggestion}
                  onmouseenter={() => { selectedSuggestion = i; }}
                  onclick={() => acceptSuggestion(t)}
                >
                  <span class="autocomplete-name">/{t.name}</span>
                  <span class="autocomplete-desc">{t.description}</span>
                </button>
              {/each}
            </div>
          {/if}
          <textarea
            bind:this={inputEl}
            bind:value={input}
            oninput={updateSuggestions}
            onkeydown={handleKeyDown}
            placeholder="Send a message… (type / for templates)"
            rows="1"
            disabled={streaming}
          ></textarea>
        </div>
        <button
          class="send-btn"
          onclick={() => streaming ? agent?.abort() : handleSubmit()}
          disabled={!streaming && !input.trim()}
        >
          {streaming ? "Stop" : "Send"}
        </button>
      </div>
    </div>
  </div>

  <!-- User input modal -->
  {#if pendingInput}
    <div class="modal-overlay">
      <form class="modal-form" onsubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const values: Record<string, string> = {};
        for (const [key, val] of formData.entries()) {
          values[key] = val as string;
        }
        handleUserInputSubmit(values);
      }}>
        <h2>{pendingInput.request.question}</h2>
        {#if pendingInput.request.description}
          <p class="modal-description">{pendingInput.request.description}</p>
        {/if}
        {#each (pendingInput.request.fields ?? [{ name: "answer", label: pendingInput.request.question, type: "text" as const, required: true }]) as field}
          <div class="field">
            <label for={field.name}>{field.label}</label>
            {#if field.type === "textarea"}
              <textarea name={field.name} id={field.name} rows="4" placeholder={"placeholder" in field ? (field.placeholder ?? "") : ""}></textarea>
            {:else if field.type === "select"}
              <select name={field.name} id={field.name}>
                {#each ("options" in field ? field.options ?? [] : []) as opt}
                  <option value={opt}>{opt}</option>
                {/each}
              </select>
            {:else}
              <input type="text" name={field.name} id={field.name} placeholder={"placeholder" in field ? (field.placeholder ?? "") : ""} />
            {/if}
          </div>
        {/each}
        <button type="submit" class="submit-btn">Submit</button>
      </form>
    </div>
  {/if}
{/if}

<style>
  /* API Key Screen */
  .api-key-screen {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 32px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-secondary);
    width: 400px;
    max-width: 90vw;
  }

  .card h1 {
    font-size: 24px;
    color: var(--accent);
    margin: 0;
  }

  .subtitle {
    color: var(--text-muted);
    margin-bottom: 8px;
  }

  .card label {
    font-size: 12px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .card input {
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-input);
    color: var(--text);
    font-family: inherit;
    font-size: 14px;
    outline: none;
  }

  .card input:focus {
    border-color: var(--accent);
  }

  .card button {
    padding: 10px;
    border: none;
    border-radius: 4px;
    background: var(--accent);
    color: var(--bg);
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }

  .card button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .hint {
    font-size: 12px;
    color: var(--text-muted);
  }

  .hint a {
    color: var(--accent);
  }

  /* Chat layout */
  .chat-layout {
    height: 100%;
    display: flex;
  }

  /* Sidebar */
  .sidebar {
    width: 220px;
    min-width: 220px;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    border-bottom: 1px solid var(--border);
  }

  .sidebar-title {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }

  .new-thread-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--accent);
    font-size: 16px;
    cursor: pointer;
    padding: 2px 8px;
    line-height: 1;
  }

  .new-thread-btn:hover {
    background: var(--bg-input);
  }

  .thread-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }

  .thread-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    cursor: pointer;
    font-size: 13px;
    color: var(--text);
    transition: background 0.1s;
    width: 100%;
    background: none;
    border: none;
    font-family: inherit;
    text-align: left;
  }

  .thread-item:hover {
    background: var(--bg-input);
  }

  .thread-item.active {
    background: var(--bg-input);
    border-left: 2px solid var(--accent);
    padding-left: 10px;
  }

  .thread-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .thread-delete {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 14px;
    padding: 0 2px;
    opacity: 0;
    transition: opacity 0.1s;
  }

  .thread-item:hover .thread-delete {
    opacity: 1;
  }

  .thread-delete:hover {
    color: var(--error);
  }

  /* Main chat */
  .chat-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-secondary);
  }

  .title {
    font-weight: 600;
    color: var(--accent);
  }

  .model {
    font-size: 12px;
    color: var(--text-muted);
  }

  /* Messages */
  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .message {
    max-width: 800px;
    width: 100%;
    margin: 0 auto;
  }

  .message-role {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    margin-bottom: 4px;
  }

  .message-user .message-role {
    color: var(--accent);
  }

  .message-content {
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.5;
  }

  .cursor {
    animation: blink 1s step-end infinite;
    color: var(--accent);
  }

  @keyframes blink {
    50% { opacity: 0; }
  }

  /* Tool calls */
  .tool-calls {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 8px;
  }

  .tool-call {
    padding: 8px 10px;
    border-radius: 4px;
    background: var(--tool-bg);
    border-left: 3px solid var(--accent-dim);
    font-size: 12px;
  }

  .tool-call-name {
    color: var(--accent);
    font-weight: 600;
    margin-bottom: 4px;
  }

  .tool-call-result {
    color: var(--text-muted);
    white-space: pre-wrap;
  }

  .tool-error {
    color: var(--error);
  }

  /* Input area */
  .input-area {
    display: flex;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--border);
    background: var(--bg-secondary);
  }

  .input-wrapper {
    flex: 1;
    position: relative;
  }

  textarea {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-input);
    color: var(--text);
    font-family: inherit;
    font-size: 14px;
    resize: none;
    outline: none;
    line-height: 1.4;
    box-sizing: border-box;
  }

  textarea:focus {
    border-color: var(--accent);
  }

  .send-btn {
    padding: 10px 20px;
    border: none;
    border-radius: 4px;
    background: var(--accent);
    color: var(--bg);
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }

  .send-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* Autocomplete */
  .autocomplete {
    position: absolute;
    bottom: 100%;
    left: 0;
    right: 0;
    margin-bottom: 4px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
    box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.3);
    z-index: 50;
    max-height: 240px;
    overflow-y: auto;
  }

  .autocomplete-item {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 8px 12px;
    cursor: pointer;
    transition: background 0.1s;
    width: 100%;
    background: none;
    border: none;
    color: inherit;
    font-family: inherit;
    font-size: inherit;
    text-align: left;
  }

  .autocomplete-item:hover,
  .autocomplete-item.selected {
    background: var(--bg-input);
  }

  .autocomplete-name {
    color: var(--accent);
    font-weight: 600;
    white-space: nowrap;
  }

  .autocomplete-desc {
    color: var(--text-muted);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Modal */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(10, 10, 20, 0.7);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .modal-form {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 28px 32px;
    width: 480px;
    max-width: 90vw;
    display: flex;
    flex-direction: column;
    gap: 16px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
  }

  .modal-form h2 {
    font-size: 18px;
    color: var(--text);
    margin: 0;
  }

  .modal-description {
    color: var(--text-muted);
    font-size: 13px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
  }

  .field input,
  .field textarea,
  .field select {
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-input);
    color: var(--text);
    font-family: inherit;
    font-size: 14px;
    outline: none;
  }

  .field input:focus,
  .field textarea:focus,
  .field select:focus {
    border-color: var(--accent);
  }

  .submit-btn {
    padding: 12px;
    border: none;
    border-radius: 6px;
    background: var(--accent);
    color: var(--bg);
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }

  .submit-btn:hover {
    opacity: 0.9;
  }
</style>
