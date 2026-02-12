import type { Skill } from "$core";

export const codeReviewSkill: Skill = {
  name: "code-review",
  description:
    "Review code for bugs, security issues, performance problems, and style. Use when asked to review or audit code.",
  content: `# Code Review

## Process

1. Read the file(s) to review using the \`read\` tool
2. Analyze for the following categories:

### Bugs & Logic Errors
- Off-by-one errors
- Null/undefined access
- Race conditions
- Incorrect boolean logic
- Missing error handling

### Security
- Injection vulnerabilities (SQL, XSS, command)
- Hardcoded secrets or credentials
- Insecure data handling
- Missing input validation

### Performance
- Unnecessary re-renders (React)
- N+1 query patterns
- Missing memoization for expensive computations
- Unbounded data structures

### Style & Maintainability
- Inconsistent naming
- Dead code
- Missing types (TypeScript)
- Overly complex functions (suggest extraction)

## Output Format

For each finding, report:
- **Severity**: 🔴 Critical | 🟡 Warning | 🔵 Info
- **Location**: file and line/region
- **Issue**: what's wrong
- **Fix**: suggested correction

Summarize with a count of findings by severity.`,
};
