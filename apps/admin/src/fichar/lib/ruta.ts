// F1 · quién decide qué app arranca (ADR-018).
//
// Vive aparte de `main.tsx` a propósito: `main.tsx` es el punto de entrada
// y al importarlo se monta la app entera (Sentry incluido), así que la
// decisión no se podría probar. Aquí es una función pura.
export function esRutaDeFichar(pathname: string): boolean {
  return pathname === "/fichar" || pathname.startsWith("/fichar/");
}
