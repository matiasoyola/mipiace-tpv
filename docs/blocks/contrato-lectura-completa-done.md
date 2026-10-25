# Bloque contrato-lectura-completa · done

Rama `contrato-lectura-completa`, worktree `~/Developer/Claude/Projects/mipiacetpv-contrato-lectura`,
desde `origin/master` = `3847c9f` (el prompt del bloque). Escrito el 24-10-2026, el día de la
aceptación de la versión 2 del contrato en la primera residencia real.

**Pequeño, y toca el núcleo: clínica y residencia.**

En una frase: **el contrato de encargado no se acepta sin haber pasado por todo el texto**, y la fila
guardada lo dice. El día que alguien diga «yo eso no lo leí», la aceptación contesta que el texto
completo se mostró y se recorrió hasta el final antes de aceptar, con su huella, quién, cuándo y
desde dónde.

---

## 1 · Lo que había

El texto completo iba **plegado** detrás de «Leer el contrato completo» (un `<details>` que
primer-acceso puso ahí, con las tres líneas en llano encima haciendo de sustituto). Se podía marcar
la casilla y pulsar «Acepto» **sin haberlo abierto nunca**. Y la API no preguntaba nada: la única
condición para escribir la fila era ser la dueña.

Matías, el 24-10-2026: «no debemos dejar aceptar el contrato sin ver todo el texto; es la forma de
curarnos en salud».

---

## 2 · La pantalla (decisiones 1, 2, 4 y 5)

`apps/admin/src/pages/ContratoTratamientoPage.tsx`.

El texto está **desplegado**, en un recuadro con su propio scroll (`max-h-[46vh] md:max-h-[400px]`),
con las tres líneas en llano **encima** como resumen — ya no lo sustituyen. La casilla y «Acepto»
nacen **desactivados** y se abren cuando el final del texto ha pasado por la vista. Debajo del
botón, mientras tanto: «Baja hasta el final del contrato para poder aceptarlo».

### Un centinela, no una cuenta de píxeles

Decisión 2, y la razón es que los píxeles mienten: con `scrollTop + clientHeight >= scrollHeight`
hay que elegir un margen de tolerancia, y ese margen se come la última línea a un zoom del 110 %, o
no llega nunca con un `scrollHeight` fraccionario. Un `<div>` de un píxel al final del texto y un
`IntersectionObserver` con el recuadro como `root` contestan la pregunta de verdad: **¿se ha visto
el final?**

Y de paso sale gratis el caso de la pantalla grande: **si el texto cabe entero sin scroll, el
centinela ya está a la vista** y el observador avisa en su primer disparo. No hace falta ningún `if`
que lo diga.

### Un navegador sin `IntersectionObserver` cuenta como VISTO

Al revés de lo que parece prudente, y a propósito. Con el observador caído la casilla no se
activaría nunca y la dueña **no podría aceptar el contrato** — o sea, no podría usar la historia
clínica. Es la dirección de fallo de la casa (`caja-gate.ts`, `cajaIsDisabled`): una comprobación
que no se puede hacer no bloquea el trabajo. La API sigue exigiendo el campo, y lo que se pierde es
la garantía de que el texto pasó por delante, en un navegador que ninguna tablet ni ningún portátil
de 2026 tiene.

**Esto es lo que obliga a instalar el observador en los bancos.** Sin instalarlo, jsdom no lo trae,
la pantalla cuenta «visto» y los tests pasarían en verde con la puerta arrancada — es la memoria de
la casa de *sabotear el fichero que EJERCITA la línea*. Los dos bancos nuevos lo instalan;
`clinica-7-pantallas.test.tsx` no, y por eso no prueba la puerta (y está bien así: prueba otras
cosas).

### Lo demás de la pantalla

- **Accesibilidad** (decisión 5): el recuadro lleva `tabIndex={0}` y `role="region"`, así que con el
  foco dentro se recorre con flechas y AvPág. Sin el `tabIndex`, un recuadro con scroll no se
  recorre con teclado — y entonces quien no usa ratón no podría aceptar el contrato nunca.
- El aviso de debajo del botón es **una sola región `role="status" aria-live="polite"`** montada
  desde el primer render, y lo que cambia es su texto. Una región que nace con el mensaje dentro no
  se anuncia en varios lectores, y entonces el «ya puedes aceptarlo» no se oiría.
- **«Descargar el PDF» de la versión pendiente** (decisión 4), junto al recuadro y antes de aceptar.
  Es lo que se le manda a un abogado, y pedírselo después de aceptar llega tarde. No está detrás de
  la puerta del recorrido: leerlo no es aceptarlo.

### Y el TPV, igual

`apps/tpv-web/src/clinica/ContratoDeTratamiento.tsx`. El contrato se acepta desde **dos** sitios, y
el otro es la tablet de la dueña de una clínica. Sin esto la API le daría 400 y ella se quedaría con
un botón que falla, con la paciente delante. Mismo centinela, con el `root` en el viewport porque
allí scrollea la página entera y no un recuadro: el texto ya estaba desplegado.

El hook está **duplicado** en las dos apps (cuarenta líneas), porque no comparten paquete de UI y
crear uno para esto sería de más. Lo que **no** está duplicado es la regla, que vive en la API.

---

## 3 · La prueba lo guarda, y la API lo exige (decisión 3)

`clinical_processor_agreements` gana **una columna**: `texto_recorrido_en TIMESTAMPTZ`, nullable.
Migración `20261024010000_contrato_lectura_completa`.

**Una columna y no dos** (un booleano y un instante): son el mismo hecho — `IS NOT NULL` es el
booleano. Dos columnas que siempre van juntas son dos columnas que un día se contradicen, y esta
tabla es una prueba jurídica.

**`null` en tres casos, y los tres son verdad:** en una revocación (que no acepta nada); en las
aceptaciones **anteriores** a la regla, donde nadie midió nada; y nunca más en una aceptación nueva.
Un `DEFAULT false` habría escrito en las filas de hoy «no recorrió el texto», y eso no se sabe. Las
aceptaciones ya guardadas **no se tocan**.

El CHECK `clinical_processor_agreements_recorrido_coherente` cierra la combinación imposible (una
revocación con el recorrido puesto) y está escrito con `CASE` + `IS NULL` / `IS NOT NULL` en todas
las ramas, **a propósito**: un CHECK que evalúa a NULL **pasa**, así que una condición con `=` sobre
una columna nullable no cierra nada.

El trigger de solo-inserción de la tabla no se toca: un `ALTER TABLE ... ADD COLUMN` nullable es DDL
y no despierta un trigger `FOR EACH ROW`. Comprobado (§6).

### El 400

`POST /clinica/contrato/aceptar` responde **400 `TEXTO_NO_RECORRIDO`** a una aceptación que no traiga
`textoMostradoCompleto: true`. 400 y no 403 ni 409: no es de permisos ni de estado — es que la
petición no trae lo que hace falta.

La regla vive en el **camino de escritura** y no sólo en la pantalla, por lo de siempre: un `curl`
con el token de la dueña escribiría la misma fila sin haber pintado una letra, y una prueba que se
firma sin abrir el documento no demuestra nada. Mismo reparto que `esDuena` dos líneas más arriba y
que `hayConsentimiento` en `guardarFoto`.

**Los dos campos van DECLARADOS en el `schema` de la ruta**, y hace falta decirlo: con
`additionalProperties: false` Fastify no da 400 por un campo que no conoce — **lo borra**. Olvidarse
de declararlos habría dado un 400 «baja hasta el final» a una pantalla que sí lo manda, para siempre.
El test del 201 es el canario de eso.

### El reloj del aparato

El instante lo mide la pantalla (es la única que sabe cuándo se vio el centinela) y viaja en el
cuerpo, así que lo estampa el reloj de la tablet — y el reloj de una tablet miente. Un instante del
futuro, o de hace más de un día, no es «cuándo bajó hasta el final»: es un reloj mal puesto, y se
cambia por la hora del servidor.

**No se rechaza por eso.** El reloj de su tablet no es motivo para no poder aceptar un contrato —
misma dirección que el user-agent largo, que se recorta en vez de rechazarse. Lo que se pierde al
sanearlo son los segundos entre llegar al final y marcar la casilla, y eso no es lo que la fila
demuestra.

### Y el historial lo cuenta

La lista «Lo que se ha aceptado» dice, en la fila que lo trae: «El texto completo se mostró y se
recorrió hasta el final antes de aceptarlo (24 de octubre de 2026 a las 10:59)». En las anteriores a
la regla **no afirma nada**: `null` es «no se midió», no «no lo leyó», y escribir lo segundo sería
inventárselo.

---

## 4 · Sin caja no hay PIN de respaldo (punto 6)

Lo encontró el primer acceso real de la residencia. A la directora de Jardín de Gredos, **nada más
entrar**, la primera pantalla del programa le dijo «te hemos asignado un PIN de respaldo de 4
dígitos… lo usarás para autorizar descuentos o cierres con incidencia desde el TPV» — seis líneas
sobre descuentos y cierres, en una cuenta sin caja, sin TPV y que no lo va a tener.

Dónde se generaba, y qué faltaba:

| Sitio | Antes | Ahora |
| ----- | ----- | ----- |
| `activate` (super-admin) | ya no lo generaba | igual |
| «Mi cuenta» en el panel | escondido con `cajaEnabled` desde H1 | igual |
| **`POST /auth/login`** | lo generaba y lo devolvía **siempre** | con `cajaIsDisabled`, no |
| **`POST /auth/me/regenerate-owner-pin`** | sin gate | 403 `CAJA_DISABLED` |

El login era el camino por el que entra todo el mundo el primer día, y la ruta de regenerar seguía
ahí aunque el botón estuviera escondido: **esconder no es gatear** (la cabecera de `caja-gate.ts`,
literal).

`cajaIsDisabled` **falla hacia ENCENDIDO** si la fila no se puede leer, igual que en las 103 rutas
que lo usan. Fallar al revés dejaría sin PIN a una dueña que cobra, y el PIN es lo que autoriza un
descuento con la clienta delante.

---

## 5 · «Residentes» (punto 7)

Con la residencia encendida, la **prosa** de la pantalla del contrato dice «residentes»: la
entradilla («la historia clínica de tus residentes»), la lista de consecuencias de revocar («solo
hora, residente y servicio») y la devolución de datos («la historia completa de cada residente…
queda registrada residente a residente»). La palabra sale de `useTenantCapabilities().residencia`,
que es de donde la sacan las demás pantallas; `null` mientras no se sabe se lee como «no es
residencia», que es la palabra de los quince clientes de hoy.

**Sólo en pantalla.** `vista.apartados` es el texto jurídico versionado, viene del paquete tal cual y
**no se toca aquí**: cambiarlo es una versión nueva del contrato y otra aceptación. Medido en la
pasada: la prosa de la pantalla no dice «paciente» ni una vez, y el texto legal del recuadro lo dice
**10**. Ver la duda abierta 1.

---

## 6 · El SQL, medido contra Postgres

Cinco casos a mano sobre una base migrada de cero, porque un CHECK sólo se prueba ejecutándolo:

| | Caso | Esperado | Real |
| - | ---- | -------- | ---- |
| 1 | aceptación anterior a la regla, la columna en blanco | pasa | pasa |
| 2 | aceptación nueva con su instante | pasa | pasa |
| 3 | **revocación con el recorrido puesto** | falla | falla (`recorrido_coherente`) |
| 4 | revocación en blanco | pasa | pasa |
| 5 | **`UPDATE` de la columna nueva** | falla | falla (`CONTRATO_VIOLADO: … no se edita`) |

Y `prisma migrate diff` contra el esquema no saca ni una línea sobre `texto_recorrido_en` (lo que
saca son los tres residuos que master ya traía: el nombre del índice, el `DEFAULT` del `id` y el
nombre de la FK de revocación).

---

## 7 · La tabla de sabotajes

Cada línea se arrancó y se vio el rojo.

| Sabotaje | Qué se pone rojo |
| -------- | ---------------- |
| quitar el 400 de `TEXTO_NO_RECORRIDO` | 2 casos de `contrato-lectura-completa.test.ts` |
| quitar `textoMostradoCompleto` del `schema` de la ruta | 5 casos (el canario de `additionalProperties`) |
| guardar el instante del aparato tal cual | 2 casos (el reloj del futuro y el de hace una semana) |
| dejar de seleccionar `textoRecorridoEn` en la vista | 1 caso — **y antes NO**, ver abajo |
| panel · quitar el `disabled` de la casilla y el botón | 2 casos del banco de la pantalla |
| panel · volver a «pacientes» con la residencia encendida | 1 caso |
| panel · no mandar `textoMostradoCompleto` en el POST | 1 caso |
| TPV · quitar el `disabled` del botón | 1 caso |
| quitar el gate de la caja del login | 1 caso del banco del PIN |
| quitar el gate de `regenerate-owner-pin` | 1 caso |

**El sabotaje que no se veía, y lo que arregló.** Quitando `textoRecorridoEn: true` del `select` de
`vistaDelContrato`, el banco seguía **verde**: el doble de Prisma de `clinica-7-claves-fake.ts`
devolvía la fila entera e ignoraba el `select`. O sea, un `select` al que se le olvida una columna
pasaba aquí y en producción deja `undefined`. El doble ahora proyecta sólo lo seleccionado, como
Prisma — y las 220 suites de la API siguen verdes con él.

---

## 8 · El bucle visual, y lo que midió

`apps/e2e-ui/capturas-contrato-lectura.ts`, contra la cuenta de Jardín de Gredos.
Fotos y medidas en `docs/qa/2026-10-24-contrato-lectura-completa/`.

**La medida del bloque** (decisión 1: «alto razonable, que quepa la casilla y el botón debajo sin
bajar la página»):

| Ancho | El recuadro | Recuadro y «Acepto» a la vez |
| ----- | ----------- | ---------------------------- |
| escritorio 1280×800 | 398 px, con 2.204 px de texto dentro | **sí** — 600 px de los 800 |
| móvil 390×844 | 386 px, con 3.866 px de texto dentro | **sí** — 627 px de los 844 |

Se mide con el recuadro ya en pantalla y **no desde arriba de la página**, y es la memoria de la
casa — *medir contra el contenedor, no contra el viewport*. Desde `scrollY = 0` el botón cae siempre
bajo el pliegue, porque encima del recuadro están la entradilla, la banda de estado y las tres
líneas en llano; bajar hasta una sección es lo normal. Lo que decisión 1 pide es que el recuadro no
sea tan alto que, **estando ya delante de él**, haya que volver a bajar para encontrar el botón. No
lo es.

Lo demás que confirmó: el botón y la casilla nacen desactivados a los dos anchos; el aviso dice lo
que tiene que decir y cambia a verde al llegar al final; al final la casilla se abre pero el botón
**sigue cerrado hasta marcarla** (recorrerlo no es aceptarlo); después de aceptar el historial dice
que el texto se recorrió; y **entre «Entrar» y el contrato no aparece la pantalla del PIN**.

`capturas-primer-acceso.ts` se actualizó: ya no hay «Leer el contrato completo» que pulsar, y antes
de marcar la casilla baja el recuadro hasta el final. (La foto `09-contrato-desplegado-390.png` del
bloque anterior se queda como estaba: enseña una pantalla que ya no existe, y eso es lo que
documenta.)

---

## 9 · Decisiones tomadas sin preguntar

1. **Una columna (`texto_recorrido_en`) y no dos.** El prompt nombra `textoMostradoCompleto` y el
   instante; el campo de la PETICIÓN se llama así, pero en la base los dos hechos son uno. Razonado
   en §3.
2. **El 400 se comprueba ANTES del estado del contrato.** Un `curl` sin el campo sobre un contrato ya
   aceptado recibe `TEXTO_NO_RECORRIDO` y no `YA_ESTABA_ACEPTADA`. Cualquiera de las dos vale; se
   ahorra una lectura de la base.
3. **La fecha ilegible no rechaza.** Lo que decide el 400 es haber recorrido el texto, no saber
   estampar un ISO.
4. **El TPV entra en el bloque.** El prompt habla de «la página», pero la API rechaza a los dos
   clientes y el otro es el TPV: dejarlo fuera habría sido entregar un botón roto.
5. **Un `data-test="contrato-aceptacion"` en la fila del historial.** Para poder afirmar la ausencia
   de la frase sobre la FILA y no sobre la página: «se recorrió hasta el final» también está en el
   pie de debajo del botón, y la memoria de la casa dice que *«pan» está dentro de «ocupantes»*.
6. **`capturas-primer-acceso.ts` deja de morir con un ENOENT** quitándole las comillas a
   `EMAIL_OUTBOX_FILE`. Fuera del alcance del bloque, una línea, y la pasada no arrancaba sin ella.

---

## 10 · Dudas abiertas

1. **¿Una versión del contrato con el vocabulario de residencia?** El texto jurídico versionado dice
   «paciente» **10 veces** dentro del recuadro, y la prosa de alrededor dice «residentes». La
   directora de una residencia lee las dos cosas en la misma pantalla. Cambiarlo es una **versión 3**
   del contrato y **otra aceptación** de todas las clínicas, así que no se hace aquí. Lo que hay que
   decidir: si la v3 lleva «pacientes o residentes» en todo el texto, o si se publican dos textos
   (clínica / residencia) con versiones distintas — lo segundo multiplica las huellas y los PDF por
   dos.
2. **El `max-h-[46vh]` del recuadro.** Está medido a 800 y a 844 de alto y cabe con holgura, pero
   nadie lo ha visto en un portátil de 13" con la ventana a media altura (≈ 600 px). Ahí el recuadro
   mide 276 px y el conjunto necesitaría ~480: sigue cabiendo, pero el texto se lee en una rendija.
   Si molesta, el arreglo es un `min-h` — no se pone ahora porque sería un número inventado.
3. **Las aceptaciones de hoy no dicen nada.** Las filas vivas de producción tienen
   `texto_recorrido_en` NULL y así se quedan. Si algún día hace falta que la v2 de una clínica concreta conste como
   recorrida, lo honesto es **pedirle que la vuelva a aceptar**, no rellenar la columna (y el trigger
   de solo-inserción lo impide igualmente).

---

## 11 · Lo que hay que hacer al desplegar

1. **Migrar.** `20261024010000_contrato_lectura_completa` añade una columna nullable y un CHECK a
   `clinical_processor_agreements`. **No reescribe ni una fila** y no despierta el trigger de
   solo-inserción: es `ADD COLUMN` sin `DEFAULT`. En las filas que ya hay la columna queda NULL, que es
   la verdad.
2. **Desplegar la API antes que los fronts**, o a la vez. Una API nueva con un panel viejo da 400 a
   cada aceptación (el panel viejo no manda el campo); un panel nuevo con una API vieja funciona —
   Fastify le borra el campo que no conoce y la aceptación pasa como antes. Si se despliegan por
   separado, **primero los fronts**.
3. Nada que tocar a mano. Ni variables de entorno, ni tareas, ni datos.
4. **Comprobar en producción, un minuto:** entrar al panel de una clínica con el contrato por
   aceptar, ver el botón gris, bajar el recuadro hasta el final y ver que se enciende. Y que la
   sección del PIN de respaldo **no** aparece en «Mi cuenta» de una cuenta sin caja.

---

## 12 · Verde

| Qué | Resultado |
| --- | --------- |
| `pnpm vitest run` (toda la casa) | **463 ficheros, 6.678 tests, 0 rojos** (10 saltados) |
| `pnpm --filter @mipiacetpv/api run test:e2e` | **50 ficheros, 1.148 tests, 0 rojos** |
| `tsc --noEmit` API · `tsc -b` admin y tpv-web | limpio |
| `vite build` admin y tpv-web | limpio |
| Migraciones contra Postgres de cero | aplican, y los cinco casos del §6 |

Ficheros nuevos de prueba: `apps/api/test/contrato-lectura-completa.test.ts` (10),
`apps/api/test/contrato-lectura-completa-pin.test.ts` (6),
`apps/api/test/contrato-lectura-completa-migracion.test.ts` (5),
`apps/admin/test/contrato-lectura-completa-pantallas.test.tsx` (14),
`apps/tpv-web/test/contrato-lectura-completa-tpv.test.tsx` (4). Más los dos casos nuevos en
`test-e2e/primer-acceso.e2e.ts`.

Tocados: `clinica-7-contrato-rutas.test.ts` (todas sus aceptaciones mandan ya el campo, para que cada
test falle por SU razón), `clinica-7-claves-fake.ts` (el `select`) y
`primer-acceso-pantallas.test.tsx` (su caso del texto plegado, que este bloque cambia de forma).

---

## 13 · Commits

| | |
| - | - |
| `18fc04d` | `feat(contrato)`: la aceptación guarda que el texto se recorrió, y la API lo exige |
| `24fce1b` | `feat(contrato)`: el texto a la vista, «Acepto» cerrado hasta el final y «residentes» |
| `b86738d` | `feat(contrato)`: el TPV tampoco acepta sin recorrer el texto |
| `c75cc82` | `fix(pin)`: sin caja no hay PIN de respaldo del TPV |
| `c050ec1` | `test(contrato)`: el doble del contrato respeta `select` |
| `274fd35` | `test(contrato)`: el guardia del SQL de la columna y el e2e del 400 |
| `bf1fc19` | `docs(contrato)`: el bucle visual del bloque y sus medidas |
