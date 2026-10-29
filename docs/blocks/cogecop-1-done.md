# cogecop-1 · la historia de Rosario entra entera — hecho

> **REQUISITO PREVIO PARA PRODUCCIÓN: `clinica-11` DESPLEGADO.**
> Sin él, Sentry se lleva datos de salud. Nada de lo de «Al ejecutar en
> producción» (al final de este documento) se toca antes.

Rama `cogecop-1`, desde `origin/master`. Escrito el 29-10-2026. Vertical
clínica.

Rosario lleva su clínica en COGECOP —el programa que regala el Consejo
General de Colegios Oficiales de Podólogos: Firebird, sólo Windows— y nos
ha dado su copia: **3.681 pacientes, 9.569 visitas (feb-2025 → oct-2026),
52.003 marcas en el mapa del pie, 5.962 tratamientos y dos podólogas.**

El primer día con nosotros tiene que poder abrir a cualquier paciente y
ver todo lo que le hizo, con el mapa del pie partiendo de cómo lo dejó en
la última visita. Si tiene que mirar el programa viejo, no deja el
programa viejo.

---

## 1 · Lo que entra, pieza a pieza

### 1.1 · `LESIONES_V2` — `packages/clinica-sesion/src/listas.ts`

Las siete de la V1 **tal cual, en su orden, con sus ids y sus etiquetas**,
más cinco:

| id | etiqueta | marcas en la copia de Rosario |
|---|---|---|
| `onicogrifosis` | Uña engrosada (onicogrifosis) | 7.022 |
| `xerosis` | Piel seca (xerosis) | 290 |
| `hematoma` | Hematoma bajo la uña | 205 |
| `onicolisis` | Uña despegada (onicolisis) | 110 |
| `distrofica` | Uña distrófica | 59 |

Son **7.686 de sus 52.003 marcas**: la onicogrifosis es la segunda lesión
más marcada de su clínica. Sin ellas habría que tirarlas a «sin traducir»,
y la primera sesión que hiciera con nosotros no tendría dónde apuntar la
uña engrosada que lleva años tratando.

`VERSION_DE_LAS_LESIONES` pasa a 2: **lo que se escribe hoy lleva la V2, y
lo escrito con la V1 se sigue leyendo con la V1** (cada cuerpo guarda su
`lesionesVersion`). La API sirve la V2 a la pantalla de la sesión y a la
historia; los dos sitios que resuelven el hueco de un cuerpo viejo siguen
cayendo a `LESIONES_V1.version`, que es lo correcto.

### 1.2 · La traducción — `packages/clinica-sesion/src/cogecop.ts`

En el **paquete puro** y no en el script, porque el script se corre una vez
y se olvida pero **lo que escribió se sigue leyendo para siempre**: la API
lee lo importado en cada apertura de ficha. Y porque COGECOP es el programa
del Colegio: cada podóloga que venga de ahí trae la misma forma.

**Las 144 patologías** del catálogo, con su nombre tal cual lo escribe
COGECOP (erratas incluidas: «Onicigrifosis», «Tinea pedís») y la lesión
nuestra que le toca. Aplicado por prefijo y revisado una a una. Después de
la V2, **sólo 124 de las 52.003 marcas se quedan sin traducir (0,24 %)** —
y entran igual, con su nombre.

**Los centroides de los tres dibujos**, sacados de los datos con k-medias
agrupando por dibujo y mitad, y congelados en código con sus recuentos al
lado. Dos cosas dieron la confianza de que los grupos son los dedos:

1. **las dos mitades son espejo** (el eje sale en x ≈ 183 en los dos
   dibujos, y cada centroide tiene su pareja a menos de 3 px) — un test lo
   ata;
2. **el dedo gordo es el de dentro en los dos dibujos** (el grupo con más
   marcas y el de arriba en el dibujo 0, el de más marcas de la banda de
   dedos en el 2). Que los dos coincidan en eso es lo que dice que usan la
   misma disposición.

En el dibujo 2 los dedos pequeños casi no se marcan (476 de 34.392) y sólo
salen dos grupos por mitad; los otros tres se colocaron escalando el patrón
del dibujo 0 alrededor del dedo gordo con el factor que esos dos imponen
(**0,57**, con cuatro medidas independientes: 0,538 / 0,560 / 0,572 /
0,596). Están para que una marca ahí tenga dónde caer, no porque los datos
la hayan visto: en la copia de Rosario ese centroide gana **una** marca.

Radio de 32 px (dos iconos). Con 24 se quedarían fuera 1.098 marcas
(2,11 %) y con 50 se come medio pie; **con 32 se quedan fuera 306
(0,59 %)**, que es la cola de marcas entre dos zonas más las 12 del dibujo
3. Entran con su lesión, su nombre y su dibujo, y sin zona.

### 1.3 · ⚠ La lateralidad, **sin confirmar**

**Qué mitad de los dibujos es el pie izquierdo no se puede sacar de los
datos.** Los dos dibujos ponen los dedos gordos mirándose, que es lo
anatómico tanto en vista dorsal (desde arriba) como plantar (de la suela),
y la vista es justo lo que decide si la mitad de la izquierda de la imagen
es el pie izquierdo del paciente o el derecho.

Por eso **no hay valor por defecto**: `LATERALIDAD_COGECOP` entra por la
puerta y el script **se niega a correr sin `--lateralidad`**, con un
mensaje que dice qué hay que mirar. Un defecto «razonable» aquí sería
meterle a 3.681 personas la historia del pie cambiado, y nadie lo vería
nunca: el mapa se pintaría perfecto, en el pie que no es.

> **Matías: hace falta una captura de la pantalla de quiropodia de
> Rosario** para saber de qué pie es el dibujo de la izquierda. El ensayo
> local se hizo con `--lateralidad=izquierdo-a-la-izquierda` **sin
> confirmar**, y eso no decide nada.

### 1.4 · `IMPORTED_VISIT` — migración `20261029000000_cogecop_1_visita_importada`

Un valor de enum y **nada más**. Aditiva: ni un DROP, ni un UPDATE, ni un
índice.

**Lo importado es historia, no sesión** (decisión de Dirección), y por eso
es un kind propio: con `TREATMENT_SESSION`, las 9.569 visitas de Rosario
serían 9.569 sesiones cerradas sin cobrar — `cobrosPendientes` las
reclamaría una a una, el bono de la paciente las contaría y la caja del día
de su alta tendría un agujero de nueve años. Con un kind propio, esas
consultas (que ya filtran por `TREATMENT_SESSION`) siguen diciendo la
verdad **sin tocar ni una**.

**La fecha del pasado no necesitó nada**, y se miró porque el prompt pedía
mirarlo: el trigger de inmutabilidad es `BEFORE UPDATE OR DELETE` (nunca
INSERT), `clinical_entries_body_object` sólo mira que el cuerpo sea objeto
no vacío y `..._body_cifrado_formato` sólo mira el prefijo `c1:`. Ninguno
habla de `created_at`. **Así que esta migración no relaja ningún guardia**,
que es lo que queríamos: una importación no es un buen motivo para abrirle
la mano a la tabla del registro legal.

### 1.5 · El importador — `apps/api/src/cogecop/`

Tres ficheros, y el esquema es la bisagra:

- **`export-esquema.ts`** · la forma de los trece JSON, en Zod. **Lo
  comparten el importador y el generador de datos falsos**, y un test pasa
  lo que sale del generador por él. Sin eso, el generador se iría separando
  del formato real y la primera vez que lo notaríamos sería corriendo el
  script contra los datos de una persona.
- **`generador.ts`** · el export falso, con semilla y con **centinelas**:
  todo valor que en la copia de verdad sería dato de persona lleva una `ß`
  dentro, y un test exige que ninguno aparezca en la salida del script.
- **`importar.ts`** · el trabajo.

Y **`apps/api/src/scripts/importar-cogecop.ts`** es sólo la línea de
órdenes (y `pnpm --filter @mipiacetpv/api cogecop:importar`).

Las cuatro garantías:

1. **Idempotente.** `Client.externalId` = UUID v5 de
   `cogecop:<tenantId>:paciente:<id>` (el tenant va dentro porque
   `external_id` es único GLOBAL), y cada visita lleva su `cogecopId`
   dentro del cuerpo cifrado. Antes de escribir las visitas de un paciente
   se leen las que ya tiene, se descifran y se descartan las repetidas.
2. **Una transacción por paciente.** Reanudable: si se corta, lo que hay
   dentro es paciente entero o nada. Un paciente son como mucho 33 visitas.
3. **El `--dry-run` no escribe**, y no es un `if` al final: en seco **no se
   abre ni una transacción**. Pero traduce igual, que es lo que hace que
   pueda contar marcas sin zona y patologías sin traducir.
4. **Ni un dato de persona en la salida.** Números y nombres de catálogo
   del Colegio. Un test con centinelas lo comprueba de verdad.

Se niega —y antes de tocar la primera ficha— si la cuenta no es de vertical
clínica, si no tiene `ClinicalTenantKey`, o si alguna de las dos autoras no
es usuaria de la cuenta. Un importador que se parara a la mitad porque la
autora 2 no existe dejaría media clínica firmada por la 1.

### 1.6 · Sin pérdida

Lo que tiene columna propia va a su columna (`firstName`, `lastName`,
`phone` normalizado a E.164, `email`, `birthdate`); **todo lo demás que
tenga contenido va cifrado a `notesCifradas`**, con el encabezado
«Importado de COGECOP el dd/mm/aaaa» y una línea por campo. `notes` (en
claro) se queda a `null`: es un tenant clínico.

Incluido lo que parece basura y no lo es: un código postal que dice «viven
fuera», un teléfono que lleva el nombre de una hija (catorce campos de
teléfono de la copia llevan un nombre: **ése es el teléfono al que de
verdad se llama**), un `email2` que lleva un DNI.

La nota **se escribe y se vuelve a leer con la misma función** (test de ida
y vuelta), porque la ficha tiene que poder enseñar aparte dos de esos
campos. Lo que cuesta, dicho: los saltos de línea de dentro de un valor se
convierten en « · » al escribir. No se pierde ni un carácter de contenido;
se pierde el salto, que es formato de un campo libre de un programa de
2013.

`marketingOptIn = false` para todos. Los **difuntos entran** (es historia
clínica) con su línea en la nota —«Sí. No se le manda ningún aviso ni
recordatorio.»— y sin avisos: con `marketingOptIn` en falso no entran en
ninguna comunicación, y en la casa no hay ningún envío masivo de
recordatorios que lea `Client` (los recordatorios cuelgan de una cita, y un
difunto no tiene).

`Client.createdAt` se pone a su **primera visita en COGECOP**, no al día
del script: «paciente desde» tiene que decir la verdad.

### 1.7 · Se ve en la historia

- La lista de visitas las enseña con su fecha, su tipo, sus tratamientos y
  **«Importada de COGECOP» al lado de la fecha** (no en el título: el
  título dice qué visita fue, y de dónde salió es otra cosa).
- **El pie vivo parte de la última importada y lo dice**: la zona lleva
  «Parte de la última visita importada de COGECOP. Nadie lo ha comprobado
  aquí todavía», y cada paso de su línea de evolución lleva su etiqueta.
  `estadoDeLasZonas` las trata como lo que son —visitas que miraron el
  pie— sin un solo `if` nuevo dentro: lo que cambia es que
  `VisitaDeLaHistoria`, `PasoDeZona`, `ZonaViva` y `VisitaLegible` ganan un
  `importada` **obligatorio** (un `?` habría dejado que la pantalla se
  callara eso por olvido).
- **La ficha enseña «De COGECOP · sin validar»** con las enfermedades y las
  alergias que traía, y dice con todas las letras que nadie las ha repasado
  con el paciente y que la valoración inicial se le hace igual. No van en
  la franja roja: no son alertas. Pero se ven desde el primer día — «nadie
  trata a un diabético anticoagulado sin saberlo», y el día que más falta
  hace saberlo es justo el primero.
- **Abrir una visita importada** (`VisitaImportada.tsx`) pinta sus cuatro
  textos, sus tratamientos y sus marcas, con las que no se tradujeron bajo
  su nombre de COGECOP y marcadas «Sin equivalente nuestro». **Un solo
  botón: volver.** No se edita, no se anota desde ahí, no se cobra.

---

## 2 · Decisiones tomadas sin preguntar

1. **Dos líneas de la partida de traducción no casan con nada, y hay que
   decirlo.** En el catálogo de 144 **no existe ninguna «úlcera»** (la
   única que lleva la palabra es «Tinea pedís ulcerativa», que es una tiña
   que ulcera, y es la única que va a `herida`) **ni ningún «hallux
   valgus» ni ninguna «deformidad»**: COGECOP tiene la deformidad en otro
   sitio de su ficha, no en el mapa. Así que **`juanete` no lo escribe
   nadie en una importación** — un test lo ata, para que no parezca un
   olvido.
2. **Traducir por lo que el nombre DICE.** «Eczema hiperqueratósico» es un
   eczema, «Tinea pedís hiperqueratósica» es una tiña y «Mal de Meleda» es
   una queratodermia hereditaria cuyo nombre no lo dice. Las tres a `null`
   con su nombre conservado. Es lo que hace que la tabla se pueda revisar
   sin ser podóloga.
3. **El cuerpo importado guarda `mapaVersion` y `lesionesVersion`**, que
   el prompt no pedía. Misma regla que una sesión: lo marcado se lee con el
   vocabulario con el que se escribió.
4. **Una visita importada SE PUEDE ABRIR.** El prompt pedía que la lista
   las enseñara; abrirlas es lo que hace que la importación valga para
   algo. `detalleDeVisita` acepta los dos kinds y la pantalla sabe cuál es
   cuál.
5. **Se pueden ANOTAR** (`clinical_addenda`), como cualquier pieza de
   historia. «No se edita» es lo que impide el trigger; una anotación no
   es una edición, es la forma que tiene esta casa de añadir a lo
   inmutable.
6. **La ambigüedad de `paciente_especialista`.** Sus ids son 1 y 2, que son
   a la vez los de `personal` (Rosario y Marta) y los de
   `cat_tipo_especialista` (traumatólogo, reumatólogo). Se lee como el
   **podólogo asignado**, que es como lo lee el prompt y lo que hacen las
   columnas `*idespecialista` de las visitas. Para que sea recuperable si
   resulta ser lo otro, la nota escribe **el nombre y el número**:
   «Especialista: <nombre> (nº 2)». **A confirmar con Rosario.**
7. **Texto de una pestaña que no es la suya**: se pega al final de la
   recomendación con su etiqueta (`[cirugía] …`) y se cuenta en el informe.
   En la copia de Rosario son **0**; existe para que la segunda clínica no
   pierda nada en silencio.
8. **El script no crea la clave clínica.** Si la cuenta no tiene
   `ClinicalTenantKey`, se niega (lo pide el prompt). En una clínica recién
   abierta la clave nace la primera vez que se escribe algo clínico; en
   producción basta con que Rosario guarde una nota de ficha o abra una
   valoración antes. Está en los pasos del final.
9. **El `--dry-run` TRADUCE.** Podría contar pacientes y poco más; traduce
   entero y tira lo traducido, porque si no el seco no podría decir cuántas
   marcas se quedan sin zona ni qué patologías no se traducen, que es
   justo para lo que se mira.

---

## 3 · Tabla de sabotajes

Cada fila: se rompe **el fichero que ejercita la línea**, se corre el test
y se restaura con `git checkout -- .`. Las once salieron rojas.

| # | Sabotaje | Fichero roto | Test que se pone rojo |
|---|---|---|---|
| S1 | La idempotencia: nunca se leen las visitas que ya estaban (`if (existente != null)` → `if (false)`) | `cogecop/importar.ts` | `cogecop.e2e.ts` › «CORRERLO OTRA VEZ no duplica nada y lo dice» |
| S2 | El centroide del dedo gordo del dibujo 0 se mueve 100 px | `clinica-sesion/src/cogecop.ts` | `cogecop.test.ts` › 3 rojos: «las dos mitades son ESPEJO», «LA LATERALIDAD CAMBIA EL PIE», «justo en el borde del radio» |
| S3 | Una patología sin traducir pierde su nombre original | `cogecop/importar.ts` | `cogecop-importador.test.ts` › 3 rojos, entre ellos «una patología SIN traducir guarda su nombre original y se cuenta» |
| S4 | El `--dry-run` escribe (`if (!opciones.ejecutar) return` → `if (false)`) | `cogecop/importar.ts` | `cogecop.e2e.ts` › «el --dry-run no escribe NI UNA fila» y «la primera pasada escribe la clínica entera» |
| S5 | El nombre del paciente se cuela en la línea de progreso | `cogecop/importar.ts` | `cogecop.e2e.ts` › «por línea de órdenes el seco imprime recuentos y NI UN dato» |
| S6 | `esLateralidadDeCogecop` dice que sí a cualquier cosa | `clinica-sesion/src/cogecop.ts` | `cogecop.e2e.ts` › «SIN --lateralidad, el script NO CORRE» y «con una lateralidad inventada tampoco» |
| S7 | Lo importado entra como `TREATMENT_SESSION` | `cogecop/importar.ts` | `cogecop.e2e.ts` › **9 rojos**, entre ellos «no hay NI UNA TREATMENT_SESSION» y «UNA ENTRADA IMPORTADA NO SE EDITA» |
| S8 | La historia sólo mira `TREATMENT_SESSION` | `clinica/historia.ts` | `cogecop.e2e.ts` › «la historia enseña las visitas importadas y el pie parte de ahí» |
| S9 | La V1 de lesiones pasa a resolverse con la V2 | `clinica-sesion/src/listas.ts` | `cogecop.test.ts` › «la V1 se sigue leyendo IGUAL» y «las cinco nuevas NO existen en la V1» |
| S10 | `sinValidarDeLaNota` devuelve siempre `null` | `clinica-sesion/src/cogecop.ts` | `cogecop.test.ts` › «sinValidarDeLaNota saca lo que la ficha enseña en rojo» **y** `cogecop.e2e.ts` › «la historia enseña las visitas importadas…» |
| S11 | La nota de la ficha se escribe en claro | `cogecop/importar.ts` | `cogecop.e2e.ts` › «el `external_id` es el determinista, y el teléfono está en E.164» |

### Dos que al principio salieron VERDES, y qué se hizo

- **S5 salía verde.** El e2e corre con ocho fichas y la línea de progreso
  era «cada 250 fichas»: **no llegaba a ejecutarse nunca**, así que el test
  de centinelas vigilaba una línea muerta. Arreglado en el código (la
  primera ficha también avisa, commit `84ea81f`) — y de paso arregla lo de
  uso: con una clínica pequeña el script no decía nada hasta el final y
  parecía colgado. Con el arreglo, el sabotaje sale rojo.
- **S10 salía verde contra el test de pantalla** (`cogecop-1-historia.test.tsx`),
  y es correcto que salga: ese test monta la pantalla con una respuesta de
  API fija, así que **no ejercita la función pura**. La línea la ejercitan
  el test del paquete y el e2e, y contra esos dos sale roja. Queda anotado
  aquí para que nadie lea ese verde como cobertura.

---

## 4 · Ensayo con los datos reales, EN LOCAL

Postgres del Mac, base desechable, **nunca producción**. Carpeta
`~/Downloads/rosario-bbdd/export`, fuera del repo.

### 4.1 · `--dry-run` (8,7 s)

```
EN SECO · no se ha escrito nada

Pacientes      3681 en el fichero · 3681 nuevos · 0 ya estaban
Visitas        9569 en el fichero · 9569 nuevas · 0 ya estaban
   por tipo    quiropodia 9554 · cirugía 6 · biomecánica 9 · general 0
Marcas         52.003 · con zona 51.697 · sin zona 306

Lesiones sin traducir (nombre del catálogo de COGECOP):
        56  Dermatomicosis
        24  Eritrasma
        14  Psoriasis
         7  Acropustulosis psoriásica
         7  Leuconiquia
         7  Eczema
         4  Cuerno cutáneo
         3  Granuloma
         1  Forúnculo
         1  Quiste sinovial

Fechas imposibles   nacimiento 1 · otras 1
Difuntos            9
Sin teléfono        56
Fichas sin nota     0
Visitas sin especialista   0 (entran con la autora 1)
Texto de otra pestaña      0
```

**124 marcas sin traducir de 52.003 (0,24 %)** y **306 sin zona (0,59 %)**.
Las dos fechas imposibles son las que el prompt anunciaba: un nacimiento en
1356 y una primera visita en 8018 (ésta es un texto de la nota, no una
columna de `Client`).

### 4.2 · `--ejecutar` (50 s) y otra vez (23 s)

Segunda pasada, sobre lo mismo:

```
Pacientes      3681 en el fichero · 0 nuevos · 3681 ya estaban
Visitas        9569 en el fichero · 0 nuevas · 9569 ya estaban
```

Y la base, después de las dos:

| | |
|---|---|
| `clients` | 3.681 |
| `clinical_entries` con `IMPORTED_VISIT` | 9.569 |
| con teléfono | 3.625 |
| con fecha de nacimiento | 3.661 |
| `notes` **en claro** | **0** |
| `notes_cifradas` | 3.681 |
| `marketing_opt_in` | **0** |
| cuerpos **en claro** (≠ centinela) | **0** |

### 4.3 · Tres fichas miradas a mano en el TPV local

Stack local contra esa base (API 3061 + TPV 5261), entrando con el PIN como
cualquier día. **Qué se vio, sin copiar nada:**

- **La lista de Clientes** sale ordenada A–Z con **el teléfono ya en
  E.164** (`+34…`) en todas las fichas que lo tenían.
- **El cajón de una ficha**: teléfono, nacimiento, «RGPD marketing: No», y
  en **Notas** la nota de COGECOP entera y descifrada — encabezado con la
  fecha, el aviso de «Sin validar», y después enfermedades, alergias, otros
  datos, alerta, nº de historial antiguo, nº en COGECOP, sexo, domicilio,
  población, CP, provincia, país, forma de pago, LOPD, primera y última
  visita, visitas en COGECOP y la especialista con su nombre y su número.
  Ni un campo perdido.
- **La historia** de ese mismo paciente: la banda ámbar «DE COGECOP · SIN
  VALIDAR» con sus enfermedades y sus alergias y la línea que dice que
  nadie lo ha repasado; el pie vivo pintado desde la visita importada con
  «Parte de la última visita importada de COGECOP»; y la línea de evolución
  de la zona diciendo «Quiropodia · Importada de COGECOP».
- **La pestaña Visitas** de un tercer paciente: sus dos visitas con
  «Importada de COGECOP» al lado de la fecha. Abriendo una: el chip del
  tipo, la etiqueta, la fecha real de 2025, la autora con su nº de
  colegiado, «Viene del programa anterior. No se puede editar ni genera
  ningún cobro», los textos que escribió y **las 13 marcas del pie con su
  zona** («Pie izq. · Bajo el dedo gordo», «Pie der. · Bajo 3.º–5.º
  dedo»…). Un solo botón: «← Volver a la historia».
- Y en la sesión de hoy de un paciente importado, el contador dice **«1.ª ·
  la primera»**: lo importado no cuenta como sesión. Que es la decisión.

---

## 5 · Las capturas — `docs/blocks/cogecop-1-shots/`

**Con datos del generador, no reales** (los nombres llevan la `ß` del
centinela, que es la señal de que no son de nadie).

| fichero | qué enseña |
|---|---|
| `1280-1` / `390-1-historia-ficha-sin-validar.png` | la banda «De COGECOP · sin validar» y el mapa de partida |
| `1280-2` / `390-2-historia-visitas-importadas.png` | la lista de visitas con su etiqueta |
| `1280-3` / `390-3-visita-importada.png` | una visita importada abierta, con sus marcas |
| `1280-4` / `390-4-sesion-lesiones-v2.png` | **las doce lesiones de la V2** en la pantalla de la sesión |
| `1280-5` / `390-5-informe.png` | el informe en pantalla |
| `informe-con-lesiones-v2.pdf` | el PDF de verdad |

### La V2 no cambia el layout, **medido**

No mirado: medido con `getBoundingClientRect` sobre los doce chips.

| | 1280 × 800 | 390 × 844 |
|---|---|---|
| chips | 12 | 12 |
| alto mínimo | **48 px** (el suelo táctil es 44) | **48 px** |
| chip más ancho | 222 px | 222 px |
| ancho del panel | 542 px | **332 px** |
| desborda del panel | no | no |
| texto cortado (`scrollWidth > clientWidth`) | no | no |
| scroll horizontal del documento | no | no |

A 1280 los doce caben en cuatro filas; a 390 van uno por línea, el más
largo («Uña engrosada (onicogrifosis)», 222 px) entra en los 332 del panel
sin cortarse. **Lo que cambia es el alto, no el ancho.**

Y el **PDF**, leído de vuelta de sus flujos:

```
LO ENCONTRADO
Pie izq. · 5.º dedo: Callo (heloma) · curada
Pie der. · Dedo gordo: Uña engrosada (onicogrifosis) · activa
```

Una página, el nombre largo entero, y las patologías sin traducir salen en
la fila de su visita («Q1 QUIROPODIA BASICA, Carcinoma basocelular,
Eritrasma», partido por el `wrap` de la columna).

---

## 6 · Lo que NO entra

- **Fotos y adjuntos**: en su copia las carpetas vienen vacías.
- **El banco de imágenes y los iconos de COGECOP**: son del programa.
- **Agenda y facturas**: no las usaba.
- **Pantallas nuevas de pie de riesgo, cirugía y biomecánica**: sus pocas
  visitas (6 y 9) entran como historia con su `tipo`.
- **Un importador en el panel.** Se hará cuando llegue la segunda clínica.
  La traducción ya está en el paquete puro para reutilizarla tal cual.

---

## 7 · Al ejecutar en producción

> **Requisito previo: `clinica-11` desplegado.** Sin él, Sentry se lleva
> datos de salud. Y **nada de esto se hace desde aquí**: lo teclea Matías.

**Antes:**

1. Marta dada de alta a mano como **sanitaria** en la cuenta de Rosario
   (el script no crea usuarias). Apuntar su `User.id` y el de Rosario.
2. **La lateralidad confirmada** con una captura de la pantalla de
   quiropodia de Rosario (§1.3). Sin esto no se corre.
3. La cuenta tiene que tener **clave clínica**. Si es nueva del todo,
   basta con que alguien guarde una nota en una ficha o abra una
   valoración: la clave nace sola la primera vez que se escribe algo
   clínico. Comprobarlo:
   ```sql
   SELECT tenant_id FROM clinical_tenant_keys WHERE tenant_id = '<tenant>';
   ```

**Llevar la carpeta:**

```bash
# Desde el Mac. La carpeta son ~22 MB de JSON.
scp -r ~/Downloads/rosario-bbdd/export root@<vps>:/root/cogecop-rosario/
ssh root@<vps> 'docker cp /root/cogecop-rosario/export mipiacetpv-api:/tmp/cogecop-export'
```

**En seco, y mirar los números** (los de §4.1 son la referencia):

```bash
docker exec -w /repo/apps/api mipiacetpv-api sh -lc \
  "node_modules/.bin/tsx src/scripts/importar-cogecop.ts \
     --tenant=<tenantId> \
     --dir=/tmp/cogecop-export \
     --autora-1=<userId de Rosario> \
     --autora-2=<userId de Marta> \
     --lateralidad=<la confirmada>"
```

**Ejecutar** (unos 50 s en el portátil; en el VPS, algo más):

```bash
docker exec -w /repo/apps/api mipiacetpv-api sh -lc \
  "node_modules/.bin/tsx src/scripts/importar-cogecop.ts \
     --tenant=<tenantId> --dir=/tmp/cogecop-export \
     --autora-1=<...> --autora-2=<...> --lateralidad=<...> --ejecutar"
```

Si se corta, **se vuelve a lanzar el mismo comando**: sigue por donde iba y
no duplica nada.

**Comprobar** (una ficha y una historia en el TPV, como en §4.3) y después
**BORRAR LAS COPIAS**. Las dos:

```bash
ssh root@<vps> 'docker exec mipiacetpv-api rm -rf /tmp/cogecop-export'
ssh root@<vps> 'rm -rf /root/cogecop-rosario'
ssh root@<vps> 'docker exec mipiacetpv-api ls /tmp | grep cogecop || echo "limpio en el contenedor"'
ssh root@<vps> 'ls /root | grep cogecop || echo "limpio en el VPS"'
```

La copia de una clínica con 3.681 personas dentro no se queda en un
servidor «por si acaso».

---

## 8 · Lo que queda abierto

1. **La lateralidad** (§1.3). Es lo único que bloquea la ejecución real.
2. **`paciente_especialista`** (§2.6): confirmar con Rosario que es la
   podóloga asignada y no el tipo de especialista externo.
3. **Las 124 marcas sin traducir** (§4.1): la lista por nombre está en el
   informe del seco. Si Rosario dice que alguna merece su color
   —«Dermatomicosis» son 56—, entra en una V3 de lesiones y se vuelve a
   correr el script: la idempotencia hace que sólo cambie lo nuevo… **no**,
   y conviene decirlo claro: **re-traducir lo ya escrito NO lo hace el
   script**, porque las visitas que ya están no se vuelven a tocar. Para
   eso haría falta una pasada aparte que reescribiera cuerpos, y eso choca
   con la inmutabilidad. La forma honesta es que la V3 traiga la lesión y
   las marcas nuevas la usen; lo ya importado conserva su nombre de
   COGECOP, que es lo que se ve en pantalla.
4. **El importador en el panel**, cuando llegue la segunda clínica.
