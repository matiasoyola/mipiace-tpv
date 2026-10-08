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
- **HECHO el 08-10, 12:30–13:40.** Resultado en el §5. El D8 venía del `pm clear` de anoche:
  hubo que volver a vincularlo (código nuevo) y entrar con email y PIN, no sólo PIN.

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
2. **Cerrar la app ANTES de instalar**: `adb shell am force-stop es.mipiace.tpv` y luego
   `adb install -r <apk>` en el D8. **Sin `pm clear` todavía**: se queda emparejado a ENSAYO para la
   pasada.
   Si se instala con la app abierta, el D8 arranca **en blanco**: Android marca como malo el proceso
   aislado del WebView (`cr_ChildProcessConn: Failed to establish the service connection`,
   `ActivityManager: ... process is bad`) y ni `force-stop` ni `kill-all` ni relanzar lo quitan —
   sólo el reinicio del terminal, que cuesta volver a sacar el puerto de depuración inalámbrica a
   mano (§6). Pasó el 08-10 instalando la 1.23.0. **No es un fallo de v2-H1 con WebView 101**: tras
   reiniciar, el proceso hijo arranca limpio y la app entra.
3. Publicarla en /apk (`infra/publicar-apk.sh`) **después** de la pasada, no antes.

## 5 · La pasada en el D8 · el «después» y las puertas

En la cuenta ENSAYO, con la APK nueva y el servidor desplegado.

### Medida (el listón)

| | Antes (1.22.0) | Después (v2-H1) |
|---|---|---|
| Comanda típica · toques | **10** (10 / 10 / 10) | **9** (9 / 9 / 10) |
| Comanda típica · segundos (mediana de 3) | **26,5** (30 / 26,5 / 15,1) | **12,9** (32,7 / 12,9 / 9,9) |
| Cobro en efectivo · toques | **4** (4 / 4 / 4) | **4** (4 / — / 4) |
| Cobro en efectivo · segundos (mediana de 3) | **15,1** la 1.ª · **5,8** entrenado | **6,2** la 1.ª · **4,0** entrenado |
| Dónde tuvo que pararse a leer | buscar la familia y el producto dentro: 7,0 s hasta Cafés, 4,4 s hasta Desayunos, 5,5 s la tostada, 4,4 s hasta Cervezas | ya no hay paradas largas; la única fue 10,9 s buscando la Tostada dentro de Desayunos |

Cómo se midió el «antes» (08-10, cuenta ENSAYO `81f2177b`, APK 1.22.0):

- **Cesto fijo**, el mismo para el después: 2 × Café con leche + 1 × Tostada con tomate +
  2 × Caña mediana = **9,10 €**. El §1 decía «2 cafés con leche + 1 tostada + 2 cañas», pero en el
  catálogo no existen «Tostada» ni «Caña» a secas (seis tostadas, dos cañas), así que se concretó.
- **Secuencia medida**: del toque en la mesa al toque en el botón final (Enviar comanda / Cobrar).
  El toque de «Mapa» para volver a la sala queda fuera.
- **Comanda** en B1, B2 y B3 (una mesa libre por repetición, misma condición de partida).
  **Cobro** sobre esas mismas tres, en efectivo con el chip rápido de 20 € (vuelta de 10,90 €).
- Toques y segundos salen del **driver táctil del D8** (`/dev/input/event2`): cada toque con su
  marca de tiempo y su coordenada, no contados a ojo en el espejo. La 2.ª repetición del cobro
  se descarta en tiempo (41,3 s, con un hueco de 37,4 s escribiendo); sus toques sí valen.
- **El aprendizaje pesa**: 30 → 26,5 → 15,1 s con los mismos 10 toques. Cuando se mida el después,
  Matías ya vendrá entrenado, así que la comparación honesta de **tiempos** es contra los ~15 s;
  la cifra limpia son los **toques**.

El «después» se midió el 08-10 a las 16:00, misma cuenta, mismo cesto, APK 1.23.0 (`106f0d3`) y el
servidor en el mismo `106f0d3`:

- **Toques: 10 → 9.** La ruta del después es «Ahora» (que abre sola) → Café con leche ×2 →
  Desayunos → Tostada con tomate → Cervezas → Caña mediana ×2 → Enviar. Se ahorra el toque de
  entrar en Cafés, porque el café ya está en «Ahora». **No se ahorran más porque la Tostada con
  tomate NO está entre los 20 de «Ahora»**: si estuviera, serían 8.
- **Segundos, entrenado contra entrenado: 15,1 → 9,9** en la comanda, y **5,8 → 4,0** en el cobro.
  Un tercio menos en los dos.
- La 3.ª repetición salió en 10 toques porque uno fue **una corrección**: pulsó Cafés y rectificó a
  Cervezas, familias vecinas de la misma fila. En tres pasadas a velocidad, una familia equivocada.
- La 2.ª repetición del cobro no cuenta en tiempo: se cobró el **importe exacto**, sin vuelta. Dato
  suelto que vale: **el cobro justo son 3 toques**, uno menos que con vuelta.

### Puertas (cada una ✅ / ❌ con captura)

1. **Se reconoce sin leer**: cada familia de un vistazo; la de Licores entera sin desplazar.
   *Después (08-10): ✅ Licores sale en 5 × 7, los 31 enteros y sin desplazar. Color de familia en
   todo el botón. **Pero el botón de producto ya no lleva el precio**, y eso no lo declara ni el
   prompt ni el `-done` (ver §8).*
2. **«Ahora»** abre por defecto y tiene sentido para la hora del día.
   *Después (08-10): ✅ abre sola y es la primera. A las 16:00 encabezan Café con leche, Montado y
   Caña mediana, que es razonable. Dos peros: **no trae la Tostada con tomate** del cesto, e
   **«Ingrediente extra» gasta uno de los 20 huecos** siendo un añadido de modificador.*
3. **La comanda**: se ve qué está enviado y qué no; − y + sobre la línea funcionan con un dedo.
   *Antes (08-10): no se pudo probar — en 1.22.0 «Enviar comanda» falla con «Sin impresora
   configurada» y no envía nada. Es la puerta 11.*
   *Después (08-10): **sigue sin poderse probar**, mismo mensaje en 1.23.0. Lo que sí se ve: la
   comanda separa «SIN ENVIAR» como bloque, con − y + grandes sobre la línea, y la cantidad aparece
   dentro del propio botón del producto.*
4. **La sala**: Barra arriba; ocupada se distingue de libre de reojo; el importe cabe en la tarjeta.
   *Después (08-10): ✅ las tres. Oscuro, Barra la primera, taburetes redondos y mesas
   rectangulares del mismo tamaño, ocupada en relleno coral con el importe grande dentro.
   ❌ **El plano no se reparte**: las bandas acaban a 1320 px de los 1920 del D8 y el tercio derecho
   queda en negro. Con 16 mesas sobra pantalla y no se usa (Matías, 08-10).*
5. **N1 · teclado del sistema**: no sale el QWERTY al entrar en la venta, tras cobrar, tras la
   comanda, ni encima del pad del cobro mixto (lo arregló v1.22; se confirma en el hierro).
   *Antes (08-10): ✅ sobre el pad del cobro. Falta confirmar los otros tres momentos.*
   *Después (08-10): ✅ los cuatro. En tres comandas y tres cobros seguidos no salió el QWERTY
   ni una vez.*
6. **Cobro mixto** con el pad: el importe pre-relleno se puede corregir (C2).
   *Antes (08-10): ✅ viene el importe exacto y hay chips 5/10/20/50/100 y C.*
   *Después (08-10): ✅ igual, la hoja no cambió. **El importe del cambio sigue pequeño**: con 50 €
   sobre 37,30, «Cambio 12,70 €» sale a la mitad de tamaño que «TOTAL 37,30 €», y lo mismo se dice
   dos veces y con dos palabras («sobran» arriba, «Cambio» abajo). Ver §8.*
7. **Las hojas en claro** sobre la pantalla oscura: ¿molestan para abrir o no? (Lo decide Matías.
   Si molestan, v2-H2 entra antes de la fecha.)
   *Después (08-10): **✅ JUZGADO POR MATÍAS: se quedan como están.** Las hojas en claro sobre la
   venta oscura **ayudan a leer, porque centran la vista**. No se cambian, y esto sale del alcance
   de v2-H2.*
8. **Cierre de turno con mesas abiertas** avisa (B2).
9. **Textos en español** (sin CASH, CARD, DRAFT) y sin «Sincronizando con Holded…» (N4, N6, en v1.22).
   *Antes (08-10): ✅ en la hoja de cobro — Efectivo / Tarjeta / Bizum / Vale / Mixto.*
   *Después (08-10): ✅ sin cambios.*

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

- **Las hojas en claro** (puerta 7): **resuelto el 08-10, no se tocan.** Matías las juzgó en el D8 y
  ayudan a leer porque centran la vista. Fuera del alcance de v2-H2.
- **El orden de las familias** sigue siendo alfabético, no el de la carta.

### Alcance de v2-H2 (lo que salió de la pasada del 08-10 en el D8)

1. **No se pueden combinar productos.** Un plato combinado con ingrediente extra se comanda como
   **producto aparte**: no dice qué ingrediente es ni a qué plato acompaña. Para la cocina y para el
   ticket, eso es una línea huérfana.
   El soporte existe desde B-Bar-Modifiers —`ModifierGroup`, `Modifier`, `ProductModifierGroup` en
   el esquema, y el CRUD entero en la API (`apps/api/src/admin/modifier-groups.ts`: listar, crear,
   editar, borrar)—, pero **el panel no tiene pantalla para crearlos**: no llama a
   `/admin/modifier-groups` ni una vez. Sin esa pantalla, quien monta una carta no puede más que
   hacer lo que se hizo aquí: el catálogo de La Maestranza cargó **`BOC-005` «Extra de ingrediente»
   (0,50 €)** y **`PLA-003` «Ingrediente extra» (1,00 €)** como productos sueltos.
   Es el punto más gordo de los cinco: los otros son de pantalla, éste es de datos.
2. **Los colores de las categorías no gustan** (Matías, 08-10, en el hierro). El qué poner en su
   sitio está **pendiente de decidir**; lo que está decidido es que los de ahora no se quedan.
3. **El plano de sala no ocupa la pantalla**: a 1920 px las bandas acaban en 1320 y el tercio
   derecho queda en negro. Con 16 mesas sobra sitio y no se usa.
4. **El importe del cambio tiene que verse mucho más grande.** Hoy «Cambio 12,70 €» sale a la mitad
   de tamaño que «TOTAL 37,30 €», que en ese momento ya no sirve, y lo mismo se dice dos veces con
   dos palabras distintas («sobran» arriba, «Cambio» abajo).
5. **El precio volvió a desaparecer del botón de producto**, y el cambio no está declarado en
   ninguna parte: ni en el prompt del bloque ni en el `-done` (§6 «decisiones sin preguntar» ni §10
   «diferencias»). En 1.22.0 cada tarjeta llevaba nombre y precio. Decidir si se queda así —y, si se
   queda, declararlo.
6. **«Ahora» no entiende de modificadores**: «Ingrediente extra» ocupa uno de los 20 huecos de la
   vista que existe para ganar velocidad, siendo un añadido y no algo que se comande solo. Se
   arregla solo en cuanto exista el 1.

- **Pantalla de comandas en cocina** (puerta 11): decidida el 08-10, sin construir. Es lo que más
  puede mover la fecha. Medido en el hierro el 08-10: hoy **no se puede comandar en absoluto** —
  «Enviar comanda» falla con «Sin impresora configurada · falta impresora WIFI para la sección» y
  la comanda no sale. Ésa es la razón de la puerta, no un punto aparte.
- **Fallo a investigar**: con la mesa **B1, de Barra**, el error de envío habla de la sección
  **SALON**. La sección que se usa para enrutar la comanda no es la de la mesa.
- **La Tostada con tomate no entra en «Ahora»**, así que la comanda típica no se resuelve entera
  desde la vista que abre: cuesta un toque más ir a Desayunos.
- **El aviso de error no caduca**: el cartel de «Sin impresora configurada» seguía tapando el nombre
  de la mesa seis minutos después; hay que cerrarlo a mano con «Entendido».
- **El catálogo no tiene «Tostada» ni «Caña» a secas**: seis tostadas y dos cañas (Caña mediana,
  Tubo de caña). Para un camarero nuevo es una duda en cada comanda.
- **Tras un `pm clear`, la primera entrada pide email completo**, no sólo PIN (no hay cajeros
  recientes). A prever en el guion del §7: entra Matías una vez y ya quedan guardados.
- **Botella de vino VIN-007** sin precio, fuera del catálogo.
- **Devoluciones sin Holded**: las rectificativas (V3) no existen; hace falta una instrucción de uso
  para Salomé.
- El camarero aparece como «lamaestranza» (la parte del email), no como Salomé.
- Al cerrar: actualizar la línea de La Maestranza en `claude/tablero-direccion.md` (peldaño 2, 🔴).
