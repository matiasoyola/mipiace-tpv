// Los rótulos del vídeo y el ritmo humano.
//
// El rótulo se pinta con un overlay que inyecta el propio spec: un `<div>` en
// el `<body>` y una hoja de estilos aparte. **No se toca la app** — el TPV y
// el admin no saben que están siendo grabados, y el día que se quite el vídeo
// no queda nada que limpiar en producción.
//
// En modo banco (sin `BANCO_VIDEO=1`) los rótulos TAMBIÉN se pintan: cuestan
// nada y hacen legible la captura de un fallo, que es cuando hace falta. Lo
// que sólo pasa en modo vídeo son las PAUSAS: el banco no va a esperar tres
// segundos por paso para decir lo mismo.

import type { Page } from "@playwright/test";

import { MODO_VIDEO } from "../playwright.config.js";

const ID_CAPA = "banco-rotulo";

const CSS = `
#${ID_CAPA} {
  position: fixed; inset: auto 0 0 0; z-index: 2147483647;
  display: flex; flex-direction: column; gap: 6px; align-items: center;
  padding: 18px 24px 26px; pointer-events: none;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  background: linear-gradient(to top, rgba(12,14,20,.92), rgba(12,14,20,0));
  opacity: 0; transition: opacity .35s ease;
}
#${ID_CAPA}[data-visible="1"] { opacity: 1; }
#${ID_CAPA} .cap {
  font-size: 13px; letter-spacing: .14em; text-transform: uppercase;
  color: #ffb199; font-weight: 600;
}
#${ID_CAPA} .txt {
  font-size: 26px; line-height: 1.25; color: #fff; font-weight: 600;
  text-align: center; max-width: 88%;
  text-shadow: 0 2px 12px rgba(0,0,0,.55);
}
/* La portada: tapa la pantalla entera. */
#${ID_CAPA}[data-portada="1"] {
  inset: 0; justify-content: center; background: #0c0e14;
}
#${ID_CAPA}[data-portada="1"] .txt { font-size: 52px; max-width: 70%; }
`;

async function asegurarCapa(page: Page): Promise<void> {
  const yaEsta = await page.locator(`#${ID_CAPA}`).count();
  if (yaEsta > 0) return;
  await page.addStyleTag({ content: CSS });
  await page.evaluate((id) => {
    const capa = document.createElement("div");
    capa.id = id;
    capa.innerHTML = '<div class="cap"></div><div class="txt"></div>';
    document.body.appendChild(capa);
  }, ID_CAPA);
}

/** Una espera que sólo existe grabando. */
export async function latido(page: Page, ms = 900): Promise<void> {
  if (!MODO_VIDEO) return;
  await page.waitForTimeout(ms);
}

/**
 * Pinta un rótulo. `capitulo` es la línea pequeña de arriba («Capítulo 6 ·
 * Reservar»), `texto` la frase que explica el paso.
 */
export async function rotulo(
  page: Page,
  texto: string,
  capitulo?: string,
): Promise<void> {
  await asegurarCapa(page);
  await page.evaluate(
    ({ id, texto, capitulo }) => {
      const capa = document.getElementById(id);
      if (!capa) return;
      capa.removeAttribute("data-portada");
      (capa.querySelector(".cap") as HTMLElement).textContent = capitulo ?? "";
      (capa.querySelector(".txt") as HTMLElement).textContent = texto;
      capa.setAttribute("data-visible", "1");
    },
    { id: ID_CAPA, texto, capitulo: capitulo ?? "" },
  );
  await latido(page, 1400);
}

/** La portada de un capítulo (o del vídeo entero): pantalla completa. */
export async function portada(
  page: Page,
  texto: string,
  capitulo?: string,
): Promise<void> {
  await asegurarCapa(page);
  await page.evaluate(
    ({ id, texto, capitulo }) => {
      const capa = document.getElementById(id);
      if (!capa) return;
      (capa.querySelector(".cap") as HTMLElement).textContent = capitulo ?? "";
      (capa.querySelector(".txt") as HTMLElement).textContent = texto;
      capa.setAttribute("data-portada", "1");
      capa.setAttribute("data-visible", "1");
    },
    { id: ID_CAPA, texto, capitulo: capitulo ?? "" },
  );
  await latido(page, 2600);
  await esconder(page);
}

/**
 * Quita el rótulo de en medio, y le BORRA el texto.
 *
 * Borrarlo no es cosmético: el rótulo vive en el DOM, y un `getByText` del
 * propio spec lo encuentra igual que si fuera de la app. Un rótulo que decía
 * «Cerrar el día» hizo fallar la comprobación de la pantalla que dice
 * «Cerrar el día» — el banco se estaba leyendo a sí mismo. Al esconderlo se
 * vacía, y así ningún rótulo viejo puede volver a mentir.
 */
export async function esconder(page: Page): Promise<void> {
  await page.evaluate((id) => {
    const capa = document.getElementById(id);
    if (!capa) return;
    capa.setAttribute("data-visible", "0");
    const cap = capa.querySelector(".cap");
    const txt = capa.querySelector(".txt");
    if (cap) cap.textContent = "";
    if (txt) txt.textContent = "";
  }, ID_CAPA);
  await latido(page, 450);
}
