/**
 * Static SVG: savings vs under-routing. x = spend (lower is cheaper), y = under-routing rate.
 * Blue = Jev threshold settings on the Pareto front (line) with the chosen one ringed;
 * orange = baselines, direct-labeled. Palette validated for CVD in light and dark.
 */
export interface ChartPoint {
  spend: number;
  under: number;
  label?: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function sweepSvg(front: ChartPoint[], chosen: ChartPoint, baselines: ChartPoint[], xLabel: string): string {
  const W = 640,
    H = 380,
    m = { l: 56, r: 24, t: 40, b: 48 };
  const all = [...front, chosen, ...baselines];
  const xMax = Math.max(...all.map((p) => p.spend)) * 1.08 || 1;
  const xMin = Math.min(0, ...all.map((p) => p.spend));
  const yMax = Math.max(0.05, ...all.map((p) => p.under)) * 1.15;
  const x = (v: number) => m.l + ((v - xMin) / (xMax - xMin)) * (W - m.l - m.r);
  const y = (v: number) => H - m.b - (v / yMax) * (H - m.t - m.b);

  const yTicks = Array.from({ length: 5 }, (_, i) => (yMax * i) / 4);
  const xTicks = Array.from({ length: 5 }, (_, i) => xMin + ((xMax - xMin) * i) / 4);
  const grid = yTicks
    .map((v) => `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${(v * 100).toFixed(0)}%</text>`)
    .join("");
  const xt = xTicks.map((v) => `<text class="tick" x="${x(v)}" y="${H - m.b + 18}" text-anchor="middle">${v.toFixed(2)}</text>`).join("");

  const sorted = [...front].sort((a, b) => a.spend - b.spend);
  const path = sorted.map((p, i) => `${i ? "L" : "M"}${x(p.spend).toFixed(1)},${y(p.under).toFixed(1)}`).join(" ");
  const tip = (p: ChartPoint, who: string) => `<title>${esc(who)}: spend ${p.spend.toFixed(3)}, under-routing ${(p.under * 100).toFixed(1)}%</title>`;
  const frontDots = sorted.map((p) => `<circle class="jev" cx="${x(p.spend)}" cy="${y(p.under)}" r="4">${tip(p, "Jev setting")}</circle>`).join("");
  const chosenMark = `<circle class="ring" cx="${x(chosen.spend)}" cy="${y(chosen.under)}" r="8">${tip(chosen, "Jev chosen")}</circle><text class="lbl" x="${x(chosen.spend) + 12}" y="${y(chosen.under) - 10}">Jev (chosen)</text>`;
  const base = baselines
    .map((p) => `<circle class="base" cx="${x(p.spend)}" cy="${y(p.under)}" r="5">${tip(p, p.label ?? "")}</circle><text class="lbl" x="${x(p.spend) + 9}" y="${y(p.under) + 4}">${esc(p.label ?? "")}</text>`)
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Savings versus under-routing on the tune set">
<style>
  :root { --bg:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --grid:#e4e3df; --s1:#2a78d6; --s2:#eb6834; }
  @media (prefers-color-scheme: dark) { :root { --bg:#1a1a19; --ink:#ffffff; --ink2:#c3c2b7; --grid:#383835; --s1:#3987e5; --s2:#d95926; } }
  .bg{fill:var(--bg)} .grid{stroke:var(--grid);stroke-width:1} .axis{stroke:var(--ink2);stroke-width:1}
  .tick{fill:var(--ink2);font:11px system-ui,sans-serif} .lbl{fill:var(--ink);font:12px system-ui,sans-serif}
  .title{fill:var(--ink);font:600 14px system-ui,sans-serif} .jevline{fill:none;stroke:var(--s1);stroke-width:2}
  .jev{fill:var(--s1);stroke:var(--bg);stroke-width:2} .ring{fill:none;stroke:var(--s1);stroke-width:2}
  .base{fill:var(--s2);stroke:var(--bg);stroke-width:2}
</style>
<rect class="bg" width="${W}" height="${H}" rx="6"/>
<text class="title" x="${m.l}" y="22">Savings vs under-routing (TUNE set)</text>
<g transform="translate(${W - m.r - 190},12)"><circle class="jev" cx="6" cy="6" r="4"/><text class="lbl" x="16" y="10">Jev settings (Pareto)</text><circle class="base" cx="136" cy="6" r="5"/><text class="lbl" x="146" y="10">Baselines</text></g>
${grid}${xt}
<line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>
<text class="tick" x="${(m.l + W - m.r) / 2}" y="${H - 10}" text-anchor="middle">${esc(xLabel)} (lower = cheaper)</text>
<text class="tick" transform="translate(14,${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle">under-routing rate</text>
<path class="jevline" d="${path}"/>${frontDots}${chosenMark}${base}
</svg>
`;
}
