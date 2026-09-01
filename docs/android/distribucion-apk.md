# Distribución interna de la APK

Cómo se construye, se publica y se instala la app Android de mipiacetpv sin pasar por
Play Store. Escrito para que lo repita otra persona.

## Por qué existe esto

En las pruebas del 2026-08-27 sobre un AP11-1006 se confirmó que su Chrome de fábrica es el
**81** (2020) y no soporta `gap` en flexbox: pinta el TPV con los textos pegados
("Sala5 abiertas", "GEgemmamgc720,00 €"). El WebView del sistema es el **93** y sí lo
soporta. Conclusión: un terminal no se entrega con la PWA sobre su navegador de fábrica.
O se actualiza Chrome antes de salir, o se entrega la APK.

Play Store no sirve para esto: la revisión tarda, el canal cerrado obliga a gestionar
cuentas de tester, y una implantación no puede depender de eso. WhatsApp tampoco: recomprime,
no deja traza y nadie sabe qué versión acabó instalada.

## El camino completo

```
Mac de Matías                      VPS                        Terminal
─────────────                      ───                        ────────
build-release-apk.sh 1.10.2
   │  APK firmado + .sha256
   ▼
publicar-apk.sh <apk>  ──scp──►  /opt/mipiacetpv/releases/
                                  releases.json
                                        │
                          consola ──────┤ genera código de 6 dígitos
                                        │
                                        ▼
                                   mipiacetpv.com/apk  ◄──── teclea el código
                                                              descarga e instala
```

## 1. Construir

```bash
apps/tpv-android/scripts/build-release-apk.sh 1.10.2
```

El argumento es la versión del TPV que se empaqueta, sin la `v`. El script deriva el
`versionCode` (`MAJOR*10000 + MINOR*100 + PATCH` → `11002`) y deja en
`apps/tpv-android/build-releases/`:

- `mipiacetpv-1.10.2-11002.apk`
- `mipiacetpv-1.10.2-11002.apk.sha256` — el hash y, en una línea de comentario, el
  `gitSha`, el `versionName` y el `versionCode`.

**Aborta** si: el árbol de git está sucio (usa `ALLOW_DIRTY=1` para un build de urgencia,
que queda marcado `-dirty` para siempre), si `https://api.mipiacetpv.com` no quedó embebida
en el bundle, o si el APK no está firmado.

Requisitos: `keystore.properties` relleno, `JAVA_HOME` con openjdk@17 y `ANDROID_HOME` con
las command-line tools.

## 2. Publicar

Desde el Mac, **no** desde Cowork (que no tiene red):

```bash
infra/publicar-apk.sh apps/tpv-android/build-releases/mipiacetpv-1.10.2-11002.apk
```

Sube por `scp`, **recalcula el SHA-256 en el VPS** y aborta si no coincide con el local,
regenera `releases.json` y mueve las dos cosas con `mv` sobre el mismo filesystem.

Republicar la misma versión sobreescribe sin duplicar la entrada.

Comprobar después:

```bash
curl -s https://api.mipiacetpv.com/apk/latest.json
curl -sI https://mipiacetpv.com/apk
```

## 3. Generar el código

En `https://admin.mipiacetpv.com/superadmin/descargas`: botón **Generar código de
instalación** en la versión que toque. Opcionalmente una nota ("Thalía, terminal barra")
para saber a quién se le dio cuando haya varios vivos.

El código son **6 dígitos**, vale **60 minutos** y sirve para **3 descargas**. Tres y no una
porque el WiFi del bar corta y el instalador reintenta; un solo uso obligaría a llamar al
super-admin a mitad de instalación.

## 4. Instalar en el terminal

Ver `docs/implantacion/terminal-android.md`. En corto: permitir orígenes desconocidos, abrir
`mipiacetpv.com/apk`, teclear el código, **cotejar el SHA-256**, instalar.

## Dónde está el keystore, y qué pasa si se pierde

El keystore de release **no está en el repo** y no puede estarlo (`.gitignore` cubre `*.jks`,
`*.keystore` y `keystore.properties`).

- **Dónde**: en el Mac de Matías, con la contraseña en 1Password, en una entrada aparte de la
  del fichero.
- **Si se pierde**: Android identifica una app por `applicationId` + firma. Sin ese keystore
  no se puede publicar ninguna actualización que los terminales acepten instalar encima:
  fallan con `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. La única salida sería un
  `applicationId` nuevo, es decir, otra app: desinstalar la vieja en cada terminal, instalar
  la nueva y volver a emparejar. **Con datos locales de por medio** (paquete offline, sesión
  de cajero, outbox de cobros pendientes), que se pierden al desinstalar.
- Por eso: copia del `.jks` en 1Password además de en el Mac, y no sólo en el Mac.

## Decisiones que conviene no re-litigar

- **Código de 6 dígitos, no un enlace con token.** El teclado del SO del AP11 tapa el 52 %
  inferior de la pantalla; teclear una URL con token ahí es impracticable. El código de 6
  dígitos es el patrón que ya usamos para vincular terminales y funcionó a la primera.
- **La página `/apk` la sirve la API, no la PWA.** Se ve precisamente en el navegador roto.
  Si dependiera del bundle de `tpv-web` se rompería igual que el TPV. Mini-ADR en
  `docs/04-stack-y-decisiones.md`.
- **Los binarios viven fuera del repo y fuera de la imagen Docker**, en
  `/opt/mipiacetpv/releases`, montado read-only en el contenedor.
- **`latest.json` es público y sólo metadatos.** Saber que existe la 1.10.2 no es un secreto;
  el binario sigue detrás del código. No lleva URL del binario, y tampoco `gitSha`: el commit
  del build sólo se sirve en `/super-admin/releases`, que pide sesión, nunca en el
  `/apk/latest.json` público.
- **No se escribe ningún `latest.json` en disco**: la API lo deriva de `releases.json`. Dos
  ficheros con la misma verdad acaban desincronizados.
