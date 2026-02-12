/**
 * Skills system for pi-browser.
 *
 * Skills are specialized instruction sets the model can load on-demand.
 * Like pi, only names and descriptions appear in the system prompt —
 * full content is loaded when the model calls the `read_skill` tool.
 *
 * Since pi-browser runs in the browser with no filesystem, skills are
 * registered programmatically rather than discovered from disk.
 */

import type { ToolDefinition, ToolResult } from "./types.js";

// ─── Skill definition ───────────────────────────────────────────────

export interface Skill {
  /** Unique name (lowercase, hyphens, e.g. "code-review") */
  name: string;
  /** When the model should use this skill (shown in system prompt) */
  description: string;
  /** Full instruction content (markdown) — loaded on-demand */
  content: string;
}

// ─── Skill registry ─────────────────────────────────────────────────

export class SkillRegistry {
  private skills = new Map<string, Skill>();

  /** Register a skill */
  register(skill: Skill): void {
    if (!skill.name || !skill.description || !skill.content) {
      console.warn(`[skills] Skipping invalid skill: missing required fields`);
      return;
    }
    if (this.skills.has(skill.name)) {
      console.warn(`[skills] Duplicate skill "${skill.name}", keeping first`);
      return;
    }
    this.skills.set(skill.name, skill);
  }

  /** Register multiple skills */
  registerAll(skills: Skill[]): void {
    for (const skill of skills) {
      this.register(skill);
    }
  }

  /** Get a skill by name */
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /** Get all registered skills */
  getAll(): Skill[] {
    return [...this.skills.values()];
  }

  /**
   * Generate the system prompt fragment listing available skills.
   * This is injected into the system prompt so the model knows what's
   * available and when to load each skill.
   */
  systemPromptFragment(): string {
    const skills = this.getAll();
    if (skills.length === 0) return "";

    const entries = skills
      .map(
        (s) =>
          `  <skill>\n    <name>${s.name}</name>\n    <description>${s.description}</description>\n  </skill>`
      )
      .join("\n");

    return `
The following skills provide specialized instructions for specific tasks.
Use the read_skill tool to load a skill's full content when the task matches its description.

<available_skills>
${entries}
</available_skills>`;
  }

  /**
   * Create the read_skill tool that lets the model load skill content.
   */
  createReadSkillTool(): ToolDefinition {
    return {
      name: "read_skill",
      description:
        "Load the full content of a skill by name. Use this when a task matches an available skill's description.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The skill name to load",
          },
        },
        required: ["name"],
      },
      execute: async (args): Promise<ToolResult> => {
        const name = args.name as string;
        const skill = this.get(name);
        if (!skill) {
          const available = this.getAll()
            .map((s) => s.name)
            .join(", ");
          return {
            content: `Skill "${name}" not found. Available skills: ${available || "none"}`,
            isError: true,
          };
        }
        return {
          content: skill.content,
          isError: false,
        };
      },
    };
  }
}
