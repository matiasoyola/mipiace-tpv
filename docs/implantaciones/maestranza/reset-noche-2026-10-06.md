# La Maestranza · reset de la noche del 06-10 y despliegue del 07-10

Para una conversación nueva. Escrito el 06-10-2026 por la tarde. **La visita al bar es mañana,
miércoles 07-10** (la checklist decía 08-10 por error).

## Por qué hay que rehacer la cuenta

La cuenta `81f2177b` (activa, propietario `lamaestranza@mipiacetpv.com`) tiene dos facturas
reales de la serie C1 que hizo la auditoría del AP13: #000002 (2,60 €) y #000003 (6,90 €).
Salomé quiere empezar en la factura 1.

- `fiscal_records` es append-only por trigger (`mipiacetpv_fiscal_records_append_only`). Su
  única salida es borrar el tenant, y **no hay endpoint para borrar tenants**.
- Borrar a mano en la BD se descartó. El D8 cachea la cabeza de la cadena (`GET
  /tpv/fiscal/head`, `apps/tpv-web/src/lib/fiscal.ts`): la primera venta saldría como nº 4
  encadenada a una huella que ya no existe. Además habría que tocar tickets, líneas, pagos y los
  totales de los turnos.
- Contexto legal: VERI*FACTU se aplazó a **octubre de 2028** para todos (anuncio del 05-10-2026),
  y esos registros nunca se remitieron (V2 no existe; el QR apunta a PRUEBAS).

**Decisión: cuenta nueva desde cero. La 81f2177b se queda apartada, sin borrar.**

## Orden de esta noche

### 0 · Antes: que Code termine v1.22

- Rama `v1-22-el-terminal-del-bar`, prompt `docs/code-prompts/bloque-v1-22-el-terminal-del-bar.md`.
  Incluye N1 (el teclado del sistema tapa la venta y el pad del cobro mixto), C2, B4/N3/N5, N2 y B2.
- Antes del merge, pasada en el hierro del AP13. Ojo: **esa pasada no puede cobrar en una cuenta
  activa**. Se hace con «Probar TPV» de la cuenta nueva mientras está en DRAFT, o en el AP11.
- Merge, y deploy con `IMAGE_TAG=<sha>` desde la consola web de hPanel (srv1582207 → Consola web,
  entra como root sin contraseña). Claude no puede teclear ahí: lo pega Matías. Health en
  `https://api.mipiacetpv.com/health`.
- **v1.22 es front: la APK lleva su propio bundle.** Hay que publicar la APK nueva en /apk e
  instalarla en el D8 (por adb: `adb install -r`). Sin eso, el arreglo no llega al bar.

### 1 · Apartar la cuenta de ensayo 81f2177b

- Revocar el D8 en su panel (Dispositivos), entrando con «Configurar como OWNER» desde el super-admin.
- Renombrarla a «La Maestranza · ENSAYO 06-10 (no usar)» (PATCH en el super-admin).
- No hay estado «suspendida». Se queda ACTIVE, sin dispositivos.

### 2 · Cuenta nueva sin Holded (super-admin → Nuevo tenant)

- Nombre «Bar La Maestranza». Hostelería, con caja, **sin Holded**.
- Datos fiscales (de la factura F260010): **Eguez García Pabla Salome**, NIE **Y8303186Q**,
  Calle Paseo de los Rosales nº 6, 45542 El Casar de Escalona (Toledo), tel. 641 602 868.
- Pie del ticket: «Bar La Maestranza · Santa Olalla (Toledo)».
- Correo del propietario: `lamaestranza@` ya lo usa la cuenta de ensayo. Si el super-admin deja
  cambiar el email del OWNER viejo, se libera. Si no, se crea el alias
  `barlamaestranza@mipiacetpv.com` sobre el buzón `no-reply@` (hPanel → Emails → mipiacetpv.com;
  el plan tiene 1 buzón, los alias son gratis).
- Catálogo: CSV `docs/implantaciones/maestranza/catalogo-tpv.csv` (128 productos, precio CON
  IVA, 10 %), importado desde el super-admin. VIN-007 Botella de vino sigue fuera (sin precio).
- **En DRAFT**: «Probar TPV» → una venta de 3 líneas. Comprobar en el ticket: líneas con IVA
  (café con leche 1 x 1,60 €), **una sola base imponible** y el total. Esto valida ticket-con-iva
  (88eb317), que aún no se ha visto en papel.

### 3 · Activar, y montar después

- Activar → crea el OWNER, manda el correo de credenciales al alias y purga lo de prueba.
- Con «Configurar como OWNER» (30 min, auditado):
  - Renombrar la tienda a **Bar La Maestranza**. Así no sale «Tienda principal».
  - Sala: Barra B1–B4, Salón M1–M6 y Terraza T1–T6, capacidad 4.
  - Comprobar que «Mi cuenta» ya no muestra «Conexión con Holded».
  - Dispositivos → Generar código.
- La contraseña temporal y el PIN de Salomé los guarda Matías. Claude no los teclea.

### 4 · El D8 (AP13 · Kozen D8, Android 13, WebView 101)

- adb: `~/adb35/platform-tools/adb`, por `MacOS-MCP__Shell`. Los `connect` van vía
  `osascript -e 'tell application "Terminal" to do script "…"'` (Red local de macOS).
  Dispositivo `192.168.5.136:5555` (tcpip fijado el 06-10). Si se reinicia, hay que volver a
  sacar el puerto en Ajustes → Opciones de desarrollador → Depuración inalámbrica, conectar y
  repetir `adb tcpip 5555`.
- Espejo: `/usr/local/bin/scrcpy -s 192.168.5.136:5555 --window-title AP13-Maestranza`.
- **Borrar los datos de la app antes de vincular** (`adb shell pm clear es.mipiace.tpv`, con el
  OK de Matías). Así el equipo olvida la cadena fiscal y la sesión de la cuenta vieja. Después,
  instalar la APK nueva, abrir, meter el código y comprobar que sale la pantalla de login.
- Ya hecho y no hay que repetirlo: zona horaria Europe/Madrid (automática desactivada) y
  `svc power stayon true`.
- La entrada de Salomé (email + PIN) la teclea Matías.
- **Desde la activación, nada de cobros.** Para vaciar una mesa: «Más» → «Vaciar mesa».

### 5 · Miércoles 07-10 en el bar

1. Wifi del bar en el D8.
2. Impresora: solo vale USB ESC/POS. Plan B: impresora de 80 mm USB de los modelos ya
   configurados otras veces.
3. Salomé entra y cambia la contraseña del panel.
4. Camareros como cajeros (panel → Cajeros).
5. Primera venta real = **factura C1 nº 1**. Mirar el papel (líneas con IVA, una sola base) y
   hacer el arqueo. Eso cierra el criterio de «desplegado».

## Abierto, sin resolver

- Precio de la botella de vino (VIN-007).
- Devoluciones sin Holded: las rectificativas (V3) no existen. Hace falta una instrucción de uso.
- N4 «Sincronizando con Holded…» eterno y N6 (CASH/CARD en inglés) quedan fuera de v1.22.
- El camarero aparece como «lamaestranza» (la parte del email), no con el nombre de Salomé.
- Actualizar el tablero de Dirección.

## Estado de producción al escribir esto

- API 88eb317 (ticket-con-iva, PR #8), sin migraciones. Rollback: `IMAGE_TAG=6e6f0df`.
- master local: 906b279 (prompt v1.22 + auditoría).
