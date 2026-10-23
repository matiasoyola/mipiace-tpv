import { abrir, entrar } from "./entrar.mjs";
import { writeFileSync } from "node:fs";

const COMANDA = `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const rect = (e) => { if (!e) return null; const r = e.getBoundingClientRect();
    return { y: Math.round(r.y), bottom: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width) }; };
  const enElPunto = (e) => {
    if (!e) return null;
    const r = e.getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return "FUERA DE PANTALLA";
    const hit = document.elementFromPoint(cx, cy);
    if (!hit) return "NADA";
    return e === hit || e.contains(hit) ? "EL" : (hit.getAttribute("data-testid") || hit.tagName);
  };
  const hoja = document.querySelector('[data-testid="hoja-comanda"]');
  const lista = document.querySelector('[data-testid="comanda-lineas"]');
  const lineas = lista ? [...lista.children].filter(vis).filter((c) => c.getBoundingClientRect().height > 20) : [];
  // ¿CUANTAS CAPAS SE VEN A LA VEZ? R1 pide una.
  //
  // Se mide por lo que asoma de la capa de debajo: si la hoja no cubre
  // la pantalla, lo que queda arriba y abajo es la venta.
  const hr = hoja ? hoja.getBoundingClientRect() : null;
  const asoma = hr
    ? { arriba: Math.round(Math.max(0, hr.top)), abajo: Math.round(Math.max(0, innerHeight - hr.bottom)) }
    : null;
  const objetivos = [...(hoja || document).querySelectorAll("button")].filter(vis).map((b) => {
    const r = b.getBoundingClientRect();
    return {
      que: (b.getAttribute("data-testid") || b.getAttribute("aria-label") || (b.textContent||"").trim()).slice(0, 32),
      w: Math.round(r.width), h: Math.round(r.height), min: Math.round(Math.min(r.width, r.height)),
      dentro: r.top >= 0 && r.bottom <= innerHeight,
      enElPunto: enElPunto(b),
    };
  });
  return {
    innerWidth, innerHeight,
    hoja: rect(hoja),
    hojaPantallaCompleta: hoja ? hoja.getAttribute("data-pantalla-completa") : null,
    capaDeDebajoAsoma: asoma,
    cerrar: (() => { const b = document.querySelector('[data-testid="hoja-comanda-cerrar"]');
      return b ? { ...rect(b), min: Math.round(Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height)), enElPunto: enElPunto(b) } : null; })(),
    avisos: (() => {
      const b = document.querySelector('[data-testid="listo-banner"]');
      const c = document.querySelector('[data-testid="listo-contador"]');
      return {
        modo: b ? b.getAttribute("data-modo") : null,
        bloque: rect(b),
        contador: c ? { ...rect(c), cuantos: c.getAttribute("data-avisos"), texto: (c.textContent||"").trim(), enElPunto: enElPunto(c) } : null,
        bandas: [...document.querySelectorAll('[data-testid="listo-banda"]')].length,
      };
    })(),
    listaDeLineas: rect(lista),
    lineas: lineas.map((l) => ({ ...rect(l), texto: (l.textContent||"").trim().slice(0, 34),
      entera: l.getBoundingClientRect().top >= (lista.getBoundingClientRect().top - 1) &&
              l.getBoundingClientRect().bottom <= (lista.getBoundingClientRect().bottom + 1) })),
    lineasVisiblesEnteras: lineas.filter((l) => {
      const lr = l.getBoundingClientRect(), cr = lista.getBoundingClientRect();
      return lr.top >= cr.top - 1 && lr.bottom <= cr.bottom + 1;
    }).length,
    lineasTotal: lineas.length,
    listaDesplaza: lista ? lista.scrollHeight > lista.clientHeight + 1 : null,
    desbordeDeLaLista: lista ? Math.round(lista.scrollHeight - lista.clientHeight) : null,
    objetivosPorDebajoDe48: objetivos.filter((o) => o.dentro && o.min < 48),
    objetivos: objetivos.slice(0, 18),
    filaDeCantidad: rect(document.querySelector('[data-testid="qty-row"]')),
  };
})()`;

const { browser, page } = await abrir({ w: 360, h: 720 });
await entrar(page);
await page.waitForTimeout(1200);

const out = {};
// T2 es la mesa con la comanda de SEIS líneas y el urgente con alergia.
// Está en TERRAZA, bajo el pliegue: `click()` la desplaza a la vista.
const t2 = page.locator('[data-testid="table-shape"]').filter({ hasText: /^T2/ }).first();
await t2.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await t2.click();
await page.waitForTimeout(3000);
await page.screenshot({ path: "shots/20-venta-t2.png" });
out.venta_sin_hoja = await page.evaluate(COMANDA);

// Abrimos la comanda, que es «la previa» del hallazgo 1.
await page.locator('[data-testid="handheld-bar"] button[aria-label="Abrir la comanda"]').click();
await page.waitForTimeout(1200);
await page.screenshot({ path: "shots/21-comanda-6-lineas.png" });
out.comanda_abierta = await page.evaluate(COMANDA);

// El contador de avisos, desplegado: la lista en su propia capa.
const contador = page.locator('[data-testid="listo-contador"]');
if (await contador.count()) {
  await contador.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "shots/22-avisos-desplegados.png" });
  out.avisos_desplegados = await page.evaluate(COMANDA);
  await page.locator('[data-testid="listo-lista-cerrar"]').click();
  await page.waitForTimeout(600);
}

// El atrás de Android cierra la hoja (hallazgo 6) y NO saca de la mesa.
await page.goBack();
await page.waitForTimeout(1200);
out.tras_atras = await page.evaluate(COMANDA);
out.tras_atras.sigueEnLaVenta = await page.evaluate(
  `document.querySelector('[data-testid="handheld-bar"]') != null`,
);
await page.screenshot({ path: "shots/23-tras-atras.png" });

writeFileSync("medidas-comanda.json", JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out)) {
  console.log(`\n=== ${k}  (ventana ${v.innerWidth}x${v.innerHeight})`);
  console.log(` hoja ${JSON.stringify(v.hoja)} pantallaCompleta=${v.hojaPantallaCompleta}`);
  console.log(` capa de debajo asoma: ${JSON.stringify(v.capaDeDebajoAsoma)}`);
  console.log(` cerrar ${JSON.stringify(v.cerrar)}`);
  console.log(` avisos modo=${v.avisos.modo} bloque=${JSON.stringify(v.avisos.bloque)} bandas=${v.avisos.bandas}`);
  if (v.avisos.contador) console.log(`   contador ${v.avisos.contador.h}px «${v.avisos.contador.texto}» toque=${v.avisos.contador.enElPunto}`);
  console.log(` lista ${JSON.stringify(v.listaDeLineas)} desplaza=${v.listaDesplaza} desborde=${v.desbordeDeLaLista}`);
  console.log(` lineas enteras ${v.lineasVisiblesEnteras}/${v.lineasTotal}`);
  for (const l of v.lineas) console.log(`   ${l.entera ? "si" : "NO"} ${String(l.y).padStart(4)}..${String(l.bottom).padStart(4)} «${l.texto}»`);
  console.log(` fila de cantidad: ${v.filaDeCantidad ? JSON.stringify(v.filaDeCantidad) : "NO SE PINTA"}`);
  console.log(` objetivos < 48: ${JSON.stringify(v.objetivosPorDebajoDe48)}`);
  if (v.sigueEnLaVenta !== undefined) console.log(` sigue en la venta: ${v.sigueEnLaVenta}`);
}
await browser.close();
