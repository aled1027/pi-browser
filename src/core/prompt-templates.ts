/**
 * Prompt templates for pi-browser.
 *
 * Templates are named markdown snippets that expand when the user types
 * `/name` in the chat input. They support positional arguments:
 *   /review staged         → $1 = "staged", $@ = "staged"
 *   /component Button big  → $1 = "Button", $2 = "big", $@ = "Button big"
 *
 * Like pi, templates are registered programmatically (no filesystem).
 */

// ─── Template definition ────────────────────────────────────────────

export interface PromptTemplate {
  /** Command name (no leading slash). e.g. "review" → invoked as /review */
  name: string;
  /** Short description shown in autocomplete */
  description: string;
  /**
   * Template body with optional argument placeholders:
   *   $1, $2, ...   — positional args
   *   $@             — all args joined with spaces
   *   ${@:N}         — args from position N onward
   *   ${@:N:L}       — L args starting at position N
   */
  body: string;
}

// ─── Template registry ──────────────────────────────────────────────

export class PromptTemplateRegistry {
  private templates = new Map<string, PromptTemplate>();

  /** Register a template */
  register(template: PromptTemplate): void {
    this.templates.set(template.name, template);
  }

  /** Register multiple templates */
  registerAll(templates: PromptTemplate[]): void {
    for (const t of templates) {
      this.register(t);
    }
  }

  /** Get a template by name */
  get(name: string): PromptTemplate | undefined {
    return this.templates.get(name);
  }

  /** Get all registered templates */
  getAll(): PromptTemplate[] {
    return [...this.templates.values()];
  }

  /**
   * Find templates whose name starts with the given prefix.
   * Used for autocomplete in the chat input.
   */
  search(prefix: string): PromptTemplate[] {
    const lower = prefix.toLowerCase();
    return this.getAll().filter((t) => t.name.toLowerCase().startsWith(lower));
  }

  /**
   * Try to expand a user input string.
   *
   * If the input starts with `/name`, looks up the template and expands
   * argument placeholders. Returns null if no template matches.
   */
  expand(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed.startsWith("/")) return null;

    // Parse: /name arg1 arg2 "arg with spaces" ...
    const withoutSlash = trimmed.slice(1);
    const parts = parseArgs(withoutSlash);
    if (parts.length === 0) return null;

    const name = parts[0];
    const args = parts.slice(1);
    const template = this.get(name);
    if (!template) return null;

    return expandBody(template.body, args);
  }
}

// ─── Argument parsing ───────────────────────────────────────────────

/**
 * Parse a string into tokens, respecting quoted strings.
 *   parseArgs('review "staged changes"') → ["review", "staged changes"]
 */
function parseArgs(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === " " || ch === "\t") {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }

  if (current) tokens.push(current);
  return tokens;
}

/**
 * Expand a template body with positional arguments.
 *   $1, $2, ...   → positional
 *   $@ or $ARGUMENTS → all args joined
 *   ${@:N}        → args from N onward (1-indexed)
 *   ${@:N:L}      → L args from N
 */
function expandBody(body: string, args: string[]): string {
  let result = body;

  // ${@:N:L} — slice with length
  result = result.replace(/\$\{@:(\d+):(\d+)\}/g, (_, nStr, lStr) => {
    const n = parseInt(nStr, 10) - 1;
    const l = parseInt(lStr, 10);
    return args.slice(n, n + l).join(" ");
  });

  // ${@:N} — slice from N
  result = result.replace(/\$\{@:(\d+)\}/g, (_, nStr) => {
    const n = parseInt(nStr, 10) - 1;
    return args.slice(n).join(" ");
  });

  // $@ or $ARGUMENTS — all args
  result = result.replace(/\$@/g, args.join(" "));
  result = result.replace(/\$ARGUMENTS/g, args.join(" "));

  // $1, $2, ... — positional (do this last so $@ isn't partially matched)
  result = result.replace(/\$(\d+)/g, (_, nStr) => {
    const n = parseInt(nStr, 10) - 1;
    return args[n] ?? "";
  });

  return result;
}
