function sanitizeJsonEscapes(jsonStr) {
  let out = "";
  let inString = false;
  let escape = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const c = jsonStr[i];

    if (escape) {
      out += c;
      escape = false;
      continue;
    }

    if (c === '"') {
      inString = !inString;
      out += c;
      continue;
    }

    if (inString && c === '\\') {
      const next = jsonStr[i + 1] || '';
      const afterNext = jsonStr[i + 2] || '';

      // Valid standard JSON escapes:
      // \"  \\  \/  \b  \f  \n  \r  \t
      // If \ is followed by \, it's an escaped backslash
      if (next === '\\') {
        out += '\\\\';
        i++; // skip the second backslash
        continue;
      }

      if (next === '"' || next === '/') {
        out += '\\' + next;
        i++;
        continue;
      }

      // Check if it's \n (newline), \r (carriage return), \t (tab), \b (backspace), \f (formfeed)
      // BUT if it's LaTeX like \frac, \text, \times, \right, \beta, \neq (followed by letters):
      const isWord = /^[a-zA-Z]/.test(afterNext);
      if (/^[nrtbf]/.test(next) && !isWord) {
        out += '\\' + next;
        i++;
        continue;
      }

      // Unicode \uXXXX
      if (next === 'u' && /^[0-9a-fA-F]{4}/.test(jsonStr.slice(i + 2, i + 6))) {
        out += jsonStr.slice(i, i + 6);
        i += 5;
        continue;
      }

      // Anything else is an INVALID escape (e.g. \%, \$, \frac, \sqrt, \alpha, \times)
      // We must double the backslash so it becomes valid JSON \\% or \\frac
      out += '\\\\';
      continue;
    }

    // Handle raw unescaped newlines inside strings
    if (inString && c === '\n') {
      out += '\\n';
      continue;
    }
    if (inString && c === '\r') {
      out += '\\n';
      if (jsonStr[i + 1] === '\n') i++;
      continue;
    }

    out += c;
  }
  return out;
}

const deepSeekRaw = `[
  {
    "question": "Q.28. मूल्य $$40\\\\%$$ कम है। वृद्धि $$18\\\\%$$ होती है। \\frac{1}{2} \\% \\$50 \\times 2",
    "options": [
      "(a) $$0.5\\\\%$$ की कमी",
      "(b) $$6.4\\\\%$$ की कमी",
      "(c) $$6.5\\\\%$$ की वृद्धि",
      "(d) $$6.8\\\\%$$ की वृद्धि"
    ],
    "answer": "D",
    "type": "text",
    "continues_previous": false,
    "content": "Q.28. ... \\frac{1}{2} ... \\times ... \\% ...\\nAnswer: D"
  }
]`;

const fixed = sanitizeJsonEscapes(deepSeekRaw);
console.log("Fixed output:");
console.log(fixed);

try {
  const parsed = JSON.parse(fixed);
  console.log("\n>>> SUCCESS! PARSED QUESTIONS COUNT:", parsed.length);
  console.log("Question 0 text:", parsed[0].question);
  console.log("Options:", parsed[0].options);
} catch (e) {
  console.log("\n>>> PARSE FAILED:", e.message);
}
