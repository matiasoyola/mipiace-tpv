// residencia-4 (D-66) · LA GUARDIA GUARDADA EN EL MÓVIL.
//
// Sólo el token y quién lo lleva. **Nada de avisos y nada de residentes**:
// un móvil de guardia es un teléfono personal que puede perderse en un
// bar, y lo que no se guarda no se pierde. La puerta sí cachea el plan de
// dos residentes porque sin eso no puede registrar sin red; aquí no hay
// nada que hacer sin red — un aviso que no ha llegado no se puede acusar.
//
// ── POR QUÉ SOBREVIVE A CERRAR LA APP ───────────────────────────────
//
// Porque la guardia dura un turno y la app se va a segundo plano cien
// veces. Si el token muriera con la pantalla, la enfermera tendría que
// teclear su PIN cada vez que vuelve al móvil — y el aviso de las cuatro
// de la mañana llegaría a una pantalla de PIN.
//
// Lo que esto NO abre: el token solo no vale. Las rutas exigen además el
// `X-Device-Token`, y la sesión está atada a ESTE móvil
// (`requireGuardiaSesion`).

const SESION_KEY = "mipiacetpv-guardia-sesion";

export interface SesionDeGuardia {
  token: string;
  /** ms epoch. El servidor manda el TTL; aquí ya resuelto. */
  expiraEn: number;
  guardiaId: string;
  canal: "ENFERMERIA" | "RESPONSABLE";
  userId: string;
  nombre: string;
  careRoleAssignmentId: string;
  rolCode: string;
  rolName: string;
  turno: string | null;
}

export function guardarSesionDeGuardia(s: SesionDeGuardia): void {
  try {
    localStorage.setItem(SESION_KEY, JSON.stringify(s));
  } catch {
    /* sin almacenamiento: la guardia vive en memoria y se vuelve a
       teclear el PIN al recargar. */
  }
}

/** La guardia guardada, o `null` si no hay o ya caducó. */
export function leerSesionDeGuardia(): SesionDeGuardia | null {
  const raw = localStorage.getItem(SESION_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as SesionDeGuardia;
    if (typeof s.token !== "string" || s.expiraEn <= Date.now()) {
      localStorage.removeItem(SESION_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function olvidarGuardia(): void {
  try {
    localStorage.removeItem(SESION_KEY);
  } catch {
    /* ya no estaba */
  }
}
