// La captura que faltaba: una mesa con LISTO en el terminal, antes y
// después, SIN tapar nada. Las cuatro capturas de 0 px tapaban justo
// este elemento, así que la única excepción a la restricción no se veía.
import { abrir, entrar } from "./entrar.mjs";
import { writeFileSync } from "node:fs";

const etiqueta = process.argv[2] || "despues";
const out = {};

for (const [nombre, w, h] of [["AP11", 1280, 800], ["D8", 1442, 811]]) {
  const { browser, page } = await abrir({ w, h });
  await entrar(page);
  await page.waitForTimeout(1800);

  // La caja de la mesa que lleva la etiqueta, con margen para que se vea
  // en su contexto (el relleno de la mesa y el lienzo alrededor).
  const caja = await page.evaluate(`(() => {
    const e = document.querySelector('[data-testid="table-listo"]');
    if (!e) return null;
    const mesa = e.parentElement;
    const r = (mesa || e).getBoundingClientRect();
    const cs = getComputedStyle(e);
    const nombre = mesa ? (mesa.querySelector('[data-testid="table-name"]')?.textContent || "").trim() : "";
    return {
      clip: { x: Math.max(0, Math.round(r.x) - 26), y: Math.max(0, Math.round(r.y) - 26),
              width: Math.round(r.width) + 52, height: Math.round(r.height) + 52 },
      mesa: nombre,
      etiqueta: { color: cs.color, fondo: cs.backgroundColor, px: cs.fontSize,
                  alto: Math.round(e.getBoundingClientRect().height) },
    };
  })()`);

  if (!caja) {
    console.log(`${nombre}: NO hay ninguna mesa con LISTO en pantalla`);
    await browser.close();
    continue;
  }
  await page.screenshot({
    path: `shots/listo-${etiqueta}-${nombre}.png`,
    clip: caja.clip,
  });
  out[nombre] = caja;
  console.log(
    `${etiqueta} · ${nombre} · mesa ${caja.mesa} · etiqueta ${caja.etiqueta.alto} px ` +
      `${caja.etiqueta.px} color ${caja.etiqueta.color} sobre ${caja.etiqueta.fondo}`,
  );
  await browser.close();
}
writeFileSync(`medidas-listo-${etiqueta}.json`, JSON.stringify(out, null, 1));
