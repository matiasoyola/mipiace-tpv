// v1.22-el-terminal-del-bar · §3 (hallazgos B4, N3 y N5 de la auditoría
// del 2026-10-06, y B4 de la del 02-09: lleva dos auditorías vivo).
//
// El problema, medido en el AP13: el nombre de la línea del ticket tenía
// 86–100 px y UNA línea con `truncate`, así que en la carta de La
// Maestranza dos productos de distinto precio se leían igual DESPUÉS de
// pulsarlos:
//
//   Hamburguesa normal   →  "Hamburgu…"
//   Hamburguesa especial →  "Hamburgu…"
//   Bocadillo / Bocadillo especial, Montado / Montado especial: igual.
//
// Lo que distingue a esos pares está al FINAL, que es justo lo que corta
// una elipsis por el final. De ahí las dos decisiones:
//
//   1. Dos líneas, no una. Duplica la capacidad sin coste de alto: la
//      fila del ticket se mide por sus objetivos táctiles (48 px), no
//      por el texto.
//   2. Si aun así hay que cortar, se corta por el MEDIO. Con cabeza y
//      cola, "Johnnie Walker Etiqueta Negra" y "Johnnie Walker Etiqueta
//      Roja" siguen siendo distintas aunque ninguna entre completa —
//      por el final las dos serían "Johnnie Walker Etiqueta…".
//
// Por qué se ESTIMA el ancho en vez de medirlo en el DOM: la misma razón
// que `chipRows.ts` documenta para los chips. Medir obliga a un render
// de dos pasadas (pintar, medir `scrollHeight`, repintar cortado) que
// parpadea y que puede oscilar —al cortar, el texto cabe, así que se
// vuelve a pintar entero—, y en jsdom no hay layout, así que la regla no
// sería testeable sin navegador. Con una estimación el corte es una
// función pura del ancho de la caja y de la etiqueta.
//
// Qué se estima, y por qué NO basta un presupuesto de caracteres: la
// primera versión de este módulo dividía ancho × líneas entre el ancho
// medio de carácter, y en la primera captura del bucle visual salió
// "Tostada de jamón…rk y…" — cortado DOS veces, primero por el medio
// aquí y luego por el final por el `line-clamp` de CSS, que es
// exactamente el fallo que el módulo venía a arreglar. El presupuesto
// plano ignora que el texto se ajusta POR PALABRAS y que cada salto deja
// una línea corta. Lo que se simula aquí es el ajuste entero.

/** Dos líneas. Es también el `line-clamp` del componente. */
export const LINE_NAME_MAX_LINES = 2;

/**
 * Ancho útil de la caja del nombre en el panel del ticket, en px.
 *
 * Medido en el navegador a 1443 × 812 (el D8) y a 1280 × 800 (el AP11)
 * con el reparto de la línea de este bloque: la lista del panel da
 * 302 px de contenido, de los que se llevan el stepper (48 + 26 + 48),
 * la papelera (48) y los dos huecos de `gap-2.5` (20).
 *
 * El mismo número en los dos terminales: el panel del ticket es de ancho
 * fijo (360 px), y lo que cambia entre el D8 y el AP11 es el ALTO.
 */
export const LINE_NAME_BOX_WIDTH = 112;

/**
 * Ancho medio de carácter de DM Sans a 14,5 px / peso 500, en px.
 *
 * NO es el ancho medio real (que medido sobre la carta de La Maestranza
 * sale ~8,1): es el mayor valor con el que el ajuste simulado de
 * `wrapLines` **nunca subestima** las líneas que ocupa un nombre en el
 * navegador. Calibrado contra los 128 nombres de la carta con el DOM
 * real: a 7,5 son 0 subestimaciones y 13 sobrestimaciones de 128; a 7,2
 * aparecen 4 subestimaciones, y una subestimación es un nombre que el
 * CSS corta por el final después de que esta función lo haya cortado
 * por el medio.
 *
 * El error tiene dos lados y no valen lo mismo, igual que en
 * `chipRows.ts` pero al revés: sobrestimar recorta un nombre que habría
 * cabido entero —y aun así se lee, porque conserva cabeza y cola—;
 * subestimar le quita la cola, que es la parte que distingue.
 */
export const LINE_NAME_CHAR_WIDTH = 7.5;

/**
 * Cuántas líneas ocupa un texto en una caja de `boxWidth`, simulando el
 * ajuste por palabras del navegador.
 *
 * Una palabra más larga que la caja entera se parte (`overflow-wrap:
 * break-word` en el componente), de ahí el `Math.ceil`.
 */
export function wrapLines(
  text: string,
  boxWidth: number = LINE_NAME_BOX_WIDTH,
  charWidth: number = LINE_NAME_CHAR_WIDTH,
): number {
  const t = (text ?? "").trim();
  if (t === "" || boxWidth <= 0 || charWidth <= 0) return 1;

  let lines = 1;
  let used = 0;
  for (const word of t.split(/\s+/)) {
    const w = wordWidth(word, charWidth);
    // El espacio que separa de lo ya escrito cuenta como un carácter.
    const need = used === 0 ? w : used + charWidth + w;
    if (need <= boxWidth) {
      used = need;
      continue;
    }
    if (w <= boxWidth) {
      lines += 1;
      used = w;
      continue;
    }
    // Palabra que no cabe ni sola: se parte en `ceil` trozos, no en
    // `floor`. Con `floor` el modelo decía dos líneas donde el navegador
    // pintaba tres, y "Croissant mermela…mantequilla" salía cortado otra
    // vez por el final.
    //
    // Si la línea en curso está VACÍA, la palabra empieza en ella y no
    // en una nueva: de ahí el `- 1`.
    const chunks = Math.ceil(w / boxWidth);
    lines += used === 0 ? chunks - 1 : chunks;
    used = w - (chunks - 1) * boxWidth;
  }
  return lines;
}

/**
 * La elipsis cuenta doble. Es un glifo ancho (tres puntos con sus
 * huecos) y aparece justo en las palabras que ya van al límite: las que
 * este módulo acaba de fusionar al cortar por el medio.
 */
function wordWidth(word: string, charWidth: number): number {
  const extra = word.includes("…") ? 1 : 0;
  return (word.length + extra) * charWidth;
}

/**
 * Corta por el medio dejando cabeza y cola.
 *
 * El reparto del presupuesto no es a mitades: la cola se lleva el 40 %
 * porque es donde viven los calificativos que distinguen la carta de un
 * bar ("especial", "con queso", "tercio", "botellín", "Etiqueta Roja"),
 * y la cabeza el resto porque es por donde se reconoce el producto. Con
 * 50/50 la cabeza se queda en dos palabras y la línea deja de decir qué
 * es.
 */
export function truncateMiddle(name: string, maxChars: number): string {
  const n = (name ?? "").trim();
  if (maxChars <= 0 || n.length <= maxChars) return n;
  if (maxChars <= 4) return n.slice(0, Math.max(0, maxChars - 1)) + "…";

  const budget = maxChars - 1; // la elipsis ocupa su sitio
  const tail = Math.max(1, Math.round(budget * 0.4));
  const head = budget - tail;
  // Un espacio pegado a la elipsis se lee como un error de maquetación.
  return n.slice(0, head).trimEnd() + "…" + n.slice(n.length - tail).trimStart();
}

/**
 * El nombre tal y como se LEE en la línea del ticket.
 *
 * Si cabe en las dos líneas, va entero: sólo se recorta lo que de verdad
 * no entra (6 nombres de los 128 de la carta de La Maestranza, más los
 * 13 que la estimación deja fuera por prudencia). Si no cabe, se le va
 * quitando presupuesto hasta que el ajuste simulado lo mete en dos
 * líneas — así el corte no depende de adivinar el presupuesto exacto.
 */
export function lineNameDisplay(
  name: string,
  boxWidth: number = LINE_NAME_BOX_WIDTH,
  maxLines: number = LINE_NAME_MAX_LINES,
  charWidth: number = LINE_NAME_CHAR_WIDTH,
): string {
  const n = (name ?? "").trim();
  if (wrapLines(n, boxWidth, charWidth) <= maxLines) return n;

  // Techo del presupuesto: lo que cabría si no se perdiera nada en los
  // saltos de línea. A partir de ahí se baja de uno en uno.
  let budget = Math.floor((boxWidth * maxLines) / charWidth);
  while (budget > 4) {
    const candidate = truncateMiddle(n, budget);
    if (wrapLines(candidate, boxWidth, charWidth) <= maxLines) return candidate;
    budget -= 1;
  }
  return truncateMiddle(n, 4);
}
