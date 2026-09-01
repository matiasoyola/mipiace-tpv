// A3-distribución · Frente 2 · etiqueta de versión para el menú del cajero.
//
// Arranca con lo que se sabe sin esperar a nadie (el hash y la marca de
// bundle, que son síncronos) y completa con la versión nativa cuando el
// puente responde. Así el menú nunca pinta un hueco vacío mientras se
// resuelve la promesa.
//
// A4: `isForeignBundle()` se evalúa en las DOS ramas. Si el JS en ejecución
// no es el de la APK, el aviso aparece desde el primer pintado y no espera al
// bridge — que es justo el escenario en que algo va mal.

import { useEffect, useState } from "react";

import {
  formatVersionLabel,
  getNativeAppInfo,
  isForeignBundle,
  readBuildHash,
} from "../platform/AppInfo.js";

export function useVersionLabel(): string {
  const [label, setLabel] = useState<string>(() =>
    formatVersionLabel(null, readBuildHash(), isForeignBundle()),
  );

  useEffect(() => {
    let cancelled = false;
    void getNativeAppInfo().then((info) => {
      if (cancelled || !info) return;
      setLabel(formatVersionLabel(info, readBuildHash(), isForeignBundle()));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return label;
}
