// Si la URL trae ?impersonationToken=<jwt>, lo guarda en sessionStorage
// y limpia el query param antes del primer render. Se monta arriba de
// las Routes en App.tsx. Idempotente — si ya hay token guardado, no
// pisa salvo que el de la URL sea distinto (caso "abrir otra
// impersonación").

import { useEffect } from "react";

import { storeImpersonationToken } from "../api.js";

export function ImpersonationBootstrap() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const token = url.searchParams.get("impersonationToken");
    if (!token) return;
    storeImpersonationToken(token);
    url.searchParams.delete("impersonationToken");
    window.history.replaceState({}, "", url.toString());
  }, []);
  return null;
}
