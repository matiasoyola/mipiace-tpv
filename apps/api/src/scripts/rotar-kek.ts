// clinica-7 · ROTAR LA CLAVE MAESTRA.
//
//   CLINICAL_KEK_VIEJA="…" CLINICAL_KEK="…" CLINICAL_KEK_ID="kek-2027-04" \
//     pnpm --filter @mipiacetpv/api exec tsx src/scripts/rotar-kek.ts
//
// Decisión 16: «la KEK lleva id; re-envolver las DEK con una KEK nueva es
// un script del repo con su test. **Las filas no se re-cifran**: solo se
// re-envuelven las DEK».
//
// ── Por qué eso es la diferencia entre minutos y días ───────────────
//
// La DEK de cada clínica cifra TODA su historia. Si rotar la clave maestra
// obligara a re-cifrar las filas, rotar significaría reescribir cada
// entrada, cada foto y cada consentimiento de cada clínica — una operación
// de horas, con la historia clínica en movimiento y los triggers de
// inmutabilidad de por medio.
//
// Con la DEK envuelta, lo que cambia es el envoltorio. Una fila por
// clínica. En un despliegue con cinco clínicas, cinco `UPDATE`.
//
// Y el trigger `clinical_tenant_keys_guard` es lo que lo garantiza:
// **rechaza una re-envoltura que cambie el canario**. Un canario distinto
// significaría que la DEK es otra, y entonces todo lo escrito antes habría
// quedado ilegible — que es exactamente el fallo que una rotación mal
// hecha produce.
//
// ── Las DOS claves hacen falta, y por eso entran por el entorno ─────
//
// La vieja para desenvolver y la nueva para envolver. `loadEnv` solo tiene
// una, así que la vieja entra por `CLINICAL_KEK_VIEJA` — y se lee aquí y
// no en `env.ts` a propósito: es una variable de un rato, no del
// despliegue, y en el esquema del entorno sería una que alguien se deja
// puesta.
//
// ── Es idempotente y se puede cortar ────────────────────────────────
//
// Una fila que ya está con la KEK nueva se cuenta y no se toca. Si el
// script se corta a la mitad, el despliegue queda con unas filas en la
// vieja y otras en la nueva **y sigue funcionando**: cada fila dice cuál es
// su `kek_id`, y `dekDe` desenvuelve con la de la fila. Eso es lo que hace
// que la rotación no necesite ventana de mantenimiento.
//
// Lo que sí hay que hacer es acabarla: mientras queden filas con la vieja,
// la KEK vieja sigue hace falta para arrancar.

import { getPrisma, shutdown } from "../context.js";
import { rotarKek } from "../clinica/claves.js";

function laDe(nombre: string): string {
  const v = process.env[nombre];
  if (v == null || v.trim() === "") {
    throw new Error(`Falta ${nombre}.`);
  }
  if (Buffer.from(v, "base64").length !== 32) {
    throw new Error(`${nombre} tiene que ser base64 de 32 bytes.`);
  }
  return v;
}

async function main(): Promise<void> {
  const vieja = laDe("CLINICAL_KEK_VIEJA");
  const nueva = laDe("CLINICAL_KEK");
  const idNuevo = process.env.CLINICAL_KEK_ID;
  if (idNuevo == null || idNuevo.trim() === "") {
    throw new Error("Falta CLINICAL_KEK_ID (el id de la KEK NUEVA).");
  }
  if (vieja === nueva) {
    // No es un fallo tonto: pasa cuando alguien exporta la misma variable
    // dos veces. Y rotar a la misma clave dejaría todas las filas
    // diciendo que están con la nueva sin estarlo.
    throw new Error(
      "CLINICAL_KEK_VIEJA y CLINICAL_KEK son la misma clave. No hay nada que rotar.",
    );
  }

  const r = await rotarKek(
    { kekViejaBase64: vieja, kekNuevaBase64: nueva, kekNuevaId: idNuevo },
    getPrisma(),
  );

  console.log(`
Re-envueltas:  ${r.reenvueltas.length}
Ya estaban:    ${r.yaEstaban.length}
Destruidas:    ${r.destruidas.length}  (no se tocan: no tienen clave)
FALLIDAS:      ${r.fallidas.length}`);

  if (r.fallidas.length > 0) {
    console.error(`
✖ ${r.fallidas.length} clínica(s) NO se han podido re-envolver:

${r.fallidas.map((t) => `  · ${t}`).join("\n")}

Lo que esto significa, y lo que NO:

  · Sus DEK siguen envueltas con la KEK VIEJA y su historia se sigue
    leyendo con normalidad. **No se ha perdido nada.**
  · Lo que ha fallado es desenvolver con la vieja o el canario: o
    CLINICAL_KEK_VIEJA no es la que las envolvió, o esas filas vienen de
    otra rotación a medias.
  · NO quites la KEK vieja del entorno. Mientras queden filas con ella,
    hace falta para arrancar.

Comprueba que CLINICAL_KEK_VIEJA es la buena y vuelve a lanzarlo: las que
ya se re-envolvieron se saltan.`);
    process.exitCode = 1;
    return;
  }

  console.log(`
✔ Rotación completa. Ahora:

  1. Pon CLINICAL_KEK y CLINICAL_KEK_ID nuevas en el entorno del VPS (si
     no lo has hecho ya) y reinicia la API.
  2. Comprueba el log: 'clinica · la KEK descifra el canario de todas las
     clínicas'.
  3. **Guarda la KEK vieja de todas formas.** Las copias de seguridad
     ANTERIORES a esta rotación traen las DEK envueltas con ella: para
     restaurar una copia de hace un mes hace falta la vieja, no la nueva.
     Esto es lo que más se olvida.`);
}

main()
  .then(() => shutdown())
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(async (err) => {
    console.error(`\n✖ ${err instanceof Error ? err.message : String(err)}`);
    await shutdown();
    process.exit(1);
  });
