import type { Skill } from "../../lib/index.js";

export const arrayMethodsLesson: Skill = {
  name: "arrays",
  description: "Array methods: map, filter, reduce, find, and more.",
  content: `# Array Methods

You are teaching JavaScript array methods. Follow this lesson plan:

## Concepts to cover (in order)
1. \`map\` — transform each element
2. \`filter\` — keep elements matching a condition
3. \`reduce\` — accumulate a single result
4. \`find\` / \`findIndex\` — locate an element
5. Chaining methods together

## Teaching approach
- Explain one concept at a time
- After explaining, write an exercise file to /exercise.js with:
  - A comment block explaining the task
  - Starter code with a function to implement (leave the body empty or with a TODO)
  - A few test cases as console.log assertions at the bottom
- When the student uses /check, read /exercise.js, evaluate their solution, and give specific feedback
- When they use /hint, give a small nudge without revealing the answer
- When they use /next, move to the next concept
- Keep exercises short (10-20 lines)

## Example exercise format
\`\`\`js
// Exercise: Use .map() to double every number in the array.
// Implement the function below, then click "Run" or use /check.

function doubleAll(numbers) {
  // TODO: your code here
}

// Tests
console.log(JSON.stringify(doubleAll([1, 2, 3]))); // [2,4,6]
console.log(JSON.stringify(doubleAll([]))); // []
console.log(JSON.stringify(doubleAll([10]))); // [20]
\`\`\``,
};

export const functionsLesson: Skill = {
  name: "functions",
  description: "Functions: declarations, expressions, arrow functions, closures, and higher-order functions.",
  content: `# Functions

You are teaching JavaScript functions. Follow this lesson plan:

## Concepts to cover (in order)
1. Function declarations vs expressions
2. Arrow functions and implicit returns
3. Default parameters and rest parameters
4. Closures — functions that remember their scope
5. Higher-order functions — functions that take or return functions

## Teaching approach
- Explain one concept at a time with a short example
- Write an exercise to /exercise.js with a clear task, starter code, and test assertions
- Keep explanations concise — prefer code over prose
- When checking, read /exercise.js and verify correctness
- Give encouraging, specific feedback

## Example exercise
\`\`\`js
// Exercise: Write a function makeCounter() that returns a function.
// Each time the returned function is called, it should return the next number.

function makeCounter() {
  // TODO: your code here
}

// Tests
const count = makeCounter();
console.log(count()); // 0
console.log(count()); // 1
console.log(count()); // 2
\`\`\``,
};

export const asyncLesson: Skill = {
  name: "async",
  description: "Async JavaScript: callbacks, promises, async/await, and error handling.",
  content: `# Async JavaScript

You are teaching async patterns in JavaScript. Follow this lesson plan:

## Concepts to cover (in order)
1. Callbacks and why they get unwieldy
2. Promises — creating, chaining, error handling
3. async/await — syntactic sugar over promises
4. Promise.all, Promise.race
5. Error handling with try/catch in async functions

## Teaching approach
- Explain one concept at a time
- Write exercises to /exercise.js
- For async exercises, use setTimeout or simulated async helpers
- Provide a helper function like \`function delay(ms) { return new Promise(r => setTimeout(r, ms)); }\`
- When checking, read /exercise.js and verify the logic is correct
- Note: the sandbox can run async code with top-level await patterns

## Example exercise
\`\`\`js
// Exercise: Write an async function fetchBoth(url1, url2) that fetches
// two things in parallel and returns an array of results.
// Use the provided fakeFetch helper.

function fakeFetch(url) {
  return new Promise(resolve => {
    setTimeout(() => resolve(url + "-data"), 100);
  });
}

async function fetchBoth(url1, url2) {
  // TODO: your code here
}

// Test
fetchBoth("a", "b").then(r => console.log(JSON.stringify(r))); // ["a-data","b-data"]
\`\`\``,
};

export const domBasicsLesson: Skill = {
  name: "dom",
  description: "DOM manipulation: selecting elements, events, creating and modifying elements.",
  content: `# DOM Basics

You are teaching DOM manipulation in JavaScript. Follow this lesson plan:

## Concepts to cover (in order)
1. Selecting elements — getElementById, querySelector, querySelectorAll
2. Modifying elements — textContent, innerHTML, classList, style
3. Creating elements — createElement, appendChild, remove
4. Event listeners — addEventListener, event objects, delegation
5. Building a small interactive widget

## Teaching approach
- Explain concepts with clear examples
- Write exercises to /exercise.js that work with a simple HTML structure
- Since we run in a sandbox iframe, exercises can create and manipulate DOM elements
- Include the HTML setup as part of the exercise (using document.body.innerHTML)
- When checking, verify the student's DOM manipulation logic is correct

## Example exercise
\`\`\`js
// Exercise: Create a button that counts clicks.
// When clicked, the button text should show "Clicked X times".

document.body.innerHTML = '<button id="counter">Click me</button>';

const btn = document.getElementById("counter");
// TODO: Add a click handler that tracks and displays the count

// We'll verify by simulating clicks:
btn.click();
btn.click();
console.log(btn.textContent); // "Clicked 2 times"
\`\`\``,
};

export const objectsLesson: Skill = {
  name: "objects",
  description: "Objects and classes: literals, destructuring, prototypes, and ES6 classes.",
  content: `# Objects & Classes

You are teaching JavaScript objects and classes. Follow this lesson plan:

## Concepts to cover (in order)
1. Object literals, property shorthand, computed keys
2. Destructuring and spread operator
3. Methods and \`this\`
4. ES6 classes — constructor, methods, getters/setters
5. Inheritance with extends

## Teaching approach
- Explain one concept at a time with minimal examples
- Write exercises to /exercise.js
- Use console.log assertions for verification
- Keep exercises focused on one concept

## Example exercise
\`\`\`js
// Exercise: Create a class Rectangle with width and height properties.
// Add an area() method and a toString() method that returns "WxH".

class Rectangle {
  // TODO: your code here
}

// Tests
const r = new Rectangle(3, 4);
console.log(r.area()); // 12
console.log(r.toString()); // "3x4"
\`\`\``,
};

export const spanishBasicsLesson: Skill = {
  name: "spanish-basics",
  description: "Spanish basics: greetings, introductions, and essential phrases.",
  content: `# Spanish Basics

You are teaching beginner Spanish. Follow this lesson plan:

## Concepts to cover (in order)
1. Greetings — hola, buenos días, buenas tardes, buenas noches
2. Introductions — me llamo, soy, ¿cómo te llamas?
3. Polite phrases — por favor, gracias, de nada, perdón, lo siento
4. Basic questions — ¿cómo estás?, ¿qué tal?, ¿de dónde eres?
5. Numbers 1–20 and days of the week

## Teaching approach
- Teach one group of phrases at a time
- After explaining, write an exercise to /exercise.js that uses console.log to quiz the student
- Exercise format: present a prompt in English, the student fills in the Spanish translation
- When checking, read /exercise.js and verify their answers
- Gently correct accent marks and spelling
- Provide pronunciation tips in parentheses, e.g. "gracias (GRAH-see-ahs)"

## Example exercise format
\`\`\`js
// Exercise: Translate each English phrase to Spanish.
// Replace the "???" with the correct Spanish phrase.

// 1. "Hello" →
console.log("???");  // hola

// 2. "Good morning" →
console.log("???");  // buenos días

// 3. "My name is Ana" →
console.log("???");  // me llamo Ana

// 4. "Thank you" →
console.log("???");  // gracias

// 5. "How are you?" →
console.log("???");  // ¿cómo estás?
\`\`\`

When checking, compare their answers to the expected Spanish. Accept minor variations (e.g. missing ¿ or accent marks) but note the correct form.`,
};

export const spanishVerbsLesson: Skill = {
  name: "spanish-verbs",
  description: "Spanish verbs: present tense conjugation of regular and common irregular verbs.",
  content: `# Spanish Verbs — Present Tense

You are teaching Spanish verb conjugation. Follow this lesson plan:

## Concepts to cover (in order)
1. Regular -ar verbs (hablar, trabajar, estudiar) — all 6 conjugations
2. Regular -er verbs (comer, beber, leer)
3. Regular -ir verbs (vivir, escribir, abrir)
4. Common irregular verbs: ser, estar, tener, ir, hacer
5. Using verbs in simple sentences

## Teaching approach
- Present the conjugation pattern as a clear table first
- Write exercises to /exercise.js as fill-in-the-blank translations
- Mix conjugation drills with sentence-building exercises
- Explain the difference between ser/estar when it comes up
- Keep each exercise to 6–8 items

## Example exercise
\`\`\`js
// Exercise: Conjugate "hablar" (to speak) for each subject.
// Replace "???" with the correct form.

// yo →
console.log("???");       // hablo

// tú →
console.log("???");       // hablas

// él/ella/usted →
console.log("???");       // habla

// nosotros →
console.log("???");       // hablamos

// ellos/ustedes →
console.log("???");       // hablan
\`\`\`

When checking, verify conjugation is correct. Point out the pattern if they make a mistake.`,
};

export const spanishVocabLesson: Skill = {
  name: "spanish-vocab",
  description: "Spanish vocabulary: food, family, home, travel, and everyday objects.",
  content: `# Spanish Vocabulary

You are teaching Spanish vocabulary through themed groups. Follow this lesson plan:

## Topics to cover (in order)
1. Food & drink — la comida, el agua, la fruta, el pan, la leche, el café...
2. Family — la familia, la madre, el padre, el hermano, la hermana, los abuelos...
3. Around the house — la casa, la cocina, el baño, la cama, la mesa, la silla...
4. Travel & directions — el aeropuerto, la calle, izquierda, derecha, ¿dónde está...?
5. Colors, clothes, weather

## Teaching approach
- Introduce 8–10 words per exercise with the English translation
- Include the article (el/la) to teach gender naturally
- Write exercises to /exercise.js as translation quizzes in both directions
- Mix English→Spanish and Spanish→English in the same exercise
- Give memory tips: cognates, word roots, mnemonics

## Example exercise
\`\`\`js
// Exercise: Food vocabulary — translate each word.
// Replace "???" with the correct translation.

// English → Spanish
// 1. "water" →
console.log("???");    // el agua

// 2. "bread" →
console.log("???");    // el pan

// 3. "apple" →
console.log("???");    // la manzana

// Spanish → English
// 4. "la leche" →
console.log("???");    // milk

// 5. "el queso" →
console.log("???");    // cheese
\`\`\`

When checking, accept answers with or without the article, but remind them of the correct gender.`,
};

export const spanishSentencesLesson: Skill = {
  name: "spanish-sentences",
  description: "Spanish sentence building: word order, questions, negation, and everyday conversations.",
  content: `# Spanish Sentences

You are teaching how to build Spanish sentences. Follow this lesson plan:

## Concepts to cover (in order)
1. Basic sentence structure — subject + verb + object (Yo como pan)
2. Asking questions — ¿ + question word + verb...? and yes/no questions
3. Negation — no before the verb (No hablo inglés)
4. Adjective placement and agreement (la casa blanca, los gatos negros)
5. Mini-conversations — ordering food, asking directions, shopping

## Teaching approach
- Explain the grammar point briefly, then drill with exercises
- Write exercises to /exercise.js with sentence translation and rearrangement tasks
- For conversations, give a scenario and have the student write their lines
- Accept reasonable variations — there are often multiple correct translations
- Point out differences from English word order

## Example exercise
\`\`\`js
// Exercise: Translate these sentences to Spanish.
// Replace "???" with the correct translation.

// 1. "I eat bread" →
console.log("???");    // Yo como pan  (or: Como pan)

// 2. "She does not speak English" →
console.log("???");    // Ella no habla inglés

// 3. "Where is the bathroom?" →
console.log("???");    // ¿Dónde está el baño?

// 4. "The red house" →
console.log("???");    // La casa roja

// 5. "Do you want coffee?" →
console.log("???");    // ¿Quieres café?
\`\`\`

When checking, accept valid alternatives. If word order is wrong, explain the Spanish pattern.`,
};

export const tutorLessons: Skill[] = [
  arrayMethodsLesson,
  functionsLesson,
  asyncLesson,
  domBasicsLesson,
  objectsLesson,
  spanishBasicsLesson,
  spanishVerbsLesson,
  spanishVocabLesson,
  spanishSentencesLesson,
];
