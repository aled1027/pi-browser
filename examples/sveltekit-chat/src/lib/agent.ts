/**
 * Shared agent creation helper.
 * Creates an Agent configured with the standard plugins.
 */
import {
  Agent,
  askUserExtension,
  runJavascriptExtension,
  codeReviewSkill,
  litComponentSkill,
  builtinTemplates,
} from "tau";

export async function createAgent(apiKey: string): Promise<Agent> {
  return Agent.create({
    apiKey,
    extensions: [askUserExtension, runJavascriptExtension],
    skills: [codeReviewSkill, litComponentSkill],
    promptTemplates: builtinTemplates,
  });
}
