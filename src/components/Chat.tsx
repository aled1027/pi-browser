import { useState, useRef, useEffect, useCallback } from "react";
import type { Agent } from "../agent";
import type { PromptTemplate } from "../prompt-templates";
import type { UserInputRequest, UserInputResponse } from "../extensions";
import type { ToolCall } from "../types";
import { UserInputForm } from "./UserInputForm";
import "./Chat.css";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
}

interface Props {
  agent: Agent;
}

export function Chat({ agent }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [streamToolCalls, setStreamToolCalls] = useState<ToolCall[]>([]);
  const [pendingInput, setPendingInput] = useState<{
    request: UserInputRequest;
    resolve: (response: UserInputResponse) => void;
  } | null>(null);
  const [suggestions, setSuggestions] = useState<PromptTemplate[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Wire up the user input handler so extensions can request input
  useEffect(() => {
    agent.setUserInputHandler((request) => {
      return new Promise<UserInputResponse>((resolve) => {
        setPendingInput({ request, resolve });
      });
    });
  }, [agent]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText, streamToolCalls]);

  // Autocomplete for prompt templates
  useEffect(() => {
    const trimmed = input.trim();
    if (trimmed.startsWith("/") && !trimmed.includes(" ")) {
      const prefix = trimmed.slice(1);
      const matches = agent.promptTemplates.search(prefix);
      setSuggestions(matches);
      setSelectedSuggestion(0);
    } else {
      setSuggestions([]);
    }
  }, [input, agent]);

  const handleUserInputSubmit = useCallback(
    (response: UserInputResponse) => {
      if (pendingInput) {
        pendingInput.resolve(response);
        setPendingInput(null);
      }
    },
    [pendingInput]
  );

  const acceptSuggestion = useCallback(
    (template: PromptTemplate) => {
      setInput(`/${template.name} `);
      setSuggestions([]);
    },
    []
  );

  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setInput("");
    setSuggestions([]);
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setStreaming(true);
    setStreamText("");
    setStreamToolCalls([]);

    let fullText = "";
    const toolCalls: ToolCall[] = [];

    try {
      for await (const event of agent.prompt(text)) {
        switch (event.type) {
          case "text_delta":
            fullText += event.delta;
            setStreamText(fullText);
            break;
          case "tool_call_start":
            toolCalls.push(event.toolCall);
            setStreamToolCalls([...toolCalls]);
            break;
          case "tool_call_end": {
            const idx = toolCalls.findIndex(
              (tc) => tc.id === event.toolCall.id
            );
            if (idx >= 0) {
              toolCalls[idx] = event.toolCall;
              setStreamToolCalls([...toolCalls]);
            }
            break;
          }
          case "error":
            fullText += `\n\n**Error:** ${event.error}`;
            setStreamText(fullText);
            break;
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        fullText += `\n\n**Error:** ${e}`;
      }
    }

    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: fullText,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      },
    ]);
    setStreamText("");
    setStreamToolCalls([]);
    setStreaming(false);
  }, [agent, input, streaming]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Autocomplete navigation
      if (suggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedSuggestion((prev) =>
            prev < suggestions.length - 1 ? prev + 1 : 0
          );
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedSuggestion((prev) =>
            prev > 0 ? prev - 1 : suggestions.length - 1
          );
          return;
        }
        if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
          e.preventDefault();
          acceptSuggestion(suggestions[selectedSuggestion]);
          return;
        }
        if (e.key === "Escape") {
          setSuggestions([]);
          return;
        }
      }

      // Normal submit
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [suggestions, selectedSuggestion, acceptSuggestion, handleSubmit]
  );

  return (
    <div className="chat">
      <div className="chat-header">
        <span className="chat-title">π browser</span>
        <span className="chat-model">anthropic/claude-sonnet-4</span>
      </div>

      <div className="chat-messages">
        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}

        {streaming && (streamText || streamToolCalls.length > 0) && (
          <MessageBubble
            message={{
              role: "assistant",
              content: streamText,
              toolCalls:
                streamToolCalls.length > 0 ? streamToolCalls : undefined,
            }}
            isStreaming
          />
        )}

        <div ref={bottomRef} />
      </div>

      <div className="chat-input-area">
        <div className="chat-input-wrapper">
          {suggestions.length > 0 && (
            <div className="autocomplete">
              {suggestions.map((t, i) => (
                <div
                  key={t.name}
                  className={`autocomplete-item ${i === selectedSuggestion ? "selected" : ""}`}
                  onMouseEnter={() => setSelectedSuggestion(i)}
                  onClick={() => acceptSuggestion(t)}
                >
                  <span className="autocomplete-name">/{t.name}</span>
                  <span className="autocomplete-desc">{t.description}</span>
                </div>
              ))}
            </div>
          )}
          <textarea
            className="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Send a message… (type / for templates)"
            rows={1}
            onKeyDown={handleKeyDown}
            disabled={streaming}
          />
        </div>
        <button
          className="chat-send"
          onClick={streaming ? () => agent.abort() : handleSubmit}
          disabled={!streaming && !input.trim()}
        >
          {streaming ? "Stop" : "Send"}
        </button>
      </div>

      {pendingInput && (
        <UserInputForm
          request={pendingInput.request}
          onSubmit={handleUserInputSubmit}
        />
      )}
    </div>
  );
}

function MessageBubble({
  message,
  isStreaming,
}: {
  message: ChatMessage;
  isStreaming?: boolean;
}) {
  return (
    <div className={`message message-${message.role}`}>
      <div className="message-role">
        {message.role === "user" ? "you" : "assistant"}
      </div>

      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="tool-calls">
          {message.toolCalls.map((tc) => (
            <div key={tc.id} className="tool-call">
              <div className="tool-call-name">
                🔧 {tc.name}({JSON.stringify(tc.arguments).slice(0, 80)}
                {JSON.stringify(tc.arguments).length > 80 ? "…" : ""})
              </div>
              {tc.result && (
                <div
                  className={`tool-call-result ${tc.result.isError ? "tool-error" : ""}`}
                >
                  {tc.result.content.slice(0, 200)}
                  {tc.result.content.length > 200 ? "…" : ""}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="message-content">
        {message.content}
        {isStreaming && <span className="cursor">▊</span>}
      </div>
    </div>
  );
}
