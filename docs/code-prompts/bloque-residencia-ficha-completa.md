# Bloque residencia-ficha-completa · buscar, ver la cara y abrir la ficha entera

Rama `residencia-ficha-completa`, worktree
`~/Developer/Claude/Projects/mipiacetpv-ficha-completa`, desde `origin/master`. PR contra `master`.
Escrito el 24-10-2026 desde el proyecto de Jardín de Gredos, el día después de cargar los 43
residentes reales. Matías, al usar la lista: «no me parece cómodo de gestionar: falta un buscador,
el residente tiene que tener una foto asociada y al pinchar sobre él tengo que poder ver su ficha
completa»; y después, que el estado tiene que poder ser una salida temporal (vacaciones, salida de
día, cita médica, ingreso en el hospital…). **Mockup: `docs/mockups/residencia-residentes-ficha.html`**,
con todas las pestañas y la ventana de «Sale del centro» (pendiente de validar por
Matías; si al abrir el bloque no pone «validado» en `docs/residencia/09-hoja-de-ruta.md` o en este
prompt, pregúntalo antes de escribir código).

**Ábrelo cuando estén en `master` `historia-1` y `residencia-cuadro-de-control`.** historia-1 trae
la ficha clínica, las ausencias y el ingreso guiado, que son pestañas de esta ficha;
cuadro-de-control cambia el menú en el que vive «Residentes». Si alguno no está, dilo y para.

Lee antes:
1. **El mockup**, con su leyenda.
2. `apps/admin/src/pages/residencia/ResidentesPage.tsx`, `ResidentesPage.completar.tsx` y
   `ResidentesPage.foto.tsx`; las páginas de un residente que ya existen (`PlanResidentePage`,
   `RegistroResidentePage`, `UmbralesResidentePage` y, de historia-1, `FichaClinicaPage`,
   `AusenciasResidentePage`, `IngresoResidentePage`) y sus rutas en `App.tsx`.
3. `apps/api/src/residencia/ficha-routes.ts` (la foto: se sirve cifrada y **cada lectura pasa por
   `conHistoria`**, que deja una línea en el registro de accesos) y la ruta de
   `GET /residencia/residentes`.
4. `docs/blocks/residencia-3-done.md` (D-64, foto y consentimiento), `alta-minima-done.md` (lo que
   falta, «Siguiente incompleta», `?completar=`), `primer-acceso-done.md` (`?alta=1`) y
   `historia-1-done.md`.

## Por qué existe

Hoy la lista es una columna de 43 nombres sin buscador, sin caras, con dos botones por línea, y al
pulsar un nombre se abre una ventana que lleva a otras cinco pantallas (plan, lo registrado, ficha
clínica, ausencias, ingreso). Para encontrar a «la de la 12» hay que leer la lista entera, y para
saber todo de ella, abrir seis sitios.

¿Y qué?: la dirección encuentra a cualquier residente en dos segundos escribiendo tres letras o el
número de habitación, lo reconoce por la cara, y en una sola página ve todo lo suyo y sabe qué le
falta. La suplente o la DUE nueva aprende quién es quién mirando la lista.

## Decisiones de producto ya tomadas — no se re-debaten

1. **Buscador arriba, siempre visible, con el foco puesto al entrar** (en escritorio; en el móvil
   no, que abre el teclado) y la tecla «/» para volver a él. Busca por nombre, apellidos y número
   de habitación, **sin tildes ni mayúsculas** («dolores» encuentra «DOLORES ALCÁZAR»), en el
   cliente: son 49 personas y la lista ya viene entera. Busca también entre los que se fueron
   cuando está puesto «Se fueron».
2. **Al escribir, la búsqueda ignora el filtro** («Fichas incompletas», «Sin foto»…) y lo dice:
   «Buscando entre los 43, sin el filtro». Quien busca a alguien quiere que salga; con el filtro de
   incompletas puesto por defecto (alta-minima), una ficha ya completa «desaparecería» y parecería
   un fallo. Al borrar la búsqueda, el filtro vuelve.
3. **Los filtros pasan a fichas (chips) con su número**: Todos · Fichas incompletas · Sin foto ·
   Fuera del centro (ausencias de historia-1) · Se fueron. «Fichas incompletas» sigue viniendo
   puesto mientras quede alguna (alta-minima) y desaparece cuando no queda ninguna; «Sin foto»,
   igual. «Ver también los que se fueron» deja de ser una casilla y es el chip «Se fueron».
4. **Cada fila lleva la cara del residente**, en un hueco cuadrado de esquinas redondeadas:
   - foto, **sólo si hay foto y consentimiento de imagen vigente**: la lista la ve cualquiera que
     pase por el despacho (la misma razón por la que no lleva el DNI), y es lo mismo que hace la
     puerta;
   - sus iniciales en el mismo hueco si hay foto sin consentimiento o si hay consentimiento sin
     foto;
   - un hueco punteado con una cámara si no hay foto.
5. **La foto cuenta como un dato pendiente**, no imprescindible, en el cálculo de lo que falta
   (`CampoDeFicha` en `@mipiacetpv/residencia-plan`, con su ancla en `ANCLA_DEL_CAMPO`, que lleva
   al bloque de la foto de la ficha). El consentimiento no se cuenta aparte: es de la familia y no
   se puede «completar» desde el despacho.
6. **La fila entera abre la ficha completa**, que es **una página**
   (`/admin/residencia/residentes/:clientId`) y no una ventana. La ventana actual (`ModalFicha`)
   desaparece. «Habitación» y «Dar de alta» salen de la fila y van a la cabecera de la ficha (más
   «Sale del centro», la ausencia de historia-1): la lista sólo sirve para encontrar. La fila es un
   enlace de verdad (se puede abrir en otra pestaña) y se maneja con teclado.
7. **La ficha completa** (ver el mockup):
   - **Cabecera**: foto grande (aquí se ve aunque no haya consentimiento, como hoy en el admin;
     pulsarla sube o cambia la foto: es el `BloqueDeFoto` actual con otra disposición), nombre,
     edad si hay fecha de nacimiento, habitación · cama · planta, y fichas con plaza, dependencia,
     «En el centro» / «Fuera: hospital desde el martes», y cuánto lleva en el centro. Acciones:
     Habitación · Sale del centro · Dar de alta. («Habitación» abre hoy el cambio de habitación que
     ya existe; `bloque-residencia-ingreso-documentos.md` lo cambia por el selector sobre el plano de
     la planta.)
   - **Debajo, la franja de alertas de historia-1** (la misma que la puerta, con el detalle del
     admin) y **la banda de lo que falta de alta-minima**, con su enlace por dato y «Completar».
   - **Pestañas (revisado el 27-10-2026: de nueve a seis, y una séptima sólo para dirección y
     administración)**: **Resumen · Cuidados · Salud · Familia y datos · Estancia · Documentos**
     y **Plaza y pago** (con candado; la añade `bloque-residencia-plaza-y-pago.md`, al final; un rol
     sin permiso **no ve la pestaña**). Se juntan las que contaban la misma historia por partes:
     el plan y lo registrado pasan a ser **Cuidados**; ausencias e historial pasan a ser
     **Estancia**; la ficha clínica se llama **Salud**; ingreso y documentos se llama
     **Documentos**. **Las páginas que ya existen se montan dentro de este marco** (rutas
     anidadas con `Outlet`), no se copian: las rutas viejas (`…/plan`, `…/registros`, `…/ficha`,
     `…/ausencias`, `…/ingreso`) siguen valiendo y redirigen a su pestaña nueva, y quien llegue
     por un enlace viejo la ve con la cabecera encima. Sus tests siguen valiendo; los de
     disposición se ajustan al mockup.
   - **En toda la ficha**: los formularios **se guardan solos** al salir de cada campo (con «se
     guarda solo · guardado hace un momento» al pie), sin botón «Guardar» que olvidar; corregir
     algo que se usa poco (resolver un diagnóstico, retirar un consentimiento, quitar un contacto)
     va en un «⋯» por línea, no a la vista; y nada se repite entre pestañas ni con la cabecera.
   - **Resumen** (lo único de contenido nuevo; revisado el 27-10-2026). **No es un índice de las
     pestañas**: contesta «¿cómo está y qué hay que hacer hoy con este residente?». No repite nada
     de la cabecera (estado, alertas, datos que faltan) y **no enseña nada económico** (plaza y pago
     vive en su pestaña, sólo para dirección y administración). Tres bloques, como el mockup:
     - **Pide atención**: una lista corta, ordenada por urgencia, y **cada línea lleva a la pestaña
       donde se arregla**. Cuidados de hoy (hechos de los del plan y el siguiente pendiente con su
       hora), un cuidado rechazado o no hecho varios días seguidos, la revisión del plan vencida,
       las salidas programadas próximas (citas) y los documentos del ingreso sin firmar. Con su
       cuenta en el título. Si no hay nada, una línea que lo dice.
     - **Cómo está**: los últimos 7 días sacados de lo registrado y de sus umbrales (los del centro
       y los propios del residente), y **sólo lo que se aparta de lo normal**: come menos, caídas,
       cambio de peso, sueño, deposiciones, líquidos. Lo que está bien se agrupa en una línea («como
       siempre»). Si nada se aparta, una sola línea.
     - **A quién llamar**: el contacto con el papel «avisar en urgencias» (o el responsable si no
       hay), con su horario para llamar y **un botón grande de llamar** (`tel:`); debajo el
       responsable, y si le falta el teléfono, «Anotarlo» lleva a Familia y datos.
     - Los **diagnósticos y dispositivos** pasan a una línea discreta en la cabecera, bajo la de
       edad y habitación.
     Lo que todavía no exista como dato (p. ej. los documentos del ingreso, que llegan con
     `bloque-residencia-ingreso-documentos.md`, o el peso si no se registra) **no se inventa**: la
     línea no sale y el done dice qué hueco queda. **Una sola petición nueva**
     (`GET /residencia/residentes/:clientId/resumen`) que junte lo que ya calculan las rutas de
     cada parte y devuelva las líneas ya decididas; nada de recalcular en el cliente.
   - **Cuidados** (el plan y lo registrado, en una tabla). Arriba, una línea: «9 de 14 hechos hoy ·
     el siguiente, cambio postural a las 14:00», y un filtro «Lo que falta hoy (n)». La tabla, por
     grupos del plan: cada cuidado con cada cuánto toca, sus turnos (M · T · N), **cómo va hoy**
     (hecho con hora, «2 de 4», «no quiso», la hora a la que toca) y **los últimos 7 días en
     puntos** (hecho, a medias, no hecho, no tocaba). **Tocar un cuidado lo despliega ahí mismo**
     con sus últimos registros (hora, quién y el porqué) y dos acciones: «Avisar a la DUE» y
     «Cambiar este cuidado». Debajo, «Fuera del plan, hoy» (lo anotado que no es un cuidado, como
     «no está como siempre»). Al pie, sin estorbar: «Añadir un cuidado», «Umbrales propios» e
     «Imprimir» (lo registrado del día, para una inspección). En el móvil se ocultan los turnos.
   - **Salud** (la ficha clínica de historia-1). Ordenada por riesgo: **Alergias** y **Dieta**
     arriba (lo que puede hacer daño hoy), **Diagnósticos** y **Dispositivos** debajo. La dieta en
     etiquetas grandes, con la textura y el espesante en rojo, y «Cambiar la dieta» (no «nueva
     versión»; las anteriores en un enlace). Los diagnósticos con alerta primero; los resueltos no
     salen tachados en medio, se agrupan en «Resueltos (n)». Alergias con «preguntadas por última
     vez el … · quién» al pie. Corregir («se resolvió», «estaba mal escrito», «ya no lo usa») va en
     «⋯». Una nota al pie dice quién escribe cada parte (D-90). Lo que todavía no existe
     (medicación, valoraciones) no se dibuja.
   - **Familia y datos**. **Primero los contactos** (lo que más se usa): cada uno con su teléfono
     como botón de llamar (o un campo «Anotar su teléfono» en ámbar si falta), su email y **sus
     papeles como interruptores de un toque**: **responsable**, **recibe las facturas**, **avisar
     en urgencias**. Varios contactos por residente (hoy sólo hay un «familiar responsable»):
     nombre, parentesco, teléfono, email, DNI (opcional, enmascarado) y horario para llamar. Hay
     exactamente un responsable; el actual se migra como tal. Lo que hoy cuenta como pendiente
     (familiar y su teléfono) sigue contando sobre el responsable. **Después, «Sus datos»**: la foto
     grande con su consentimiento al lado («lo dio … el … · retirarlo») y el `FormularioDeCompletar`
     actual, siempre editable (no sólo cuando falta algo), con el nombre también editable y un
     número en la pestaña con los datos que faltan. Gana tres datos personales, **ninguno cuenta
     como pendiente**: sexo, estado civil y domicilio anterior al ingreso. Al pie, «Siguiente ficha
     incompleta →» (alta-minima) para completar las 43 de un tirón.
   - **Estancia** (ausencias e historial). Arriba, «en el centro desde … · habitación …» y «Sale del
     centro». A un lado, **el mes en días** (en el centro, hospital, con la familia, por venir; hoy
     marcado; flechas de mes; «estos días son los que irán a la factura de la Junta»). Al otro,
     **una sola línea de tiempo** con todo lo de su estancia, lo más nuevo arriba: salidas
     programadas, citas, salidas de día, días con la familia, hospital, cambios de habitación,
     cambios de plaza, ingreso y alta. Los cambios de dieta o de consentimientos **no** van aquí:
     viven con su dato (Salud, Familia y datos), con sus versiones.
   - **Documentos** (el ingreso guiado de historia-1). Arriba, «del ingreso: 9 de 11 · faltan 2» y
     «Subir un documento». **Lo que falta primero**, con su plazo y su acción en la misma línea
     («Adjuntar»; «Mandar a firmar a …» llega con `bloque-residencia-ingreso-documentos.md`: hasta
     entonces el botón no sale). **Lo que ya está**, en fichas agrupadas (estancia y plaza,
     identidad, salud, consentimientos, otros) que se abren con un toque. El mandato SEPA sólo lo
     ven dirección y administración.
   - **Flechas «anterior / siguiente»** y «3 de 43», en el orden de la lista y respetando el filtro
     o la búsqueda con que se llegó (pasar el orden por estado de navegación, no por la URL).
     «Siguiente ficha incompleta» (alta-minima) se queda al pie de Familia y datos.
8. **Salidas temporales: el estado del residente se ve siempre** (lo pidió Matías: vacaciones,
   salida de día, cita médica, ingreso en el hospital…). Es la ausencia de historia-1 (D-92), con
   otra cara:
   - En la cabecera de la ficha, la ficha de estado dice «En el centro» o «Fuera · cita médica», y
     si está fuera aparece **una banda azul** encima de las alertas: tipo, a qué hora salió, con
     quién y cuándo vuelve, con el botón **«Ha vuelto»**. Si la vuelta prevista ya ha pasado, la
     banda pasa a ámbar y lo dice («debía volver a las 13:00»): **no se cierra sola** (historia-1).
   - **«Sale del centro»** abre una ventana con el tipo en botones: **Salida de día ·
     Vacaciones / con la familia · Cita médica · Ingreso hospitalario · Urgencias · Otra**; sale
     (ahora, editable), vuelve previsto, con quién (sus contactos, «ambulancia», «personal del
     centro», «solo/a»), dónde y una nota. Debajo, una línea que dice qué efecto tiene ese tipo
     (p. ej. «vuelve el mismo día: no cuenta como día fuera en la factura de la Junta»).
   - Correspondencia con D-92: «Cita médica» = `CONSULTA_EXTERNA`; «Vacaciones / con la familia» =
     `VACACIONES_FAMILIA`; hospital y urgencias, los suyos. **Faltan dos tipos: `SALIDA_DE_DIA`
     (vuelve el mismo día; pausa los cuidados de esas horas y no cuenta noche fuera) y `OTRA`
     (con nota obligatoria)**: añádelos como decisión nueva, con lo que hacen en `queToca` y en
     los días del mes (una salida que no pasa la noche fuera no cambia los días de la factura).
     `SALIDA_NO_CONTROLADA` no va entre los botones: es un aviso, no una salida; deja el camino
     que tenga en historia-1 y enlázalo desde la ventana («¿No está y nadie sabe dónde?»).
   - En la lista, el que está fuera lleva su etiqueta azul («Cita médica · vuelve a las 13:00») y
     cuenta en el chip «Fuera del centro».
9. **Las entradas de la URL siguen funcionando**: `?completar=<id>` (la tarjeta del panel) ahora
   lleva a `/admin/residencia/residentes/<id>/datos`; `?alta=1` sigue abriendo «Nuevo ingreso» en
   la lista; «Añadir varios» y «Nuevo ingreso» no cambian.

## La foto en la lista: lo que hay que resolver sin saltarse nada

Hoy cada foto se pide una a una, cifrada, y cada lectura deja una línea en el registro de accesos.
**43 peticiones y 43 líneas cada vez que alguien abre la lista no vale**, y **un camino que se salte
el registro de accesos tampoco** (historia-1, «Respeta»). Lo que se pide:

- Una **miniatura** por residente (cuadrada, ~160 px, unos pocos KB), que nace al subir la foto.
  Hacerla en el navegador (canvas) al subir y mandarla junto a la original evita meter una
  dependencia nativa de imágenes en la API; si ves una forma mejor, decídela y cuéntala.
- **Una sola petición** para las miniaturas de la lista, que sólo devuelva las de quien tiene
  consentimiento vigente, y **una sola línea** en el registro de accesos por petición («lista de
  residentes · N miniaturas»). Cómo encaja eso con `conHistoria` lo decides tú y va como decisión
  nueva en `00-decisiones.md`.
- Las fotos que ya estén subidas sin miniatura: se genera al leerlas la primera vez o con un script
  de una vez; en producción ahora mismo no hay ninguna (Jardín de Gredos no ha subido fotos).

## Respeta

- Sistema visual y metodología de front de Mi Piace; el mockup manda en disposición, jerarquía y
  densidad, no en cada píxel.
- El nombre se lleva la línea entera en estrecho (lo aprendido en residencia-1: a 320 px no se
  trunca el nombre). En el móvil, las etiquetas bajan debajo del nombre.
- `nombreVisible` para enseñar los nombres; lo guardado no se toca.
- DNI y NSS nunca en la lista ni en `GET /residencia/residentes`.
- Nada de esto llega a la puerta, al relevo ni a la sala: la auxiliar no gana ni un toque.
- Comercios, clínicas y bares no notan nada.

## Fuera de alcance (declarado)

Recortar o girar la foto al subirla (se encuadra con `object-fit: cover`), una vista en cuadrícula
de caras, buscar por diagnóstico o por familiar, imprimir la ficha, la ficha para roles que no son
dirección.

## Cómo se cierra

- Tests: la búsqueda encuentra sin tildes y por habitación; con «Fichas incompletas» puesto,
  buscar a alguien completo lo encuentra y el aviso lo dice; los chips cuentan lo mismo que la
  lista; la foto sólo sale en la lista con consentimiento; la foto cuenta en lo que falta; la
  ficha abre en su URL y cada pestaña es la página de siempre; los contactos migran con un
  responsable; cada tipo de salida pausa lo que debe y cuenta en los días lo que debe (`SALIDA_DE_DIA`
  no cambia los días de la factura); «Ha vuelto» cierra la ausencia y una vuelta vencida no la
  cierra nadie más; `?completar=` y `?alta=1` siguen
  funcionando; las flechas respetan el orden filtrado; la lista con 43 residentes hace **una**
  petición de miniaturas y deja **una** línea en el registro de accesos.
- Bucle visual: capturas de la lista (1366 y 390), buscando con el filtro puesto, y de la ficha
  (cada una de las seis pestañas) en 1366 y 390, en `docs/qa/`, junto al mockup.
- CI verde (`ci`, `smoke`, `e2e`).
- `docs/blocks/residencia-ficha-completa-done.md` con la estructura de la metodología. Dice si la
  rama está pusheada y si hay PR.
- Commits pequeños en español, push y **PR contra `master`**. Ni merges ni despliegues.
