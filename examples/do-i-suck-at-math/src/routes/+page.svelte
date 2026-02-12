<script lang="ts">
  import { Agent, askUserExtension } from "pi-browser";
  import type { AgentEvent, UserInputRequest, UserInputResponse, UserInputField } from "pi-browser";
  import { onMount } from "svelte";
  import { mathAssessmentSkill } from "$lib/math-assessment-skill";

  // --- State ---
  let loading = $state(true);
  let agent: Agent | null = $state(null);
  let started = $state(false);
  let running = $state(false);
  let streamedText = $state("");

  // Chat log: sequence of messages & questions
  type ChatEntry =
    | { type: "user"; text: string }
    | { type: "assistant"; text: string }
    | { type: "question"; request: UserInputRequest; resolve: (r: UserInputResponse) => void }
    | { type: "answer"; values: Record<string, string> };

  let chatLog: ChatEntry[] = $state([]);

  // Current pending question (for rendering the form)
  let pendingQuestion: ChatEntry & { type: "question" } | null = $state(null);
  let formValues: Record<string, string> = $state({});

  // --- API Key ---
  let apiKeyInput = $state("");

  function saveApiKey(apiKey: string) {
    localStorage.setItem("openrouterApiKey", apiKey);
  }

  function getApiKey() {
    return localStorage.getItem("openrouterApiKey") ?? "";
  }

  // --- Agent Setup ---
  async function initializeAgent(apiKey: string) {
    const a = await Agent.create({
      apiKey,
      extensions: [askUserExtension],
      skills: [mathAssessmentSkill],
      systemPrompt: `You are a friendly, encouraging math tutor who assesses students' math abilities.

You have a skill called "math-assessment" that contains detailed instructions for conducting an adaptive math test. Load it with the read_skill tool before starting.

Use the ask_user tool to present each question to the student and collect their answer.

Be warm, supportive, and make the experience feel low-pressure — this is about helping them understand where they are, not making them feel bad.`,
    });

    // Wire up user input handler to our UI
    a.setUserInputHandler((request: UserInputRequest): Promise<UserInputResponse> => {
      return new Promise((resolve) => {
        const entry: ChatEntry & { type: "question" } = {
          type: "question",
          request,
          resolve,
        };
        chatLog = [...chatLog, entry];
        pendingQuestion = entry;
        // Initialize form values
        const vals: Record<string, string> = {};
        for (const field of request.fields ?? []) {
          vals[field.name] = field.defaultValue ?? "";
        }
        formValues = vals;
      });
    });

    agent = a;
  }

  function submitApiKey(event: Event) {
    event.preventDefault();
    saveApiKey(apiKeyInput);
    initializeAgent(apiKeyInput);
  }

  // --- Assessment Flow ---
  async function startAssessment() {
    if (!agent) return;
    started = true;
    running = true;
    streamedText = "";

    const stream = agent.prompt(
      "I'd like you to assess my math skills. Please load the math-assessment skill and begin the adaptive test."
    );

    chatLog = [...chatLog, { type: "user", text: "Starting math assessment..." }];

    for await (const event of stream) {
      if (event.type === "text_delta") {
        streamedText += event.delta;
      }
    }

    if (streamedText) {
      chatLog = [...chatLog, { type: "assistant", text: streamedText }];
      streamedText = "";
    }
    running = false;
  }

  function submitAnswer(event: Event) {
    event.preventDefault();
    if (!pendingQuestion) return;

    const response = { ...formValues };
    pendingQuestion.resolve(response);

    chatLog = [...chatLog, { type: "answer", values: response }];
    pendingQuestion = null;
    formValues = {};
  }

  // Auto-scroll
  let chatContainer: HTMLDivElement | undefined = $state(undefined);
  $effect(() => {
    // Re-run whenever chatLog or streamedText changes
    chatLog;
    streamedText;
    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  });

  onMount(() => {
    const apiKey = getApiKey();
    if (apiKey) {
      apiKeyInput = apiKey;
      initializeAgent(apiKey);
    }
    loading = false;
  });
</script>

<svelte:head>
  <title>Do I Suck at Math?</title>
</svelte:head>

<main>
  <div class="container">
    <h1>🧮 Do I Suck at Math?</h1>
    <p class="subtitle">An adaptive math assessment powered by AI. Find out your grade level, strengths, and what to work on next.</p>

    {#if loading}
      <p class="loading">Loading...</p>
    {:else if !agent}
      <form class="api-key-form" onsubmit={submitApiKey}>
        <label for="apiKey">OpenRouter API Key</label>
        <input
          id="apiKey"
          type="password"
          bind:value={apiKeyInput}
          placeholder="sk-or-..."
        />
        <button type="submit">Connect</button>
      </form>
    {:else if !started}
      <div class="start-screen">
        <p>Ready to find out where you stand? The test adapts to your level — it starts in the middle and adjusts based on your answers.</p>
        <p>It'll take about <strong>10-15 questions</strong> and a few minutes.</p>
        <button class="start-btn" onclick={startAssessment}>Start the Assessment</button>
      </div>
    {:else}
      <div class="chat" bind:this={chatContainer}>
        {#each chatLog as entry}
          {#if entry.type === "user"}
            <div class="msg user">{entry.text}</div>
          {:else if entry.type === "assistant"}
            <div class="msg assistant">{entry.text}</div>
          {:else if entry.type === "answer"}
            <div class="msg user">
              {#each Object.entries(entry.values) as [key, val]}
                <span>{val}</span>
              {/each}
            </div>
          {:else if entry.type === "question" && entry !== pendingQuestion}
            <div class="msg assistant question-past">
              <strong>{entry.request.question}</strong>
              {#if entry.request.description}
                <span class="desc">{entry.request.description}</span>
              {/if}
            </div>
          {/if}
        {/each}

        {#if streamedText}
          <div class="msg assistant streaming">{streamedText}</div>
        {/if}

        {#if pendingQuestion}
          <div class="question-card">
            <h3>{pendingQuestion.request.question}</h3>
            {#if pendingQuestion.request.description}
              <p class="desc">{pendingQuestion.request.description}</p>
            {/if}
            <form onsubmit={submitAnswer}>
              {#each pendingQuestion.request.fields ?? [] as field}
                <div class="field">
                  <label for={field.name}>{field.label}</label>
                  {#if field.type === "text"}
                    <input
                      id={field.name}
                      type="text"
                      bind:value={formValues[field.name]}
                      placeholder={field.placeholder ?? ""}
                      required={field.required}
                      autofocus
                    />
                  {:else if field.type === "textarea"}
                    <textarea
                      id={field.name}
                      bind:value={formValues[field.name]}
                      placeholder={field.placeholder ?? ""}
                      required={field.required}
                    ></textarea>
                  {:else if field.type === "select"}
                    <select id={field.name} bind:value={formValues[field.name]} required={field.required}>
                      {#each field.options ?? [] as opt}
                        <option value={opt}>{opt}</option>
                      {/each}
                    </select>
                  {:else if field.type === "confirm"}
                    <label class="confirm">
                      <input
                        type="checkbox"
                        checked={formValues[field.name] === "true"}
                        onchange={(e) => formValues[field.name] = (e.target as HTMLInputElement).checked ? "true" : "false"}
                      />
                      {field.label}
                    </label>
                  {/if}
                </div>
              {/each}
              <button type="submit" class="submit-btn">Submit Answer</button>
            </form>
          </div>
        {/if}

        {#if running && !pendingQuestion && !streamedText}
          <div class="msg assistant thinking">Thinking...</div>
        {/if}
      </div>
    {/if}
  </div>
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0f0f1a;
    color: #e0e0e0;
  }

  main {
    min-height: 100vh;
    display: flex;
    justify-content: center;
    padding: 2rem 1rem;
  }

  .container {
    max-width: 640px;
    width: 100%;
  }

  h1 {
    font-size: 2rem;
    text-align: center;
    margin-bottom: 0.25rem;
  }

  .subtitle {
    text-align: center;
    color: #999;
    margin-bottom: 2rem;
  }

  .loading {
    text-align: center;
    color: #777;
  }

  /* API Key Form */
  .api-key-form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-width: 400px;
    margin: 0 auto;
  }

  .api-key-form label {
    font-weight: 600;
  }

  .api-key-form input {
    padding: 0.75rem;
    border: 1px solid #333;
    border-radius: 8px;
    background: #1a1a2e;
    color: #e0e0e0;
    font-size: 1rem;
  }

  .api-key-form button {
    padding: 0.75rem;
    background: #4f46e5;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 1rem;
    cursor: pointer;
  }

  .api-key-form button:hover {
    background: #4338ca;
  }

  /* Start Screen */
  .start-screen {
    text-align: center;
  }

  .start-screen p {
    color: #bbb;
    line-height: 1.6;
  }

  .start-btn {
    margin-top: 1rem;
    padding: 1rem 2rem;
    background: #4f46e5;
    color: white;
    border: none;
    border-radius: 12px;
    font-size: 1.1rem;
    cursor: pointer;
    transition: background 0.2s;
  }

  .start-btn:hover {
    background: #4338ca;
  }

  /* Chat */
  .chat {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-height: 70vh;
    overflow-y: auto;
    padding: 1rem 0;
  }

  .msg {
    padding: 0.75rem 1rem;
    border-radius: 12px;
    max-width: 85%;
    white-space: pre-wrap;
    line-height: 1.5;
  }

  .msg.user {
    align-self: flex-end;
    background: #4f46e5;
    color: white;
    border-bottom-right-radius: 4px;
  }

  .msg.assistant {
    align-self: flex-start;
    background: #1e1e3a;
    border-bottom-left-radius: 4px;
  }

  .msg.streaming {
    opacity: 0.8;
  }

  .msg.thinking {
    color: #888;
    font-style: italic;
  }

  .question-past .desc {
    display: block;
    color: #888;
    font-size: 0.85rem;
    margin-top: 0.25rem;
  }

  /* Question Card */
  .question-card {
    background: #1a1a3e;
    border: 1px solid #333;
    border-radius: 12px;
    padding: 1.25rem;
  }

  .question-card h3 {
    margin: 0 0 0.5rem 0;
    font-size: 1.1rem;
  }

  .question-card .desc {
    color: #999;
    font-size: 0.9rem;
    margin-bottom: 1rem;
  }

  .question-card form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .field label {
    font-size: 0.85rem;
    color: #aaa;
  }

  .field input,
  .field textarea,
  .field select {
    padding: 0.6rem;
    border: 1px solid #444;
    border-radius: 8px;
    background: #0f0f1a;
    color: #e0e0e0;
    font-size: 1rem;
  }

  .field textarea {
    min-height: 80px;
    resize: vertical;
  }

  .submit-btn {
    padding: 0.7rem;
    background: #22c55e;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 1rem;
    cursor: pointer;
    font-weight: 600;
  }

  .submit-btn:hover {
    background: #16a34a;
  }

  .confirm {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
  }
</style>
