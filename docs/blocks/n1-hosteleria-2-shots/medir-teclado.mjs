import { abrir, entrar } from "./entrar.mjs";
import { writeFileSync } from "node:fs";

const BUSCANDO = `(() => {
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect();
    return { y: Math.round(b.y), bottom: Math.round(b.bottom), h: Math.round(b.height) }; };
  const enElPunto = (e) => {
    if (!e) return null;
    const b = e.getBoundingClientRect();
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return "FUERA DE PANTALLA";
    const hit = document.elementFromPoint(cx, cy);
    return !hit ? "NADA" : (e === hit || e.contains(hit) ? "EL" : (hit.getAttribute("data-testid") || hit.tagName));
  };
  const prods = [...document.querySelectorAll('[data-testid="product-button"]')];
  const rejilla = document.querySelector('[data-testid="family-bar"]');
  const tira = document.querySelector('[data-testid="family-strip"]');
  const qty = document.querySelector('[data-testid="qty-row"]');
  const buscador = document.querySelector('[data-testid="product-grid"]')
    ? document.querySelector('[data-testid="comanda-chrome"]')
    : null;
  return {
    ventana: { w: innerWidth, h: innerHeight },
    buscador: r(buscador),
    rejillaDeFamilias: r(rejilla),
    tira: r(tira),
    filaDeCantidad: r(qty),
    primerProducto: prods[0] ? { ...r(prods[0]), enElPunto: enElPunto(prods[0]),
      texto: (prods[0].textContent||"").trim().slice(0,28) } : null,
    productosEnteros: prods.filter((p) => { const b = p.getBoundingClientRect();
      return b.top >= 0 && b.bottom <= innerHeight; }).length,
    productosTotal: prods.length,
  };
})()`;

const out = {};
for (const h of [720, 449]) {
  const { browser, page } = await abrir({ w: 360, h });
  await entrar(page);
  await page.waitForTimeout(1200);
  const t2 = page.locator('[data-testid="table-shape"]').filter({ hasText: /^T2/ }).first();
  await t2.scrollIntoViewIfNeeded(); await t2.click(); await page.waitForTimeout(3000);
  out[`n1_${h}_entrada`] = await page.evaluate(BUSCANDO);
  await page.screenshot({ path: `shots/30-venta-${h}.png` });
  // Buscamos «tost», que es la medida de la pasada. El campo de la mano
  // es el input OCULTO del lector USB-HID (aria-hidden, 62 px de ancho):
  // no se puede clicar, pero enfocado recibe las teclas igual, que es
  // justamente para lo que está.
  const hayCampo = await page.evaluate(
    `(() => { const i = document.querySelector('input[type=search]'); if (!i) return false; i.focus(); return true; })()`,
  );
  if (hayCampo) {
    await page.keyboard.type("tost", { delay: 60 });
    await page.waitForTimeout(1400);
    out[`n1_${h}_buscando_tost`] = await page.evaluate(BUSCANDO);
    await page.screenshot({ path: `shots/31-buscando-tost-${h}.png` });
  }
  await browser.close();
}
writeFileSync("medidas-teclado.json", JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out)) {
  console.log(`\n=== ${k} (ventana ${v.ventana.w}x${v.ventana.h})`);
  console.log(` buscador ${JSON.stringify(v.buscador)}`);
  console.log(` rejilla ${v.rejillaDeFamilias ? JSON.stringify(v.rejillaDeFamilias) : "NO"} · tira ${v.tira ? JSON.stringify(v.tira) : "NO"}`);
  console.log(` fila de cantidad: ${v.filaDeCantidad ? JSON.stringify(v.filaDeCantidad) : "NO SE PINTA"}`);
  console.log(` primer producto ${v.primerProducto ? `${v.primerProducto.y}..${v.primerProducto.bottom} toque=${v.primerProducto.enElPunto} «${v.primerProducto.texto}»` : "ninguno"}`);
  console.log(` productos enteros ${v.productosEnteros}/${v.productosTotal}`);
}
