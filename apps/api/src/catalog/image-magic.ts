// v1.2-Lite-fix1 Bug-Imagenes-Holded: re-export del detector puro que
// vive en `packages/holded-client` para que cualquier consumidor del
// API server pueda usarlo sin importar al package de Holded directo.
// La lógica real (y sus tests) están en
// `packages/holded-client/src/image-magic.ts` — el spike empírico que
// motiva esto está documentado en
// `docs/auditorias/bug-imagenes-holded.md`.

export {
  detectImageMime,
  extFromDetectedMime,
  type DetectedImageMime,
} from "@mipiacetpv/holded-client";
