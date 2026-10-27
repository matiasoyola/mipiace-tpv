# Bloque personal-1 · plan

Rama `personal-1`, worktree `mipiacetpv-personal-1`, base `2be8476` (= `origin/master`, comprobado
con `git merge-base --is-ancestor`). PR contra `master`. Sin merges ni despliegues.

Suite de partida, medida en este árbol tras `pnpm install` + `pnpm db:generate`:
**474 ficheros, 6 896 verdes, 10 saltados** (`pnpm test` desde la raíz — nunca desde un paquete).

---

## 1 · Lo medido antes de escribir una línea

| Pregunta | Respuesta medida |
|---|---|
| ¿Quién decide hoy la salida olvidada? | `esSalidaOlvidada(entry, now, maxHoras)` en `apps/api/src/fichaje/time.ts`, y sólo ahí. Tres superficies la llaman: `routes.ts:269` (`/me`), `routes.ts:473` (cierre) y `admin-routes.ts:412-460` (`/today`, en dos listas). El tercer argumento lo da `maxOpenHoursFor` (`fichaje/max-open.ts`), que **falla hacia el default**. |
| ¿Hay tabla de turnos reutilizable? | Sí: `center_shifts` (`CenterShift`), horas de pared «HH:MM», `@@unique([tenantId, code])`. Lo que la ata a la residencia **no es la tabla**: son sus rutas (`residencia/turnos-routes.ts`, con `ensureClinicaEnabled` + `ensureResidenciaEnabled`). |
| ¿`turnoDe` se puede reutilizar? | Sí, y es pura: vive en `packages/residencia-plan/src/turnos.ts` (`turnoDe`, `minutosEnTurno`, `cruzaMedianoche`, `TURNOS_DE_SERIE`). `apps/api/src/residencia/turnos.ts` sólo la re-exporta. |
| ¿Hay precedente de dependencia entre paquetes puros? | Sí: `clinica-sesion`, `escpos-builder`, `ticket-pdf` y `verifactu` dependen de otros `@mipiacetpv/*` por `workspace:*`. |
| ¿Cómo se cifra una columna? | `apps/api/src/clinica/cripto-campos.ts` (`cifrarTexto` / `leerTexto` + un `sitio*` por columna) sobre `cripto.ts`. La DEK la da `asegurarDek(tenantId, tx)` en la **escritura**, `dekONada` en la **lectura**. 30 columnas cifradas hoy. |
| ¿La DEK existe en un tenant sin clínica? | No hace falta que exista: `asegurarDek` la crea en la primera escritura y **no pasa por ningún gate de clínica**. Lo que hace falta es `CLINICAL_KEK` en el entorno — ya está en el compose de producción (residencia-1b). |
| ¿De dónde salen las plazas ocupadas de un día? | `bed_assignments` con `from_at` / `to_at` (`panel.ts:1442-1455` ya cuenta así la ocupación media del mes). Las plazas son las camas activas; no hay columna «plazas». |
| ¿Dónde está el patrón de append-only + «cambiar exige traza de la MISMA txid»? | `20260923010000_fichaje_1_registro`: `mipiacetpv_time_corrections_append_only`, `mipiacetpv_time_correction_exists` (mira `txid_current()`), `record_time_entry_correction` (`SECURITY DEFINER`) y `mipiacetpv_time_entries_guard`. |
| ¿Dónde está el patrón `datosQueFaltan`? | `packages/residencia-plan/src/datos-que-faltan.ts` (tabla ordenada, peso `IMPRESCINDIBLE`/`RECOMENDABLE`, campo estable, reglas que dependen de otro dato). |
| ¿Cómo se escribe un `down`? | Comentado en la cabecera de la migración, con `RAISE EXCEPTION` si bajar destruiría dato (`20261023010000_alta_minima`). |

---

## 2 · Las dos decisiones que el prompt manda explicar

### Decisión 1 · la persona

**`Employee` se amplía y se vincula; no se fusiona nada.** `Employee.userId` ya existe, es nullable y
tiene `@@unique([tenantId, userId])`. La ficha **enseña** los roles de cuidado (`CareRoleAssignment`,
que cuelga de `User`) y el perfil de agenda (`StaffProfile`, ídem) cuando hay `userId`; no los mueve.

Lo que se comprobará al escribir el código y se dirá en el done: si vincular **no** basta para que el
cuadrante cuadre con los roles de cuidado (la ratio mira «atención directa», que es categoría
profesional de la ficha, **no** rol de cuidado), se explica allí y no se fusiona aquí.

### Decisión 4 · la tabla de turnos

**Se reutiliza `center_shifts` tal cual, con una columna nueva (`min_coverage`), y se le abren rutas
propias bajo el gate del fichaje.** No se mueve.

Por qué no se mueve: la tabla no tiene nada de residencia (tenant + código + dos horas de pared), y
seis modelos le apuntan con `Restrict` (`CareRecord`, `Incident`, `GuardShiftSession`, `Handover`…).
Moverla sería renombrar una tabla con histórico firmado colgando para no ganar nada.

Lo que sí cambia: `GET/POST/PATCH/DELETE /admin/fichaje/turnos`, con `requireOwnerOrManager` +
`ensureFichajeEnabled` — las de residencia **no se tocan** y siguen leyendo lo mismo. Y la semilla:
si un tenant con fichaje abre el cuadrante y no tiene ni un turno, se le siembran los tres de serie
(`TURNOS_DE_SERIE` del paquete, no una copia).

---

## 3 · Los frentes, en orden

| Frente | Qué |
|---|---|
| **F0** | Este plan. |
| **F1** | La migración y el schema: ficha (8 columnas, 2 cifradas), `employee_categories`, `center_shifts.min_coverage`, `staff_schedules`, `staff_schedule_cells`, `staff_schedule_changes` (append-only + guard de txid + `record_staff_schedule_change`), `staff_rule_settings`, `tenants.fichaje_shift_margin_hours`. Con su `down`. Tests del contrato del SQL. |
| **F2** | `packages/cuadrante`: `comprobarCuadrante` (las 8 reglas), `datosQueFaltanDePersonal`, `leerCsvDePersonal` + `planDeImportacion`, `planificadoVsFichado`, `limiteDeSalidaOlvidada`. Tests de tabla. |
| **F3** | API de la ficha (lectura/edición con los cifrados) y la importación CSV (vista previa + aplicar). |
| **F4** | API del cuadrante: turnos del tenant, celdas, copiar semana, repetir patrón, publicar, cambios, reglas. |
| **F5** | `esSalidaOlvidada` con turno planificado (el ÚNICO sitio que decide) + planificado frente a fichado en «Hoy», en el mes y en el export. |
| **F6** | Admin: ficha con la banda, «Importar», Cuadrante, «Hoy», reglas en Ajustes. |
| **F7** | PWA `/fichar`: «Mi cuadrante». |
| **F8** | Sabotajes, medidas, capturas, e2e, `personal-1-done.md`, PR. |

## 4 · Lo que este plan se compromete a NO hacer

Generar el cuadrante con IA (personal-2). Festivos y cómputo anual. Pausas. Solicitudes desde el
móvil. Nóminas. Fusionar `StaffProfile` ni los roles de cuidado con la ficha. Tocar ADR-018: ni un
camino nuevo para mover una hora sin corrección.
