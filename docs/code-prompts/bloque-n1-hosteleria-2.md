# Bloque n1-hosteleria-2 · que un camarero pueda usar el N1 en pleno servicio

## Por qué existe este bloque

`n1-hosteleria` (PR #38, mergeado) cerró el §9 en verde en el N1: mapa a 360, búsqueda con teclado,
comanda que llega al AP11, cobro. **Y aun así, usándolo Matías como camarero el 23-10, hay momentos del
flujo normal en que un humano es incapaz de usarlo.** Las medidas decían «está a la vista»; la mano
decía «no se puede trabajar».

La lección, que es la regla de este bloque: **la pasada del 23-10 se hizo con la sala limpia** —sin
avisos de cocina entrando, sin urgentes, sin mesas por recoger—. En un servicio de verdad todo eso
pasa a la vez, y ahí es donde se rompe. Por eso aquí **nada se mide con la sala vacía**.

¿Y qué? El N1 sólo vale si el camarero va a la mesa, marca, revisa y manda **sin zoom, sin buscar y
sin esperar**, también cuando cocina le está avisando de dos platos listos y entra una alergia. Los
terminales de 10" y 15" se quedan **exactamente** como están.

## Leer antes

1. `docs/blocks/n1-hosteleria-done.md` entero (el umbral `UMBRAL_MANO_PX`, `RepartoDeSala`,
   `repartoDelCatalogo`, la fila de cantidad que ya cede al buscar, §9 de la pasada).
2. `docs/qa/2026-10-23-n1-hosteleria/` (capturas de la pasada).
3. Del proyecto: `principio-venta-bajo-estres` y `project_principio_cobro_en_mesa`.

## Antes de nada

- **Una sola sesión.** Comprueba con `ps aux | grep -i claude` que no hay otra sesión de Code viva en
  el worktree. Si la hay, **para y avisa**. El 23-10 dos sesiones se pisaron en el mismo N1.
- Comprueba que el PR #38 está mergeado (`gh pr view 38 --json state,mergedAt`).

## Base de rama

Worktree `~/Developer/Claude/Projects/mipiacetpv-n1-hosteleria-2`, rama `n1-hosteleria-2`, **desde
`master`** actualizado. PR contra `master`.

## La restricción del bloque (va primero)

**Los terminales grandes no cambian ni un píxel** (AP11, AP12, AP13, D8). Todo va por debajo de
`UMBRAL_MANO_PX`, que ya existe: no se crea otro umbral. Prueba con capturas antes/después a
1280×800 y 1442×811 con su diff, como en n1-hosteleria.

## Las reglas de mano que salen de los hallazgos

Valen para **todas** las pantallas de venta y sala del N1, no sólo donde se vio el fallo:

- **R1 · Una capa a la vista.** En la mano nunca se ven dos ventanas apiladas. Si se abre una encima,
  la de debajo no asoma.
- **R2 · Ningún aviso tapa trabajo.** Los avisos de cocina no se apilan encima de la comanda ni de
  ningún botón.
- **R3 · Todo lo que se toca mide ≥ 48 px**, y toda hoja o ventana se cierra también con el «atrás» de
  Android.
- **R4 · Se lee a brazo extendido.** Contraste AA (4,5:1) sobre el color de cada estado y un tamaño de
  letra mínimo, el mismo en todo el bloque (decídelo y justifícalo). Si no cabe, **se enseña menos, no
  más pequeño**.

## Alcance · los hallazgos de Matías (23-10)

### 1 · El resumen de la comanda no llega arriba
Encima de la hoja se apilan «T6 listo para servir» y «M5 listo para servir»; la hoja queda baja y las
líneas se ven **de una en una**. Debe ocupar el alto completo. Con seis líneas, las seis a la vista
sin desplazar. Matías: «la página de cobrar la veo bastante bien, **es la previa la que no está nada
bien**».

### 2 · Mesas plegables por zonas, sin zoom
En «Todas», cada zona (Barra, Salón, Terraza) es una sección que se pliega y despliega de un toque,
con cabecera de 48 px. **Plegada, la cabecera dice lo que importa**: cuántas mesas ocupadas, por
recoger y con platos listos. El estado plegado se recuerda en el aparato. El camarero no debe
necesitar el zoom del sistema en ningún momento.

### 3 · Los avisos de cocina tapan (R2)
Van a una franja estrecha o a un contador fijo que no tapa nada; al tocarlo se ven los avisos. Una
mesa con plato listo se marca **también en el mapa**, que es donde el camarero decide adónde ir.

### 4 · Ventanas apiladas (R1)
Al entrar un «Urgente · alergia», se abre encima y la ventana de debajo sigue ocupando ~15 % de la
pantalla. En la mano se ve una sola capa.

### 5 · Fuera la fila de cantidades fijas en la mano
La fila 1–6 no ayuda en este formato. En la mano **no se pinta nunca** (no sólo al buscar); la
cantidad se corrige con los −/+ de la línea. Terminales grandes, igual que hoy.

### 6 · La X de cerrar el resumen es minúscula (R3)
48 px, y el resumen se cierra también con «atrás».

### 7 · Mesa «por recoger»: no se lee lo que hay en el círculo (R4)
Revisa **todos** los estados de mesa, no sólo «por recoger».

### 8 · Opciones de una mesa «por recoger», muy pequeñas
En la mano, las opciones de una mesa salen en una **hoja inferior a todo el ancho**, botones de
≥ 48 px, letra legible y **la acción más probable primero**. Revisa el menú de opciones en todos los
estados.

**Busca tú más casos de R1–R4** en venta, mapa, comanda, tickets pasados y cobro. Lo que encuentres
fuera de los ocho, arréglalo si es de estas reglas y anótalo como decisión; si es otra cosa, anótalo
sin tocarlo.

## Fuera de alcance

- **La impresora integrada del N1 (IPOS)**: bloque propio, `n1-impresora`.
- La pantalla de cobro: Matías la ve bien. Sólo se toca si alguna regla R1–R4 lo exige.
- Fechas en la hora de la tienda (el N1 sigue en Asia/Shanghai): bloque propio.
- El «process is bad» del WebView: si aparece, se reabre la app y se anota.

## Verificación

### El banco con un servicio en marcha (obligatorio)
La stack del banco, sembrada **como Sirope** (23 mesas, 13 familias) **y en pleno servicio**: mesas
en todos los estados (libre, ocupada, cuenta, por recoger, olvidada), **dos o más avisos de «listo
para servir» entrando**, una comanda abierta de seis líneas y un «Urgente · alergia» que llega
mientras está abierta. Mide a 360×720 y 360×449 (teclado). Ninguna medida con la sala vacía.

Tabla en el `-done`: alto útil del resumen y líneas visibles, capas visibles a la vez, `y` y
`elementFromPoint` de cada botón con avisos activos, tamaño de cada objetivo táctil, contraste por
estado de mesa.

### Sabotajes
Uno por regla y por hallazgo, con su rojo en el `-done` (en navegador si sólo se ve ahí). Como mínimo:
el resumen sin el alto completo, un aviso encima de la comanda, dos capas visibles, la fila de
cantidad en la mano, una X de 32 px, el texto de una mesa por debajo de 4,5:1, y la fila de cantidad
que desaparece también a 1280.

### La pasada en el hierro (criterio de cierre)
Dos partes, y **las dos hacen falta**:

1. **Tú, por adb en el N1** (Sirope · Caja 1 en ensayo, cajero `soporte+sirope@mipiace.es`; el
   puerto y la IP cambian, **pídelos**; el KDS del AP11 **abierto y con `last_seen_at` al día antes
   de enviar**): el mismo servicio en marcha que en el banco, con avisos reales de cocina desde el
   AP11. Capturas numeradas en `docs/qa/2026-10-XX-n1-hosteleria-2/`.
2. **Matías usándolo con sus manos**, de abrir mesa a cobrar, con avisos entrando. **El bloque no se
   cierra hasta que él diga que lo puede usar.** Lo que dicte va al `-done` tal cual.

Todo en ensayo. Apunta todo lo que dejes en Sirope-ensayo (tickets TEST, borradores, comandas, mesas
no libres) para el «Resetear ensayo».

## Entregables

- Rama `n1-hosteleria-2`, commits pequeños en español.
- APK **1.29.0** con `build-release-apk.sh`, **sin publicar**.
- `docs/blocks/n1-hosteleria-2-done.md`: lo que hay ahora, las decisiones tomadas sin preguntar una a
  una (tamaño mínimo de letra, cómo se marcan los avisos, qué se fue de cada mesa), la tabla del banco
  en servicio, los sabotajes, las capturas del N1 y del antes/después del D8 y el AP11, lo que dictó
  Matías y lo pendiente.
- **El push y el PR los hace Matías**: deja al final el comando completo, con el `cd` incluido.
