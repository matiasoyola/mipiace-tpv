# Bloque residencia-5 · el relevo con acuse, el panel de dirección y las obligaciones del mes

Rama `residencia-5`, worktree `~/Developer/Claude/Projects/mipiacetpv-residencia-5`, desde
`origin/master`. PR contra `master`. Escrito el 18-10-2026 desde el proyecto de Jardín de Gredos.
**Es el último bloque de la v1** (D-39): detrás va el piloto.

Lee antes, en este orden:
1. `docs/residencia/00-decisiones.md`: D-05, D-16, D-18, D-19, D-31, D-42, D-51, D-54, D-58, D-63,
   D-66 y **D-67** (nueva).
2. `docs/residencia/rama-catalogo-de-controles.md` §7 (el relevo) y §10 (frontera estándar / centro).
3. `docs/residencia/bloque-c-obligaciones-y-consultas.md` (nuevo en el repo): el presupuesto de
   lectura, las consultas de dirección y **el catálogo de obligaciones que se carga**. Su numeración de
   decisiones es la antigua: lee la nota de cabecera.
4. `docs/residencia/01-modelo-datos.md`, apartado «residencia-5», y `07-calidad-iso.md` §8.
5. `docs/blocks/residencia-3-done.md` §1 (`CareRecord`, `care_day`, registros sin turno), §7 (sin
   red) y §14.8 («no hecho» no se apunta: **lo deriva este bloque**).
6. `docs/blocks/residencia-4-done.md` entero: el libro, los avisos y sus acuses, el móvil de guardia
   como modo de la misma APK y cómo se emparejó.

## Por qué existe

Hoy el cambio de turno se hace de palabra y con una hoja en la sala; lo que no se dice, se pierde, y
nadie puede demostrar que se dijo. La dirección se entera de lo abierto preguntando, y las obligaciones
del mes (nóminas, extintores, el certificado de PCI que falta desde 2026) viven en la cabeza de Carmen.

¿Y qué?: el turno que entra lee en la sala **lo que pasó, sin que nadie lo haya escrito**, y lo confirma
con su PIN: queda demostrado que la información pasó de un turno a otro, que es una evidencia que hoy no
existe en papel. Y la dirección abre una pantalla y ve **qué hay abierto hoy y qué toca este día del
mes**, sin preguntar a nadie (la métrica de éxito de dirección).

## Decisiones de producto ya tomadas — no se re-debaten

1. **El parte de relevo se genera solo** (D-18), uno por centro y turno (D-58). Contiene lo que el
   turno entrante necesita, por planta y residente, y nada más:
   - incidencias **abiertas** al cerrar el turno y las **nuevas** del turno (N1 en adelante), con su
     nivel, si hubo aviso y quién lo acusó;
   - «algo no va bien» del turno (texto descifrado, y si hay nota de voz, que la hay);
   - constantes del turno que salieron de rango;
   - **lo que no se hizo** (decisión 4);
   - cambios del plan de cuidados y excepciones de umbral nuevas en el turno;
   - registros sin turno y avisos que no salieron a tiempo.
   **Nadie lo escribe.** Un turno sin nada que contar dice «Turno sin novedades» y se confirma igual:
   el denominador cuenta tanto como lo que pasa (misma lógica que «como siempre»).
2. **Se congela al acabar el turno** y no se edita: lo congelado es la evidencia de lo que se supo. Lo que
   llega tarde (una puerta sin red que sube a las 15:20 algo de las 14:50) se añade como **«llegó
   después del relevo»**, a la vista y con su hora, sin reescribir lo congelado. Mientras el turno está
   en curso, el parte se puede ver en vivo.
3. **La tablet de la sala (D-67)**: `DeviceKind` nuevo, la misma APK en «modo relevo», emparejada al
   centro (no a una habitación). Está donde ya se reúne el turno. En reposo **no enseña nada de salud**:
   centro, turno, hora y «Relevo de la mañana · 3 por confirmar». Con PIN:
   - se ve el parte del turno saliente **dentro del alcance de quien entra** (D-51): la auxiliar, sus
     zonas; DUE, médico, calidad y dirección, todo;
   - **«Leído y recibido»** firma persona + capacidad + hora y deja dicho qué zonas abarcaba lo que vio;
   - el parte queda **confirmado** cuando cada zona con contenido tiene al menos una confirmación de
     alguien del turno entrante que la cubre, o una de alcance total; **la DUE confirma el suyo si está
     de turno** (D-58);
   - sesión que se cierra sola a los dos minutos sin tocar y con «Terminar», como la puerta.
   Sin red: el parte congelado se cachea al generarse y la confirmación se encola con la cola de siempre.
   Dedos grandes, sistema visual de Mi Piace, lectura cómoda de pie a un metro.
4. **«No hecho» se calcula, no se escribe** (residencia-3 §14.8): una línea del plan que tocaba en una
   franja ya cerrada y no tiene registro es «no hecha». Es una consulta sobre plan + `queToca` +
   `CareRecord`, nunca una fila que alguien apunta. Un registro tardío que llega sin red **deshace** el
   «no hecho» en todo lo que se calcule después; en el parte ya congelado, aparece como «llegó después».
   Lo `ON_DEMAND` nunca es «no hecho».
5. **El panel de dirección** es la pantalla de inicio del admin para roles de categoría directiva (y
   para el OWNER). Una pantalla, por orden de urgencia:
   1. **Qué hay abierto hoy**: incidencias abiertas por nivel (N4 y N3 arriba), avisos sin acuse,
      incidencias de residente sin constancia de familia, N3-N4 esperando cierre por otra persona.
   2. **Relevos**: el del último cambio de turno, confirmado o no y por quién; los no confirmados de la
      semana.
   3. **Qué toca hoy y qué está vencido** de las obligaciones (decisión 6), y lo que vence en 60 días.
   4. **El turno en curso**: cuánto del plan va hecho por planta, y lo no hecho de turnos cerrados hoy.
   5. **Indicadores** que ya salen de lo registrado (la tabla del bloque C §2): el valor del mes, el
      umbral objetivo del centro (configurable, §10) y si está dentro o fuera. **Sólo los que tienen
      dato**: los que dependen de bloques futuros (UPP, Barthel, desnutrición…) no se pintan vacíos; se
      listan en el done.
   Cada cifra abre su lista y cada línea de la lista abre la incidencia, el residente o la obligación:
   **≤ 3 toques y ≤ 10 s** a cualquier dato (presupuesto de lectura).
6. **Obligaciones de dirección (D-42)**: entidad con nombre, familia (personal · dinero · compras ·
   cumplimiento · calidad), periodicidad (diaria, semanal con día, mensual con día, trimestral, anual con
   fecha, quinquenal, o **por vigencia** con fecha de caducidad), responsable (un rol de cuidado o una
   persona), consecuencia (legal · ISO · interno) y una marca «periodicidad por verificar». Sus
   ocurrencias se generan solas; cada una se marca **hecha** con persona + capacidad + hora y, si se
   quiere, una evidencia adjunta (el certificado, el informe). Una ocurrencia vencida sale en rojo en el
   panel; **no abre incidencia** (el sujeto «proceso» del libro es de calidad-1). Las obligaciones son
   **del centro**, no del producto: el catálogo del bloque C §3 viene como plantilla que el centro carga
   de una vez y luego ajusta. Lo marcado *(verificar)* entra con la marca puesta. Las disparadas por un
   hecho (§4) quedan fuera.
7. **Cifrado (D-63)**: el contenido del parte congelado lleva salud y va cifrado (como fichero `MPC1` o
   columna, lo decides tú y lo explicas). En claro, declarado: centro, turno, `care_day`, instante de
   congelado, recuentos por zona, confirmaciones con firma y zonas. Las obligaciones y sus ocurrencias no
   son de salud y van en claro; la evidencia adjunta se guarda como los demás ficheros.
8. **El sistema no habla con el exterior** (D-33): ni correo, ni mensajes. Los recordatorios de
   obligaciones son el panel.

## Alcance

- **Modelo y migración**: el parte (congelado, con sus añadidos tardíos) y sus confirmaciones;
  obligación y ocurrencia; umbral objetivo de indicador por centro; el dispositivo de sala. CHECK de
  formato en lo cifrado y triggers de inmutabilidad (el parte congelado y las confirmaciones no se
  editan ni se borran; una ocurrencia hecha no vuelve a «pendiente» salvo por una corrección firmada).
- **Paquete puro**: el cálculo de «no hecho» (plan + franjas + registros) y el de cada indicador, con
  tests de tabla; la tablet de sala y el servidor usan el mismo.
- **API**: generación y congelado del parte al cerrar cada turno (tarea programada por centro, que
  respete los turnos configurables de D-54 y el turno de noche que cruza el día); añadidos tardíos al
  llegar registros; rutas de la tablet de sala detrás de su propio guard; rutas del panel y de
  obligaciones para el admin; generación de ocurrencias.
- **Tablet de sala** (APK, modo relevo): reposo, PIN, el parte, «Leído y recibido», el aviso de que hay
  añadidos tardíos.
- **Admin**: el panel como inicio de dirección; el parte de cualquier turno (vivo o congelado) con sus
  confirmaciones; obligaciones (cargar la plantilla del bloque C, alta, edición, marcar hecha con
  evidencia, ocurrencias); umbrales objetivo de indicadores; emparejar la tablet de sala.
- **La devolución del art. 28.3.g** incluye lo que del parte toca a cada residente.
- **Sembrador de Jardín de Gredos** (`sembrar-gredos.ts`): un día con tres turnos cerrados, un relevo
  confirmado y otro sin confirmar, y la plantilla de obligaciones cargada, para las capturas.

## Respeta

- Tenants sin residencia no notan nada; TERMINAL, puerta, guardia y sala no se cruzan sus rutas.
  Sabotaje para cada cruce.
- `UserRole` no gana valores. Nada de salud en logs.
- Suite, `e2e` y `pnpm e2e:agenda` como estaban; la CI sin Redis (residencia-3 §18).
- Sistema visual y metodología de front de Mi Piace.

## Fuera de alcance (declarado)

Obligaciones disparadas por un hecho, no conformidades y el sujeto «proceso» del libro (calidad-1);
indicadores que dependen de escalas, lesiones o medicación (Fase 2); portal y cualquier envío a familias
(familias-1); la prueba del timbre en un Android real (pendiente de residencia-4, va antes del piloto).

## Cómo se cierra

- Migración con su `down`, aplicada sobre una copia con datos de residencia-1 a -4.
- Tests de tabla del «no hecho»: tocaba y no se hizo · se hizo tarde dentro de la franja · llegó sin red
  después del congelado (deshace el «no hecho» y sale como añadido) · `ON_DEMAND` nunca · residente
  ausente o dado de baja no cuenta · el turno de noche que cruza medianoche.
- Tests del parte: turno sin novedades se genera y se confirma; el congelado no cambia; el confirmado
  exige una confirmación por zona con contenido o una de alcance total; la DUE de turno confirma el suyo;
  una auxiliar no ve zonas que no son suyas; confirmar dos veces no duplica.
- Tests de obligaciones: cada periodicidad genera sus ocurrencias bien (fin de mes, 29 de febrero,
  trimestres); la vigencia avisa a 60 días; marcar hecha firma; vencida sale en el panel.
- Tests de indicadores contra un mes sembrado con el resultado calculado a mano.
- **Sin red, de verdad**: e2e que corta la red de la tablet de sala, confirma, la recupera y comprueba
  que la confirmación llega una vez con su hora.
- **Tabla de sabotajes**: editar un parte congelado por SQL · borrar una confirmación · confirmar desde
  una puerta · una auxiliar pidiendo una zona ajena · una ocurrencia hecha devuelta a pendiente por SQL ·
  un TERMINAL contra la sala.
- **Medido**: toques y segundos de «¿qué hay abierto hoy?», «¿qué pasó en el turno anterior?» y «¿qué
  toca hoy?», contra el presupuesto de lectura (≤ 3 toques, ≤ 10 s); y lo que cuesta confirmar el relevo.
- Capturas de la tablet de sala (1280×800: reposo, parte, sin novedades, confirmado, añadidos tardíos) y
  del admin (panel, parte, obligaciones, indicadores) a 390 y escritorio, en `docs/qa/`.
- CI verde (`ci`, `smoke`, `e2e`); `COPY` en `infra/Dockerfile` si hace falta.
- `docs/blocks/residencia-5-done.md` con la estructura de la metodología, y **un apartado final «Qué
  falta para el piloto»**: lo pendiente de todos los bloques de la v1 (el timbre del Android, D-05 sin
  medir en un turno real, el wifi por plantas, las deudas anotadas) en una sola lista.
- Commits pequeños en español, push y **PR contra `master`**. Ni merges ni despliegues.
