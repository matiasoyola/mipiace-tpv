// Capítulo 5 · El panel de salud: provocar un aviso de verdad y arreglarlo.
//
// El aviso no está puesto a mano: sale de que los dos servicios del tinte no
// los sabe hacer NADIE (capítulo 3, a propósito). Un servicio sin ninguna
// profesional no ofrece ni un hueco, y hasta que existió este panel lo hacía
// **sin decirlo** — una clienta pedía tinte, la agenda decía que no había
// sitio, y nadie sabía por qué.
//
// El panel vive en el TPV, no en el admin. Y trae el arreglo dentro: la
// matriz profesional × servicio está a un dedo del aviso, no en otra app.
//
// PERO NO LO ARREGLA CUALQUIERA. El capítulo tiene dos actos porque la
// pantalla tiene dos comportamientos: Marta (CASHIER) ve el aviso y ve la
// matriz, y la matriz le sale en modo mirar — `canConfigure` exige OWNER o
// MANAGER (`routes.ts:792`). Lo arregla la dueña. Para Sole da igual (es la
// propietaria), pero para Ana o Isa el aviso es un callejón sin salida: va
// como hallazgo 🟡.

import { expect, test } from "@playwright/test";

import { cerrarBd, servicio, skills } from "../lib/bd.js";
import { entrarTpv, turnoAbierto } from "../lib/entrar.js";
import { AP11 } from "../lib/pantallas.js";
import { esconder, portada, rotulo } from "../lib/rotulo.js";
import {
  DUENA,
  PROFESIONALES,
  TINTE_LO_APRENDEN,
  TINTE_SKUS,
} from "../seed/escenario.js";

const CAP = "Capítulo 5 · Salud";
const MARTA = PROFESIONALES[0]!;
const TINTES = ["Tinte · aplicación", "Tinte · lavado y peinado"];

test.use(AP11);

test.afterAll(async () => {
  await cerrarBd();
});

test("Marta ve el aviso, pero la matriz le sale en modo mirar", async ({
  page,
}) => {
  await entrarTpv(page, MARTA.email);
  await turnoAbierto(page);
  await page.getByRole("button", { name: "Agenda" }).click();
  await portada(page, "¿Está la agenda sana?", CAP);

  // El badge del botón de salud ya canta: dos servicios sin nadie.
  const salud = page.getByRole("button", { name: "Salud de la agenda" });
  await expect(page.locator('[data-test="badge-salud"]')).toHaveText("2", {
    timeout: 30_000,
  });
  await rotulo(page, "El TPV avisa solo: dos servicios sin nadie.", CAP);
  await esconder(page);

  await salud.click();
  const tarjeta = page.locator('[data-test="tarjeta-servicios-sin-profesional"]');
  await expect(tarjeta).toBeVisible({ timeout: 20_000 });
  await expect(tarjeta.locator('[data-test="cifra"]')).toHaveText("2");
  for (const nombre of TINTES) {
    await expect(tarjeta.getByText(nombre)).toBeVisible();
  }
  await rotulo(
    page,
    "El tinte no lo sabe hacer nadie: no ofrece ni un hueco.",
    CAP,
  );
  await esconder(page);

  // Marta llega hasta la matriz, pero no la puede cambiar.
  await page.getByRole("button", { name: "Arreglarlo en la matriz" }).click();
  await expect(
    page.getByText(/puede mirar la matriz pero no cambiarla/i),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByRole("button", { name: `${TINTES[0]} · Marta` }),
  ).toBeDisabled();
  await rotulo(page, "La matriz la cambia la dueña, no la cajera.", CAP);
  await esconder(page);
});

test("la dueña lo arregla y el panel queda limpio", async ({
  page,
}) => {
  await entrarTpv(page, DUENA.email);
  await turnoAbierto(page);
  await page.getByRole("button", { name: "Agenda" }).click();
  await page.getByRole("button", { name: "Salud de la agenda" }).click();
  const tarjeta = page.locator('[data-test="tarjeta-servicios-sin-profesional"]');
  await expect(tarjeta).toBeVisible({ timeout: 30_000 });
  // El arreglo, sin salir del TPV.
  await page.getByRole("button", { name: "Arreglarlo en la matriz" }).click();
  await rotulo(page, "Marta y Lucía aprenden a teñir. Irene no tiñe.", CAP);
  await esconder(page);
  for (const nombre of TINTES) {
    for (const alias of TINTE_LO_APRENDEN) {
      const celda = page.getByRole("button", { name: `${nombre} · ${alias}` });
      await expect(celda).toBeVisible({ timeout: 20_000 });
      await celda.click();
      await expect(celda).toHaveAttribute("aria-pressed", "true", {
        timeout: 20_000,
      });
    }
  }
  await expect(page.locator('[data-test="aviso-guardado"]')).toBeVisible();

  // De vuelta al panel: limpio. `.last()` porque hay tres «Volver» en el
  // árbol a la vez (la rejilla, el panel y la matriz, que se pintan unos
  // encima de otros): el de la matriz, que es la que está delante, es el
  // último que se monta.
  await page.getByRole("button", { name: "Volver", exact: true }).last().click();
  await expect(tarjeta).toBeVisible({ timeout: 20_000 });

  // Y AQUÍ SIGUE DICIENDO 2. El panel no vuelve a preguntar al volver de la
  // matriz: hay que pulsar «Actualizar». Es justo lo que hace pensar que el
  // arreglo no ha funcionado —acabas de marcar cuatro casillas y la cifra no
  // se mueve—, así que va como hallazgo 🟡.
  await expect(tarjeta.locator('[data-test="cifra"]')).toHaveText("2");
  await rotulo(page, "El panel no se entera solo: hay que actualizarlo.", CAP);
  await esconder(page);
  await page.getByRole("button", { name: "Actualizar" }).click();

  await expect(tarjeta.locator('[data-test="cifra"]')).toHaveText("0", {
    timeout: 20_000,
  });
  await expect(tarjeta.locator('[data-test="buena-noticia"]')).toBeVisible();
  await rotulo(page, "Panel limpio.", CAP);
  await esconder(page);

  // Y el badge del botón de salud desaparece: ya no hay nada que contar.
  await page.getByRole("button", { name: "Volver a la agenda" }).click();
  await expect(page.locator('[data-test="badge-salud"]')).toHaveCount(0, {
    timeout: 20_000,
  });

  // En la BD: las cuatro filas nuevas de la matriz, y ninguna de Irene.
  const matriz = await skills();
  const aprendices = PROFESIONALES.filter((p) =>
    (TINTE_LO_APRENDEN as readonly string[]).includes(p.alias),
  );
  for (const sku of TINTE_SKUS) {
    const prod = await servicio(sku);
    const suyas = matriz.filter((m) => m.serviceId === prod.id);
    expect(suyas).toHaveLength(aprendices.length);
    for (const p of aprendices) {
      expect(suyas.some((m) => m.userId === p.id)).toBe(true);
    }
  }
  const irene = PROFESIONALES.find((p) => p.alias === "Irene")!;
  for (const sku of TINTE_SKUS) {
    const prod = await servicio(sku);
    expect(
      matriz.some((m) => m.serviceId === prod.id && m.userId === irene.id),
    ).toBe(false);
  }
});
