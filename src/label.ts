/**
 * Optional second labeler: a frontier Claude model labels each task. Output is a REVIEW AID:
 *   <data-dir>/llm_labels.jsonl     every LLM label
 *   <data-dir>/disagreements.jsonl  tasks where the LLM disagrees with your manual label
 * It never writes labels.csv, and eval never reads its output.
 */
import { loadLabels, loadTasks, writeJsonl, type Paths } from "./data.ts";
import { runPool } from "./pool.ts";

export async function runLabel(p: Paths, o: { concurrency: number; limit?: number }) {
  const { classifyTier, LABELER_MODEL } = await import("./llm.ts");
  const tasks = loadTasks(p).slice(0, o.limit ?? Infinity);
  const manual = loadLabels(p, tasks);
  console.log(`Second labeler: ${LABELER_MODEL} on ${tasks.length} task(s). Manual labels are read-only.`);

  const res = await runPool(tasks, o.concurrency, async (t) => ({ t, r: await classifyTier(t.prompt, LABELER_MODEL, true) }));
  const llm = [];
  const disagreements = [];
  let failed = 0;
  for (const x of res) {
    if (x.status === "rejected") {
      failed++;
      console.error(`  failed: ${(x.reason as Error).message}`);
      continue;
    }
    const { t, r } = x.value;
    llm.push({ id: t.id, tier: r.tier, reason: r.reason, model: r.model });
    const m = manual.get(t.id);
    if (m && m.label !== r.tier)
      disagreements.push({
        id: t.id,
        prompt: t.prompt,
        manual_label: m.label,
        manual_sure: m.sure,
        llm_label: r.tier,
        llm_reason: r.reason,
        model: r.model,
      });
  }
  writeJsonl(p.llmLabels, llm);
  writeJsonl(p.disagreements, disagreements);
  const compared = llm.filter((l) => manual.has(l.id)).length;
  console.log(`Wrote ${p.llmLabels} (${llm.length}) and ${p.disagreements} (${disagreements.length}/${compared} disagree).`);
  if (failed) process.exitCode = 1;
}
