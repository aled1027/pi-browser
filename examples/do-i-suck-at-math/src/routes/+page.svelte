<script lang="ts">
  import { Agent } from "pi-browser";
  import { onMount } from "svelte";

  let loading = $state(true);
  let agent: Agent | null = $state(null);
  let response = $state("");
  let asking = $state(false);

  function saveApiKey(apiKey: string) {
    localStorage.setItem("openrouterApiKey", apiKey);
  }

  function getApiKey() {
    return localStorage.getItem("openrouterApiKey") ?? "";
  }

  function submitInitializeAgent(event: Event) {
    event.preventDefault();
    const formData = new FormData(event.target as HTMLFormElement);
    const apiKey = formData.get("openrouterApiKey") as string;
    saveApiKey(apiKey);
    initializeAgent(apiKey);
  }

  async function initializeAgent(apiKey: string) {
    agent = await Agent.create({
      apiKey: apiKey,
      extensions: [],
      skills: [],
      promptTemplates: [],
      systemPrompt: "respond like a cat, but only in 10 words or less",
    });
  }

  async function submitQuestion(event: Event) {
    if (!agent) return;

    asking = true;
    event.preventDefault();
    const formData = new FormData(event.target as HTMLFormElement);
    const question = formData.get("question") as string;

    const result = await agent.send(question);
    response = result.text;
    asking = false;
  }

  onMount(() => {
    console.log("onMount");
    const apiKey = getApiKey();
    console.log("apiKey", apiKey);
    if (apiKey) {
      initializeAgent(apiKey);
    }
    loading = false;
  });
</script>

<h1>Welcome to SvelteKit</h1>
<p>
  Visit <a href="https://svelte.dev/docs/kit">svelte.dev/docs/kit</a> to read the
  documentation
</p>

{#if !agent && !loading}
  <form onsubmit={submitInitializeAgent}>
    <input type="text" name="openrouterApiKey" />
    <button type="submit">Initialize Agent</button>
  </form>
{:else if agent && !loading}
  <form onsubmit={submitQuestion}>
    <input type="text" name="question" />
    <button type="submit">Ask Question</button>
  </form>
  {#if asking}
    <pre>Asking...</pre>
  {:else}
    <pre>{response}</pre>
  {/if}

  <!-- <pre>{JSON.stringify(agent.tools, null, 2)}</pre> -->
{/if}
