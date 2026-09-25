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
      problemInput.value += sym.replace("()", "(");
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

analyzeBtn.addEventListener("click", () => {
  const problem = problemInput.value.trim();
  if (!problem) {
    setStatus("Enter a problem first.", "error");
    return;
  }

  resetSteps();

  try {
    solutionData = solveProblem(problem);
    setStatus("Analysis complete. Reveal steps below.", "");
    placeholderMsg.classList.add("hidden");
    unlockStep(1);
  } catch (err) {
    console.error(err);
    setStatus("Error: " + err.message, "error");
  }
});

// ---------- MASTER SOLVER (no API, fully offline) ----------

function normalizeExpr(str) {
  return str
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-")
    .replace(/π/g, "pi")
    .replace(/√\(/g, "sqrt(")
    .replace(/\s+/g, "");
}

function solveProblem(raw) {
  const original = raw.trim();
  if (original.includes("∫")) return solveIntegral(original);
  if (/d\/dx/i.test(original)) return solveDerivative(original);
  if (/lim/i.test(original)) return solveLimit(original);
  if (original.includes("=")) return solveEquation(original);
  return solveExpression(original);
}

// ---- Polynomial helpers ----

function tryParsePolynomial(expr) {
  if (!/^[0-9x^+\-.*]+$/.test(expr)) return null;
  expr = expr.replace(/\*/g, "");
  if (expr[0] !== "+" && expr[0] !== "-") expr = "+" + expr;
  const termRegex = /([+-])([^+-]+)/g;
  let terms = [];
  let m;
  while ((m = termRegex.exec(expr)) !== null) {
    const sign = m[1] === "-" ? -1 : 1;
    let t = m[2];
    let coeff, power;
    if (t.includes("x")) {
      const parts = t.split("x");
      coeff = parts[0] === "" ? 1 : parseFloat(parts[0]);
      if (isNaN(coeff)) return null;
      if (parts[1] && parts[1].startsWith("^")) {
        power = parseFloat(parts[1].slice(1));
        if (isNaN(power)) return null;
      } else {
        power = 1;
      }
    } else {
      coeff = parseFloat(t);
      if (isNaN(coeff)) return null;
      power = 0;
    }
    terms.push({ coeff: sign * coeff, power });
  }
  return terms.length ? terms : null;
}

function integratePoly(terms) {
  return terms.map(t => {
    if (t.power === -1) throw new Error("Term x^-1 needs ln|x| — not supported in the offline polynomial solver.");
    return { coeff: t.coeff / (t.power + 1), power: t.power + 1 };
  });
}

function differentiatePoly(terms) {
  return terms.filter(t => t.power !== 0).map(t => ({ coeff: t.coeff * t.power, power: t.power - 1 }));
}

function formatPoly(terms) {
  terms = terms.filter(t => t.coeff !== 0).sort((a, b) => b.power - a.power);
  if (terms.length === 0) return "0";
  let out = "";
  terms.forEach((t, i) => {
    const c = t.coeff;
    const absC = Math.abs(c);
    const coeffStr = (t.power !== 0 && absC === 1) ? "" : (Number.isInteger(absC) ? absC.toString() : absC.toFixed(4).replace(/\.?0+$/, ""));
    const varStr = t.power === 0 ? "" : (t.power === 1 ? "x" : `x^${t.power}`);
    const termStr = (coeffStr + varStr) || "0";
    out += i === 0 ? (c < 0 ? "-" : "") + termStr : (c < 0 ? " - " : " + ") + termStr;
  });
  return out;
}

// ---- Integral ----

function solveIntegral(raw) {
  let expr = raw.replace("∫", "").replace(/dx$/i, "");
  expr = normalizeExpr(expr);

  const terms = tryParsePolynomial(expr);
  if (terms) {
    const integrated = integratePoly(terms);
    const resultStr = formatPoly(integrated) + " + C";
    return {
      topic_method: `This is an INTEGRATION problem from Calculus. The integrand is a polynomial in x, so we apply the Power Rule for Integration term by term: ∫x^n dx = x^(n+1)/(n+1) + C.`,
      formulas_simplification: `Power Rule: ∫x^n dx = x^(n+1)/(n+1) + C\nApplied to each term of ${expr} separately, then combined into one expression.`,
      complete_solution: `∫(${expr}) dx\n= ${resultStr}\n\nwhere C is the constant of integration.`
    };
  }

  const known = matchKnownIntegral(expr);
  if (known) return known;

  throw new Error("This integral form isn't supported offline yet. Try a polynomial like x^3+2x-5.");
}

function matchKnownIntegral(expr) {
  const table = [
    { re: /^sin\(x\)$/, result: "-cos(x) + C", rule: "∫sin(x)dx = -cos(x) + C" },
    { re: /^cos\(x\)$/, result: "sin(x) + C", rule: "∫cos(x)dx = sin(x) + C" },
    { re: /^e\^x$/, result: "e^x + C", rule: "∫e^x dx = e^x + C" },
    { re: /^1\/x$/, result: "ln|x| + C", rule: "∫(1/x)dx = ln|x| + C" }
  ];
  for (const entry of table) {
    if (entry.re.test(expr)) {
      return {
        topic_method: `This is a standard INTEGRATION problem using a known basic integral rule from Calculus.`,
        formulas_simplification: `Rule used: ${entry.rule}`,
        complete_solution: `∫(${expr}) dx = ${entry.result}`
      };
    }
  }
  return null;
}

// ---- Derivative (uses math.js) ----

function solveDerivative(raw) {
  let expr = raw.replace(/d\/dx/i, "");
  expr = normalizeExpr(expr);
  try {
    const derivative = math.derivative(expr, "x");
    const simplified = math.simplify(derivative).toString();
    return {
      topic_method: `This is a DIFFERENTIATION problem from Calculus. We differentiate with respect to x using standard rules (power rule, sum rule, chain/product rule as needed).`,
      formulas_simplification: `Key rules: d/dx[x^n] = n·x^(n-1), d/dx[sin(x)] = cos(x), d/dx[cos(x)] = -sin(x), sum rule: d/dx[f+g] = f' + g'.\nApplied to: ${expr}`,
      complete_solution: `d/dx(${expr}) = ${simplified}`
    };
  } catch (e) {
    throw new Error("Could not parse this expression for differentiation. Try something like x^3+2x.");
  }
}

// ---- Linear equation ----

function solveEquation(raw) {
  const [lhsRaw, rhsRaw] = raw.split("=");
  if (!lhsRaw || !rhsRaw) throw new Error("Equation format not recognized.");

  const lhs = tryParsePolynomial(normalizeExpr(lhsRaw));
  const rhs = tryParsePolynomial(normalizeExpr(rhsRaw));
  if (!lhs || !rhs) throw new Error("This equation type isn't supported offline yet. Try 2x+3=7.");

  const maxPower = Math.max(...lhs.map(t => t.power), ...rhs.map(t => t.power));
  if (maxPower > 1) throw new Error("Only linear equations (degree 1) are supported offline right now.");

  const getCoeff = (terms, power) => terms.filter(t => t.power === power).reduce((s, t) => s + t.coeff, 0);
  const a = getCoeff(lhs, 1) - getCoeff(rhs, 1);
  const b = getCoeff(rhs, 0) - getCoeff(lhs, 0);
  if (a === 0) throw new Error("No unique solution (x cancels out).");
  const x = b / a;

  return {
    topic_method: `This is a LINEAR EQUATION from Algebra. We isolate x by moving all x-terms to one side and constants to the other.`,
    formulas_simplification: `Rearranged form: ${a}x = ${b}`,
    complete_solution: `${raw}\n=> ${a}x = ${b}\n=> x = ${b}/${a}\n=> x = ${Number.isInteger(x) ? x : x.toFixed(4)}`
  };
}

// ---- Limit (numeric substitution) ----

function solveLimit(raw) {
  const match = raw.match(/lim.*?x\s*(?:->|→)\s*([^\s,)]+)\)?\s*(.*)/i);
  if (!match) throw new Error("Limit format not recognized. Try: lim(x->2) x^2+3");
  const point = normalizeExpr(match[1]);
  let expr = normalizeExpr(match[2]);
  if (!expr) throw new Error("Could not find the expression to take the limit of.");

  try {
    let value;
    if (/^inf/i.test(point)) {
      value = math.evaluate(expr.replace(/x/g, "1e10"));
    } else {
      const a = math.evaluate(point);
      value = math.evaluate(expr.replace(/x/g, `(${a})`));
    }
    return {
      topic_method: `This is a LIMIT problem from Calculus. We evaluate the function's behavior as x approaches ${point}, using direct substitution since the function is continuous there.`,
      formulas_simplification: `Direct substitution: replace x with ${point} in ${expr}.`,
      complete_solution: `lim(x->${point}) ${expr} = ${value}`
    };
  } catch (e) {
    throw new Error("Could not evaluate this limit directly (may be an indeterminate form).");
  }
}

// ---- Generic fallback ----

function solveExpression(raw) {
  const expr = normalizeExpr(raw);
  try {
    const simplified = math.simplify(expr).toString();
    let evaluated = null;
    try { evaluated = math.evaluate(expr); } catch (e) {}
    return {
      topic_method: `This is a general algebraic expression. We simplify it using standard algebraic rules.`,
      formulas_simplification: `Simplification applied to: ${expr}`,
      complete_solution: `${expr} = ${simplified}` + (typeof evaluated === "number" ? `\n(evaluates to ${evaluated})` : "")
    };
  } catch (e) {
    throw new Error("Could not parse this expression. Please check the syntax.");
  }
}

// ---------- UI helpers ----------

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
    body.textContent = solutionData[keys[n]] || "(no content)";
    btn.textContent = "REVEALED";
    btn.classList.add("done");
    const nextN = parseInt(n, 10) + 1;
    if (nextN <= 3) unlockStep(nextN);
  });
});
