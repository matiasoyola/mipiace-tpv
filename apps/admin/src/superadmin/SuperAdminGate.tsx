// Gate de rutas /superadmin/*. Si no hay tokens super-admin, redirige
// al login específico (NO al login per-tenant).

import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

import { readSuperAdminTokens } from "./api.js";

export function SuperAdminGate({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    setAuthed(readSuperAdminTokens() !== null);
  }, []);

  if (authed === null) return null;
  if (!authed) return <Navigate to="/superadmin/login" replace />;
  return <>{children}</>;
}
