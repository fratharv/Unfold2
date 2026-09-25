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

// ================= MASTER OFFLINE SOLVER (no API) =================

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
  if (/^int\s*\(/i.test(original) || original.includes("∫")) return solveIntegral(original);
  if (/d\/dx/i.test(original)) return solveDerivative(original);
  if (/lim/i.test(original)) return solveLimit(original);
  if (original.includes("=")) return solveEquation(original);
  return solveExpression(original);
}

// ---------- core numeric helpers ----------

function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { [a, b] = [b, a % b]; }
  return a || 1;
}

function reduceFraction(num, den) {
  if (den < 0) { den = -den; num = -num; }
  if (Number.isInteger(num) && Number.isInteger(den) && den !== 0) {
    const g = gcd(num, den) || 1;
    num /= g; den /= g;
  }
  return { num, den };
}

function toFraction(coeff, power) {
  if (Number.isInteger(coeff)) return { num: coeff, den: 1, power };
  for (let d = 2; d <= 16; d++) {
    if (Math.abs(coeff * d - Math.round(coeff * d)) < 1e-9) {
      const r = reduceFraction(Math.round(coeff * d), d);
      return { num: r.num, den: r.den, power };
    }
  }
  return { num: coeff, den: 1, power };
}

// Splits a sum-of-terms expression at top level (ignores +/- inside parentheses)
function splitTopLevel(expr) {
  const terms = [];
  let depth = 0, current = "";
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if ((ch === "+" || ch === "-") && depth === 0 && i !== 0) {
      terms.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  terms.push(current);
  return terms.filter(t => t !== "" && t !== "+" && t !== "-");
}

// Parses a pure "coeff*x^power" or plain number, using strict regex (no functions)
function parseSimpleFactor(str) {
  if (/^-?\d*\.?\d*x(\^-?\d+(?:\.\d+)?)?$/.test(str)) {
    const idx = str.indexOf("x");
    const coeffPart = str.slice(0, idx);
    const powerPart = str.slice(idx + 1);
    let coeff = coeffPart === "" || coeffPart === "+" ? 1 : (coeffPart === "-" ? -1 : parseFloat(coeffPart));
    if (isNaN(coeff)) return null;
    let power = 1;
    if (powerPart.startsWith("^")) power = parseFloat(powerPart.slice(1));
    return { coeff, power };
  }
  if (/^-?\d+\.?\d*$/.test(str) || /^-?\.\d+$/.test(str)) {
    return { coeff: parseFloat(str), power: 0 };
  }
  return null;
}

// Handles division too: e.g. "1/x^2", "3/x", "5", "x^5" (sign included in `term`)
function parseMonomialWithDivision(term) {
  let s = term.trim();
  let sign = 1;
  if (s[0] === "+") s = s.slice(1);
  else if (s[0] === "-") { sign = -1; s = s.slice(1); }
  s = s.replace(/\*/g, "");
  if (s === "") return null;

  const slashIdx = s.indexOf("/");
  let numerPart, denomPart;
  if (slashIdx === -1) { numerPart = s; denomPart = "1"; }
  else { numerPart = s.slice(0, slashIdx); denomPart = s.slice(slashIdx + 1); }

  const numer = parseSimpleFactor(numerPart);
  const denom = parseSimpleFactor(denomPart);
  if (!numer || !denom || denom.coeff === 0) return null;

  const coeff = sign * numer.coeff / denom.coeff;
  const power = numer.power - denom.power;
  return toFraction(coeff, power);
}

function tryParsePolynomialFraction(expr) {
  const rawTerms = splitTopLevel(expr);
  const terms = [];
  for (const t of rawTerms) {
    const m = parseMonomialWithDivision(t);
    if (!m) return null;
    terms.push(m);
  }
  return terms;
}

function integratePoly(terms) {
  return terms.map(t => {
    const newPower = t.power + 1; // caller guarantees power !== -1
    const r = reduceFraction(t.num, t.den * newPower);
    return { num: r.num, den: r.den, power: newPower };
  });
}

function differentiatePoly(terms) {
  return terms.filter(t => t.power !== 0).map(t => {
    const r = reduceFraction(t.num * t.power, t.den);
    return { num: r.num, den: r.den, power: t.power - 1 };
  });
}

function formatPolyFraction(terms) {
  terms = terms.filter(t => t.num !== 0).sort((a, b) => b.power - a.power);
  if (!terms.length) return "0";
  let out = "";
  terms.forEach((t, i) => {
    const neg = t.num < 0;
    const absNum = Math.abs(t.num);
    const den = t.den;
    let termStr;
    const fmtNum = n => Number.isInteger(n) ? n.toString() : n.toFixed(4).replace(/\.?0+$/, "");

    if (t.power === 0) {
      termStr = den === 1 ? fmtNum(absNum) : `${fmtNum(absNum)}/${den}`;
    } else if (t.power > 0) {
      const varStr = t.power === 1 ? "x" : `x^${t.power}`;
      if (den === 1) termStr = absNum === 1 ? varStr : fmtNum(absNum) + varStr;
      else if (absNum === 1) termStr = `${varStr}/${den}`;
      else termStr = `${fmtNum(absNum)}${varStr}/${den}`;
    } else {
      const absPower = -t.power;
      const denomVar = absPower === 1 ? "x" : `x^${absPower}`;
      termStr = den === 1
        ? (absNum === 1 ? `1/${denomVar}` : `${fmtNum(absNum)}/${denomVar}`)
        : `${fmtNum(absNum)}/(${den}${denomVar})`;
    }
    out += i === 0 ? (neg ? "-" : "") + termStr : (neg ? " - " : " + ") + termStr;
  });
  return out;
}

function joinBlocks(blocks) {
  blocks = blocks.filter(b => b && b.trim() !== "" && b.trim() !== "0");
  if (!blocks.length) return "0";
  let out = "";
  blocks.forEach((b, i) => {
    const trimmed = b.trim();
    const neg = trimmed.startsWith("-");
    const content = neg ? trimmed.slice(1).trim() : trimmed;
    out += i === 0 ? (neg ? "-" : "") + content : (neg ? " - " : " + ") + content;
  });
  return out;
}

function scaleWrap(coeff, expr) {
  if (Math.abs(coeff - 1) < 1e-9) return expr;
  if (Math.abs(coeff + 1) < 1e-9) return `-${expr}`;
  let coeffStr;
  if (Number.isInteger(coeff)) coeffStr = coeff.toString();
  else {
    let frac = null;
    for (let d = 2; d <= 12; d++) {
      if (Math.abs(coeff * d - Math.round(coeff * d)) < 1e-6) { frac = `${Math.round(coeff * d)}/${d}`; break; }
    }
    coeffStr = frac || coeff.toFixed(4).replace(/\.?0+$/, "");
  }
  const neg = coeffStr.startsWith("-");
  const absCoeffStr = neg ? coeffStr.slice(1) : coeffStr;
  return `${neg ? "-" : ""}${absCoeffStr}(${expr})`;
}

function linearArgCoeff(argStr) {
  if (argStr === "x") return 1;
  const m = argStr.match(/^([+-]?\d*\.?\d*)\*?x$/);
  if (!m) return null;
  const c = m[1];
  if (c === "" || c === "+") return 1;
  if (c === "-") return -1;
  return parseFloat(c);
}

function argLabel(k, isExp) {
  if (Math.abs(k - 1) < 1e-9) return "x";
  const kStr = Number.isInteger(k) ? k : k;
  return isExp ? `(${kStr}x)` : `${kStr}x`;
}

// Matches trig/exp/log terms with a linear argument (kx) and an outer sign folded in
function matchTranscendental(body, outerSign) {
  let coeff = outerSign;
  let rest = body;
  const coeffMatch = rest.match(/^(\d+\.?\d*|\.\d+)\*?(?=(?:sin\(|cos\(|tan\(|sec\(|csc\(|cot\(|e\^|ln\())/);
  if (coeffMatch) { coeff *= parseFloat(coeffMatch[1]); rest = rest.slice(coeffMatch[0].length); }

  let m;
  if ((m = rest.match(/^sin\(([^()]+)\)$/))) {
    const k = linearArgCoeff(m[1]); if (k === null) return null;
    return { rule: "∫sin(kx)dx = -(1/k)cos(kx) + C", result: scaleWrap(-coeff / k, `cos(${argLabel(k)})`) };
  }
  if ((m = rest.match(/^cos\(([^()]+)\)$/))) {
    const k = linearArgCoeff(m[1]); if (k === null) return null;
    return { rule: "∫cos(kx)dx = (1/k)sin(kx) + C", result: scaleWrap(coeff / k, `sin(${argLabel(k)})`) };
  }
  if ((m = rest.match(/^tan\(([^()]+)\)$/))) {
    const k = linearArgCoeff(m[1]); if (k === null) return null;
    return { rule: "∫tan(kx)dx = -(1/k)ln|cos(kx)| + C", result: scaleWrap(-coeff / k, `ln|cos(${argLabel(k)})|`) };
  }
  if ((m = rest.match(/^sec\(([^()]+)\)\^2$/))) {
    const k = linearArgCoeff(m[1]); if (k === null) return null;
    return { rule: "∫sec²(kx)dx = (1/k)tan(kx) + C", result: scaleWrap(coeff / k, `tan(${argLabel(k)})`) };
  }
  if ((m = rest.match(/^csc\(([^()]+)\)\^2$/))) {
    const k = linearArgCoeff(m[1]); if (k === null) return null;
    return { rule: "∫csc²(kx)dx = -(1/k)cot(kx) + C", result: scaleWrap(-coeff / k, `cot(${argLabel(k)})`) };
  }
  if ((m = rest.match(/^sec\(([^()]+)\)\*?tan\(\1\)$/))) {
    const k = linearArgCoeff(m[1]); if (k === null) return null;
    return { rule: "∫sec(kx)tan(kx)dx = (1/k)sec(kx) + C", result: scaleWrap(coeff / k, `sec(${argLabel(k)})`) };
  }
  if ((m = rest.match(/^csc\(([^()]+)\)\*?cot\(\1\)$/))) {
    const k = linearArgCoeff(m[1]); if (k === null) return null;
    return { rule: "∫csc(kx)cot(kx)dx = -(1/k)csc(kx) + C", result: scaleWrap(-coeff / k, `csc(${argLabel(k)})`) };
  }
  if ((m = rest.match(/^e\^\(?([^()]+)\)?$/))) {
    const k = linearArgCoeff(m[1]); if (k === null) return null;
    return { rule: "∫e^(kx)dx = (1/k)e^(kx) + C", result: scaleWrap(coeff / k, `e^${argLabel(k, true)}`) };
  }
  if (rest === "ln(x)") {
    return { rule: "∫ln(x)dx = x·ln(x) - x + C  (integration by parts)", result: scaleWrap(coeff, "x·ln(x) - x") };
  }
  if (rest === "1/(1+x^2)" || rest === "1/(x^2+1)") {
    return { rule: "∫1/(1+x²)dx = arctan(x) + C", result: scaleWrap(coeff, "arctan(x)") };
  }
  return null;
}

// ---------- Integration ----------

function solveIntegral(raw) {
  let expr;
  const trimmed = raw.trim();
  if (/^int\s*\(/i.test(trimmed)) {
    const start = trimmed.indexOf("(") + 1;
    const end = trimmed.lastIndexOf(")");
    expr = trimmed.slice(start, end);
  } else {
    expr = trimmed.replace("∫", "");
  }
  expr = expr.replace(/dx\s*$/i, "");
  expr = normalizeExpr(expr);

  const rawTerms = splitTopLevel(expr);
  const polyTerms = [];
  const otherBlocks = [];
  const rulesUsed = new Set();

  for (const term of rawTerms) {
    const mono = parseMonomialWithDivision(term);
    if (mono) {
      if (mono.power === -1) {
        otherBlocks.push(scaleWrap(mono.num / mono.den, "ln|x|"));
        rulesUsed.add("∫(1/x)dx = ln|x| + C");
      } else {
        polyTerms.push(mono);
        rulesUsed.add("Power Rule: ∫xⁿdx = x^(n+1)/(n+1) + C  (n ≠ -1)");
      }
      continue;
    }

    let sign = 1, body = term;
    if (body[0] === "+") body = body.slice(1);
    else if (body[0] === "-") { sign = -1; body = body.slice(1); }

    const match = matchTranscendental(body, sign);
    if (match) {
      otherBlocks.push(match.result);
      rulesUsed.add(match.rule);
      continue;
    }

    throw new Error(`Could not integrate "${term}". Supported: any-power polynomial terms (e.g. x^5, 1/x^2), sin/cos/tan(kx), sec²/csc²(kx), sec·tan, csc·cot, e^(kx), ln(x), 1/(1+x²).`);
  }

  const blocks = [];
  if (polyTerms.length) {
    const polyStr = formatPolyFraction(integratePoly(polyTerms));
    if (polyStr !== "0") blocks.push(polyStr);
  }
  blocks.push(...otherBlocks);

  const finalResult = joinBlocks(blocks) + " + C";

  return {
    topic_method: `This is an INTEGRATION problem from Calculus. Each term is integrated independently — the Power Rule for polynomial terms (any positive or negative degree) and the standard rule for trigonometric, exponential or logarithmic terms — then combined via the Sum Rule.`,
    formulas_simplification: [...rulesUsed].join("\n"),
    complete_solution: `∫(${expr}) dx\n= ${finalResult}\n\nwhere C is the constant of integration.`
  };
}

// ---------- Differentiation ----------

function solveDerivative(raw) {
  let expr = raw.replace(/d\/dx/i, "");
  expr = normalizeExpr(expr);

  const terms = tryParsePolynomialFraction(expr);
  if (terms) {
    const diff = differentiatePoly(terms);
    const resultStr = formatPolyFraction(diff);
    return {
      topic_method: `This is a DIFFERENTIATION problem from Calculus. The expression is a polynomial (any degree, positive or negative powers included), so the Power Rule is applied term by term.`,
      formulas_simplification: `Power Rule: d/dx[x^n] = n·x^(n-1)\nApplied to each term of ${expr}.`,
      complete_solution: `d/dx(${expr}) = ${resultStr}`
    };
  }

  // Rewrite sec/csc/cot to reciprocal form so math.js can chain/quotient-rule them
  const mathExpr = expr
    .replace(/sec\(/g, "1/cos(")
    .replace(/csc\(/g, "1/sin(")
    .replace(/cot\(/g, "1/tan(");

  try {
    const derivative = math.derivative(mathExpr, "x");
    const simplified = math.simplify(derivative).toString();
    return {
      topic_method: `This is a DIFFERENTIATION problem from Calculus. We differentiate using standard rules — power, sum, product, quotient and chain rule — across trigonometric, exponential and logarithmic functions.`,
      formulas_simplification: `Key rules: d/dx[x^n]=n·x^(n-1), d/dx[sin(x)]=cos(x), d/dx[cos(x)]=-sin(x), d/dx[tan(x)]=sec²(x), d/dx[e^x]=e^x, d/dx[ln(x)]=1/x, plus product/chain rule for compositions.\nApplied to: ${expr}`,
      complete_solution: `d/dx(${expr}) = ${simplified}`
    };
  } catch (e) {
    throw new Error("Could not parse this expression for differentiation.");
  }
}

// ---------- Linear equation ----------

function solveEquation(raw) {
  const [lhsRaw, rhsRaw] = raw.split("=");
  if (!lhsRaw || !rhsRaw) throw new Error("Equation format not recognized.");

  const lhs = tryParsePolynomialFraction(normalizeExpr(lhsRaw));
  const rhs = tryParsePolynomialFraction(normalizeExpr(rhsRaw));
  if (!lhs || !rhs) throw new Error("This equation type isn't supported offline yet. Try 2x+3=7.");

  const maxPower = Math.max(...lhs.map(t => t.power), ...rhs.map(t => t.power));
  if (maxPower > 1) throw new Error("Only linear equations (degree 1) are supported for equation solving right now.");

  const getCoeff = (terms, power) => terms.filter(t => t.power === power).reduce((s, t) => s + t.num / t.den, 0);
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

// ---------- Limit ----------

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

// ---------- Generic fallback ----------

function solveExpression(raw) {
  const expr = normalizeExpr(raw);
  try {
    const simplified = math.simplify(expr).toString();
    let evaluated = null;
    try { evaluated = math.evaluate(expr); } catch (e) {}
    return {
      topic_method: `This is a general algebraic/trigonometric expression. We simplify it using standard rules.`,
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
