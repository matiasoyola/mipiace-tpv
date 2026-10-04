// B-Hardening B · U1: traducción humana de error codes que devuelve
// la API en {error, message}. Si la API ya viene con un `message`
// claro (suele venir), lo usamos tal cual. Si solo viene `error`
// (código), lo mapeamos aquí para que el implantador no vea
// "HOLDED_RATE_LIMITED" sino "Holded ha limitado la frecuencia de
// peticiones. Inténtalo en unos minutos."
//
// El map es defensivo: si el código no está, devuelve el código tal
// cual (o un fallback) — así no rompemos nada para errores futuros.

export const ERROR_LABEL: Record<string, string> = {
  // --- Holded API errors ---
  HOLDED_API_KEY_INVALID:
    "La API key de Holded ya no es válida. Pide al cliente una nueva en Holded → Configuración → Más → Desarrolladores.",
  // holded-pat · la clave nueva de Holded (`pat_…`) no sirve: no autentica
  // contra la API v1, que es la única que habla esta versión del TPV. Se
  // dice qué clave hace falta y dónde se saca, porque el implantador lo
  // lee delante del cliente.
  HOLDED_API_KEY_V1_REQUIRED:
    "Esa clave es un API Token nuevo de Holded (empieza por «pat_») y esta versión del TPV necesita una API Key v1. Genérala en Holded → Configuración → Más → Desarrolladores y pega esa.",
  // No es que Holded no responda: responde algo que no esperábamos. Se
  // separa de HOLDED_UNREACHABLE para no mandar a nadie a mirar la red.
  HOLDED_UNEXPECTED_STATUS:
    "Holded ha respondido algo inesperado. Reintenta y, si sigue, avisa a Mi Piace.",
  HOLDED_SUSPENDED:
    "La cuenta Holded del cliente está suspendida. Tiene que regularizarla con Holded antes de seguir.",
  HOLDED_INVALID_RESPONSE:
    "Holded ha devuelto una respuesta inesperada. Si persiste, revisa el estado del servicio.",
  HOLDED_UNREACHABLE:
    "No conseguimos contactar con Holded (red, timeout o caída suya). Reintenta en unos minutos.",
  HOLDED_RATE_LIMITED:
    "Holded está limitando peticiones. La próxima sincronización irá un poco más lenta.",
  NO_HOLDED_KEY:
    "Esta cuenta aún no tiene API key de Holded configurada.",
  // holded-desconectar (ADR-020) · los dos motivos que NO son un pendiente.
  // Distintos de `NO_HOLDED_KEY` a propósito: ese dice "todavía no", y
  // decirle "todavía no" a un comercio que dejó Holded es invitar a
  // reconectarlo.
  HOLDED_DESCONECTADO:
    "Este comercio dejó de usar Holded. No queda nada que sincronizar ni subir, y volver a conectarlo es una operación aparte.",
  HOLDED_NO_HABILITADO:
    "Este comercio no usa Holded: su catálogo se gestiona desde el panel del cliente.",
  DEJAR_HOLDED_BLOQUEADO:
    "No se puede dejar Holded todavía. Revisa lo que la previsualización lista y vuelve a comprobarlo.",
  CONFIRMACION_NO_COINCIDE:
    "El nombre no coincide. Escríbelo exactamente como aparece.",
  INVALID_HOLDED_FISCAL_PROFILE:
    "Los datos fiscales de Holded no son válidos. El cliente tiene que completarlos en Holded.",

  // --- Validation / state errors ---
  EXTERNAL_ID_TAKEN:
    "Identificador externo ya en uso. Genera uno nuevo y reintenta.",
  TENANT_BLOCKED:
    "La cuenta está bloqueada. Desbloquéala antes de operar con ella.",
  TENANT_NOT_FOUND:
    "Cuenta no encontrada. Quizá fue eliminada.",
  CANNOT_DELETE_SELF:
    "No puedes eliminar tu propia sesión de super-admin.",
  SHIFT_NOT_OPEN:
    "No hay un turno abierto en esta caja.",
  INSUFFICIENT_PERMISSIONS:
    "Esta acción requiere permisos que tu sesión no tiene.",

  // --- Onboarding errors ---
  DRAFT_NOT_READY:
    "Faltan validaciones antes de poder activar esta cuenta. Revisa el panel de Onboarding.",
  ALREADY_ACTIVE:
    "Esta cuenta ya está activa.",
};

/**
 * Convierte un error de la API en un mensaje humano:
 *   - Si trae `message`, se prefiere (suele venir explicado en es).
 *   - Si solo trae `error` (code), se busca en el map.
 *   - Si no está mapeado, devuelve el código crudo como fallback.
 */
export function humanizeError(
  err: { error?: string; message?: string } | string | unknown,
): string {
  if (typeof err === "string") {
    // Si lo que llega es un code crudo, intentamos mapearlo.
    return ERROR_LABEL[err] ?? err;
  }
  if (err && typeof err === "object") {
    const obj = err as { error?: string; message?: string };
    if (obj.message && obj.message.trim()) return obj.message.trim();
    if (obj.error) {
      const mapped = ERROR_LABEL[obj.error];
      if (mapped) return mapped;
      return obj.error;
    }
  }
  return "Error inesperado. Reintenta en unos segundos.";
}
