# Bloque historia-1 · done

**Primer bloque de la Fase 2.** Lo que una residencia sabe de cada persona dejaba de estar en el
producto justo donde más vale: la ficha en papel, el PAI en Word y la cabeza de la DUE. Y había tres
agujeros que no se arreglan con una pantalla más:

1. **Las ausencias no existían.** Un residente que pasa una semana en el hospital seguía generando
   veintiocho cuidados «no hechos», salía en la puerta como si estuviera en su cama y hundía los
   indicadores de AENOR de ese mes. Los días de la factura de la Junta se tecleaban a mano.
2. **«No tener alergias apuntadas» y «no tener alergias» eran lo mismo.** Un `COUNT(*) = 0`.
   Medicación (Fase 2) va a bloquear sobre esa diferencia.
3. **El ingreso no tenía lista.** Lo que falta de un expediente se descubre cuando lo pide un
   inspector (R20).

Decisiones **D-90 a D-97** en `docs/residencia/00-decisiones.md`. Corrió **en paralelo con
calidad-1** (ver §15).

---

## 1 · La ficha clínica es la historia de la clínica, ampliada (D-90)

Siete tablas nuevas colgando del **`Client` residente** (D-49). **No hay un segundo sistema
clínico**: el acceso, el registro de accesos, la inmutabilidad y el cifrado son los de clinica-1 y
clinica-7, sin tocar una línea de ellos.

| Tabla | Qué guarda |
|---|---|
| `resident_diagnoses` | diagnósticos y antecedentes, con CIE-10-ES opcional y **marca de alerta** |
| `allergies` | alergias e intolerancias, con clase y gravedad |
| `allergy_reviews` | **«sin alergias conocidas» como dato**, de sólo inserción |
| `resident_devices` | dispositivos y ayudas, con vigencia |
| `diet_profiles` | la dieta, **versionada** |
| `resident_absences` | las ausencias, que pausan |
| `admission_checklist_items` | el ingreso guiado |

Más `center_admission_settings` (los dos plazos del centro) y
`resident_profiles.discharge_kind`.

### Nada se edita, y lo dice el motor

| Qué | Qué pasa si se intenta |
|---|---|
| `UPDATE` de una alergia | `allergies_inmutable` → `RESIDENCIA_VIOLADA` |
| `DELETE` de una alergia | igual |
| `UPDATE` del texto o de la **frase de alerta** de un diagnóstico | `resident_diagnoses_inmutable` |
| Reabrir un diagnóstico resuelto o deshacer una retirada | igual |
| Editar una versión de dieta, o resucitar una jubilada | `diet_profiles_inmutable` |
| Editar o borrar una revisión de alergias | `allergy_reviews_append_only` |
| Borrar una ausencia, o cambiarle el tipo | `resident_absences_inmutable` |

Corregir es **escribir otra fila**. La vieja se queda: quien prescribe ve que alguien se equivocó y
cuándo, que es justo lo que un `UPDATE` borraría.

**Los dispositivos NO llevan trigger, a propósito.** Cerrar uno («dejó el andador en mayo») es la
operación normal y no hay nada que un `UPDATE` pueda falsificar que importe clínicamente. Un trigger
ahí habría sido simetría por simetría, y cada trigger es una escapatoria más que mantener. Lo que sí
hay es la firma del cierre, que es lo que la auditoría pregunta.

### Quién escribe cada parte

Por **capacidad del rol de cuidado** (D-50), no por `UserRole`:

| Parte | Quién |
|---|---|
| Diagnósticos, alergias, dieta | médico y DUE |
| Dispositivos | médico, DUE, TO y fisio |

`capacidadParaLaFicha` devuelve **la asignación con la que se firma**, no un booleano: la fila exige
`created_by_care_role_assignment_id` NOT NULL, y dos pasos —«¿puede?» y «¿con cuál?»— serían dos
consultas y la posibilidad de firmar con una capacidad distinta de la que autorizó.

Son **códigos de rol y no categorías**, al revés que `puedeTocarElPlan`, y es la decisión de esa
tabla: la categoría no distingue a la fisio (OPERATIVO) de la auxiliar (OPERATIVO), y la diferencia
es justo la que D-90 marca.

### El OWNER sin rol de cuidado · el caso que obliga a decidir algo

El OWNER puede tocar la ficha, pero la fila **exige** una capacidad. Un OWNER que nunca se asignó un
rol de cuidado no tiene ninguna. **Se le niega**, con su frase: «asígnate un rol de cuidado en
Personal».

La alternativa era inventar una capacidad de sistema, y entonces la firma de un diagnóstico podría
decir «el programa» — que es exactamente lo que D-31 prohíbe.

---

## 2 · «Sin alergias conocidas» es un dato (D-90)

La mitad de la decisión que no cabe en `allergies`. Sin `allergy_reviews`:

- «a don Luis **nadie le ha preguntado**» y
- «a don Luis **se le preguntó y no tiene**»

son el mismo `COUNT(*) = 0`. Medicación va a bloquear sobre esa diferencia, y un recuento no la sabe
decir.

La tabla es **de sólo inserción**, como `client_consents`: cada revisión es una fila con su autor,
su capacidad y su fecha. La vigente es la última, y el histórico cuenta cuándo se preguntó por
última vez — que es lo que un inspector pide.

**Y «sin alergias conocidas» con alergias vigentes apuntadas se rechaza** (409). La ficha diría las
dos cosas a la vez; la que mandaría sería la última revisión, y entonces medicación dejaría
prescribir penicilina a alguien con una alergia a la penicilina en su ficha.

---

## 3 · La franja de alertas se calcula, no se teclea (D-91)

Función pura: `packages/residencia-plan/src/ficha.ts`. De la ficha salen las alertas (alergia grave,
diagnóstico marcado, textura distinta de normal o espesante, dispositivo de riesgo).

Dos razones para que sea una función y no una columna:

1. **Una franja escrita a mano se queda vieja.** El día que la DUE cambia la textura, la banda de la
   puerta tiene que cambiar sola.
2. **La puerta y el despacho enseñan cosas distintas de lo mismo**, y eso sólo se puede garantizar
   desde un sitio.

### Las dos caras de la misma alerta

Cada alerta sale con **dos textos**:

- `frase` — **lo accionable**: «Disfagia: triturado y espesante nivel 2», «Alergia: penicilina».
- `detalle` — el porqué: el diagnóstico con todas las letras, la reacción de la alergia.

**En la puerta, sólo `frase`.** Un pasillo de residencia lo cruza cualquiera: la familia de otro
residente, el fontanero, un inspector. Un diagnóstico pintado en una tablet a la altura de los ojos,
en una pared, es un diagnóstico publicado.

Son dos campos y no uno largo porque con un solo texto quien escribiera la pantalla de la puerta
tendría que recortarlo — y recortar un diagnóstico por la mitad sigue siendo el diagnóstico.

### Y el mecanismo, no la costumbre

`frasesDeLaPuerta` devuelve **`string[]` y nada más**. Las dos rutas de la puerta (el arranque y «lo
que toca») reciben frases ya recortadas, y **el texto del diagnóstico ni siquiera se pide a la
base**: lo que no se trae no se puede mandar por error.

El e2e lo mide sobre el **cuerpo completo** de la respuesta, no sobre el campo `alertas`:

```
for (const prohibido of [...Object.values(CANARIOS), "Parkinson", "orofaríngea",
                         "R13.1", "edema", "retención", "vesical"]) {
  expect(cuerpo, `«${prohibido}» llegó a la tablet`).not.toContain(prohibido);
}
```

### La frase es OBLIGATORIA con la marca puesta

`resident_diagnoses_alerta_completa`: marcar un diagnóstico como alerta **exige** escribir la frase.
Sin ella, la banda de la puerta nacería vacía o —mucho peor— empujaría a alguien a poner el
diagnóstico dentro.

Y está **prohibida sin la marca**: una frase accionable de un diagnóstico que no alerta es una frase
que nadie va a ver y que se queda vieja.

### Lo que NO alerta, y por qué

| Qué | Por qué no |
|---|---|
| Una alergia **leve o moderada** | está en la ficha, donde la mira quien prescribe y quien cocina. En la banda gastaría la única línea que la auxiliar va a leer |
| Unas **gafas**, un audífono, unos absorbentes | están en la ficha y no interrumpen a nadie en un pasillo |
| Las **restricciones** de la dieta (diabética, sin sal) | son una propiedad del plato que sale de la cocina, no algo que la auxiliar tenga que saber al abrir la puerta |
| Una dieta que **no existe** | **no se inventa normal**: pintar «normal» por no tener fila sería afirmar algo que nadie ha comprobado, y a alguien con disfagia sin ficha se le daría un filete |

Los dispositivos de riesgo son **exactamente tres** —grúa, sonda y oxígeno— y está fijado por test:
son los que cambian lo que alguien hace al entrar en la habitación. Si alguien marca `riesgo: true`
en las gafas, la banda se llena y deja de leerse.

### Tres diccionarios para la textura, y no uno

- «Triturada» en la columna «Textura» de la ficha, que concuerda con ella;
- «triturado» en la frase de la puerta, que concuerda con lo que se le da de comer («Disfagia:
  triturado y espesante nivel 2», que es la frase literal de D-91).

Con un solo diccionario, una de las dos pantallas leería mal — y la que importa es la de la puerta,
que se lee de reojo. Lo mismo pasa con las ausencias (§4).

---

## 4 · Las ausencias pausan, no fallan (D-92)

`ResidentAbsence` con cinco tipos. **La regla vive DENTRO de `queToca`.**

### Por qué dentro y no al lado

La alternativa era una segunda lista de «residentes que no cuentan» que cada consulta nueva tiene
que acordarse de pedir. Ya hay una —el `fuera` de `loQueNoSeHizo`, que es para quien no tiene cama—
y dos listas con dos criterios es la forma de que un indicador nuevo use la que no toca.

Con la regla dentro, un residente ausente **no produce ocurrencias**, y todo lo que se construye
sobre ellas lo hereda sin escribir una línea: el parte, el panel, los indicadores de AENOR de hoy
**y los que calidad-1 añada mientras este bloque se escribe**.

### Y el parámetro es OBLIGATORIO

`queToca` pasa de seis parámetros a siete, y el séptimo **no tiene valor por defecto**. Un
`ausencias = []` opcional habría dejado que una llamada nueva —la de calidad-1, la de medicación— se
olvidara de pasarlas y volviera **en silencio** al comportamiento de ayer.

Con el parámetro obligatorio, el compilador obliga a cada sitio a contestar «¿qué ausencias?». `[]`
es una respuesta legítima (la pantalla del plan que mira el futuro) pero está **escrita**.

Siete llamantes, los siete actualizados: el panel (×3), el parte de relevo, la vista «hoy» del plan,
«lo que toca» de la puerta y la tablet sin red.

### Se mide contra la OCURRENCIA, no contra el día

Una señora que se va al hospital el martes a las 15:00 **sí** tenía la higiene de la mañana de ese
martes, y no tiene nada de la tarde. Comparando días se le perdonaría el turno entero —o se le
reprocharía—, y las dos cosas son mentira en el parte de ese turno.

Es la misma razón exacta por la que la vigencia de una línea del plan se mide así (residencia-2).

### Una viva por residente

Índice parcial `resident_absences_una_viva_key`. Nadie está en el hospital y de vacaciones a la vez,
y dos ausencias abiertas dejarían «¿desde cuándo está fuera?» sin respuesta única.

### Borrar una ausencia es borrar días de factura

El trigger deja pasar **tres** transiciones y ninguna más: cerrarla, la revisión al volver, y
**corregir las fechas sólo con la corrección firmada en la misma operación** (quién y por qué).
Mismo patrón que `duty_occurrences_hecha_no_vuelve`.

El tipo y el residente no cambian nunca: convertir un ingreso hospitalario en unas vacaciones cambia
tres días de la factura de la Junta y no deja rastro.

### La salida no controlada nace N4 y suena

Regla nueva en la plantilla de gravedad, que **sube a `VERSION_DE_LA_PLANTILLA = 2`** (D-65). La
versión 1 se jubila con `supersededAt` y no se toca: una incidencia abierta en octubre guarda
`plantillaVersion = 1` y la auditoría puede reconstruir con qué tabla se graduó.

**Tipo propio y no `NO_LOCALIZADO`**, aunque las dos sean N4 y las dos suenen igual:

- `NO_LOCALIZADO` · **nadie sabe dónde está.** La auxiliar hace su ronda y la habitación está vacía.
- `SALIDA_NO_CONTROLADA` · **se sabe que se ha ido** y nadie lo autorizó.

Separarlas es lo que permite contarlas aparte, y eso importa: un centro con tres fugas por la puerta
de la calle y cero desapariciones dentro tiene un problema **de puerta**, no de vigilancia, y la
medida que lo arregla es otra.

### El orden de la apertura, y el fallo que se acepta

Primero la incidencia, después la ausencia que la apunta. `declararIncidencia` **avisa al móvil de
guardia** y por eso no va dentro de la transacción. La consecuencia, dicha: si la escritura de la
ausencia fallara después, quedaría una incidencia N4 abierta sin su ausencia. **Es el lado correcto
del fallo** — el aviso de que alguien no está ya salió, que es lo que no se puede perder.

### La vuelta del hospital

`reviewRequired` lo pone **el cierre**, no la apertura: mientras está ingresada no hay nada que
revisar, y el panel de la DUE enseñaría una tarea que no se puede hacer.

Sólo de `INGRESO_HOSPITALARIO` y `URGENCIAS`. De unas vacaciones con la hija, no — marcar las cuatro
clases habría llenado el panel de revisiones que no hay que hacer, que es cómo se deja de mirar un
panel.

La confirma quien **supervisa** (DUE, médico, dirección): es un acto clínico, no un trámite. Y una
vez firmada no se deshace.

**Aquí no se adelanta nada de historia-2 ni de medicación.** Lo que hay es el aviso y su acuse;
escribir hoy una tarea de conciliación sin medicación que conciliar sería una tarea que nadie puede
cerrar.

### La puerta, sin red incluida

Las ausencias abiertas viajan en el arranque de la tablet (tipo y dos fechas: lo que la tarjeta
pinta; **adónde fue y por qué no viajan**), así que una puerta sin wifi tampoco pide los cuidados de
quien está en el hospital.

Y la frase se arma con la **misma función** del paquete puro en los dos lados: la pantalla sin red
dice exactamente lo que diría con red.

---

## 5 · Los días del mes (D-93)

`diasDelMes(residente, ausencias, mes)` → **ordinarios, hospital, vacaciones, otros** y la presencia
total. Es exactamente el dato que hoy se teclea a mano en `meses/AAAA-MM.json` para facturar las
concertadas (`05-plazas-facturacion.md`).

### La regla de los días frontera es DATO, no código

El día que un residente sale y el día que vuelve: ¿los cobra el centro? **Es normativa de cada
comunidad autónoma.** De serie se cuenta **dónde pernoc­ta el residente**, medido a las 00:00 de la
hora de pared del día siguiente:

- el día del **ingreso cuenta** (durmió aquí);
- el día del **alta no cuenta** (ya no durmió aquí).

Queda como **duda abierta** (§13) para contrastar con la Junta antes de facturacion-1. La regla va
**en la respuesta de la API** y en las dos pantallas: un número de facturación sin su regla al lado
es un número que alguien copia mal.

### El cuarto número

`otros` existe aparte y no repartido entre los otros dos: meter en «vacaciones» una noche en que
nadie encontró al residente sería ponerla en la factura de la Junta como una salida con la familia.
Son pocas y normalmente cero, y cuando no lo son hay algo que mirar.

### `diasDelMes` ya existía, y se le cedió el nombre

La función de `obligaciones.ts` que contaba cuántos días tiene un mes pasa a llamarse
`cuantosDiasTieneElMes` y se mueve a `ausencias.ts`, donde la usan las dos. El nombre se cedió a
propósito: «los días del mes de este residente» es la pregunta del producto, y «cuántos días tiene
este mes» es una cuenta de calendario — la segunda no puede quedarse el nombre bueno.

### La tabla de casos de oro

Los seis que el prompt pide, más seis bordes que salieron al escribirla:

| # | Caso | Resultado |
|---|---|---|
| 1 | mes completo, sin ausencias | 31 ordinarios de 31 |
| 2 | ingreso a mitad (día 20) | 12 noches, **el día del ingreso cuenta** |
| 3 | ausencia que **cruza de mes** (28-10 → 03-11) | octubre 27+4, noviembre 28+2, y la suma es la estancia entera |
| 4 | alta a mitad (día 10) | 9 noches, **el día del alta no cuenta** |
| 5 | dos ausencias de clases distintas en el mismo mes | 2 de hospital + 5 de familia |
| 6 | año bisiesto | febrero de 2028 son 29; **2100 son 28** (el caso que un `% 4` se come) |
| + | ausencia **abierta** | cuenta hasta el final del mes, y el siguiente entero |
| + | consulta externa de ida y vuelta el mismo día | **ordinaria**: durmió aquí |
| + | salida no controlada que cruza la noche | va a `otros`, no a vacaciones |
| + | ingreso posterior / alta anterior al mes | cero días |
| + | los dos cambios de hora | octubre y marzo siguen teniendo 31 noches |
| + | ausencias de otro residente | no entran en mi cuenta |

---

## 6 · El ingreso guiado (D-94)

Doce elementos de serie. **Sin tabla padre**: la lista es el conjunto de sus filas — una fila con
sólo `client_id` no guardaría nada que `resident_profiles` no sepa ya.

Se crean **en la misma transacción que el alta del residente**, por la misma razón que el plan: si
se crearan después, un fallo dejaría a alguien ingresado **sin expediente**, y eso no se ve hasta
que lo pide un inspector.

### Las dos formas de estar hecho, y la segunda es la buena

| Cómo | Cuáles |
|---|---|
| **Se comprueba** cuando el dato existe | identidad, cama, consentimiento de datos, familiar responsable, alergias revisadas, dieta, plan de cuidados |
| **Se marca** a mano, con firma | contrato (con PDF), consentimiento de imagen pedido, dispositivos revisados, escalas iniciales, PAI inicial |

Pedirle a la dirección que marque «cama asignada» cuando la cama ya está en la base es pedirle que
copie un dato que el sistema tiene — y una lista que se copia a mano miente el día que alguien marca
sin haberlo hecho. **El CHECK `admission_checklist_items_hecho_completo` lo prohíbe**: no es una
costumbre, lo para el motor.

Y un elemento `auto` **dice por qué**: «Falta el DNI o el NSS», «No tiene cama: asígnasela en
Edificio». «Pendiente» a secas no dice dónde se arregla.

### Por qué alergias es `auto` y dispositivos no

Es la asimetría que llama la atención. «Sin alergias conocidas» **tiene su propia tabla** porque
medicación va a bloquear sobre esa diferencia: ahí hace falta un dato, no una marca. Los
dispositivos **no bloquean nada**; darles una tabla de revisión propia sería una tabla más para
contestar «alguien lo miró», que es lo que la firma de un elemento marcado ya dice.

### El consentimiento de imagen se MARCA, no se comprueba

Si fuera automático, un residente cuya familia **no autoriza** la imagen se quedaría pendiente para
siempre y el panel de dirección lo pediría cada día — que es cómo se deja de mirar un panel. El
elemento es «se ha pedido», y la firma con su nota («la hija no lo autoriza») es la evidencia. Que
la foto se pinte o no en el pasillo lo gobierna el consentimiento, no esto (D-64).

### Los dos sin pantalla todavía

`ESCALAS_INICIALES` (historia-3) y `PAI_INICIAL` (historia-2) entran **con su fecha límite** aunque
su pantalla no exista: el plazo de 30 días del PAI **corre desde el ingreso**, y meterlos cuando haya
pantalla sería empezar a contar tarde. La pantalla lo dice con esas palabras en vez de esconderlos.

### Quien ingresó ANTES del bloque no tiene lista

No se le inventa en la migración: habría que decidir la fecha límite del PAI de alguien que ingresó
hace cuatro meses, y un plazo ya vencido inventado por el programa es peor que no tenerlo. La crea
la dirección con un botón, **y desde hoy**.

### Los dos plazos del centro

`initialCarePlanDays` 30 de serie. `dischargeNoticeDays` **NULL de serie, a propósito** (ver §7).

Y cambiar un plazo **no mueve lo ya escrito**: el plazo de quien ya ingresó es el que había cuando
ingresó, que es lo que un inspector va a comparar con su fecha de ingreso.

---

## 7 · El alta, completa (D-96)

residencia-1 ya cerraba la cama y residencia-2 el plan. Este bloque añade, **en la misma
transacción**:

- **la clase del alta** (traslado · voluntaria · fallecimiento · otra), obligatoria desde hoy;
- **la ausencia abierta**, si la hay;
- y, si la plaza es **concertada**, la obligación de comunicar la baja.

### Por qué la ausencia

Sin esto, un residente dado de alta desde el hospital se queda **ausente para siempre**: los días del
mes lo siguen contando fuera, el panel sigue pidiendo la revisión de su vuelta, y la pantalla de
ausencias no lo lista porque sólo enseña a los que viven aquí. Una fila que nadie puede volver a
tocar.

**Y no deja revisión pendiente**, aunque venga de un hospital: la DUE no tiene que revisar la
medicación de alguien que ya no vive aquí. Por eso `cerrarAusenciaPorAlta` es otra función y no
`cerrarAusencia` con un booleano.

### La clase es nullable, y no es una concesión

Las filas dadas de alta **antes** de este bloque tienen fecha y motivo libre. **No se les inventa una
clase**: un `UPDATE … SET discharge_kind = 'OTRA'` en la migración sería alguien decidiendo a mano
por qué se fue una persona de la que no sabe nada. La pantalla lo dice: «sin clasificar (alta
anterior a este bloque)».

### El plazo de la baja no se inventa

El plazo de comunicación de una baja es **normativa autonómica**. Escribir «15 días» de serie porque
suena bien es prometer un plazo que puede no ser el de la Junta, y una obligación con una fecha
inventada es peor que una con fecha por confirmar: la primera parece correcta.

Sin plazo configurado, la obligación **nace igual**: con la fecha del alta —lo antes posible, que es
el lado seguro de un plazo desconocido— y marcada **`periodicityToVerify`**, la columna que
residencia-5 creó para exactamente esto. El panel la pinta, la pantalla deja quitarlo y no bloquea
nada.

Reutilizar esa columna en vez de inventar una `fechaPorVerificar` es la decisión: es la misma
pregunta, y un segundo flag con el mismo significado serían dos sitios donde el panel tendría que
acordarse de mirar.

### Y la ocurrencia se escribe en el alta, no en la pasada

`generarOcurrenciasDe` sólo materializa lo que cae en `[hoy − 31, hoy + 90]`, y un plazo de 120 días
se quedaría sin ocurrencia hasta que la pasada lo alcanzara — o sea, invisible en el panel **el día
del alta**, que es el día en que a alguien se le tiene que decir.

### Sólo `CONCERTADA`

`TEMPORAL` **no** entra: una plaza temporal puede ser privada o pública y el enum no lo dice. Crear
la obligación para todas llenaría el panel de comunicaciones que no hay que hacer; no crearla para
ninguna deja fuera las temporales concertadas. Se elige **no inventar**, y queda anotado para
facturacion-1, que es el bloque que va a saber quién paga cada plaza (§13).

---

## 8 · Los consentimientos de residencia (D-95)

Dos plantillas nuevas en `packages/consentimientos`: «protección de datos del residente» e «imagen
del residente», versionadas y con `pendienteDeValidar: true`.

**Lo único que hacía falta** para reutilizar el mecanismo de clinica-4 era que el `kind` de la fila
saliera de la plantilla en vez de ser `TREATMENT` fijo. Con el fijo, el consentimiento de imagen que
D-64 mira para pintar la foto en la puerta **no lo habría encontrado nunca**: esa comprobación busca
`kind = IMAGE`.

`claseDeLaPlantilla` devuelve `TREATMENT` cuando la plantilla no lo dice, que es lo que las tres de
clinica-4 hacen. **Nada de lo firmado antes cambia de significado**, y las tres huellas del texto
canónico siguen byte a byte donde estaban.

### `clinica: false` en las dos, y es una decisión

De esa marca cuelgan dos reglas: el PDF pasa por `conHistoria` y **el informante tiene que ser
sanitario**. La segunda es la que decide: quien informa de la protección de datos de un ingreso es
**la administrativa del centro**, no la DUE. Con `clinica: true`, la plantilla que D-94 pone en la
lista de TODO ingreso sólo la podría firmar personal sanitario — y los ingresos se quedarían
esperando a que pase la DUE.

Hoy en el Drive de Jardín de Gredos hay **cero** consentimientos individuales de datos (`03` §7). Lo
que no se puede permitir es que el producto los siga dejando a cero por una marca.

### Cada pantalla ofrece las SUYAS

`vistaDeConsentimientos` gana un `ambito`. Sin él, la podóloga vería «Consentimiento para que mi foto
se vea en el centro» en la lista de una paciente de quiropodia, y la dirección de la residencia vería
«Consentimiento para cirugía de uña». Lo que se filtra es **lo que se ofrece para firmar**: los
firmados se enseñan todos, porque esconder un documento de un expediente por ser «de otra pantalla»
sería esconderlo.

### El pad de firma va en el admin

El ingreso se hace **en el despacho** (D-97), con la familia delante y el contrato encima de la mesa:
no hay una tablet de pasillo en esa conversación, y la pantalla de la clínica vive dentro de una
sesión de podología.

Y «con el dedo» sigue siendo verdad: son eventos `pointer*`, no `touch*`, así que el mismo código
recoge el dedo cuando el admin se abre en una tablet y el ratón cuando se abre en el portátil — que
es, además, lo que permite recorrer la pantalla en el bucle visual sin un dedo de verdad.

---

## 9 · Lo que va cifrado, y lo que no (D-63)

**Trece columnas lógicas nuevas**, que llevan el inventario de la casa de 24 a **37**.

Cifrado: el texto de un diagnóstico y su CIE-10 —que *es* el diagnóstico—, la frase de alerta, el
agente y la reacción de una alergia, el detalle de un dispositivo, las restricciones libres de una
dieta, el destino y el motivo de una ausencia, la fuente de una revisión y la nota de un elemento del
ingreso.

**Trece y no cinco**, por la razón de siempre: cada columna lógica es un AAD distinto. La pareja que
importa de este bloque es **el texto de un diagnóstico y la frase de alerta**: son dos columnas de la
MISMA fila, y la segunda es la única de la ficha que llega a una tablet de pasillo. Con el mismo
nombre lógico, un `UPDATE resident_diagnoses SET alert_phrase_cifrado = text_cifrado` publicaría
«Adenocarcinoma de próstata con metástasis óseas» a la altura de los ojos de quien pase — **y
descifraría**, así que nadie lo vería como un fallo. Hay test.

**En claro, y declarado**: el residente, las fechas, los códigos cerrados (clase y gravedad de una
alergia, textura, tipo de ausencia, código de dispositivo, código de elemento) y las firmas. De ahí
salen «¿quién está ausente hoy?», «¿qué ingresos tienen pendientes?», los días de la factura y el
bloqueo de medicación de la Fase 2 — todas consultas SQL. La consecuencia, como en residencia-1b §2:
un `SELECT` sigue diciendo que doña Carmen tiene una alergia grave a un medicamento y que lleva tres
días fuera. Lo que no dice es a qué, con qué reacción ni por qué.

### El CIE-10 va cifrado, y la deuda que deja

«E11.9» es la diabetes. Nada de este bloque ni de la hoja de ruta lo consulta en SQL —el catálogo con
buscador es fuera de alcance—, así que no hay nada que perder. **El día que haya un indicador por
diagnóstico hará falta un índice ciego**, y es la misma conversación que D-69.

---

## 10 · Qué cambia en la puerta y en la sala (D-97)

**La auxiliar no gana ni un toque.** Las dos cosas son texto.

- **La franja**, debajo del nombre y antes de todo lo demás: es lo que hay que saber antes de tocar
  a alguien. 22 px —el tamaño de los botones de esa pantalla— y no 16: se lee a la distancia a la que
  alguien pasa por un pasillo con una bandeja en las manos.
- **Sin banda cuando no hay nada.** Nada de un hueco que diga «sin alertas»: una banda gris en
  cuarenta puertas es la que hace que nadie mire la roja de la cuarenta y una.
- **El ausente** ocupa el hueco de «¿cómo está hoy?» y «toca ahora», que **no se pintan**. No por
  esconderlo: pedirle a la auxiliar que registre la higiene de quien está en el hospital es pedirle
  que invente un cuidado, y un «como siempre» de un residente ausente es un dato falso firmado con su
  PIN. Lo que sí queda es el nombre, la foto y por qué no está — que es lo que evita que vayan a
  buscarla.
- **Azul y no rojo**: no es una alerta, es una explicación. Pintarlo del color de una alergia grave
  gastaría el rojo que la franja necesita.

En el parte de relevo, una clase nueva: `AUSENTE`, **una línea** y arriba, con las incidencias. Es lo
primero que el turno entrante tiene que saber de un residente: que no está. Al final, con lo
administrativo, alguien leería sus cuatro líneas de ayer y iría a su habitación a buscarla.

Se anota la ausencia que **solapa el turno**, no la que está abierta: el parte de la mañana de ayer
tiene que decir quién estaba fuera ayer por la mañana aunque hoy ya haya vuelto. Y la frase se
calcula contra el **tope del turno**, no contra «ahora», para que el parte congelado siga diciendo lo
mismo cuando alguien lo lea el viernes.

---

## 11 · La tabla de sabotajes

Contra el motor, con la línea rota y devuelta después. **Los trece en rojo a la primera.**

| # | Sabotaje | Qué lo para |
|---|---|---|
| 1 | `UPDATE allergies SET agent_cifrado = …` | `allergies_inmutable` |
| 2 | `DELETE FROM allergies` | igual |
| 3 | **`DELETE FROM resident_absences`** | `resident_absences_inmutable` · «son días de la factura» |
| 4 | Cambiar el **tipo** de una ausencia | igual |
| 5 | Mover una fecha de una ausencia **sin** la corrección firmada | igual |
| 6 | …y **con** la corrección firmada | **pasa**, que es lo correcto |
| 7 | Editar una versión de dieta | `diet_profiles_inmutable` |
| 8 | Dos dietas vigentes del mismo residente | `diet_profiles_una_viva_key` |
| 9 | Una alerta **sin su frase** | `resident_diagnoses_alerta_completa` |
| 10 | El **claro** en una columna cifrada | `allergies_agent_cifrado_formato` |
| 11 | Editar una revisión de alergias | `allergy_reviews_append_only` |
| 12 | Marcar a mano un elemento `auto` del ingreso | `admission_checklist_items_hecho_completo` |
| 13 | Una regla de gravedad **de centro** | sigue cerrado desde residencia-4 (D-21, D-65) |
| 14 | Atar una incidencia a una ausencia **planificada** | `resident_absences_incidencia_solo_si_no_controlada` |

### Y leer la ficha sin pasar por el registro de accesos

No hay ruta que lo haga: **todas** pasan por `conHistoria`. La prueba es que cada lectura deja su
línea, y el e2e cuenta tres lecturas y tres líneas. Si mañana alguien escribe una ruta nueva sin el
envoltorio, ese recuento deja de subir.

Y en el registro de accesos **no hay ni un dato de salud**: el test busca «penicilina», «Parkinson»,
«sonda» y «neumonía» en el volcado de la tabla.

---

## 12 · Decisiones tomadas sin preguntar

### 12.1 · `AdmissionChecklist` es una tabla, no dos

`03` §8 la nombra como entidad, pero una fila padre con sólo `client_id` no guardaría nada. La lista
**es el conjunto de sus filas**.

### 12.2 · Los dispositivos y los elementos del ingreso son CÓDIGOS, no enums

D-11 llevado aquí, como `incident_type` de residencia-4: un nebulizador o una CPAP en 2028 tienen que
ser una fila de un fichero, no un `ALTER TYPE` en producción. La clase y la gravedad de una alergia
**sí** son enums, y es el criterio: de ellas cuelga un bloqueo clínico de la Fase 2.

### 12.3 · El catálogo de dispositivos vive en el PAQUETE PURO

Y no en `apps/api/src/residencia/catalogo/`: de la misma lista salen el nombre y el riesgo, y la
segunda la necesita la regla pura de la franja. Partirlo serían dos ficheros que se separan el día
que entre una CPAP.

### 12.4 · La ruta de los días del CENTRO no pasa por `conHistoria`

No tiene `clientId`: es un recuento agregado, la misma clase de dato que el panel de dirección ya
devuelve sin registrar accesos (decisión 2 de residencia-1). **Pero lleva los nombres**, así que es
`requireOwnerOrManager` y el alcance por zona no se aplica: quien factura necesita el centro entero,
y quien factura es la dirección.

### 12.5 · Una ausencia la apunta cualquiera que registre

La auxiliar que ve que la ambulancia se lo lleva es la que está delante. **No es como un
diagnóstico**, que es del médico y la DUE. Lo que sí es de supervisión es confirmar la revisión de la
vuelta y corregir las fechas de una ausencia.

### 12.6 · Una ausencia abierta cuenta hasta el final del mes

Leída a mitad de mes, la cuenta de un residente ingresado enseña noches de hospital que todavía no
han pasado. Es deliberado: dar por vuelto a quien no ha vuelto sería contarlo como presente en la
factura, y la factura se emite con el mes cerrado — cuando la ausencia ya estará cerrada.

### 12.7 · La migración NO se parte en dos

`clinica_4`, `residencia_3`, `-4` y `-5` se partieron porque **añadían un valor a un enum que ya
existía**. Aquí los cinco son `CREATE TYPE` nuevos, y un tipo recién creado sí se puede usar en su
transacción. Partirla «porque las otras se partieron» habría sido un despliegue más sin razón detrás.

### 12.8 · Un arreglo fuera de alcance, declarado

La limpieza de los **seis** bancos e2e de residencia borra ahora los hijos del residente antes de
`DELETE FROM clients`. Las FK son `RESTRICT` a propósito, así que el banco tiene que borrarlos
primero — igual que ya hacía con las camas. Y los tres `POST /alta` de `residencia-1b.e2e.ts` llevan
ahora la clase, que es obligatoria desde D-96.

---

## 13 · Dudas abiertas

1. **La regla de los días frontera** (D-93). De serie se cuenta dónde pernocta el residente: el día
   del ingreso cuenta y el del alta no. **Hay que contrastarlo con la JCCM antes de facturacion-1.**
   Cuando se sepa, entra como parámetro del centro (`CenterAdmissionSetting` es el sitio) y
   `diasDelMes` gana un argumento. Inventarlo hoy, sin saber qué valores puede tomar, sería escribir
   una opción que nadie puede elegir.
2. **El plazo para comunicar una baja** (D-96). Normativa autonómica. Mientras no esté, cada alta de
   una concertada crea su obligación con la fecha del alta y marcada «por verificar».
3. **Las plazas `TEMPORAL`** (§7). El enum no dice quién paga. facturacion-1 lo sabrá.
4. **Los textos de los dos consentimientos** están marcados `pendienteDeValidar`. Son un punto de
   partida con los contenidos mínimos del RGPD (arts. 13 y 7) y la LOPDGDD, **no texto aprobado por
   un jurista**.
5. **El CIE-10 va cifrado** (§9). Un indicador por diagnóstico necesitará un índice ciego.
6. **La revisión de la vuelta no genera tareas todavía.** Cuando existan PAI (historia-2) y
   medicación, esa confirmación se convertirá en sus tareas de revisión y conciliación.

---

## 14 · Lo que NO cubre este bloque

Declarado en el prompt y respetado: el **PAI** y sus firmas (historia-2), las **escalas**
(historia-3), las **lesiones** (historia-4), las **sujeciones** (historia-5), la **medicación**, la
**hoja de cocina por dietas** (cocina-1), la **facturación** (facturacion-1: aquí sólo se cuentan los
días) y el **catálogo CIE-10 con buscador**.

Y lo que no se ha tocado: la suite, el `e2e` y `pnpm e2e:agenda` siguen como estaban; los tenants sin
residencia —la clínica de podología incluida— no notan nada, porque las entidades nuevas cuelgan del
residente.

---

## 15 · Convivir con calidad-1

calidad-1 corre a la vez y añade un indicador de cumplimentación por turno que sale de `queToca` +
`loQueNoSeHizo`. **No se ha tocado nada suyo.** La regla de ausencias está **dentro de `queToca`**,
así que cualquier indicador que lo use la hereda solo — y el séptimo parámetro es obligatorio, de
modo que si calidad-1 añade una llamada nueva, el compilador la para en el merge en vez de dejarla
contando a un residente ingresado.

Quien mergee segundo resolverá `schema.prisma`, el sembrador y `00-decisiones.md`. Los números de
decisión no chocan: calidad-1 reserva D-70 a D-76 y éste usa D-90 a D-97.

---

## 16 · Las capturas

En `docs/blocks/historia-1-shots/`, contra la stack de verdad (API + Postgres + las dos PWA) con
Jardín de Gredos sembrado:

| Fichero | Qué enseña |
|---|---|
| `ficha-con-franja.png` | la franja con sus DOS textos y la frase que dice qué ve la puerta |
| `puerta-con-la-franja.png` | **la prueba del bloque**: en la tablet, sólo las frases accionables |
| `puerta-con-ausente.png` | Antonio, «En el hospital», sin nada que registrar · Isabel al lado, normal |
| `puerta-reposo.png` | en reposo: nombre y nada más (residencia-3 sigue en pie) |
| `parte-con-el-ausente.png` | el parte: **una** línea de ausencia y **cero** de «no hecho» suyas |
| `ausencia-abierta-y-dias.png` | la ausencia abierta y los cuatro números del mes |
| `dias-del-mes.png` | los días del centro, con su regla a la vista |
| `ingreso-con-pendientes.png` | lo que se comprueba, lo que se marca, y los dos sin pantalla |
| `ingresos-del-centro.png` | los expedientes a medias y el plazo de la baja sin poner |
| `panel-vuelta-e-ingresos.png` | la vuelta por revisar (rojo) y los ingresos con pendientes (ámbar) |
| `residentes-con-alta.png` | la lista, con la clase del alta |
| `alta-obligacion-de-baja.png` | la obligación de comunicar la baja, vencida y por verificar |

---

## 17 · Lo que encontró el bucle visual

Cuatro cosas, y **ninguna la vio un test**:

1. **El sembrador no era idempotente.** Las incidencias y los registros nacían con `randomUUID()` y
   `ON CONFLICT DO NOTHING`, así que cada corrida escribía otra: el parte salía con la misma caída
   **seis veces**, una por corrida. Ids derivados de lo que identifica la fila, que es lo que
   «idempotente por ids fijos» prometía en su propia cabecera. El e2e no lo veía porque siembra una
   vez y la suite no siembra.
2. **Una firma imposible.** Los elementos del ingreso salían como «Lo marcó Pilar (DUE
   (enfermería))»: la persona era la dirección y la capacidad, la de la DUE. La firma la componen las
   dos y tienen que ser de la misma asignación (D-31).
3. **«Rosa (DUE) (DUE (enfermería))».** El alias del sembrador llevaba el rol dentro, y la ficha
   firma cada línea con «lo escribió NOMBRE (CAPACIDAD)».
4. **Una frase que mandaba a otro sitio.** El consentimiento de datos sin firmar decía «se firma en
   su ficha» cuando el formulario está debajo, en la misma página.

Y una que el test encontró al correrlo, y vale la pena escribir: la primera versión del test de la
puerta buscaba la palabra **«pan»** (de una nota de dieta) en el cuerpo de la respuesta, y salía roja
por **`ocupantes`**. Se cambió a canarios —cadenas que no existen en ningún sitio del producto— que
es lo que residencia-6 ya hacía con lo ilegible. Un canario no se puede confundir con nada.

---

## 18 · Cómo se cierra

### La migración · UNA, y aditiva

`20261023010000_historia_1_ficha`: ocho tablas nuevas vacías, cinco tipos nuevos y **una sola columna
nullable** sobre `resident_profiles`. Ni un `DROP`, ni un `DELETE`, ni un `TRUNCATE`, ni un
`UPDATE … SET` sobre datos fuera de las funciones de los triggers. El único `ALTER TABLE` sobre una
tabla que ya existía nombra `resident_profiles`, y sólo para añadir la columna y su CHECK.

Los CHECK con rango llevan su **`IS NOT NULL` delante del `BETWEEN`** — un CHECK que da NULL *pasa*,
y es la lección que residencia-2 pagó en `care_plan_items`.

**El `down`** va comentado en la cabecera y **se probó de verdad**, no sólo escrito: aplicado sobre
una copia con datos de residencia-1 a -6, deja cero rastros (ni tablas, ni columna, ni tipos) y los
recuentos intactos —3 residentes, 110 registros de cuidado, 76 líneas de plan, 7 partes congelados, 6
incidencias—. Volver a aplicar el `up` funciona.

Es **completo** mientras no haya una sola fila dentro: después, el `down` es tirar historia clínica
que la ley obliga a conservar cinco años (Ley 41/2002, D-45), y eso no lo deshace una migración.

### Sobre una copia con datos de residencia-1 a -6

`mipiacetpv_residencia6_banco` copiada y migrada: todos los recuentos intactos, las ocho tablas
nuevas vacías, y **cero altas con clase y cero altas sin clase** — no se le inventa una clase a nadie.

### Deriva de Prisma · ninguna nueva de forma

`migrate diff` (migraciones → schema) sobre base limpia da **513 líneas** frente a las **489** de
`origin/master`. Las 24 de diferencia son todas `ALTER COLUMN … DROP DEFAULT` de las ocho tablas
nuevas: el mismo residuo que las 23 tablas que ya lo producían, porque `@default(uuid())` y
`@updatedAt` son de la aplicación y el SQL pone su default. Ni una línea de otra clase.

### El sello de la migración

master metió `20261023000000_primer_acceso_invitacion` el mismo día y con el mismo sello. El merge
salió **limpio, sin un conflicto**, pero dos migraciones con el mismo prefijo dejan el orden a merced
del nombre de la carpeta. La de este bloque pasó a `20261023010000` — es la que todavía no estaba en
master y por tanto la que se puede renombrar sin tocar nada desplegado.

### Verde

- **Suite unitaria desde la raíz**: 439 ficheros, **6 438 tests** (10 saltados).
- **Typecheck**: API, los paquetes, `tsc -b` de tpv-web y de admin.
- **Builds de Vite**: admin y tpv-web.
- **e2e contra Postgres de verdad**, con el `.env` apartado y `REDIS_URL` a un puerto muerto (como la
  CI): **50 ficheros, 1 148 tests, todos verdes.**
- Un test de la casa salió rojo una vez en una pasada y verde en aislamiento:
  `cashier-login › rate limit se resetea tras un login exitoso`, que depende de tiempos. No lo toca
  este bloque.

### Lo nuevo de este bloque

| Fichero | Qué es |
|---|---|
| `packages/residencia-plan/src/ficha.ts` | la franja de alertas y el catálogo de dispositivos, puros |
| `packages/residencia-plan/src/ausencias.ts` | si está fuera, sus frases y `diasDelMes` |
| `packages/residencia-plan/test/ficha.test.ts` | la tabla de la franja (33 casos) |
| `packages/residencia-plan/test/ausencias.test.ts` | las ausencias y la tabla de oro de los días (34) |
| `apps/api/src/residencia/ficha-clinica.ts` | leer la ficha descifrada y quién escribe cada parte |
| `apps/api/src/residencia/ausencias.ts` | abrir, cerrar, revisar y cargarlas para el plan |
| `apps/api/src/residencia/ingreso.ts` | los doce elementos y la comprobación de los `auto` |
| `apps/api/src/residencia/alta-del-residente.ts` | la obligación de comunicar la baja |
| `apps/api/src/residencia/ficha-clinica-routes.ts` | las rutas de la ficha |
| `apps/api/src/residencia/ausencias-routes.ts` | las ausencias y los días del mes |
| `apps/api/src/residencia/ingreso-routes.ts` | el ingreso, el contrato y los dos plazos |
| `apps/admin/src/pages/residencia/FichaClinicaPage.tsx` | la ficha, con su franja |
| `apps/admin/src/pages/residencia/AusenciasResidentePage.tsx` | ausencias y días de un residente |
| `apps/admin/src/pages/residencia/IngresoResidentePage.tsx` | el ingreso guiado, con el pad de firma |
| `apps/admin/src/pages/residencia/IngresosPage.tsx` | los ingresos del centro y los plazos |
| `apps/admin/src/pages/residencia/DiasPage.tsx` | los días del mes del centro |
| `apps/admin/src/pages/residencia/ficha-lib.ts` | los tipos y las frases, en un sitio |
| `apps/api/test/historia-1-migracion.test.ts` | el contrato del SQL (42 casos) |
| `apps/api/test-e2e/historia-1.e2e.ts` | el bloque entero contra Postgres (52 casos) |
| `apps/admin/test/historia-1-pantallas.test.tsx` | las cinco pantallas (16 casos) |
| `apps/tpv-web/test/puerta-franja-y-ausente.test.tsx` | la banda y el ausente (9 casos) |
| `packages/db/prisma/migrations/20261023010000_…` | las ocho tablas, los cinco tipos y la columna |

### Cómo arrancarlo de cero

```bash
pnpm install --frozen-lockfile
pnpm --filter @mipiacetpv/db run generate
docker start mipiacetpv-postgres

# una base propia por sesión, y un Redis propio por worktree
createdb mipiacetpv_historia1_banco
DATABASE_URL=…/mipiacetpv_historia1_banco pnpm --filter @mipiacetpv/db run migrate:deploy

# apps/api/.env con esa base, su Redis y una CLINICAL_KEK nueva
cd apps/api && set -a && . ./.env && set +a && npx tsx src/scripts/sembrar-gredos.ts

pnpm --filter @mipiacetpv/api dev                                 # API
MIPIACETPV_API_PROXY=http://127.0.0.1:3017 npx vite --port 5293   # en apps/admin
MIPIACETPV_API_PROXY=http://127.0.0.1:3017 npx vite --port 5294   # en apps/tpv-web
```

El sembrador deja el escenario del prompt: Carmen con disfagia, alergia grave y sonda; Luis con «sin
alergias conocidas» registrado; Antonio ingresado desde hace tres días; Isabel de vuelta ayer y
pendiente de revisar; Dolores recién ingresada con pendientes; y Manuel dado de alta por traslado con
su obligación de comunicar la baja. Dos tablets de puerta: la 112 (PIN de Ana, `4071`) y la 201 (PIN
de Mari, `7788`).

El e2e:

```bash
E2E_DATABASE_URL=postgresql://…/mipiacetpv_historia1_e2e \
REDIS_URL=redis://127.0.0.1:6399 \
pnpm --filter api run test:e2e          # con apps/api/.env apartado, como la CI
```

---

## 19 · Commits

```
feat(residencia): la ficha clínica del residente, ausencias, ingreso y alta (D-90 a D-96)
feat(residencia): las ausencias PAUSAN dentro de queToca y la franja de alertas se calcula (D-91, D-92)
feat(residencia): las rutas de la ficha, las ausencias, los días del mes y el ingreso guiado (D-90 a D-96)
feat(residencia): el sembrador de Gredos con el escenario de la ficha clínica
feat(admin): la ficha clínica, las ausencias, los días del mes y el ingreso guiado (D-97)
test(historia-1): el contrato del SQL, el e2e del bloque y la tabla de sabotajes
test(historia-1): las pantallas del admin y la banda de la puerta
fix(residencia): lo que encontró el bucle visual
chore: master dentro de la rama · la migración de historia-1 pasa a las 01:00
docs(residencia): el done del bloque historia-1 y la hoja de ruta al día
```
