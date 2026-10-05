// agenda-lista · ¿la stack que hay al otro lado es la del banco?
//
// POR QUÉ EXISTE ESTO. El banco reutiliza los servidores que ya estén
// arriba (`reuseExistingServer`), que es lo cómodo cuando tienes tu
// `pnpm dev` abierto. Con varios worktrees a la vez deja de ser cómodo y
// pasa a ser una trampa: otra sesión con su API en :3001 y su base, y
// Playwright la reutiliza sin decir nada. El banco entonces prueba el
// código de otro árbol contra los datos de otro árbol, y lo peor es que
// puede salir VERDE.
//
// Pasó de verdad: al ir a correr este banco, :3001 y :5173 estaban
// ocupados por `mipiacetpv-catalogo-en-alta`.
//
// Así que antes de empezar se comprueba que la API del otro lado está
// mirando LA BASE DEL BANCO. No se comprueba pidiéndoselo —la API no
// publica su `DATABASE_URL`, y hace bien— sino por donde se nota: se
// entra con la dueña sembrada y se mira que el tenant que contesta es el
// del escenario. Un tenant con ese id sólo existe en la base del banco.
//
// Corre como `globalSetup`, que Playwright ejecuta DESPUÉS de levantar
// los `webServer`: es justo el momento en que se puede saber a quién se
// ha acabado hablando.

import { API, PUERTOS_PROPIOS } from "../playwright.config.js";
import { databaseUrl } from "./base-de-datos.js";
import { nombreDeLaBase } from "./peluqueria-demo.js";
import { DUENA, ID, PASSWORD_DUENA } from "./escenario.js";

function comoArreglarlo(base: string): string {
  return [
    "",
    "Si hay otra sesión con su stack en esos puertos, levanta la tuya:",
    "",
    "  BANCO_API_PORT=3101 BANCO_ADMIN_PORT=5273 BANCO_TPV_PORT=5274 \\",
    `    DATABASE_URL=postgresql://…/${base} pnpm e2e:agenda`,
    "",
    "Con puertos propios el banco NO reutiliza nada: o levanta los suyos,",
    "o se cae. Ver apps/e2e-ui/README.md.",
  ].join("\n");
}

async function pedir(
  ruta: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${API}${ruta}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

export default async function comprobarStack(): Promise<void> {
  const base = nombreDeLaBase(databaseUrl());
  const comoSeLevanto = PUERTOS_PROPIOS
    ? "puertos propios (no se reutiliza nada)"
    : "puertos por defecto (se reutiliza lo que haya arriba)";
  console.log(`· comprobando la stack en ${API} — ${comoSeLevanto}`);

  const login = await pedir("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: DUENA.email, password: PASSWORD_DUENA }),
  });
  if (login.status !== 200) {
    throw new Error(
      [
        `La API de ${API} NO es la del banco.`,
        `La dueña sembrada (${DUENA.email}) no puede entrar: respondió ${login.status}.`,
        `Lo más probable es que ese puerto lo tenga otra sesión, con otra base.`,
        `El banco espera la base "${base}".`,
        comoArreglarlo(base),
      ].join("\n"),
    );
  }
  const { accessToken } = login.body as { accessToken?: string };
  if (!accessToken) {
    throw new Error(
      [
        `La API de ${API} contestó al login sin token.`,
        "Si pide 2FA, no es el tenant del banco: el seed no lo activa.",
        comoArreglarlo(base),
      ].join("\n"),
    );
  }

  const me = await pedir("/auth/me", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const tenantId = (me.body as { tenant?: { id?: string } } | null)?.tenant?.id;
  if (tenantId !== ID.tenant) {
    throw new Error(
      [
        `La API de ${API} está mirando OTRA base.`,
        `Esperaba el tenant del escenario (${ID.tenant}) y contestó ${tenantId ?? "nada"}.`,
        `El banco siembra y comprueba contra "${base}": si la pantalla habla`,
        "con otra base, lo que se pruebe no vale nada (y puede salir verde).",
        comoArreglarlo(base),
      ].join("\n"),
    );
  }

  console.log(`· la stack es la del banco (tenant del escenario, base ${base})`);
}
