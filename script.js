const keypadSymbols = [
  "x","y","z","²","³",
  "n","√()","π","∞","+",
  "−","×","÷","=","(",
  ")","[","]","|","∫",
  "∂","d/dx","Σ","lim","sin()",
  "cos()","tan()","ln()","log()","←"
];

const keypad = document.getElementById("keypad");
const problemInput = document.getElementById("problemInput");

keypadSymbols.forEach(sym => {
  const btn = document.createElement("button");
  btn.textContent = sym;
  btn.type = "button";
  btn.addEventListener("click", () => {
    if (sym === "←") {
      problemInput.value = problemInput.value.slice(0, -1);
    } else {
      const clean = sym.replace("()", "(");
      problemInput.value += clean;
    }
    problemInput.focus();
  });
  keypad.appendChild(btn);
});

const clearBtn = document.createElement("button");
clearBtn.textContent = "CLEAR";
clearBtn.type = "button";
clearBtn.classList.add("clear");
clearBtn.addEventListener("click", () => { problemInput.value = ""; });
keypad.appendChild(clearBtn);

const analyzeBtn = document.getElementById("analyzeBtn");
const statusMsg = document.getElementById("statusMsg");
const placeholderMsg = document.getElementById("placeholderMsg");

let solutionData = null;

analyzeBtn.addEventListener("click", async () => {
  const problem = problemInput.value.trim();
  if (!problem) {
    setStatus("Enter a problem first.", "error");
    return;
  }
  if (!GEMINI_API_KEY || GEMINI_API_KEY === "YOUR_GEMINI_KEY_HERE") {
    setStatus("Add your Gemini API key in config.js first.", "error");
    return;
  }

  resetSteps();
  setStatus("Analyzing problem...", "loading");
  analyzeBtn.disabled = true;

  try {
    solutionData = await fetchSolution(problem);
    setStatus("Analysis complete. Reveal steps below.", "");
    placeholderMsg.classList.add("hidden");
    unlockStep(1);
  } catch (err) {
    console.error(err);
    setStatus("Error: " + err.message, "error");
  } finally {
    analyzeBtn.disabled = false;
  }
});

async function fetchSolution(problem) {
  const systemPrompt = `You are a mathematics tutor. Given a math problem, respond ONLY with a raw JSON object
(no markdown fences, no backticks, no extra text before or after) with exactly these three keys:

"topic_method": a short paragraph naming the topic/branch of math and the general method or theorem to use — no formulas, no numbers from the actual solution.
"formulas_simplification": the relevant formulas/rules needed, and how the problem simplifies/sets up using them — still without giving the final numeric/symbolic answer.
"complete_solution": the full step-by-step worked solution ending in the final answer.

Use plain text math notation (e.g. x^3, sqrt(x), integral of ...). Keep each section concise but complete.

Problem: ${problem}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        { role: "user", parts: [{ text: systemPrompt }] }
      ],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: "application/json"
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error("API request failed (" + response.status + "): " + errText.slice(0, 200));
  }

  const data = await response.json();

  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) {
    throw new Error("No content returned by Gemini. Try again.");
  }

  const cleaned = raw.replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error("Model returned invalid JSON. Try again.");
  }
  return parsed;
}

function unlockStep(n) {
  const stepEl = document.querySelector(`.step[data-step="${n}"]`);
  const btn = stepEl.querySelector(".reveal-btn");
  stepEl.classList.remove("locked");
  btn.disabled = false;
}

function resetSteps() {
  [1, 2, 3].forEach(n => {
    const stepEl = document.querySelector(`.step[data-step="${n}"]`);
    const body = document.getElementById(`step${n}Body`);
    const btn = stepEl.querySelector(".reveal-btn");
    body.textContent = "";
    btn.textContent = "REVEAL";
    btn.disabled = true;
    btn.classList.remove("done");
    if (n !== 1) stepEl.classList.add("locked");
  });
  placeholderMsg.classList.remove("hidden");
}

function setStatus(msg, type) {
  statusMsg.textContent = msg;
  statusMsg.className = "status-msg" + (type ? " " + type : "");
}

document.querySelectorAll(".reveal-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    if (!solutionData) return;
    const n = btn.dataset.target;
    const keys = { 1: "topic_method", 2: "formulas_simplification", 3: "complete_solution" };
    const body = document.getElementById(`step${n}Body`);
    body.textContent = solutionData[keys[n]] || "(no content returned)";
    btn.textContent = "REVEALED";
    btn.classList.add("done");
    const nextN = parseInt(n, 10) + 1;
    if (nextN <= 3) unlockStep(nextN);
  });
});
