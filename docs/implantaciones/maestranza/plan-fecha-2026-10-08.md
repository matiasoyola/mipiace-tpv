# La Maestranza · el avance para poder poner fecha a la implantación

Para una conversación nueva. Escrito el 08-10-2026 a las 11:50 por Dirección.
Se lee antes: `claude/maestranza-estado-2026-10-07-noche.md` (por qué se aplazó),
`claude/principio-venta-bajo-estres.md` (el listón) y `claude/maestranza-reset-noche-2026-10-06.md`
§3–§5 (el guion del día de la implantación, que sigue valiendo).

**Objetivo de la conversación:** llegar, hoy si se puede, a una pasada en el D8 que pase el listón de
«venta bajo estrés». Si la pasa, Matías pone fecha. Si no, sale una lista corta de lo que falta y no
se pone fecha.

**Cómo se trabaja:** una cosa por mensaje. Comandos completos para pegar (con `cd`, encadenados).
En el VPS, Claude prepara el comando y Matías lo pega. Claude no teclea contraseñas ni PINs.

---

## 0 · Dónde estamos (comprobado el 08-10 a las 11:45)

- **Producción = `c6192f5`** (desplegado el 08-10 a las 11:07). Lleva **v1.22 y v1.23** (PR #12,
  incluido el arreglo del importe que se salía de la tarjeta de la mesa) y clinica-5.
- **v2-H1 · la venta y la sala de hostelería** (el bloque de «venta bajo estrés»): rama
  `v2-h1-venta-y-sala`, cabeza **`80b876a`**, empujada y con su `-done`
  (`docs/blocks/v2-h1-venta-y-sala-done.md`). **Sin mergear.** Sale de `4ce04e8`: está por detrás de
  master (le falta clinica-5). Worktree vivo: `~/Developer/Claude/Projects/mipiacetpv-v2-h1`.
  - Qué trae: nombre de producto de 16 a 24 px, color de la familia en todo el botón, los 31 licores
    en una pantalla del D8, la comanda dice qué está en cocina, «Ahora» (los 20 más pedidos en ±1 h
    de los últimos 28 días; en una cuenta nueva sin ventas rellena por turnos entre familias y nunca
    sale vacía), sala en oscuro con formas y la Barra primero. **Sin migración.**
  - **Trae API nueva**: `GET /tpv/catalog/now` y el estado de envío de la comanda. Por eso **hay que
    desplegar el servidor** además de instalar la APK. Sin el servidor, «Ahora» cae a su relleno
    local, pero no se mide lo de verdad.
  - Pendiente declarado (§10 y §13): las hojas de modificadores, línea, mover, partir y cobro, y el
    menú de caja, siguen en **claro** sobre la pantalla oscura. Las familias salen en **orden
    alfabético**, no en el de la carta. Las dos cosas, para un v2-H2.
  - Toques medidos en el navegador: comanda 7 → 7, cobro 4 → 4. Lo que cambia es la atención que
    pide cada toque. **El tiempo de verdad sale del D8**, no del banco.
- **D8 (AP13 · Kozen D8, Android 13, WebView 101)**: lleva la **APK 1.22.0** (`98e9792`), emparejado
  a la cuenta **ENSAYO `81f2177b`** (código 449372 de anoche), con sala montada y tickets de prueba.
- **Cuenta nueva `8c1c7863-869c-4eb0-aba6-2161474b8175`**: DRAFT, sin activar, sin Holded, solo Caja,
  Hostelería. Datos fiscales de Salomé puestos, pie de ticket, 128 productos. Sin sala (se monta al
  activar). `lamaestranza@mipiacetpv.com` queda libre para ella.
- APK publicada en /apk: **1.19.0**. Construidas sin publicar: 1.20.0, 1.21.0 y 1.22.0.

---

## 1 · Medir el «antes» en el D8 · ANTES de tocar nada

El listón exige antes y después medidos en el hierro, y el «antes» solo se puede medir mientras el D8
tenga la 1.22.0. **Esto va primero.**

- Cuenta ENSAYO `81f2177b`. Espejo con scrcpy (ver §6).
- **Comanda típica**: mesa de la Barra → 2 cafés con leche + 1 tostada + 2 cañas → enviar.
- **Cobro**: esa mesa, en efectivo, con vuelta.
- Por cada una: **toques** (los cuenta Claude en el espejo) y **segundos** (cronómetro de Matías,
  tres repeticiones, se apunta la mediana). Y la nota de Matías: dónde tuvo que pararse a leer.
- Se apunta en la tabla del §5.

## 2 · v2-H1: al día con master, revisión y merge

1. Traer master (`c6192f5`) a la rama y empujar (comando completo, con guarda de conflictos como el
   de clinica-5). La CI corre sola.
2. **Revisión de Dirección** del PR, con el `-done` delante. Mirar sobre todo:
   - que `GET /tpv/catalog/now` filtra por tenant y por tienda, y que la franja en SQL con
     `AT TIME ZONE 'Europe/Madrid'` y la vuelta de medianoche tienen test;
   - el offline de «Ahora» (tres peldaños, nunca rejilla vacía);
   - el §6 «Decisiones tomadas sin preguntar»: sólo se le llevan a Matías las que abran un debate de
     verdad;
   - que RETAIL (Sole) no cambia: el oscuro es solo de la venta y la sala de hostelería.
3. CI en verde (`gh pr checks <n> --watch --fail-fast && gh pr merge <n> --merge`). Ojo: entre las
   00:00 y las 06:00 de Madrid, los e2e `f3-fichar` y `f8-colegio` se ponen rojos por el reloj (lo
   arregla el bloque `e2e-fichaje-sin-reloj`). No es la rama.

## 3 · Desplegar el servidor

Esperar al `publish` de master y, **con copia de la base antes**:

```
ssh root@76.13.142.28 'bash /opt/mipiacetpv/infra/backup-postgres.sh && ls -lh /opt/mipiacetpv/backups | tail -1 && cd /opt/mipiacetpv && IMAGE_TAG=<sha-corto> bash infra/deploy.sh' && curl -s https://api.mipiacetpv.com/health
```

`IMAGE_TAG` con el SHA **corto** (7). Rollback: el mismo comando con `c6192f5`. Si da `denied`, ha
caducado el token de GHCR del VPS (lo renueva Matías). No afecta a nadie en el bar: RETAIL no cambia
y La Maestranza todavía no vende.

## 4 · La APK nueva en el D8

1. Construir desde master limpio, en el principal:
   `apps/tpv-android/scripts/build-release-apk.sh <versión>`. La versión: **la siguiente a la más
   alta construida**, que hoy es la 1.22.0, así que **1.23.0** (code 12300). Ojo: la 1.22.0 se
   construyó en el worktree `mipiacetpv-v1-22`, retirado el 08-10, así que su binario ya no está en
   disco; no hace falta, la nueva la sustituye. El script aborta si no está firmada o si no lleva el
   backend de producción.
2. `adb install -r <apk>` en el D8. **Sin `pm clear` todavía**: se queda emparejado a ENSAYO para la
   pasada.
3. Publicarla en /apk (`infra/publicar-apk.sh`) **después** de la pasada, no antes.

## 5 · La pasada en el D8 · el «después» y las puertas

En la cuenta ENSAYO, con la APK nueva y el servidor desplegado.

### Medida (el listón)

| | Antes (1.22.0) | Después (v2-H1) |
|---|---|---|
| Comanda típica · toques | | |
| Comanda típica · segundos (mediana de 3) | | |
| Cobro en efectivo · toques | | |
| Cobro en efectivo · segundos (mediana de 3) | | |
| Dónde tuvo que pararse a leer | | |

### Puertas (cada una ✅ / ❌ con captura)

1. **Se reconoce sin leer**: cada familia de un vistazo; la de Licores entera sin desplazar.
2. **«Ahora»** abre por defecto y tiene sentido para la hora del día.
3. **La comanda**: se ve qué está enviado y qué no; − y + sobre la línea funcionan con un dedo.
4. **La sala**: Barra arriba; ocupada se distingue de libre de reojo; el importe cabe en la tarjeta.
5. **N1 · teclado del sistema**: no sale el QWERTY al entrar en la venta, tras cobrar, tras la
   comanda, ni encima del pad del cobro mixto (lo arregló v1.22; se confirma en el hierro).
6. **Cobro mixto** con el pad: el importe pre-relleno se puede corregir (C2).
7. **Las hojas en claro** sobre la pantalla oscura: ¿molestan para abrir o no? (Lo decide Matías.
   Si molestan, v2-H2 entra antes de la fecha.)
8. **Cierre de turno con mesas abiertas** avisa (B2).
9. **Textos en español** (sin CASH, CARD, DRAFT) y sin «Sincronizando con Holded…» (N4, N6, en v1.22).

### En la cuenta NUEVA, en DRAFT («Probar TPV»)

10. Una venta de 3 líneas: el ticket enseña las líneas con IVA, **una sola base imponible** (10 %) y
    el total. Es la primera vez que `ticket-con-iva` se ve en una cuenta sin Holded.
11. **Comandas a cocina — DECIDIDO por Matías el 08-10: van a una PANTALLA de gestión de comandas
    en cocina, NO a impresora.** Hoy esa pantalla **no existe** en el producto: «Enviar a cocina»
    genera PDFs y emite el evento en tiempo real `ticket.sent_to_kitchen`
    (`apps/api/src/realtime/store-events.ts`), que es la base sobre la que se construiría. Es un
    bloque nuevo (pantalla de cocina: comandas por mesa en orden de llegada, marcar en
    preparación / lista, qué hay nuevo desde el último envío) y **la fecha depende de él**. Pasa
    por la ficha del §5 del tablero de Dirección antes de escribir su prompt.
    La impresora térmica USB ESC/POS queda solo para el ticket del cliente, si Salomé lo quiere en
    papel.

## 6 · El D8 · cómo se conduce

- adb: `~/adb35/platform-tools/adb`, por `MacOS-MCP__Shell`. Los `connect` van con
  `osascript -e 'tell application "Terminal" to do script "…"'` (por el permiso de Red local de
  macOS). Dispositivo `192.168.5.136:5555` (tcpip fijado el 06-10). Si se ha reiniciado: Ajustes →
  Opciones de desarrollador → Depuración inalámbrica, sacar el puerto, conectar y repetir
  `adb tcpip 5555`.
- Espejo: `/usr/local/bin/scrcpy -s 192.168.5.136:5555 --window-title AP13-Maestranza`.
- Ya hecho, no se repite: zona horaria Europe/Madrid (la automática, desactivada) y
  `svc power stayon true`.
- **`pm clear es.mipiace.tpv` sólo con el OK de Matías**, y sólo al final (§7).
- Si se miden secuencias con DevTools sobre el WebView: el procedimiento corregido está en la memoria
  del proyecto (`project_pruebas_fisicas_ap11`).

## 7 · Si pasa: la fecha, y lo que se deja listo

- Matías pone la fecha.
- Se publica la APK en /apk.
- **El día antes**, no ahora: `pm clear` del D8, para que llegue al bar sin la cuenta de ensayo.
- El día de la implantación, el guion de `claude/maestranza-reset-noche-2026-10-06.md` §3–§5:
  activar `8c1c7863` con `lamaestranza@mipiacetpv.com`, renombrar la tienda a «Bar La Maestranza»,
  montar la sala (Barra B1–B4, Salón M1–M6, Terraza T1–T6, capacidad 4), generar código, emparejar
  el D8, wifi, impresora, camareros como cajeros, y la primera venta real = factura C1 nº 1, con el
  papel mirado y el arqueo hecho.

## 8 · Abierto, que puede mover la fecha

- **Las hojas en claro** (puerta 7) y **el orden de las familias**: si Matías dice que impiden abrir,
  v2-H2 entra antes de la fecha.
- **Pantalla de comandas en cocina** (puerta 11): decidida el 08-10, sin construir. Es lo que más
  puede mover la fecha.
- **Botella de vino VIN-007** sin precio, fuera del catálogo.
- **Devoluciones sin Holded**: las rectificativas (V3) no existen; hace falta una instrucción de uso
  para Salomé.
- El camarero aparece como «lamaestranza» (la parte del email), no como Salomé.
- Al cerrar: actualizar la línea de La Maestranza en `claude/tablero-direccion.md` (peldaño 2, 🔴).
