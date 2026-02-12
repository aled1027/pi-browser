/** A message in the conversation */
export interface Message {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  /** If the assistant used tool calls, they're tracked here */
  toolCalls?: ToolCall[];
  /** For tool-role messages, the ID of the tool call this is a response to */
  toolCallId?: string;
}

/** A tool call requested by the model */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: ToolResult;
}

/** Result from executing a tool */
export interface ToolResult {
  content: string;
  isError: boolean;
}

/** Definition of a tool the model can use */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
}

/** Events emitted during agent processing */
export type AgentEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call_start"; toolCall: ToolCall }
  | { type: "tool_call_end"; toolCall: ToolCall }
  | { type: "tool_loop_message"; message: Message }
  | { type: "turn_end" }
  | { type: "error"; error: string };
