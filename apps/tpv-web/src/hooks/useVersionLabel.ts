// A3-distribución · Frente 2 · etiqueta de versión para el menú del cajero.
//
// Arranca con lo que se sabe sin esperar a nadie (el hash, que es síncrono) y
// completa con la versión nativa cuando el puente responde. Así el menú nunca
// pinta un hueco vacío mientras se resuelve la promesa.

import { useEffect, useState } from "react";

import {
  formatVersionLabel,
  getNativeAppInfo,
  readBuildHash,
} from "../platform/AppInfo.js";

export function useVersionLabel(): string {
  const [label, setLabel] = useState<string>(() =>
    formatVersionLabel(null, readBuildHash()),
  );

  useEffect(() => {
    let cancelled = false;
    void getNativeAppInfo().then((info) => {
      if (cancelled || !info) return;
      setLabel(formatVersionLabel(info, readBuildHash()));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return label;
}
