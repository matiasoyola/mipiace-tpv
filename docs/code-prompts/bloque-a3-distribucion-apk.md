# Bloque A3 · Distribución interna de la APK

> Sustituye al A3 anterior (`docs/blocks/A3-done.md`, canal interno de Play). Aquel bloque
> dejó hecha la identidad de la app, la firma de release y el `.aab`. Este bloque **no** los
> rehace: los aprovecha y cambia el canal de distribución.

**Objetivo**: que cualquier terminal nuestro (y el de un cliente durante la implantación)
instale el TPV escribiendo una URL corta de mipiacetpv, sin Play Store, sin cable y sin pasar
la APK por WhatsApp.

**Por qué ahora**: en las pruebas del 2026-08-27 sobre el AP11-1006 se confirmó que el Chrome
de fábrica del terminal es el **81** y no soporta `gap` en flexbox, así que pinta la interfaz
con los textos pegados ("Sala5 abiertas", "GEgemmamgc720,00 €"). El WebView del sistema es el
**93** y sí lo soporta. **La APK deja de ser fase 2: es requisito de implantación.**

## Contexto (leer antes)

- `docs/qa/2026-08-27-pruebas-fisicas-ap11.md` — los 9 hallazgos del terminal físico.
- `docs/blocks/A3-done.md` — identidad, firma y `build-release-aab.sh` ya hechos.
- `apps/tpv-android/scripts/build-release-apk.sh` — el build del APK firmado **ya existe**.
- `apps/api/src/devices/routes.ts` — patrón de código de 6 dígitos de un solo uso
  (`newSixDigitCode`, modelo `PairingCode`, consumo atómico con `updateMany`). **Se copia.**
- `apps/api/src/superadmin/{middleware,audit,rate-limit}.ts` — `requireSuperAdmin`,
  `writeAudit`, limitador por IP.
- `infra/Caddyfile`, `infra/docker-compose.prod.yml`, `infra/deploy.sh`.

## Decisiones de producto ya tomadas (no re-debatir)

1. **Se descarga con un código de 6 dígitos, no con un enlace largo.** El instalador escribe
   `mipiacetpv.com/apk` en el terminal y teclea un código de 6 dígitos que le da el
   super-admin. Motivo: el teclado del SO del AP11 tapa el 52 % inferior de la pantalla y hace
   impracticable teclear una URL con token; un código de 6 dígitos es el patrón que ya usamos
   para vincular terminales y funcionó a la primera en físico.
2. **La página `/apk` la sirve la API, no la PWA, y es Chrome-81-safe.** Se va a ver
   precisamente en el navegador roto: HTML plano servido desde Fastify, **sin JavaScript**,
   sin `gap`, sin `grid`, sin variables CSS. Formulario `<form method="POST">` y punto. Si esa
   página depende del bundle de `tpv-web`, se rompe igual que el TPV y el bloque no sirve.
3. **Los binarios viven fuera del repo**: `/opt/mipiacetpv/releases/` en el VPS, montado
   read-only en el contenedor `api`. Nada de APKs en git, ni en la imagen Docker.
4. **`latest.json` es público y sólo metadatos** (`versionCode`, `versionName`, `sha256`,
   `size`, `publishedAt`). **No lleva URL del binario.** Saber que existe la 1.10.2 no es un
   secreto; el binario sigue detrás del código. Así la app podrá comprobar actualizaciones más
   adelante sin montar autenticación para eso.
5. **Versionado determinista**: `versionName` = versión del TPV que se empaqueta, sin la `v`
   (`1.10.2`); `versionCode` = `MAJOR*10000 + MINOR*100 + PATCH` (`1.10.2` → `11002`).
   Monótono, legible y calculable por script.

## Alcance

### Frente 1 · Build reproducible del APK con huella

`apps/tpv-android/scripts/build-release-apk.sh` (ya existe) se completa con:

- Derivar `VERSION_NAME`/`VERSION_CODE` con la regla de la decisión 5 a partir de un único
  argumento (`build-release-apk.sh 1.10.2`), sin dejar de aceptar las env vars actuales.
- Renombrar la salida a `mipiacetpv-<versionName>-<versionCode>.apk` y dejarla en
  `apps/tpv-android/build-releases/` (gitignored), no en `app/build/outputs/`.
- Calcular **SHA-256** y escribir el sidecar `<apk>.sha256`, e imprimirlo en pantalla.
- Verificar la firma (`apksigner verify --print-certs` o `jarsigner -verify`) y **abortar** si
  el APK no está firmado; hoy el script asume que lo está.
- Verificar que `https://api.mipiacetpv.com` quedó embebida en el bundle (`grep` sobre
  `dist/assets/index-*.js`) y abortar si no. Es el fallo A2 que deja la app sin backend.

### Frente 2 · Versión visible dentro de la app

- La pantalla de ajustes / menú del cajero de `tpv-web` muestra
  `versionName (versionCode) · build <hash>`.
- En Android se lee con `App.getInfo()` de `@capacitor/app` (ya instalado); en web cae al
  `VITE_BUILD_HASH`. Detrás del adaptador `tpv-web/src/platform`, no con `if (Capacitor)`
  suelto en un componente.
- Sin esto, en una implantación nadie sabe qué versión tiene el terminal en la mano.

### Frente 3 · API de releases y descarga

Nuevo módulo `apps/api/src/releases/`. Lee de `RELEASES_DIR` (por defecto `/srv/releases`),
con `releases.json` como índice. **Nunca lista el directorio a un no autenticado.**

Modelo nuevo en `packages/db/prisma/schema.prisma` (+ migración):

```
model ApkDownloadCode {
  id             String    @id @default(uuid()) @db.Uuid
  code           String    @unique
  versionCode    Int       @map("version_code")
  createdBySuperAdminId String @map("created_by_super_admin_id") @db.Uuid
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  expiresAt      DateTime  @map("expires_at") @db.Timestamptz()
  maxDownloads   Int       @default(3) @map("max_downloads")
  downloadCount  Int       @default(0) @map("download_count")
  lastDownloadIp String?   @map("last_download_ip")
  lastDownloadAt DateTime? @map("last_download_at") @db.Timestamptz()
  note           String?
}
```

Endpoints:

| Método | Ruta | Auth | Qué hace |
|---|---|---|---|
| GET | `/super-admin/releases` | super-admin | Lista: versión, fecha, tamaño, sha256, nº de descargas |
| POST | `/super-admin/releases/:versionCode/download-codes` | super-admin | Crea código de 6 dígitos. `expiresAt` = +60 min, `maxDownloads` = 3, `note` opcional ("Thalía, terminal barra") |
| GET | `/super-admin/releases/:versionCode/apk` | super-admin | Descarga directa desde la consola |
| GET | `/apk` | pública | Página HTML Chrome-81-safe con el formulario del código |
| POST | `/apk` | pública | Valida el código y **responde con el binario**; si falla, re-renderiza la página con el error |
| GET | `/apk/latest.json` | pública | Metadatos de la última versión (decisión 4) |

**Convención de rutas, verificada en el código (2026-08-27):** la API usa **`/super-admin/...` con
guion** sin excepción (`/super-admin/tenants`, `/super-admin/audit`, `/super-admin/auth/login`…).
La consola del admin sí vive en `/superadmin/...` sin guion — son dos espacios de nombres
distintos y los dos son correctos en su sitio. Las rutas de esta tabla son de API: llevan guion.

**Dos sitios que se olvidan al añadir cosas al super-admin:**
- Las tarjetas de tareas del hub las genera **`apps/api/src/superadmin/hub.ts`** en el backend
  (`CommonTask[]`, ids como `review_sync_failures` o `activate_drafts`), no `HubPage.tsx`. Una
  entrada nueva en el hub se añade ahí, no sólo en el front.
- **`apps/admin/src/superadmin/AuditLogPage.tsx` tiene una lista `ACTIONS`** (línea 11) que mapea
  acción → etiqueta legible. Las acciones de auditoría nuevas de este bloque hay que añadirlas o
  se pintan como slug crudo en el registro.

Reglas:

- **60 min de validez y hasta 3 descargas** por código: el WiFi del bar corta y el instalador
  reintenta; un solo uso obligaría a llamar al super-admin a mitad de instalación.
- **Brute force**: 6 dígitos son un millón de combinaciones y el endpoint es público →
  limitador por IP (10 intentos fallidos / 10 min → 429 durante 30 min) reutilizando
  `superadmin/rate-limit.ts`. Los intentos fallidos se cuentan aunque el código no exista.
- Consumo atómico: `updateMany` con `downloadCount < maxDownloads` y `expiresAt > now()`, como
  el pairing code. Nada de leer-y-luego-escribir.
- Cabeceras del binario: `Content-Type: application/vnd.android.package-archive`,
  `Content-Disposition: attachment; filename="mipiacetpv-<versionName>-<versionCode>.apk"`,
  `Content-Length` real, `Cache-Control: no-store`. Sin compresión: un APK ya es un zip y
  comprimirlo rompe el `Content-Length` que Android usa para la barra de progreso.
- Se emite el fichero por `stream`, no cargándolo en memoria.
- Cada creación de código y cada descarga (con éxito o no) va a `writeAudit` con una acción
  nueva y su esquema de metadatos.

### Frente 4 · Página `/apk` (la que se ve en el terminal roto)

- HTML servido por Fastify, **cero JS**, estilos en un `<style>` inline sin `gap` ni `grid`
  (`margin`/`padding` y listo). Un solo `<input inputmode="numeric" maxlength="6">` y un botón
  grande (mínimo 44 px, en la mitad **superior** de la pantalla: el teclado del SO tapa la
  mitad inferior).
- Estados: formulario, error de código ("código caducado o agotado" / "código incorrecto"),
  y bloqueo por intentos.
- Debajo del formulario, en texto pequeño: versión, fecha, tamaño y **SHA-256** de la última
  versión, para poder cotejarlo antes de instalar.
- Colores de marca por valor literal (tokens de `docs/design/tokens.md`), no por variables CSS.

### Frente 5 · Consola: `/superadmin/descargas`

Pantalla nueva en `apps/admin/src/superadmin/`, dentro de `SuperAdminGate`, enlazada desde
`HubPage`:

- Tabla de versiones publicadas: versión, fecha, tamaño, SHA-256 (con copiar al portapapeles),
  descargas.
- Botón **"Generar código de instalación"** por versión → muestra el código **grande**, con
  su caducidad y un `note` opcional para saber a quién se le dio.
- Botón de descarga directa (para el Mac de Matías).
- Códigos activos con su cuenta atrás y las descargas consumidas.

### Frente 6 · Infraestructura y publicación

- `infra/docker-compose.prod.yml`: montar `/opt/mipiacetpv/releases:/srv/releases:ro` en `api`
  y exportar `RELEASES_DIR=/srv/releases`.
- `infra/Caddyfile`: en `mipiacetpv.com`, `handle /apk*` → `reverse_proxy api:3001`, **antes**
  del `handle` de estáticos y **fuera** del `encode`. Ese handle lleva sus propias cabeceras de
  seguridad (`script-src 'none'`, `style-src 'self' 'unsafe-inline'`), porque el bloque de
  cabeceras actual vive dentro del `handle` de la PWA.
- `infra/publicar-apk.sh <ruta-al-apk>`: lo ejecuta **Matías desde el Mac** (Cowork no tiene
  red). Sube el APK por `scp` a `/opt/mipiacetpv/releases/`, **verifica que el SHA-256 remoto
  coincide con el local** y aborta si no, regenera `releases.json` y `latest.json` y los
  mueve atómicamente (`mv` sobre el mismo filesystem). Idempotente: republicar la misma
  versión sobreescribe sin duplicar entradas.
- `docs/android/distribucion-apk.md`: el procedimiento completo escrito para que lo repita
  otra persona — build, publicación, generación de código, instalación en el terminal,
  y **dónde está el keystore y qué pasa si se pierde**.

### Frente 7 · Checklist de implantación

Añadir a la documentación de implantación (o crear `docs/implantacion/terminal-android.md`):

1. Ajustes → permitir "instalar apps desconocidas" para el navegador que descarga.
2. Abrir `mipiacetpv.com/apk`, teclear el código, descargar.
3. **Cotejar el SHA-256** con el que muestra la página antes de instalar.
4. Instalar y abrir.
5. `wm density 240` (o su equivalente por menú) → viewport 1280×800, el tamaño para el que
   está diseñada la UI.
6. Primer login **online** para bajar catálogo y paquete offline.
7. Dejar la app como lanzador si el terminal lo permite.

## Restricciones

- El keystore de release **nunca** al repo: 1Password, contraseña aparte, y anotado dónde
  queda. Perderlo significa no poder actualizar nunca esa instalación.
- Ningún `.apk`, `.aab`, `.jks` ni `keystore.properties` puede quedar staged. Comprobarlo con
  `git status` antes de cerrar.
- Un usuario no autenticado y sin código **no puede** descargar ni enumerar releases.
- `apps/tpv-web` sigue siendo la única fuente de UI: la página `/apk` es una excepción
  consciente (la sirve la API porque tiene que sobrevivir a Chrome 81) y se documenta como
  mini-ADR en `docs/04-stack-y-decisiones.md`.
- CI en verde, incluido el paso de humo, antes de dar el bloque por cerrado.

## Entregables

- `apps/tpv-android/scripts/build-release-apk.sh` completado (Frente 1).
- Versión visible en la app (Frente 2).
- `apps/api/src/releases/` + migración Prisma + acciones de auditoría (Frentes 3 y 4).
- `apps/admin/src/superadmin/DescargasPage.tsx` + entrada en el hub (Frente 5).
- `infra/publicar-apk.sh`, cambios en `Caddyfile` y `docker-compose.prod.yml` (Frente 6).
- `docs/android/distribucion-apk.md`, `docs/implantacion/terminal-android.md`,
  mini-ADR en `docs/04-stack-y-decisiones.md` y `docs/blocks/A3-distribucion-done.md`.
- Tests: caducidad del código, agotamiento de descargas, código inexistente, límite por IP,
  cabeceras del binario y `latest.json` sin URL.

## Criterios de aceptación

1. Desde un AP11 de fábrica, escribiendo `mipiacetpv.com/apk` y un código, se descarga e
   instala la APK sin cable ni PC.
2. La página `/apk` se ve correctamente **en Chrome 81** (verificar en el terminal real, no
   sólo en el Mac).
3. Un usuario sin código y sin sesión de super-admin no puede descargar ni listar releases.
4. El SHA-256 publicado coincide con el del fichero instalado.
5. La app instalada apunta a producción y hace login de cajero correctamente.
6. La app muestra su `versionName (versionCode)` dentro de la interfaz.
7. El procedimiento de build y publicación está escrito y es repetible por otra persona.

## Fuera de alcance (explícito)

- Auto-actualización OTA desde la propia app (`latest.json` deja la puerta abierta; el
  bloque no la implementa).
- Publicación en Play Store, abierta o cerrada.
- Teclado numérico propio del cobro (es el otro hallazgo del 27, y es su propio bloque).
- MDM, modo kiosco y aprovisionamiento masivo de terminales.
- Datáfono, mDNS y cualquier otro periférico.

## Reparto

- **Claude Code**: Frentes 1 a 6 (código, scripts y docs). No commitea; no pushea.
- **Matías**: crear el keystore definitivo y guardarlo, ejecutar `publicar-apk.sh` contra el
  VPS, y la prueba física en el AP11.
