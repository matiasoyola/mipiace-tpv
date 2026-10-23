# Bloque residencia-cuadro-de-control · el menú del día a día y el panel como cuadro de control

Rama `residencia-cuadro-de-control`, worktree
`~/Developer/Claude/Projects/mipiacetpv-cuadro-de-control`, desde `origin/master`. PR contra `master`.
Escrito el 23-10-2026 desde el proyecto de Jardín de Gredos, el día que la primera residencia real se
encendió en producción y Matías vio el panel de Carmen: «hay demasiadas opciones, no parece un cuadro
de control». **Mockup validado por Matías (23-10-2026) para probarlo en uso; los cambios llegarán
cuando Carmen lo use.**

**Ábrelo después de que estén en `master` `hotfix-menu-capabilities` y `alta-minima`** (los dos tocan lo
mismo: el filtro del menú y la tarjeta de fichas incompletas del panel). Si alguno no está, dilo y para.

Lee antes:
1. **El mockup**: `docs/mockups/residencia-cuadro-de-control.html`. Es la referencia visual; la
   leyenda de abajo resume qué cambia.
2. `apps/admin/src/AdminShell.tsx` (`NAV_ITEMS`, el filtro, el pie del menú, el banner de cuenta en
   ensayo), `apps/admin/src/pages/residencia/PanelPage.tsx` y `apps/api/src/residencia/panel.ts`.
3. `docs/blocks/residencia-5-done.md` (el panel: una sola petición, cada cifra se abre, ≤ 3 toques y
   ≤ 10 s a cualquier dato), `alta-minima-done.md` y `hotfix-menu-capabilities-done.md`.
4. `docs/code-prompts/bloque-primer-acceso.md` (si ya está en master, su tarjeta de «residencia
   vacía» se integra aquí; si no, se deja dicho en el done para que primer-acceso la pinte dentro de
   este panel y no en el viejo).

## Por qué existe

Una peluquería entra en el panel una vez al mes; la dirección de una residencia vive en él. Hoy Carmen
ve unas 18 entradas en el menú (Tiendas, Agenda · Catálogo, Agenda · Horario, Edificio, Turnos,
Controles, Plantillas, Guardia…), casi todas de configurar una vez, y un panel que es una columna
estrecha y larga donde lo urgente compite con 20 líneas de obligaciones a 60 días.

¿Y qué?: al abrir el panel, la directora sabe en cinco segundos si hay algo que atender y lo abre con
un toque. Lo que se configura una vez no le estorba el resto de los días.

## Decisiones de producto ya tomadas — no se re-debaten

1. **El menú de una cuenta con la residencia encendida** tiene sólo cinco entradas, en este orden,
   cada una con su contador (el mismo número que el panel, de la misma petición):
   **Panel · Residentes** (fichas incompletas) **· Incidencias** (abiertas) **· Relevos** (sin
   confirmar) **· Obligaciones** (vencidas). Contador rojo si hay algo grave o vencido, ámbar si no.
2. **«Configuración»** abajo del todo, una sola entrada que abre una página índice con: Centro (la
   antigua «Tiendas», renombrada sólo en una residencia), Edificio, Turnos, Controles, Plantillas,
   Guardia, Personal, Indicadores (umbrales), Contrato de datos, Mi cuenta, Seguridad y Ajustes. Las
   rutas no cambian: es otra forma de llegar a ellas.
3. **Fuera del menú de una residencia**: las entradas de agenda (la agenda sigue encendida por debajo
   porque la clínica la exige, pero no se ve), el banner de «cuenta en ensayo» del TPV (habla de
   vender y cobrar), «Declaración responsable» del pie (es de Verifactu y de la caja) y la marca del
   TPV arriba: en su lugar, el nombre del centro y «Residencia · N plazas».
4. **El panel usa todo el ancho y cabe en una pantalla de 1366×768 sin scroll** con datos normales:
   - Cabecera: «Buenos días, <nombre>», la fecha y el turno en curso; a la derecha, residentes en el
     centro y fuera (ausencias, cuando existan; mientras no, sólo el total).
   - **Cuatro cifras** que se abren: incidencias abiertas (con cuántas graves y sin comunicar a la
     familia), relevos sin confirmar, obligaciones (vencidas · para hoy) y fichas incompletas (de
     alta-minima, con «Completar»).
   - **«Ahora»**: el turno en curso por planta (lo que ya existe en residencia-5) y «Lo que no puede
     esperar»: las incidencias abiertas ordenadas por gravedad, **máximo 4-5**, cada una con su
     estado en una línea.
   - **«Hoy»**: lo que vence hoy y lo vencido, como lista con su casilla (marcar hecho desde aquí si
     la obligación lo permite; si pide evidencia, la casilla abre la obligación), y los relevos sin
     confirmar con «Abrir». **Máximo 5-6 líneas**; el resto, «Ver obligaciones».
   - **El mes en una fila**: los indicadores como fichas pequeñas con su semáforo; «Ver indicadores».
   - «Vence en los próximos 60 días» sale del panel: vive en Obligaciones.
5. **Nada nuevo en la API salvo lo que falte en `panel.ts`** para las cifras del mockup (p. ej. el
   desglose «graves / sin comunicar»). Sigue siendo **una sola petición**.
6. **Comercios, clínicas y bares no notan nada**: todo esto se aplica sólo con `residencia` encendida.
7. En el móvil (390): el menú se pliega como hoy; las cuatro cifras en dos filas de dos; «Ahora» y
   «Hoy» uno debajo del otro.

## Respeta

- Sistema visual y metodología de front de Mi Piace; el mockup manda en disposición, jerarquía y
  densidad, no en cada píxel.
- Accesibilidad: los contadores tienen texto para lector de pantalla («4 incidencias abiertas»), no
  sólo un número.
- Lo que residencia-5 garantiza: ≤ 3 toques y ≤ 10 s a cualquier dato, cada cifra se abre.

## Fuera de alcance (declarado)

El panel para roles que no son dirección (la DUE, calidad): se valora cuando Carmen lo use. Cambiar el
contenido de Incidencias, Relevos u Obligaciones: sólo cambia cómo se llega a ellas.

## Cómo se cierra

- Tests: el menú de una residencia tiene exactamente esas cinco entradas + Configuración; el de un
  comercio no cambia; los contadores coinciden con las cifras del panel; el panel con 0 de todo enseña
  un estado tranquilo («Nada abierto. Todo al día.») y no cuatro ceros rojos.
- Captura a 1366×768 que demuestre que cabe sin scroll, y a 390, en `docs/qa/`, junto al mockup.
- CI verde (`ci`, `smoke`, `e2e`).
- `docs/blocks/residencia-cuadro-de-control-done.md` con la estructura de la metodología. Dice si la
  rama está pusheada y si hay PR.
- Commits pequeños en español, push y **PR contra `master`**. Ni merges ni despliegues.
