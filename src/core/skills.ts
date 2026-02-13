/**
 * Skills system for tau.
 *
 * Skills are specialized instruction sets the model can load on-demand.
 * Like pi, only names and descriptions appear in the system prompt —
 * full content is loaded when the model calls the `read_skill` tool.
 *
 * Since tau runs in the browser with no filesystem, skills are
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

// ─── Frontmatter parsing ────────────────────────────────────────────

/**
 * Parse a skill markdown file with YAML frontmatter.
 *
 * Expected format:
 * ```markdown
 * ---
 * name: my-skill
 * description: Does things. Use when asked to do things.
 * ---
 * # Skill content here
 * ```
 *
 * Returns null if the frontmatter is missing or invalid.
 */
export function parseSkillMarkdown(markdown: string): Skill | null {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return null;

  const frontmatter = match[1];
  const content = match[2].trim();

  // Simple YAML-like parsing for name and description
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);

  if (!nameMatch || !descMatch) return null;

  const name = nameMatch[1].trim();
  const description = descMatch[1].trim();

  if (!name || !description || !content) return null;

  return { name, description, content };
}

/**
 * Serialize a Skill to markdown with YAML frontmatter.
 */
export function serializeSkillMarkdown(skill: Skill): string {
  return `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n${skill.content}\n`;
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

  /** Unregister a skill by name. Returns true if it existed. */
  unregister(name: string): boolean {
    return this.skills.delete(name);
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
        additionalProperties: false,
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
