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

/** Round a raw step up to 1, 2, 2.5 or 5 x 10^k so tick labels read cleanly. */
function niceStep(range: number, ticks: number): number {
  const raw = range / ticks || 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 2.5, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function sweepSvg(front: ChartPoint[], chosen: ChartPoint, baselines: ChartPoint[], xLabel: string): string {
  const W = 640,
    H = 380,
    m = { l: 56, r: 32, t: 40, b: 48 };
  const all = [...front, chosen, ...baselines];
  const xStep = niceStep(Math.max(...all.map((p) => p.spend)), 4);
  const xMin = 0;
  const xMax = Math.ceil((Math.max(...all.map((p) => p.spend)) * 1.05) / xStep) * xStep || 1;
  const yStep = niceStep(Math.max(0.05, ...all.map((p) => p.under)), 4);
  const yMax = Math.ceil((Math.max(0.05, ...all.map((p) => p.under)) * 1.1) / yStep) * yStep;
  const x = (v: number) => m.l + ((v - xMin) / (xMax - xMin)) * (W - m.l - m.r);
  const y = (v: number) => H - m.b - (v / yMax) * (H - m.t - m.b);

  const range = (max: number, step: number) => Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const yTicks = range(yMax, yStep);
  const xTicks = range(xMax, xStep);
  const grid = yTicks
    .map((v) => `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${Math.round(v * 100)}%</text>`)
    .join("");
  const xt = xTicks.map((v) => `<text class="tick" x="${x(v)}" y="${H - m.b + 18}" text-anchor="middle">${+v.toFixed(2)}</text>`).join("");

  const sorted = [...front].sort((a, b) => a.spend - b.spend);
  const path = sorted.map((p, i) => `${i ? "L" : "M"}${x(p.spend).toFixed(1)},${y(p.under).toFixed(1)}`).join(" ");
  const tip = (p: ChartPoint, who: string) => `<title>${esc(who)}: spend ${p.spend.toFixed(3)}, under-routing ${(p.under * 100).toFixed(1)}%</title>`;
  const frontDots = sorted.map((p) => `<circle class="jev" cx="${x(p.spend)}" cy="${y(p.under)}" r="4">${tip(p, "Jev setting")}</circle>`).join("");
  // Labels sit above-right of the dot; near the right edge they flip to the left.
  const label = (px: number, py: number, text: string) => {
    const flip = px > W - m.r - 110;
    return `<text class="lbl" x="${px + (flip ? -9 : 9)}" y="${py - 8}" text-anchor="${flip ? "end" : "start"}">${esc(text)}</text>`;
  };
  const chosenMark = `<circle class="ring" cx="${x(chosen.spend)}" cy="${y(chosen.under)}" r="8">${tip(chosen, "Jev chosen")}</circle>${label(x(chosen.spend), y(chosen.under) - 14, "Jev (chosen)")}`;
  const base = baselines
    .map((p) => `<circle class="base" cx="${x(p.spend)}" cy="${y(p.under)}" r="5">${tip(p, p.label ?? "")}</circle>${label(x(p.spend), y(p.under), p.label ?? "")}`)
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
