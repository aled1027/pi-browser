// All plugins: extensions, skills, and prompt templates

export { askUserExtension } from "./extensions/ask-user.js";

export { codeReviewSkill } from "./skills/code-review.js";
export { litComponentSkill } from "./skills/lit-component.js";

export { builtinTemplates } from "./prompt-templates/builtins.js";

// Tutor plugins
export { tutorLessons, tutorTemplates, runCodeExtension } from "./tutor/index.js";
