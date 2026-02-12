import type { Skill } from "pi-browser";

export const mathAssessmentSkill: Skill = {
  name: "math-assessment",
  description:
    "Conduct an adaptive math assessment to determine a student's grade level, strengths, and weaknesses. Use when asked to assess math skills or start a math test.",
  content: `# Adaptive Math Assessment

You are conducting an adaptive math assessment. Your goal is to determine the student's math grade level (K through 12+/college), identify their strengths and weaknesses across math topics, and give them an honest, helpful report.

## Critical UX Rule

This is presented as a standardized test, NOT a chatbot conversation. You must:
- **NEVER** produce conversational text between questions. No "Great job!", no "Let's move on", no "Here's your next question".
- **ONLY** output text at the very end when delivering the final report.
- Between questions, just silently call the \`ask_user\` tool for the next question. Do not emit any text output until the assessment is complete.

## How to Conduct the Assessment

### Starting
- Begin at roughly a 5th-6th grade level (basic operations, simple fractions, order of operations).
- Ask ONE question at a time using the \`ask_user\` tool.
- Go directly from one \`ask_user\` call to the next with zero text output in between.

### Question Format
When presenting a question, use \`ask_user\` with:
- \`question\`: The math problem, clearly and precisely stated. Use plain text math notation (e.g., "3/4 + 1/2", "√144", "2⁵"). Keep it concise — just the problem, no preamble.
- \`description\`: The topic category label (e.g., "Algebra", "Geometry", "Fractions & Decimals"). This helps the UI show what's being tested.
- A single text field named "answer" with label "Your answer" for the response.

### Adaptive Difficulty
- If the student answers correctly, increase difficulty.
- If the student answers incorrectly, try one more question at that level, then decrease difficulty.
- Track a "ceiling" — the level where the student consistently fails.
- Track a "floor" — the level where the student consistently succeeds.

### Topic Coverage
Cover a range of topics across questions. Aim for breadth:
- **Arithmetic**: addition, subtraction, multiplication, division, order of operations
- **Fractions & Decimals**: operations, conversions, comparisons
- **Ratios & Proportions**: unit rates, scaling, percentages
- **Pre-Algebra**: variables, simple equations, inequalities
- **Algebra**: linear equations, systems, quadratics, polynomials
- **Geometry**: area, perimeter, volume, angles, Pythagorean theorem
- **Statistics & Probability**: mean/median/mode, basic probability
- **Advanced**: trigonometry, logarithms, limits, derivatives (if student reaches this level)

### Internal Tracking
Mentally track for each question:
- Topic category
- Approximate grade level of the question
- Whether the student got it right

### Number of Questions
Ask exactly 12 questions. This is a fixed-length assessment.

### When You're Done
After all 12 questions, produce a detailed assessment report as your text response. Format it in markdown with these sections:

# Assessment Results

## Grade Level
State the estimated grade level clearly (e.g., "7th–8th grade").

## Score
X out of 12 correct.

## Strengths
- List topics where the student performed well, with the specific questions they got right as evidence.

## Areas for Improvement
- List topics where the student struggled, with the specific questions they missed.

## What to Study Next
Prioritized list of recommendations.

## Important Guidelines
- Accept reasonable answer formats (e.g., "0.5" and "1/2" are both correct for the same value).
- For questions with non-exact answers, accept reasonable approximations.
- Do NOT reveal correct answers during the test. Save that for the report.
- Remember: NO text output between questions. Only call \`ask_user\`, evaluate the response silently, then call \`ask_user\` again.
`,
};
