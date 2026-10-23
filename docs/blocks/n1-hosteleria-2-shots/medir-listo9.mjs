// Hallazgo 9 en los TERMINALES: la segunda excepción a la restricción.
// Antes el aviso decía «Servido» y servía en el acto; ahora dice «Ver» y
// abre la hoja. Capturas antes/después a 1280×800 y 1442×811.
import { abrir, entrar } from "./entrar.mjs";
import { writeFileSync } from "node:fs";

const etiqueta = process.argv[2] || "despues";
const out = {};

for (const [nombre, w, h] of [["AP11", 1280, 800], ["D8", 1442, 811]]) {
  const { browser, page } = await abrir({ w, h });
  await entrar(page);
  await page.waitForTimeout(1800);
  // T4 tiene un aviso LISTO; abrimos cualquier mesa para ver la comanda,
  // que es donde vive la banda en el terminal.
  const t = page.locator('[data-testid="table-shape"]').filter({ hasText: /^T2/ }).first();
  await t.scrollIntoViewIfNeeded();
  await t.click();
  await page.waitForTimeout(3000);

  const banda = await page.evaluate(`(() => {
    const b = document.querySelector('[data-testid="listo-banner"]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const filas = [...document.querySelectorAll('[data-testid="listo-banda"]')].map((x) => ({
      texto: (x.textContent||"").trim().slice(0, 60),
      comandas: x.getAttribute("data-comandas"),
      h: Math.round(x.getBoundingClientRect().height),
    }));
    return { modo: b.getAttribute("data-modo"),
      clip: { x: Math.max(0, Math.round(r.x)-8), y: Math.max(0, Math.round(r.y)-8),
              width: Math.round(r.width)+16, height: Math.round(r.height)+16 },
      filas };
  })()`);
  if (!banda) { console.log(`${nombre}: sin banda de avisos`); await browser.close(); continue; }

  await page.screenshot({ path: `shots/listo9-${etiqueta}-${nombre}.png`, clip: banda.clip });
  out[`${nombre}_banda`] = banda;
  console.log(`${etiqueta} · ${nombre} · modo=${banda.modo} · ${JSON.stringify(banda.filas)}`);

  // Y el toque: ¿sirve en el acto o abre la hoja?
  await page.locator('[data-testid="listo-banda"]').first().click();
  await page.waitForTimeout(1200);
  const tras = await page.evaluate(`(() => {
    const hoja = document.querySelector('[data-testid="hoja-listo"]');
    const sigueLaBanda = document.querySelectorAll('[data-testid="listo-banda"]').length;
    if (!hoja) return { hoja: false, sigueLaBanda };
    const r = hoja.getBoundingClientRect();
    const dlg = hoja.querySelector('[role="dialog"]');
    const dr = dlg ? dlg.getBoundingClientRect() : null;
    const hecho = hoja.querySelector('[data-testid="hoja-listo-hecho"]');
    return {
      hoja: true,
      pantallaCompleta: hoja.getAttribute("data-pantalla-completa"),
      dialogo: dr ? { w: Math.round(dr.width), h: Math.round(dr.height) } : null,
      lineas: [...hoja.querySelectorAll('[data-testid="hoja-listo-linea"]')].map(
        (l) => (l.textContent||"").trim().slice(0, 40)),
      hecho: hecho ? { h: Math.round(hecho.getBoundingClientRect().height),
                       texto: (hecho.textContent||"").trim() } : null,
      alergias: (hoja.querySelector('[data-testid="hoja-listo-alergias"]')?.textContent||"").trim(),
      sigueLaBanda,
    };
  })()`);
  out[`${nombre}_tras_tocar`] = tras;
  console.log(`   tras tocar: ${JSON.stringify(tras)}`);
  if (tras.hoja) {
    await page.screenshot({ path: `shots/listo9-${etiqueta}-${nombre}-hoja.png` });
  }
  await browser.close();
}
writeFileSync(`medidas-listo9-${etiqueta}.json`, JSON.stringify(out, null, 1));
