import { abrir, entrar } from "./entrar.mjs";
import { writeFileSync } from "node:fs";

const MAPA = `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const rect = (e) => { const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const doc = document.documentElement;
  const enElPunto = (e) => {
    const r = e.getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return "FUERA DE PANTALLA";
    const hit = document.elementFromPoint(cx, cy);
    if (!hit) return "NADA";
    return e === hit || e.contains(hit) ? "EL" : (hit.getAttribute("data-testid") || hit.tagName + "." + (hit.className||"").toString().slice(0,30));
  };
  const zonas = [...document.querySelectorAll('[data-testid="zone-header"]')].map((z) => ({
    zona: z.getAttribute("data-zone"),
    plegada: z.getAttribute("data-plegada"),
    ...rect(z),
    resumen: (z.querySelector('[data-testid="zone-header-resumen"]')?.textContent || "").trim(),
    enElPunto: enElPunto(z),
  }));
  const mesas = [...document.querySelectorAll('[data-testid="table-shape"]')].map((m) => {
    const r = m.getBoundingClientRect();
    return {
      nombre: (m.querySelector('[data-testid="table-name"]')?.textContent || "").trim(),
      estado: m.getAttribute("data-state"),
      tarde: m.getAttribute("data-late"),
      lista: m.getAttribute("data-lista"),
      ...rect(m),
      enteraEnPantalla: r.top >= 0 && r.bottom <= innerHeight,
    };
  });
  // Todo lo que se toca, con su tamaño real.
  const objetivos = [...document.querySelectorAll("button,[role=button]")].filter(vis).map((b) => {
    const r = b.getBoundingClientRect();
    return {
      que: (b.getAttribute("data-testid") || b.getAttribute("aria-label") || (b.textContent||"").trim()).slice(0, 34),
      w: Math.round(r.width), h: Math.round(r.height),
      min: Math.round(Math.min(r.width, r.height)),
      dentro: r.top >= 0 && r.bottom <= innerHeight,
    };
  });
  const banda = document.querySelector('[data-testid="ensayo-banner"]');
  return {
    innerWidth, innerHeight,
    clientWidth: doc.clientWidth, scrollWidth: doc.scrollWidth,
    altoDePagina: doc.scrollHeight,
    desbordeHorizontal: doc.scrollWidth > doc.clientWidth,
    bandaEnsayo: banda ? rect(banda) : null,
    cabecera: rect(document.querySelector('[data-testid="room-screen"] header')),
    zonas,
    marcosConMarco: [...document.querySelectorAll('[data-testid="zone-frame"]')]
      .map((f) => f.getAttribute("data-con-marco")),
    mesas,
    mesasALaVista: mesas.filter((m) => m.enteraEnPantalla).length,
    mesasTotal: mesas.length,
    ladoDeMesa: mesas[0] ? mesas[0].w : null,
    objetivosPorDebajoDe48: objetivos.filter((o) => o.dentro && o.min < 48),
    objetivoMasPequeno: objetivos.filter((o) => o.dentro).sort((a, b) => a.min - b.min)[0],
    etiquetaListo: (() => {
      const e = document.querySelector('[data-testid="table-listo"]');
      if (!e) return null;
      const cs = getComputedStyle(e);
      return { ...rect(e), color: cs.color, fondo: cs.backgroundColor, px: cs.fontSize, enElPunto: enElPunto(e) };
    })(),
    coloresPorEstado: (() => {
      const out = {};
      for (const m of document.querySelectorAll('[data-testid="table-shape"]')) {
        const st = m.getAttribute("data-state");
        if (out[st]) continue;
        const cs = getComputedStyle(m);
        out[st] = { tinta: cs.color, relleno: cs.backgroundColor };
      }
      return out;
    })(),
  };
})()`;

const { browser, page } = await abrir({ w: 360, h: 720 });
await entrar(page);
await page.waitForTimeout(1500);

const todo = {};
todo.n1_todo_abierto = await page.evaluate(MAPA);
await page.screenshot({ path: "shots/10-mapa-servicio-abierto.png" });

// Plegamos SALÓN y TERRAZA, que es el gesto del hallazgo 2.
for (const z of ["SALON", "TERRAZA"]) {
  await page.locator(`[data-testid="zone-header"][data-zone="${z}"]`).click();
  await page.waitForTimeout(400);
}
todo.n1_salon_y_terraza_plegadas = await page.evaluate(MAPA);
await page.screenshot({ path: "shots/11-mapa-dos-plegadas.png" });

// Y las tres, que es «la sala entera de un vistazo».
await page.locator('[data-testid="zone-header"][data-zone="BARRA"]').click();
await page.waitForTimeout(400);
todo.n1_tres_plegadas = await page.evaluate(MAPA);
await page.screenshot({ path: "shots/12-mapa-tres-plegadas.png" });

// ¿Se recuerda? Recargamos.
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await entrar(page);
await page.waitForTimeout(1500);
todo.n1_tras_recargar = await page.evaluate(MAPA);
await page.screenshot({ path: "shots/13-mapa-tras-recargar.png" });

writeFileSync("medidas-mapa.json", JSON.stringify(todo, null, 1));
for (const [k, v] of Object.entries(todo)) {
  console.log(`\n=== ${k}`);
  console.log(` innerWidth ${v.innerWidth} · scrollWidth ${v.scrollWidth} · desborde ${v.desbordeHorizontal}`);
  console.log(` alto de pagina ${v.altoDePagina} (ventana ${v.innerHeight}) · banda ensayo ${v.bandaEnsayo ? v.bandaEnsayo.h : 0}`);
  console.log(` cabecera ${v.cabecera.h} · lado de mesa ${v.ladoDeMesa}`);
  console.log(` mesas a la vista ${v.mesasALaVista}/${v.mesasTotal} · marcos con-marco ${JSON.stringify(v.marcosConMarco)}`);
  for (const z of v.zonas) console.log(`   zona ${z.zona} plegada=${z.plegada} h=${z.h} y=${z.y} toque=${z.enElPunto} «${z.resumen}»`);
  console.log(` objetivo mas pequeno: ${JSON.stringify(v.objetivoMasPequeno)}`);
  console.log(` por debajo de 48: ${v.objetivosPorDebajoDe48.length} ${JSON.stringify(v.objetivosPorDebajoDe48.slice(0,6))}`);
  if (v.etiquetaListo) console.log(` LISTO ${v.etiquetaListo.w}x${v.etiquetaListo.h} ${v.etiquetaListo.px} color ${v.etiquetaListo.color} fondo ${v.etiquetaListo.fondo} toque=${v.etiquetaListo.enElPunto}`);
  console.log(` colores ${JSON.stringify(v.coloresPorEstado)}`);
}
await browser.close();
