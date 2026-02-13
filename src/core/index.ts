// tau core library — Agent is the primary public API
export { Agent, PromptStream } from "./agent.js";
export type { AgentConfig, ThreadMeta } from "./agent.js";

export type {
  Message,
  ToolCall,
  ToolResult,
  ToolDefinition,
  AgentEvent,
  PromptResult,
} from "./types.js";

export type {
  Extension,
  ExtensionHost,
  UserInputField,
  UserInputRequest,
  UserInputResponse,
} from "./extensions.js";

export type { Skill } from "./skills.js";
export { parseSkillMarkdown, serializeSkillMarkdown } from "./skills.js";

export type { PromptTemplate } from "./prompt-templates.js";

export { VirtualFS } from "./tools.js";

// Plugins (built-in extensions, skills, prompt templates)
export {
  addExtensionExtension,
  askUserExtension,
  runJavascriptExtension,
  codeReviewSkill,
  litComponentSkill,
  tauSkill,
  builtinTemplates,
} from "./plugins/index.js";
