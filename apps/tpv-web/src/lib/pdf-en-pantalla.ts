// clinica-8 (fase B, 18) · ¿PUEDE ESTE APARATO ENSEÑAR UN PDF DENTRO DE
// LA PÁGINA?
//
// Auditoría del 18-10, punto 19: «"Ver ticket" se abre en blanco en
// Android». No es un fallo del ticket ni del generador: el modal pinta
// el PDF con `<embed type="application/pdf">` sobre un `blob:`, y **el
// WebView de Android no trae visor de PDF**. No hay plugin, no hay
// fallback y no hay error: el `<embed>` se queda en un rectángulo
// blanco de 70vh. Lo mismo pasa en Chrome para Android.
//
// ── Por qué se pregunta y no se mira la plataforma ───────────────────
//
// `navigator.pdfViewerEnabled` está en el estándar HTML y contesta
// exactamente esta pregunta: si el navegador va a pintar un PDF en
// lugar de descargarlo. En Chrome y Safari de escritorio es `true`; en
// Android —navegador y WebView— es `false`. Preguntarlo es mejor que
// mirar si somos la APK: el mismo bundle se abre desde un portátil del
// mostrador, desde un iPad y desde el móvil de la dueña, y la respuesta
// es distinta en cada uno por motivos que no son «qué aparato es».
//
// `undefined` (navegadores anteriores a la propiedad, y jsdom) se trata
// como que SÍ: es lo que el TPV hacía hasta este bloque y donde la
// pantalla funcionaba. Un cambio que apagara el visor donde hoy va bien
// sería peor que el fallo que se viene a arreglar.

export function puedeEnseñarPdfIncrustado(
  nav: { pdfViewerEnabled?: boolean } | undefined = typeof navigator ===
  "undefined"
    ? undefined
    : navigator,
): boolean {
  if (!nav) return true;
  if (typeof nav.pdfViewerEnabled !== "boolean") return true;
  return nav.pdfViewerEnabled;
}
