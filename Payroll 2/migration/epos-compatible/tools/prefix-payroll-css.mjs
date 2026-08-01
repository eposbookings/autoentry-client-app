import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const target = resolve(process.argv[2] || "frontend/src/modules/payroll/payroll.css");

function matchingBrace(source, open) {
  let depth = 1;
  let quote = "";
  let comment = false;
  for (let index = open + 1; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (comment) {
      if (char === "*" && next === "/") { comment = false; index += 1; }
      continue;
    }
    if (!quote && char === "/" && next === "*") { comment = true; index += 1; continue; }
    if (quote) {
      if (char === "\\") { index += 1; continue; }
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return index;
  }
  throw new Error("Unbalanced CSS block.");
}

function prefixSelector(selector) {
  const leading = selector.match(/^\s*/)?.[0] || "";
  const trailing = selector.match(/\s*$/)?.[0] || "";
  const clean = selector.trim();
  if (!clean || clean.includes(".payroll-module")) return selector;
  const scoped = clean.replace(/(^|[ >+~])(html|body|:root)(?=$|[ .:#>+~[])/g, "$1.payroll-module");
  return `${leading}${scoped === clean ? `.payroll-module ${clean}` : scoped}${trailing}`;
}

function transformRules(source) {
  let output = "";
  let cursor = 0;
  while (cursor < source.length) {
    const open = source.indexOf("{", cursor);
    if (open < 0) return output + source.slice(cursor);
    const close = matchingBrace(source, open);
    const prelude = source.slice(cursor, open);
    const body = source.slice(open + 1, close);
    const trimmed = prelude.trim();
    if (trimmed.startsWith("@")) {
      const isContainer = /^@(media|supports|layer|container|document)\b/i.test(trimmed);
      output += `${prelude}{${isContainer ? transformRules(body) : body}}`;
    } else {
      output += `${prelude.split(",").map(prefixSelector).join(",")}{${body}}`;
    }
    cursor = close + 1;
  }
  return output;
}

const source = await readFile(target, "utf8");
const prefixed = transformRules(source);
await writeFile(target, prefixed, "utf8");

