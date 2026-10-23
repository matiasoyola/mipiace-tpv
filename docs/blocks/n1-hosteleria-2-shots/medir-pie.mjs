import { abrir, entrar } from "./entrar.mjs";
const Q = `(() => {
  const r = (e) => { const b = e.getBoundingClientRect();
    return { y: Math.round(b.y), h: Math.round(b.height), w: Math.round(b.width) }; };
  const dump = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return { sel, falta: true };
    const cs = getComputedStyle(e);
    return { sel, ...r(e), padding: cs.padding, gap: cs.gap,
      hijos: [...e.children].map((c) => ({
        testid: c.getAttribute("data-testid") || c.tagName,
        ...r(c), px: getComputedStyle(c).fontSize,
        pad: getComputedStyle(c).padding,
        texto: (c.textContent||"").trim().slice(0, 26),
        hijos: [...c.children].map((g) => ({ t: (g.textContent||"").trim().slice(0,22), ...r(g), px: getComputedStyle(g).fontSize })),
      })) };
  };
  return { pie: dump('[data-testid="comanda-pie"]'), acciones: dump('[data-testid="acciones-cocina"]'),
    tirador: (() => { const h = document.querySelector('[data-testid="hoja-comanda"]');
      return h ? r(h.children[0]) : null; })() };
})()`;
const { browser, page } = await abrir({ w: 360, h: 720 });
await entrar(page);
await page.waitForTimeout(1200);
const t2 = page.locator('[data-testid="table-shape"]').filter({ hasText: /^T2/ }).first();
await t2.scrollIntoViewIfNeeded(); await t2.click(); await page.waitForTimeout(3000);
await page.locator('[data-testid="handheld-bar"] button[aria-label="Abrir la comanda"]').click();
await page.waitForTimeout(1200);
const m = await page.evaluate(Q);
console.log("tirador:", JSON.stringify(m.tirador));
for (const k of ["acciones", "pie"]) {
  const b = m[k];
  console.log(`\n=== ${k}: ${b.h}px (y=${b.y}) padding ${b.padding} gap ${b.gap}`);
  for (const h of b.hijos||[]) {
    console.log(`  ${String(h.h).padStart(3)}px w=${String(h.w).padStart(3)} ${h.px.padEnd(6)} pad=${(h.pad||"").padEnd(18)} ${h.testid.padEnd(18)} «${h.texto}»`);
    for (const g of h.hijos||[]) console.log(`       ${String(g.h).padStart(3)}px ${g.px.padEnd(6)} «${g.t}»`);
  }
}
await browser.close();
