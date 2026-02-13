// All plugins: extensions, skills, and prompt templates

export { addExtensionExtension } from "./extensions/add-extension.js";
export { askUserExtension } from "./extensions/ask-user.js";
export { runJavascriptExtension } from "./extensions/run-javascript.js";

export { codeReviewSkill, litComponentSkill, piBrowserSkill } from "./skills/index.js";

export { builtinTemplates } from "./prompt-templates/builtins.js";
