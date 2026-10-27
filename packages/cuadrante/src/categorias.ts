// personal-1 (decisión 2) · LAS CATEGORÍAS PROFESIONALES DE SERIE.
//
// «Un catálogo del tenant (editable, con los de serie que tocan **según
// los módulos encendidos**)». Esto es ese «según».
//
// ── POR QUÉ DEPENDE DE LOS MÓDULOS ──────────────────────────────────
//
// Porque la lista tiene que ser útil el primer día y no un formulario que
// alguien rellena. A una residencia de 24 horas se le siembran las nueve
// categorías con las que hace su cuadrante; a un colegio, auxiliar y DUE
// no le dicen nada y sembrárselas le obligaría a desactivar siete cosas
// antes de poder dar de alta a su primer profesor.
//
// Y lo que de verdad está en juego es `atencionDirecta`: es lo que la ratio
// cuenta. Una lista sembrada «por si acaso» con todo marcado haría que la
// ratio de una residencia saliera cumplida con la administrativa y la
// cocinera dentro.
//
// ── QUIÉN CUENTA COMO ATENCIÓN DIRECTA ──────────────────────────────
//
// Las que están con la persona: gerocultora/auxiliar, DUE, médico,
// terapeuta ocupacional y fisioterapeuta. **No** limpieza, **no** cocina,
// **no** administración y **no** dirección: su trabajo hace falta y no es
// atención directa, y meterlas en la ratio es cómo se cumple una ratio en
// un papel y no en el pasillo.
//
// Es lo que dice el Decreto 2/2022 de Castilla-La Mancha para el cliente
// cero, **y es editable**: lo que cuenta como atención directa cambia con
// la comunidad y con la acreditación, así que la marca se puede mover
// desde la pantalla y no hay trigger que la congele. Lo que se siembra es
// el punto de partida razonable, no la verdad.

export interface CategoriaDeSerie {
  code: string;
  name: string;
  atencionDirecta: boolean;
  orden: number;
}

/** Las nueve de una residencia. */
export const CATEGORIAS_DE_RESIDENCIA: readonly CategoriaDeSerie[] = [
  { code: "AUXILIAR", name: "Gerocultora / auxiliar", atencionDirecta: true, orden: 10 },
  { code: "DUE", name: "Enfermería (DUE)", atencionDirecta: true, orden: 20 },
  { code: "MEDICO", name: "Medicina", atencionDirecta: true, orden: 30 },
  { code: "TO", name: "Terapia ocupacional", atencionDirecta: true, orden: 40 },
  { code: "FISIO", name: "Fisioterapia", atencionDirecta: true, orden: 50 },
  { code: "LIMPIEZA", name: "Limpieza", atencionDirecta: false, orden: 60 },
  { code: "COCINA", name: "Cocina", atencionDirecta: false, orden: 70 },
  { code: "DIRECCION", name: "Dirección", atencionDirecta: false, orden: 80 },
  { code: "ADMINISTRACION", name: "Administración", atencionDirecta: false, orden: 90 },
] as const;

/**
 * Y las de un centro sin cuidados: el colegio de Talavera.
 *
 * Ninguna marcada como atención directa, y no es un descuido: un colegio
 * no tiene ratio de atención directa que cumplir. Lo que sí tiene es
 * cobertura mínima por turno —alguien en conserjería a primera hora—, y
 * para eso la marca sirve igual: es la que el centro moverá a mano en las
 * categorías que quiera contar.
 */
export const CATEGORIAS_SIN_CUIDADOS: readonly CategoriaDeSerie[] = [
  { code: "DOCENTE", name: "Docente", atencionDirecta: false, orden: 10 },
  { code: "DIRECCION", name: "Dirección", atencionDirecta: false, orden: 20 },
  { code: "ADMINISTRACION", name: "Administración / secretaría", atencionDirecta: false, orden: 30 },
  { code: "SERVICIOS", name: "Servicios y mantenimiento", atencionDirecta: false, orden: 40 },
] as const;

/**
 * Qué se le siembra a este tenant.
 *
 * Se llama **al abrir el cuadrante por primera vez**, no al encender el
 * módulo de fichaje: igual que `asegurarDek` crea la clave en la primera
 * escritura y no al activar la clínica. Un tenant que ficha y no hace
 * cuadrante no necesita categorías, y sembrárselas le llenaría una
 * pantalla que no va a abrir.
 *
 * Idempotente por el único `(tenant_id, code)`: el que ya está no se
 * duplica y **no se reescribe**. Si un centro renombró «Gerocultora /
 * auxiliar» a «Gerocultora» o le quitó la marca de atención directa, la
 * semilla no se lo deshace — mismo criterio que la semilla de roles de
 * cuidado de residencia-1.
 */
export function categoriasDeSerie(modulos: {
  residencia: boolean;
}): readonly CategoriaDeSerie[] {
  return modulos.residencia
    ? CATEGORIAS_DE_RESIDENCIA
    : CATEGORIAS_SIN_CUIDADOS;
}
