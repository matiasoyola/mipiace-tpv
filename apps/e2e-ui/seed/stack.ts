// Levanta lo que el banco necesita y siembra. Un comando, sin pasos a mano.
//
// Por qué un script y no el `globalSetup` de Playwright: Playwright arranca
// sus `webServer` ANTES del global setup, y la API no puede arrancar contra
// una base que todavía no existe ni está migrada. Así que el orden lo pone
// esto, y Playwright sólo se encarga de los tres servidores (y los reusa si
// ya están arriba).
//
// Es idempotente de arriba abajo: contenedores ya arriba, base ya creada,
// migraciones ya aplicadas y tenant ya sembrado dan todos lo mismo.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@mipiacetpv/db";

import { databaseUrl } from "./base-de-datos.js";
import { sembrar } from "./peluqueria-demo.js";

const RAIZ = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

function sh(cmd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync(cmd, args, {
    cwd: RAIZ,
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : process.env,
  });
}

function paso(texto: string): void {
  console.log(`· ${texto}`);
}

function nombreDeLaBase(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

// Los contenedores se tocan POR NOMBRE, no por `docker compose`.
//
// Dos intentos fallidos antes de llegar aquí, y los dos por la misma razón:
// el compose les pone `container_name` FIJO (`mipiacetpv-postgres`,
// `mipiacetpv-redis`), y un nombre de contenedor es único por demonio.
//
//   1. `docker compose up` desde el worktree usa el nombre del directorio
//      como proyecto y trata de crear contenedores nuevos con esos nombres:
//      «Conflict. The container name "/mipiacetpv-redis" is already in use».
//   2. `docker compose -p mipiacetpv up` tampoco: el proyecto con el que se
//      crearon de verdad estos contenedores se llama `holded` (el directorio
//      desde el que se levantaron hace tiempo). No se puede adivinar.
//
// Así que: si el contenedor existe, se arranca por su nombre — da igual qué
// proyecto lo creó. Sólo si NO existe se recurre al compose, que es el caso
// de una máquina limpia, donde no hay nada con lo que chocar.
const CONTENEDORES = ["mipiacetpv-postgres", "mipiacetpv-redis"] as const;

function existeContenedor(nombre: string): boolean {
  try {
    sh("docker", ["inspect", "-f", "{{.Id}}", nombre]);
    return true;
  } catch {
    return false;
  }
}

/** Postgres y Redis, esperando a que Postgres esté sano. */
function contenedores(): void {
  paso("Postgres y Redis");
  const faltan = CONTENEDORES.filter((c) => !existeContenedor(c));
  if (faltan.length > 0) {
    // Máquina limpia: aquí el compose sí puede crearlos sin chocar.
    sh("docker", ["compose", "up", "-d", "postgres", "redis"]);
  } else {
    // Ya existen: arrancarlos por nombre es inocuo si ya están arriba.
    sh("docker", ["start", ...CONTENEDORES]);
  }
  for (let i = 0; i < 30; i++) {
    const estado = sh("docker", [
      "inspect",
      "-f",
      "{{.State.Health.Status}}",
      "mipiacetpv-postgres",
    ]).trim();
    if (estado === "healthy") return;
    execFileSync("sleep", ["1"]);
  }
  throw new Error("Postgres no se puso healthy en 30 s.");
}

/** psql dentro del contenedor, por nombre (ver el comentario de arriba). */
function psql(args: string[]): string {
  return sh("docker", [
    "exec",
    "-i",
    "mipiacetpv-postgres",
    "psql",
    "-U",
    "mipiacetpv",
    ...args,
  ]);
}

/** La base del banco, si no existe ya. */
function base(nombre: string): void {
  const existe = psql([
    "-tAc",
    `SELECT 1 FROM pg_database WHERE datname = '${nombre}'`,
  ]).trim();
  if (existe === "1") {
    paso(`la base ${nombre} ya está`);
    return;
  }
  paso(`creando la base ${nombre}`);
  psql(["-c", `CREATE DATABASE ${nombre}`]);
}

/** Migraciones REALES (`migrate deploy`), no `db push`: el banco corre contra
 *  el mismo esquema que producción, EXCLUDE incluido. */
function migraciones(url: string): void {
  paso("migraciones");
  execFileSync("pnpm", ["--filter", "@mipiacetpv/db", "run", "migrate:deploy"], {
    cwd: RAIZ,
    stdio: "ignore",
    env: { ...process.env, DATABASE_URL: url },
  });
}

async function main(): Promise<void> {
  const url = databaseUrl();
  const nombre = nombreDeLaBase(url);
  console.log(`Preparando el banco de la agenda (base ${nombre}):`);
  contenedores();
  base(nombre);
  migraciones(url);
  paso("sembrando «Peluquería Demo»");
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await sembrar(prisma);
  } finally {
    await prisma.$disconnect();
  }
  console.log("Listo. La agenda nace apagada: la enciende el capítulo 1.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
