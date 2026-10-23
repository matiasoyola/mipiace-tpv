import { abrir, entrar } from "./entrar.mjs";

const REPARTO = `(() => {
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect();
    return { y: Math.round(b.y), bottom: Math.round(b.bottom), h: Math.round(b.height) }; };
  const hoja = document.querySelector('[data-testid="hoja-comanda"]');
  if (!hoja) return { error: "sin hoja" };
  // Los hijos DIRECTOS de la hoja y de la comanda: ahi esta el reparto.
  const hijos = (e, nombre) => [...e.children].map((c, i) => ({
    de: nombre, i,
    testid: c.getAttribute("data-testid") || "(sin testid)",
    clase: (c.className || "").toString().slice(0, 55),
    ...r(c),
    texto: (c.textContent || "").trim().slice(0, 40),
  }));
  const comanda = hoja.querySelector('[data-testid="comanda"]');
  const lista = hoja.querySelector('[data-testid="comanda-lineas"]');
  const primeraLinea = lista ? [...lista.children].find((c) => c.getBoundingClientRect().height > 60) : null;
  return {
    ventana: { w: innerWidth, h: innerHeight },
    hoja: r(hoja),
    hijosDeLaHoja: hijos(hoja, "hoja"),
    hijosDeLaComanda: comanda ? hijos(comanda, "comanda") : null,
    linea: primeraLinea ? {
      ...r(primeraLinea),
      clase: (primeraLinea.className||"").toString().slice(0,60),
      partes: [...primeraLinea.querySelectorAll("*")]
        .filter((e) => e.getBoundingClientRect().height > 8 && e.children.length === 0)
        .map((e) => ({ t: (e.textContent||"").trim().slice(0,18), ...r(e),
          w: Math.round(e.getBoundingClientRect().width),
          px: getComputedStyle(e).fontSize })),
    } : null,
  };
})()`;

const { browser, page } = await abrir({ w: 360, h: 720 });
await entrar(page);
await page.waitForTimeout(1200);
const t2 = page.locator('[data-testid="table-shape"]').filter({ hasText: /^T2/ }).first();
await t2.scrollIntoViewIfNeeded();
await t2.click();
await page.waitForTimeout(3000);
await page.locator('[data-testid="handheld-bar"] button[aria-label="Abrir la comanda"]').click();
await page.waitForTimeout(1200);
const m = await page.evaluate(REPARTO);
console.log("ventana", JSON.stringify(m.ventana));
console.log("hoja   ", JSON.stringify(m.hoja));
console.log("\n--- hijos DIRECTOS de la hoja (donde se va el alto) ---");
for (const h of m.hijosDeLaHoja) console.log(` ${String(h.h).padStart(4)}px  ${String(h.y).padStart(4)}..${String(h.bottom).padStart(4)}  ${h.testid.padEnd(22)} «${h.texto}»`);
console.log("\n--- hijos de <comanda> ---");
for (const h of (m.hijosDeLaComanda || [])) console.log(` ${String(h.h).padStart(4)}px  ${String(h.y).padStart(4)}..${String(h.bottom).padStart(4)}  ${h.testid.padEnd(22)} «${h.texto}»`);
console.log("\n--- UNA LINEA de comanda: " + m.linea.h + " px ---");
console.log("  clase:", m.linea.clase);
for (const p of m.linea.partes) console.log(`   ${String(p.h).padStart(3)}px w=${String(p.w).padStart(3)} ${p.px.padEnd(6)} «${p.t}»`);
await browser.close();
