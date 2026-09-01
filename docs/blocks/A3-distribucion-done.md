# A3 · Distribución interna de la APK — done

Sustituye al A3 anterior (`A3-done.md`, canal interno de Play). Aquel dejó hecha la identidad
de la app, la firma de release y el `.aab`. Este no los rehace: los aprovecha y cambia el
canal de distribución.

**Objetivo cumplido en código**: cualquier terminal instala el TPV escribiendo
`mipiacetpv.com/apk` y un código de 6 dígitos. Sin Play, sin cable y sin WhatsApp.

Rama `a3-distribucion-apk`, cortada de `3b5daff`. Sin push.

---

## Commits

| Commit | Qué |
|---|---|
| `7774c51` | Frente 1 · build con huella, firma verificada y commit |
| `9d76904` | Frente 2 · versión visible en la app |
| `88c069c` | Red de caracterización del rate-limit, antes de tocarlo |
| `091bb73` | Frentes 3 y 4 · API de releases y página `/apk` |
| `b623f5c` | Frente 5 · consola de descargas |
| *(este)* | Frente 6 · infraestructura y documentación |

---

## Decisiones

Las 1 a 5 salían del prompt del bloque. Las 6 a 11 son discrepancias que se plantearon y
Matías aprobó. De la 12 en adelante son decisiones tomadas durante la ejecución, bajo el
encargo de parar sólo ante migraciones de modelos compartidos, lo que un código concede, la
puerta de autenticación o la URL pública.

### Del prompt, aprobadas sin cambios

1. **Se descarga con un código de 6 dígitos, no con un enlace largo.** El teclado del SO del
   AP11 tapa el 52 % inferior de la pantalla: teclear una URL con token ahí es
   impracticable. El código de 6 dígitos es el patrón que ya usamos para vincular terminales.
2. **La página `/apk` la sirve la API y es Chrome-81-safe.** Mini-ADR: ADR-013.
3. **Los binarios viven fuera del repo**, en `/opt/mipiacetpv/releases`, montado read-only.
4. **`latest.json` es público y sólo metadatos.** Sin URL del binario. Y sin `gitSha`: el
   commit del build sólo se sirve en `/super-admin/releases`, que pide sesión, nunca en el
   `/apk/latest.json` público.
5. **Versionado determinista**: `versionName` sin la `v`; `versionCode` =
   `MAJOR*10000 + MINOR*100 + PATCH`.

### Discrepancias resueltas con Matías

6. **La auditoría de descargas se atribuye al super-admin que emitió el código.**
   `SuperAdminAudit.superAdminId` es NOT NULL con FK Restrict y la descarga es anónima. En
   vez de hacer la columna nullable —modelo compartido—, todo intento contra un código
   **existente** (ok / caducado / agotado) se audita con
   `superAdminId = createdBySuperAdminId` y `tenantId = null`. La descarga no es anónima: es
   la consecuencia del acto de un super-admin. Los códigos **inexistentes** no van a
   `SuperAdminAudit` (no hay a quién atribuirlos): log estructurado y contador del limitador.
7. **Si `writeAudit` falla, la descarga sigue.** El contador ya se gastó y el instalador está
   delante de un cliente. La metadata es determinista, así que un fallo ahí es un bug nuestro
   y no una condición de runtime: se registra a nivel `error` con todo el contexto. Un test
   cubre que la metadata valida.
8. **`auth/rate-limit.ts` se parametriza, con red debajo primero.** `superadmin/rate-limit.ts`
   no era un limitador: sólo construye claves. Los umbrales viven en `auth/rate-limit.ts` como
   constantes de módulo por las que pasan todas las puertas de login del producto. Se escribió
   antes un test de caracterización de 15 casos (commit `88c069c`) y después se añadieron
   overrides opcionales, defaults intactos.
9. **La versión en la app se lee por el puente global de Capacitor.** `@capacitor/app` está en
   `apps/tpv-android`, no en `tpv-web`, y `platform/index.ts` documenta que el bundle de la
   PWA no carga Capacitor. Se usa `registerPlugin("App")`, igual que
   `platform/camera/CameraPermission.ts`.
10. **La versión va al pie del drawer de `SalePage`.** No existe pantalla de ajustes en
    `tpv-web`; el drawer es el único menú al que el cajero llega desde cualquier punto.
11. **La página muestra el SHA-256 de la versión que sirve ese código**, no el de `latest`.
    Si no, el criterio de aceptación 4 se cae en cuanto un código apunte a una versión
    anterior.

### Tomadas durante la ejecución

12. **En web la app muestra sólo el hash de build**, no una versión inventada. Fuera de Gradle
    no hay `versionCode`, y como `versionName` `tpv-web` no tiene ninguno: `__APP_VERSION__` es
    un `Date.now()` y la constante manual del admin sigue diciendo `"v1.0"` con el repo en
    v1.12 — el desfase que no queremos repetir.
13. **El grep del guard A2 va sobre todos los `assets/*.js`**, no sólo `index-*.js` como decía
    el prompt. `api.ts` lee `VITE_API_URL` tras un cast, así que Vite sustituye el objeto
    `import.meta.env` entero y puede caer en cualquier chunk.
14. **Segunda verificación tras `cap sync`**, además de la del `dist`. Lo que se empaqueta es
    lo sincronizado al proyecto nativo, no el `dist`.
15. **Argumento y env var en conflicto abortan el build.** Un desajuste ahí publica un fichero
    cuyo nombre miente sobre lo que Android registra dentro.
16. **`MINOR` o `PATCH` ≥ 100 abortan.** `1.100.0` colisionaría con `2.0.0` y Android leería la
    versión nueva como degradación: se niega a instalar encima.
17. **El árbol sucio aborta el build**, con escape `ALLOW_DIRTY=1` que marca la entrada como
    `-dirty` en el sidecar, en `releases.json` y en la consola.
18. **El sidecar cumple dos papeles**: verificable con `shasum -a 256 -c` por un humano, y
    portador del `gitSha` hacia `releases.json`. La línea de metadatos va como comentario;
    `sha256sum -c` avisa de línea mal formada pero devuelve 0.
19. **FK dura en SQL sin relación Prisma** para `created_by_super_admin_id`, con
    `ON DELETE RESTRICT`. Precedente: `appointment_items_service_id_fkey`. Evita una
    back-relation en `SuperAdminUser` por una tabla periférica.
20. **El consumo atómico no usa referencia de columna.** Comparar `downloadCount` contra
    `maxDownloads` columna-contra-columna necesita el preview `fieldReference`, que este schema
    no activa. Se lee la fila antes y el límite entra como número; la condición sigue viajando
    dentro del `UPDATE`, así que Postgres resuelve la carrera igual.
21. **Sin `@fastify/formbody`.** No está en el lockfile y no había red para instalarlo. El
    `<form>` sin JS se parsea con `URLSearchParams`, que ya está en Node, con tope de 4 KB.
22. **El índice manda, nunca el directorio.** Un `.apk` suelto sin entrada en `releases.json`
    no se sirve, y `basename()` sobre `fileName` impide que una entrada con `../` convierta
    `/apk` en lectura arbitraria de ficheros.
23. **Rutas de API en `/super-admin` con guion**, que es la convención real del backend, no el
    `/superadmin` sin guion que escribía la tabla del prompt. El `/superadmin` del front es
    react-router y no cambia.
24. **`/apk` se excluye del `encode` también en `api.mipiacetpv.com`**, que lo tiene a nivel de
    sitio. No se devuelve 404 en ese host: `curl https://api.mipiacetpv.com/apk/latest.json`
    desde el Mac es como se comprueba una publicación.
25. **`publicar-apk.sh` no escribe ningún `latest.json`**, aunque el prompt lo pedía. La API lo
    deriva de `releases.json`; dos ficheros con la misma verdad acaban desincronizados.
26. **Un `releases.json` corrupto se aparta, no se sobreescribe.** Regenerar desde cero
    despublicaría en silencio todas las versiones anteriores. Se renombra a
    `releases.json.corrupto.<timestamp>` con aviso por stderr.
27. **AP11-1006 y AP12-1506 conviven.** Son terminales distintos y reales: no se reescriben las
    menciones al AP12, se añade el AP11.

---

## Verificación

`pnpm test` desde la raíz: **141 ficheros, 1220 tests**. Typecheck limpio en api, admin y
tpv-web. Los tests nuevos se validaron por sabotaje (introducir el fallo y comprobar qué test
se pone rojo), no sólo por estar en verde:

| Frente | Tests | Mutantes probados |
|---|---|---|
| 1 · build | — (script) | 6 rutas de validación ejercitadas a mano |
| 2 · versión en la app | 16 | 10 |
| rate-limit | 15 | 8 |
| 3 y 4 · API y página | 29 | 23 |
| 5 · consola | 9 | 8 |

Tres mutantes sobrevivieron a la primera pasada y destaparon huecos reales: un `<p>` vacío en
el drawer, y —el importante— **path traversal**: nada cubría que un `fileName` con `../` en
`releases.json` sacara ficheros de `RELEASES_DIR`. Se añadieron tests y ya caen.

La fila del frente 1 dejó de ser "— (script)": los guardias de nombre de fichero de
`build-release-apk.sh` y `publicar-apk.sh` se prueban en `infra/test/nombre-de-apk.test.ts`
(proyecto `infra` del workspace de vitest), corriendo los scripts de verdad y comprobando que
mueren ANTES de compilar y ANTES del scp. También validados por sabotaje: sin los guardias,
los cinco tests de rechazo caen.

## Lo que NO está verificado

- **Nada se ha ejecutado contra el AP11.** Que la página se lea en Chrome 81 con el teclado
  tapando media pantalla sólo lo dice el terminal.
- **Postgres de verdad.** Prisma está falseado con Maps en los tests. La atomicidad del
  `updateMany` está razonada y el fake respeta las condiciones, pero la carrera real de dos
  descargas simultáneas no se ha probado.
- **La migración nunca se ha aplicado.** SQL escrito a mano, `prisma validate` limpio.
- **El build real del APK.** Necesita el keystore y red para Gradle. Los pasos de firma,
  renombrado y huella no se han ejercitado.
- **`publicar-apk.sh` end-to-end.** Cowork no tiene red. Sí están probadas sus validaciones
  locales y la lógica del índice, extraída del script y ejercitada en cinco escenarios,
  incluida la idempotencia.
- **La sintaxis del Caddyfile.** No hay binario de Caddy aquí. `docker compose config` sí
  valida.
- **`NAV_ITEMS`, la ruta de `App.tsx` y la tarea del hub**: sin test. `ACTIONS` sí.

## Pendiente para Matías

1. Crear el keystore definitivo y guardarlo (Mac + 1Password, contraseña aparte).
2. `mkdir -p /opt/mipiacetpv/releases` en el VPS antes del primer deploy con el bind mount.
3. `caddy validate` antes de recargar.
4. Ejecutar `publicar-apk.sh` contra el VPS.
5. La prueba física en el AP11 — es la que cierra los criterios de aceptación 1, 2 y 5.
