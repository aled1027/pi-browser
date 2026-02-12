// pi-browser core library
export { Agent } from "./agent.js";
export type { AgentConfig } from "./agent.js";

export type {
  Message,
  ToolCall,
  ToolResult,
  ToolDefinition,
  AgentEvent,
} from "./types.js";

export { ExtensionRegistry } from "./extensions.js";
export type {
  Extension,
  PiBrowserAPI,
  UserInputField,
  UserInputRequest,
  UserInputResponse,
} from "./extensions.js";

export { SkillRegistry } from "./skills.js";
export type { Skill } from "./skills.js";

export { PromptTemplateRegistry } from "./prompt-templates.js";
export type { PromptTemplate } from "./prompt-templates.js";

export { VirtualFS, createTools } from "./tools.js";
export { runAgent } from "./openrouter.js";
