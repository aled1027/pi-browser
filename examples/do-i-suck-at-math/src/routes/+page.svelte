<script lang="ts">
  import { Agent, askUserExtension, runJavascriptExtension } from "tau";
  import type { UserInputRequest, UserInputResponse } from "tau";
  import { onMount } from "svelte";
  import { mathAssessmentSkill } from "$lib/math-assessment-skill";

  const TOTAL_QUESTIONS = 12;

  // --- Phases ---
  type Phase = "loading" | "api-key" | "ready" | "testing" | "grading" | "results";
  let phase: Phase = $state("loading");

  // --- Agent ---
  let agent: Agent | null = $state(null);
  let apiKeyInput = $state("");

  // --- Test state ---
  let questionNumber = $state(0);
  let currentQuestion: string = $state("");
  let currentCategory: string = $state("");
  let answerValue = $state("");
  let pendingResolve: ((r: UserInputResponse) => void) | null = $state(null);

  // Track answered questions for the progress dots
  let answeredQuestions: { question: string; category: string; answer: string }[] = $state([]);

  // --- Results ---
  let reportMarkdown = $state("");

  // --- API key persistence ---
  function saveApiKey(k: string) { localStorage.setItem("openrouterApiKey", k); }
  function getApiKey() { return localStorage.getItem("openrouterApiKey") ?? ""; }

  // --- Agent setup ---
  async function initializeAgent(apiKey: string) {
    const a = await Agent.create({
      apiKey,
      extensions: [askUserExtension, runJavascriptExtension],
      skills: [mathAssessmentSkill],
      systemPrompt: `You are a standardized math assessment engine.

You have a skill called "math-assessment" — load it with the read_skill tool before beginning.

CRITICAL: Do NOT produce any conversational text between questions. Only use the ask_user tool to present questions. Only produce text output for the final assessment report after all questions are answered.`,
    });

    a.setUserInputHandler((request: UserInputRequest): Promise<UserInputResponse> => {
      return new Promise((resolve) => {
        questionNumber += 1;
        currentQuestion = request.question;
        currentCategory = request.description ?? "";
        answerValue = "";
        pendingResolve = resolve;
      });
    });

    agent = a;
    phase = "ready";
  }

  function submitApiKey(event: Event) {
    event.preventDefault();
    saveApiKey(apiKeyInput);
    initializeAgent(apiKeyInput);
  }

  // --- Start the test ---
  async function startTest() {
    if (!agent) return;

    // Always start on a fresh thread so prior history doesn't interfere
    await agent.newThread("Math Assessment");

    phase = "testing";
    questionNumber = 0;
    answeredQuestions = [];
    pendingResolve = null;
    currentQuestion = "";
    currentCategory = "";
    answerValue = "";
    reportMarkdown = "";

    const stream = agent.prompt(
      "Begin the math assessment. Load the math-assessment skill and start asking questions immediately."
    );

    let fullText = "";
    for await (const event of stream) {
      if (event.type === "text_delta") {
        fullText += event.delta;
      }
    }

    reportMarkdown = fullText;
    phase = "results";
  }

  // --- Submit an answer ---
  function submitAnswer(event: Event) {
    event.preventDefault();
    if (!pendingResolve) return;

    const answer = answerValue.trim();
    if (!answer) return;

    answeredQuestions = [...answeredQuestions, {
      question: currentQuestion,
      category: currentCategory,
      answer,
    }];

    pendingResolve({ answer });
    pendingResolve = null;
    currentQuestion = "";
    currentCategory = "";
    answerValue = "";

    // Show brief "loading" state between questions
    if (questionNumber >= TOTAL_QUESTIONS) {
      phase = "grading";
    }
  }

  // --- Keyboard shortcut: Enter to submit ---
  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey && pendingResolve && answerValue.trim()) {
      event.preventDefault();
      submitAnswer(event as unknown as Event);
    }
  }

  // --- Simple markdown rendering (headers, bold, bullets, paragraphs) ---
  function renderMarkdown(md: string): string {
    return md
      .split("\n")
      .map((line) => {
        if (line.startsWith("# ")) return `<h1>${esc(line.slice(2))}</h1>`;
        if (line.startsWith("## ")) return `<h2>${esc(line.slice(3))}</h2>`;
        if (line.startsWith("### ")) return `<h3>${esc(line.slice(4))}</h3>`;
        if (line.startsWith("- ")) return `<li>${inlineMd(line.slice(2))}</li>`;
        if (line.trim() === "") return `<br/>`;
        return `<p>${inlineMd(line)}</p>`;
      })
      .join("\n");
  }

  function esc(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function inlineMd(s: string): string {
    return esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  }

  onMount(() => {
    const apiKey = getApiKey();
    if (apiKey) {
      apiKeyInput = apiKey;
      initializeAgent(apiKey);
    } else {
      phase = "api-key";
    }
  });
</script>

<svelte:head>
  <title>Do I Suck at Math?</title>
</svelte:head>

<!-- ─── API KEY ──────────────────────────────────────────── -->
{#if phase === "loading"}
  <div class="screen center">
    <p class="muted">Loading…</p>
  </div>

{:else if phase === "api-key"}
  <div class="screen center">
    <div class="card narrow">
      <h1>🧮</h1>
      <h2>Do I Suck at Math?</h2>
      <form onsubmit={submitApiKey}>
        <label for="apiKey">OpenRouter API Key</label>
        <input id="apiKey" type="password" bind:value={apiKeyInput} placeholder="sk-or-…" />
        <button type="submit">Connect</button>
      </form>
    </div>
  </div>

<!-- ─── READY / START ──────────────────────────────────── -->
{:else if phase === "ready"}
  <div class="screen center">
    <div class="card">
      <h1>🧮 Do I Suck at Math?</h1>
      <p class="tagline">Adaptive math placement test</p>
      <div class="details">
        <div class="detail-row"><span class="detail-label">Questions</span><span>{TOTAL_QUESTIONS}</span></div>
        <div class="detail-row"><span class="detail-label">Duration</span><span>~5 minutes</span></div>
        <div class="detail-row"><span class="detail-label">Difficulty</span><span>Adapts to you</span></div>
      </div>
      <p class="instructions">
        Answer each question to the best of your ability. The test adjusts difficulty based on your responses. At the end you'll receive a detailed assessment of your grade level, strengths, and areas for improvement.
      </p>
      <button class="primary-btn" onclick={startTest}>Begin Assessment</button>
    </div>
  </div>

<!-- ─── TESTING ─────────────────────────────────────────── -->
{:else if phase === "testing"}
  <div class="screen test-screen">
    <!-- Header bar -->
    <header class="test-header">
      <span class="test-title">Math Assessment</span>
      <span class="test-progress-text">
        {#if pendingResolve}
          {questionNumber} / {TOTAL_QUESTIONS}
        {:else}
          Loading…
        {/if}
      </span>
    </header>

    <!-- Progress bar -->
    <div class="progress-track">
      <div class="progress-fill" style="width: {((questionNumber - 1) / TOTAL_QUESTIONS) * 100}%"></div>
    </div>

    <!-- Question area -->
    <div class="test-body">
      {#if pendingResolve}
        <div class="question-area">
          <span class="category-badge">{currentCategory}</span>
          <h2 class="question-text">{currentQuestion}</h2>
          <form class="answer-form" onsubmit={submitAnswer}>
            <input
              type="text"
              class="answer-input"
              bind:value={answerValue}
              onkeydown={handleKeydown}
              placeholder="Type your answer…"
              autofocus
            />
            <div class="answer-actions">
              <button type="submit" class="submit-btn" disabled={!answerValue.trim()}>
                {questionNumber < TOTAL_QUESTIONS ? "Next →" : "Finish"}
              </button>
            </div>
          </form>
        </div>
      {:else}
        <div class="question-area loading-question">
          <div class="spinner"></div>
          <p class="muted">Preparing question…</p>
        </div>
      {/if}
    </div>

    <!-- Bottom dots -->
    <div class="dot-track">
      {#each Array(TOTAL_QUESTIONS) as _, i}
        <div
          class="dot"
          class:answered={i < answeredQuestions.length}
          class:current={i === answeredQuestions.length && pendingResolve}
        ></div>
      {/each}
    </div>
  </div>

<!-- ─── GRADING ─────────────────────────────────────────── -->
{:else if phase === "grading"}
  <div class="screen center">
    <div class="card">
      <div class="spinner large"></div>
      <h2>Grading your assessment…</h2>
      <p class="muted">Analyzing {TOTAL_QUESTIONS} responses</p>
    </div>
  </div>

<!-- ─── RESULTS ─────────────────────────────────────────── -->
{:else if phase === "results"}
  <div class="screen results-screen">
    <div class="results-card">
      <div class="results-body">
        {@html renderMarkdown(reportMarkdown)}
      </div>
      <div class="results-footer">
        <button class="primary-btn" onclick={startTest}>Retake Assessment</button>
      </div>
    </div>
  </div>
{/if}

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #fafafa;
    color: #1a1a1a;
    -webkit-font-smoothing: antialiased;
  }

  /* ── Layout ── */

  .screen {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .center {
    align-items: center;
    justify-content: center;
  }

  /* ── Shared ── */

  .muted { color: #888; }

  .card {
    background: white;
    border: 1px solid #e5e5e5;
    border-radius: 12px;
    padding: 2.5rem;
    max-width: 480px;
    width: 100%;
    text-align: center;
  }

  .card.narrow { max-width: 380px; }

  .card h1 {
    margin: 0 0 0.25rem;
    font-size: 1.75rem;
  }

  .card h2 {
    margin: 0 0 0.5rem;
    font-size: 1.25rem;
    font-weight: 600;
  }

  .tagline {
    color: #666;
    margin: 0 0 1.5rem;
    font-size: 0.95rem;
  }

  .details {
    border-top: 1px solid #eee;
    border-bottom: 1px solid #eee;
    padding: 1rem 0;
    margin-bottom: 1.25rem;
  }

  .detail-row {
    display: flex;
    justify-content: space-between;
    padding: 0.35rem 0;
    font-size: 0.9rem;
  }

  .detail-label {
    color: #888;
  }

  .instructions {
    font-size: 0.85rem;
    color: #666;
    line-height: 1.6;
    margin-bottom: 1.5rem;
    text-align: left;
  }

  .primary-btn {
    width: 100%;
    padding: 0.85rem;
    background: #111;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }

  .primary-btn:hover { background: #333; }

  /* ── API Key form ── */

  .card form {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    text-align: left;
  }

  .card form label {
    font-size: 0.8rem;
    font-weight: 600;
    color: #555;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .card form input {
    padding: 0.7rem 0.85rem;
    border: 1px solid #ddd;
    border-radius: 8px;
    font-size: 0.95rem;
    background: #fafafa;
    color: #1a1a1a;
    outline: none;
    transition: border-color 0.15s;
  }

  .card form input:focus { border-color: #111; }

  .card form button {
    margin-top: 0.5rem;
    padding: 0.75rem;
    background: #111;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
  }

  .card form button:hover { background: #333; }

  /* ── Test screen ── */

  .test-screen {
    background: white;
  }

  .test-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 2rem;
    border-bottom: 1px solid #eee;
  }

  .test-title {
    font-weight: 600;
    font-size: 0.9rem;
    color: #333;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .test-progress-text {
    font-size: 0.85rem;
    color: #888;
    font-variant-numeric: tabular-nums;
  }

  .progress-track {
    height: 3px;
    background: #eee;
  }

  .progress-fill {
    height: 100%;
    background: #111;
    transition: width 0.4s ease;
  }

  .test-body {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
  }

  .question-area {
    max-width: 560px;
    width: 100%;
    text-align: center;
  }

  .category-badge {
    display: inline-block;
    padding: 0.3rem 0.85rem;
    background: #f0f0f0;
    border-radius: 100px;
    font-size: 0.75rem;
    font-weight: 600;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 1.25rem;
  }

  .question-text {
    font-size: 1.65rem;
    font-weight: 600;
    margin: 0 0 2rem;
    line-height: 1.4;
    color: #111;
  }

  .answer-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-width: 320px;
    margin: 0 auto;
  }

  .answer-input {
    padding: 0.85rem 1rem;
    border: 2px solid #ddd;
    border-radius: 10px;
    font-size: 1.15rem;
    text-align: center;
    outline: none;
    transition: border-color 0.15s;
    background: white;
    color: #111;
  }

  .answer-input:focus {
    border-color: #111;
  }

  .answer-input::placeholder {
    color: #bbb;
  }

  .answer-actions {
    display: flex;
    justify-content: center;
  }

  .submit-btn {
    padding: 0.7rem 2.5rem;
    background: #111;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
  }

  .submit-btn:hover:not(:disabled) { background: #333; }
  .submit-btn:disabled { opacity: 0.3; cursor: default; }

  /* ── Dot progress ── */

  .dot-track {
    display: flex;
    justify-content: center;
    gap: 8px;
    padding: 1.5rem;
    border-top: 1px solid #eee;
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #e5e5e5;
    transition: background 0.3s, transform 0.3s;
  }

  .dot.answered { background: #111; }

  .dot.current {
    background: #111;
    transform: scale(1.3);
    box-shadow: 0 0 0 3px rgba(0,0,0,0.1);
  }

  /* ── Loading ── */

  .loading-question {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }

  .spinner {
    width: 24px;
    height: 24px;
    border: 3px solid #e5e5e5;
    border-top-color: #111;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  .spinner.large {
    width: 40px;
    height: 40px;
    border-width: 4px;
    margin-bottom: 0.5rem;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* ── Results ── */

  .results-screen {
    align-items: center;
    padding: 3rem 1.5rem;
  }

  .results-card {
    background: white;
    border: 1px solid #e5e5e5;
    border-radius: 12px;
    max-width: 640px;
    width: 100%;
    overflow: hidden;
  }

  .results-body {
    padding: 2.5rem;
    line-height: 1.7;
  }

  .results-body :global(h1) {
    font-size: 1.5rem;
    margin: 0 0 1.5rem;
    padding-bottom: 0.75rem;
    border-bottom: 2px solid #eee;
  }

  .results-body :global(h2) {
    font-size: 1.1rem;
    margin: 1.75rem 0 0.5rem;
    color: #333;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    font-weight: 700;
  }

  .results-body :global(h3) {
    font-size: 1rem;
    margin: 1.25rem 0 0.35rem;
    color: #555;
  }

  .results-body :global(p) {
    margin: 0.25rem 0;
    color: #444;
  }

  .results-body :global(li) {
    margin: 0.35rem 0 0.35rem 1.25rem;
    color: #444;
    list-style: disc;
  }

  .results-body :global(strong) {
    color: #111;
  }

  .results-body :global(br) {
    display: block;
    content: "";
    margin: 0.25rem 0;
  }

  .results-footer {
    padding: 1.25rem 2.5rem;
    border-top: 1px solid #eee;
    background: #fafafa;
  }
</style>
