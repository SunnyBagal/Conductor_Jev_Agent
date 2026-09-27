/**
 * Heuristic audit of casual rewrites against the rewrite rules: no effort/severity hints, no
 * solution. Flags are for HUMAN review; regexes over-flag (e.g. "complex" numbers) on purpose.
 */
export interface Flag {
  id: string;
  rule: "effort/severity hint" | "possible solution" | "cause guess" | "too long";
  match: string;
}

const EFFORT = /\b(easy|trivial|simple|quick(?:ly)?|hard|difficult|critical|severe|minor|major|one[- ]liner?|small fix|big fix|straightforward)\b/i;
// "complex" is excluded on purpose: in math-heavy repos it almost always means complex numbers.
const SOLUTION =
  /\b(should (?:use|be using|call|check|instead use)|probably should be|fix(?:ed)? (?:is|by)|(?:just |probably )?(?:need|needs) to (?:add|check|strip|preserve|use|change|handle|update|call|remove|return|make|pass|set)|change (?:it |this |the )?\S+ to|replace \S+ with|the fix|patch (?:is|would)|check the `[^`]+` condition)\b/i;
const CAUSE = /\b(seems like|looks like|probably (?:because|due to|caused)|likely (?:because|due to|caused)|i think (?:it'?s|the)|root cause)\b/i;

export function auditRewrite(id: string, text: string): Flag[] {
  const out: Flag[] = [];
  const e = text.match(EFFORT);
  if (e) out.push({ id, rule: "effort/severity hint", match: e[0] });
  const s = text.match(SOLUTION);
  if (s) out.push({ id, rule: "possible solution", match: s[0] });
  const c = text.match(CAUSE);
  if (c) out.push({ id, rule: "cause guess", match: c[0] });
  const sentences = (text.match(/[.!?](\s|$)/g) ?? []).length;
  if (sentences > 3) out.push({ id, rule: "too long", match: `${sentences} sentences` });
  return out;
}
