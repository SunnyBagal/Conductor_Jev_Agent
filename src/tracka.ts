/** Track A helpers: your hand-labelled prompts live in data/labels.csv (id,prompt,label,sure). */
import { existsSync, readFileSync } from "node:fs";
import { readLabelsCsv, writeJsonl, type Paths } from "./data.ts";

/** Build tasks.jsonl from labels.csv so the prompt is written once. Refuses to overwrite a different file. */
export function importLabels(p: Paths) {
  const labels = readLabelsCsv(p.labels);
  if (!labels.length) throw new Error(`${p.labels} has no rows yet. See docs/LABELING.md.`);
  const tasks = labels.map((l) => ({ id: l.id, prompt: l.prompt, source: "own" as const }));
  const next = tasks.map((t) => JSON.stringify(t)).join("\n") + "\n";
  if (existsSync(p.tasks)) {
    const cur = readFileSync(p.tasks, "utf8");
    if (cur.trim() && cur !== next) throw new Error(`${p.tasks} already has different content. Move it aside if you really want to rebuild it.`);
  }
  writeJsonl(p.tasks, tasks);
  const n = (t: string) => labels.filter((l) => l.label === t).length;
  console.log(`Wrote ${p.tasks}: ${tasks.length} prompts (cheap ${n("cheap")}, standard ${n("standard")}, frontier ${n("frontier")}; sure=no ${labels.filter((l) => l.sure === "no").length}).`);
}
