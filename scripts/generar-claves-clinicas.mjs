#!/usr/bin/env node
// clinica-7 · GENERA LAS DOS CLAVES DEL BLINDAJE y dice dónde va cada una.
//
//   node scripts/generar-claves-clinicas.mjs
//
// Son dos cosas distintas y se confunden fácil, así que este script las
// genera juntas y las explica juntas:
//
//   1. **CLINICAL_KEK** — la clave maestra que envuelve la clave de cada
//      clínica. Va en el entorno del VPS. **Si se pierde, se pierden
//      TODAS las historias clínicas.**
//   2. **El par de `age`** — con la pública el VPS cifra las copias de
//      seguridad; con la privada se descifran. **La privada NO va al
//      VPS**: el servidor tiene que poder hacer copias y no poder
//      abrirlas.
//
// ── Por qué este script y no un `openssl rand` en el README ─────────
//
// Porque el `openssl rand` es la parte fácil. Lo difícil es acordarse de
// que la privada de `age` no va al VPS, y eso no lo recuerda un README que
// alguien lee una vez. Aquí lo dice la propia salida, al lado de la clave,
// en el momento en que se está copiando.
//
// ── No escribe nada en disco, a propósito ───────────────────────────
//
// Imprime y se calla. Un fichero con la KEK dentro acaba en el historial
// de `ls`, en una copia de seguridad del portátil o en un `git add -A` a
// las once de la noche. Lo que hay que hacer con esta salida está en el
// paso 2 de abajo, y es a mano.

import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const kek = randomBytes(32).toString("base64");
// El id de la KEK lleva el mes: es lo que distingue la vieja de la nueva
// cuando se rota, y lo que `clinical_tenant_keys.kek_id` guarda por fila.
const ahora = new Date();
const kekId = `kek-${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}`;

// ── El par de `age` ─────────────────────────────────────────────────
//
// Se genera con `age-keygen` si está instalado. No se reimplementa: `age`
// usa X25519 y ChaCha20-Poly1305, y una implementación propia de eso en un
// script de 60 líneas sería exactamente la clase de criptografía casera
// que este bloque evita en todo lo demás.
let agePrivada = null;
let agePublica = null;
try {
  const salida = execFileSync("age-keygen", { encoding: "utf8" });
  agePrivada = (salida.match(/^AGE-SECRET-KEY-\S+$/m) ?? [])[0] ?? null;
  agePublica = (salida.match(/public key: (age1\S+)/) ?? [])[1] ?? null;
} catch {
  // `age` no está instalado. Se dice cómo instalarlo y se sigue: la KEK
  // sí se ha generado y no hay por qué tirarla.
}

const linea = "─".repeat(72);

console.log(`
${linea}
clinica-7 · LAS CLAVES DEL BLINDAJE
${linea}

LEE ESTO ANTES DE COPIAR NADA:

  · Estas claves se generan UNA VEZ. Volver a lanzar este script da claves
    nuevas, y con claves nuevas las historias ya cifradas NO SE LEEN.
  · La KEK y la privada de age hay que guardarlas en DOS SITIOS FUERA DEL
    VPS: el gestor de contraseñas y una copia física (papel en un cajón
    cerrado, o un USB guardado donde no esté el portátil).
  · Hay que conservarlas CINCO AÑOS como mínimo, que es lo que la Ley
    41/2002 obliga a conservar la historia clínica. Si se pierden antes,
    la historia es ilegible y eso es una infracción, no una incidencia.
  · Esta salida no se guarda en ningún fichero. Cópiala y cierra la
    terminal.

${linea}
1 · LA CLAVE MAESTRA (CLINICAL_KEK)
${linea}

Va en el entorno del VPS, en 'infra/.env.production':

CLINICAL_KEK="${kek}"
CLINICAL_KEK_ID="${kekId}"

Qué hace: envuelve la clave de cada clínica. Sin ella, la API no arranca
si hay clínicas con historia — y eso es a propósito: arrancar sin la KEK
buena sería escribir historias que después nadie puede leer.

Si se pierde: se pierden TODAS las historias clínicas de TODAS las
clínicas. No hay forma de recuperarlas. No hay copia de seguridad que
valga, porque las copias traen las claves envueltas con ESTA.
`);

if (agePublica && agePrivada) {
  console.log(`${linea}
2 · EL PAR DE LAS COPIAS DE SEGURIDAD (age)
${linea}

LA PÚBLICA va al VPS, en 'infra/.env.production':

MIPIACETPV_BACKUP_AGE_RECIPIENT="${agePublica}"

LA PRIVADA **NO VA AL VPS**. Ésta es la decisión de fondo de las copias:
el servidor puede CIFRAR copias y no puede ABRIRLAS. Si alguien entra en
el VPS, se lleva copias que no sabe leer.

${agePrivada}

Guárdala en el gestor de contraseñas Y en papel. Es la única forma de
restaurar una copia — y el simulacro de restauración
('infra/simulacro-de-restauracion.sh') la necesita, así que se prueba al
menos una vez al desplegar y se sabe que funciona.
`);
} else {
  console.log(`${linea}
2 · EL PAR DE LAS COPIAS DE SEGURIDAD (age) — FALTA 'age'
${linea}

No se ha podido generar: 'age-keygen' no está en este equipo.

  macOS:   brew install age
  Debian:  apt install age

Después, vuelve a lanzar este script (la KEK de arriba habrá cambiado:
quédate con la de la última pasada) o genera solo el par con:

  age-keygen

La PÚBLICA (empieza por 'age1') va al VPS en
MIPIACETPV_BACKUP_AGE_RECIPIENT. La PRIVADA (empieza por
'AGE-SECRET-KEY-') **NO VA AL VPS**: el servidor tiene que poder cifrar
copias y no poder abrirlas.
`);
}

console.log(`${linea}
3 · Y EN EL VPS, DESPUÉS DE PEGARLAS
${linea}

  · 'age' instalado en el VPS (apt install age), que es lo que cifra las
    copias. Sin él, el script de copia SALE CON ERROR en vez de dejar una
    copia en claro — media protección da falsa confianza.
  · Reinicia la API y comprueba el log: tiene que decir
    'clinica · la KEK descifra el canario de todas las clínicas'.
  · Lanza el simulacro de restauración con la privada, contra la primera
    copia cifrada de la noche. Es el paso 5 de «Al desplegar» en
    docs/blocks/clinica-7-done.md.

${linea}
`);
