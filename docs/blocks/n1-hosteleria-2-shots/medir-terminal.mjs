import { abrir, entrar } from "./entrar.mjs";
import { writeFileSync } from "node:fs";

const etiqueta = process.argv[2] || "despues";

const TERMINAL = `(() => {
  const doc = document.documentElement;
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect();
    return { y: Math.round(b.y), h: Math.round(b.height), w: Math.round(b.width) }; };
  const mesas = [...document.querySelectorAll('[data-testid="table-shape"]')];
  const dentro = mesas.filter((m) => { const b = m.getBoundingClientRect();
    return b.top >= 0 && b.bottom <= innerHeight; });
  return {
    innerWidth, innerHeight,
    clientWidth: doc.clientWidth, scrollWidth: doc.scrollWidth,
    desbordeHorizontal: doc.scrollWidth > doc.clientWidth,
    altoDePagina: doc.scrollHeight,
    cabecera: r(document.querySelector('[data-testid="room-screen"] header')),
    filasDeMano: document.querySelector('[data-testid="room-header-fila-1"]') ? 2 : 0,
    ladoDeMesa: mesas[0] ? Math.round(mesas[0].getBoundingClientRect().width) : null,
    mesasALaVista: dentro.length, mesasTotal: mesas.length,
    // La cabecera de zona plegable NO debe existir en el terminal.
    cabecerasDeZona: document.querySelectorAll('[data-testid="zone-header"]').length,
    marcoDeZona: [...document.querySelectorAll('[data-testid="zone-frame"]')]
      .map((f) => f.getAttribute("data-con-marco")),
    tintaDeOcupada: (() => {
      const m = [...mesas].find((x) => x.getAttribute("data-state") === "busy");
      if (!m) return null;
      const cs = getComputedStyle(m);
      return { tinta: cs.color, relleno: cs.backgroundColor };
    })(),
    etiquetaListo: (() => {
      const e = document.querySelector('[data-testid="table-listo"]');
      if (!e) return null;
      const cs = getComputedStyle(e);
      return { ...r(e), color: cs.color, fondo: cs.backgroundColor, px: cs.fontSize };
    })(),
  };
})()`;

const VENTA = `(() => {
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect();
    return { y: Math.round(b.y), bottom: Math.round(b.bottom), h: Math.round(b.height) }; };
  const prods = [...document.querySelectorAll('[data-testid="product-button"]')];
  return {
    rejillaDeFamilias: r(document.querySelector('[data-testid="family-bar"]')),
    tira: r(document.querySelector('[data-testid="family-strip"]')),
    filaDeCantidad: r(document.querySelector('[data-testid="qty-row"]')),
    primerProducto: prods[0] ? r(prods[0]) : null,
    productosEnteros: prods.filter((p) => { const b = p.getBoundingClientRect();
      return b.top >= 0 && b.bottom <= innerHeight; }).length,
    productosTotal: prods.length,
    // El pie de la comanda, que este bloque toca SOLO en la mano.
    pie: r(document.querySelector('[data-testid="comanda-pie"]')),
    total: (() => { const e = document.querySelector('[data-testid="comanda-total"]');
      return e ? { ...r(e), px: getComputedStyle(e).fontSize } : null; })(),
    enviar: (() => { const e = document.querySelector('[data-testid="comanda-enviar"]');
      return e ? r(e) : null; })(),
    hoja: document.querySelector('[data-testid="hoja-comanda"]') ? "SI" : "no",
    barraDeMano: document.querySelector('[data-testid="handheld-bar"]') ? "SI" : "no",
  };
})()`;

const out = {};
for (const [nombre, w, h] of [["AP11", 1280, 800], ["D8", 1442, 811]]) {
  const { browser, page } = await abrir({ w, h });
  await entrar(page);
  await page.waitForTimeout(1500);
  // Para el diff del terminal: se tapan los DOS elementos cuyo color
  // cambia este bloque a propósito (la etiqueta LISTO de la mesa y la
  // banda del mismo aviso en la comanda, que iban en blanco sobre verde
  // a 1,66:1). Tapados en las DOS pasadas, lo que quede en el diff es
  // algo que no se declaró.
  if (process.env.TAPAR_LISTO === "1") {
    await page.addStyleTag({
      content:
        '[data-testid="table-listo"],[data-testid="listo-banner"]{visibility:hidden !important}',
    });
    await page.waitForTimeout(300);
  }
  out[`${nombre}_mapa`] = await page.evaluate(TERMINAL);
  await page.screenshot({ path: `shots/${etiqueta}-${nombre}-mapa.png` });
  const t2 = page.locator('[data-testid="table-shape"]').filter({ hasText: /^T2/ }).first();
  await t2.scrollIntoViewIfNeeded(); await t2.click(); await page.waitForTimeout(3000);
  out[`${nombre}_venta`] = await page.evaluate(VENTA);
  await page.screenshot({ path: `shots/${etiqueta}-${nombre}-venta.png` });
  await browser.close();
}
writeFileSync(`medidas-terminal-${etiqueta}.json`, JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out)) {
  console.log(`\n=== ${etiqueta} · ${k}`);
  for (const [kk, vv] of Object.entries(v)) console.log(`  ${kk}: ${JSON.stringify(vv)}`);
}
