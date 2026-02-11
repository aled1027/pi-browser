import { useState, useRef, useEffect, useCallback } from "react";
import type { Agent } from "../agent";
import type { ToolCall } from "../types";
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
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText, streamToolCalls]);

  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setInput("");
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
        <textarea
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Send a message..."
          rows={1}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          disabled={streaming}
        />
        <button
          className="chat-send"
          onClick={streaming ? () => agent.abort() : handleSubmit}
          disabled={!streaming && !input.trim()}
        >
          {streaming ? "Stop" : "Send"}
        </button>
      </div>
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
