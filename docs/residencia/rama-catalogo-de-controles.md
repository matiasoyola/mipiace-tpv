# Rama — Catálogo de controles (capas 1-4)

> **Copia en el repo** del documento fuente del proyecto «Jardin de Gredos» (`claude/rama-catalogo-de-controles.md`),
> traída el 15-10-2026 para que los bloques de residencia no dependan de un documento que no está aquí.
> Las decisiones vinculantes viven en `00-decisiones.md`; si este documento y aquel discrepan, manda `00-decisiones.md`.

> Rama de trabajo abierta en la **sesión 2** de la toma de requisitos (2026-08-19).
> Interlocutor: **Matías Oyola** (Mi Piace). Método: pregunta a pregunta, continuando la numeración (P43-P51).
> Base: `respuestas-requisitos-fase0.md` §10.1 · `toma-de-requisitos-fase0.md` · `auditoria-aenor-2026-analisis.md`.
> Esta rama es la que **desbloquea el modelo de datos**, y con él el portal de familias y los niveles de gravedad.

---

## 1. Tesis de la rama

**El catálogo de controles es dato, no código.**

Una sola entidad `TipoDeControl`, parametrizada. Dar de alta un control nuevo en 2028 debe ser rellenar
una fila, no tocar la aplicación. Y los 23 indicadores que se declaran a AENOR dejan de ser un informe
que alguien redacta a posteriori: son consultas sobre esta tabla.

### Atributos de `TipoDeControl`

| Atributo | Valores / notas |
|---|---|
| Código y nombre | vocabulario del cliente, no inventado |
| **Capa** | 1 ejecución · 2 observación · 3a constante · 3b escala validada · 4 evento |
| **Naturaleza** | programada (se cumple o se incumple) · a demanda (solo se cuenta) · **derivada** (la genera el sistema) |
| **Dominio de valores** | booleano · escala ordinal · numérico con unidad · puntuación · texto |
| Unidad y rango de referencia | solo numéricos; el rango es **estándar del producto** |
| **Periodicidad** y **momento aplicable** | no toda dimensión se pregunta en todos los turnos |
| Rol autorizado a registrar | auxiliar · DUE · médico · TO/fisio · limpieza · dirección |
| **Visibilidad** | interna / visible para familia → alimenta el portal de familias |
| Indicador ISO al que alimenta | enlace al catálogo de 23 indicadores de AENOR |
| **Reglas derivadas** | umbral superado → evento · ausencia prolongada → evento |
| **Ámbito** | estándar del producto · activable por el centro |
| Versión y vigencia | el catálogo clínico se versiona y se revisa |

---

## 2. Las cuatro capas

Las capas **no** se distinguen por quién registra ni por la pantalla. Se distinguen por **qué significa el dato**.

| Capa | Pregunta que responde | Semántica | Forma del registro |
|---|---|---|---|
| **1. Ejecución** | ¿se hizo? | cumplimiento | hecho / no hecho + hora + quién |
| **2. Observación diaria** | ¿cómo está hoy? | estado percibido por el observador | valor en escala ordinal corta |
| **3. Medidas** | ¿cuánto ha cambiado? | valor comparable en el tiempo, con umbral | número o puntuación |
| **4. Eventos** | ¿qué ha pasado? | ruptura de la normalidad | tipo + gravedad + protocolo |

La capa 3 se subdivide, porque son dos familias que comparten semántica y se comportan distinto:

| | **3a. Constantes** | **3b. Escalas validadas** |
|---|---|---|
| Ejemplos | temperatura, tensión, pulso, saturación, peso, glucemia | Barthel · Lobo y cols. · Tinetti · Norton |
| Origen | un aparato | un profesional pasando un cuestionario |
| Frecuencia | diaria o a demanda | trimestral / anual |
| Juicio | ninguno: 38,2 es 38,2 | interpretación |

**Consecuencia clave:** la constante es el único control que **dispara un aviso sin juicio humano**.
La auxiliar no declara "fiebre": registra 38,2 y **el sistema declara la incidencia**. Eso quita decisiones
de la tablet y hace la gravedad consistente entre turnos y entre personas.

---

## 3. Capa 1 — Ejecución *(borrador desde el Drive, pendiente de validar)*

Elicitada por análisis documental (`inventario-drive-residencia.md` + indicadores de AENOR).
No hace falta preguntarla de cero: hace falta que el cliente la corrija.

| Control | Naturaleza | Rol | Indicador ISO que alimenta |
|---|---|---|---|
| Higiene personal | a demanda (sin tope) + base programada | auxiliar | — |
| Cambio postural | programada | auxiliar | UPP nuevas/mes |
| Ingesta (desayuno · comida · merienda · cena) | programada | auxiliar | desnutrición |
| Siesta / descanso | programada | auxiliar | — |
| Deposición | a demanda, contada | auxiliar | nº residentes sin deposición >3 días |
| Dispensación de medicación diurna | programada | DUE / auxiliar | — |
| Dispensación de medicación nocturna | programada | auxiliar de noche | — |
| Limpieza de habitación | programada | limpieza | nº limpiezas extraordinarias |
| Limpieza de baños | programada | limpieza | — |
| Hidratación cutánea | programada (viene del PAI) | auxiliar | infecciones en la piel |
| Toma de peso | programada (según protocolo) | DUE | desnutrición |
| Gimnasia de mantenimiento | programada, con participación | TO / fisio | % que participan y completan |
| Estimulación cognitiva | programada, con participación | TO | % que asisten |
| Taller de rehabilitación grupal | programada | TO | — |
| Actividad sociocultural | evento programado | TO | nº actividades/mes · nuevas/6 meses |
| Transferencias | programada / a demanda | auxiliar | % semiasistidos que participan |
| Analítica | programada (ingreso + anual) | DUE | — |
| Visita médica | programada mensual | médico | todos vistos 1 vez/mes |

---

## 4. Capa 2 — Observación diaria

**Prioridad del cliente: estados de ánimo y estados cognitivos.** Es además la capa que no existe
en ningún papel de la casa.

### Dimensiones aceptadas (P45)

Ánimo · cognición · dolor · descanso nocturno · piel · ingesta · movilidad/estabilidad.
El cliente añadió heridas, fiebre, tensión y pulso — que **no son observación**: ver §5 y §6.

### Vocabulario propuesto *(pendiente de contraste con auxiliares en la observación de turno)*

| Ánimo | Cognición |
|---|---|
| Como siempre | Como siempre |
| Apagado / triste / no quiere levantarse | Más despistado de lo habitual |
| Inquieto / ansioso | Confuso — no reconoce, no se ubica |
| Irritable / agresivo | Ausente — no responde |

Más un botón transversal **"algo no va bien"**, con **nota de voz** o **texto corto alternativo** (ambos opcionales).
La IA transcribe, propone dimensión y destinatario; **propone, no decide**, y el apunte queda firmado por la auxiliar.

### Reglas de diseño de la capa

1. **El registro no exige diagnosticar.** "Algo no está bien" es un dato válido y completo por sí mismo.
   Si la pantalla obliga a categorizar, la auxiliar no registra.
2. **Toda observación es relativa a la línea base del residente**, no a una norma poblacional.
   Un residente que no habla puede llevar tres años sin hablar. Sin línea base, la IA no detecta nada.
3. **Se registra siempre, también cuando está bien.** Sin el "como siempre" no hay denominador y no se
   distingue *"hoy está normal"* de *"hoy nadie lo miró"* — que es justo la distinción que da el control
   que dirección pidió como métrica de éxito.
4. **Se registra un residente, no siete dimensiones.** Un toque en "como siempre" da por buenas todas las
   dimensiones a la vez; solo se despliega la que se desvía.

> **Principio de diseño (extensible a toda la v1):**
> **el coste de registro es proporcional a la anomalía, no al tamaño del catálogo.**
> Caso normal ≈ 2 s (≈85 % de los días); día con algo ≈ 15 s. Permite ampliar el catálogo sin
> tocar el presupuesto de interacción de D-05.

---

## 5. Capa 3 — Medidas

- **Los umbrales clínicos son estándar médico, no configuración del centro** (decisión explícita del cliente).
  Catálogo **de serie**, versionado y con fecha de revisión. Cuando cambie una guía, se actualiza en el
  producto y baja a todos los centros.
- **Excepción por residente solo por prescripción médica**, firmada y con vigencia. Un hipertenso crónico,
  un paliativo o alguien con hipotermia habitual tienen rangos propios: el **mecanismo es genérico**, el valor
  distinto es un **dato clínico del residente**, no una configuración local. Nadie del centro puede tocar
  un umbral; la médica sí puede pautar el de un residente concreto.
- **El árbol de actuación es protocolo clínico, no decisión de producto.** Nosotros ponemos el motor y una
  plantilla por defecto; **lo firman la médica y la DUE**.
  Oportunidad: los protocolos de hipertensión y diabetes del Drive no se revisan desde 2011 y el de caídas
  desde 2012. Ese árbol hay que reconstruirlo igualmente para AENOR.
- Escalas 3b: ya elegidas por la casa desde 2012 (Barthel · Lobo · Tinetti · Norton) y **vacías**.
  Pendiente H-05: qué pasan hoy realmente la médica y la DUE.

---

## 6. Capa 4 — Eventos

- Definición del cliente (sesión 1): *"una caída, una fiebre, un vómito, cualquier anomalía a un descanso
  normal del residente"*.
- **Buena parte de los eventos no se declaran: se derivan.** Dos generadores automáticos:
  - **Por umbral** — 38,2 °C → incidencia "fiebre".
  - **Por ausencia** — 3 días sin deposición → incidencia (es literalmente un indicador de AENOR).
- **"Herida" no cabe en "piel".** Una herida no es una observación de un día: es un objeto que vive semanas,
  tiene curas, evoluciona y se cierra. Entidad propia `Lesión` con seguimiento longitudinal, a cargo de la DUE.
  Es exactamente lo que hoy hace imposible reportar el indicador de UPP.

### 6.1 Escala de gravedad *(propuesta, pendiente de firma clínica)*

Niveles definidos por **la consecuencia, no por la causa**: así valen igual para una caída, una fiebre o
una agresión, y el árbol clínico solo tiene que decir en qué nivel cae cada cosa.

| Nivel | Significado | Quién se entera y cuándo |
|---|---|---|
| **N0** | Queda constancia | Nadie. Vive en la historia del residente |
| **N1** | Lo tiene que saber el turno siguiente | Parte de relevo |
| **N2** | Alguien tiene que verlo ahora | Aviso inmediato a la DUE |
| **N3** | Hay que tomar una decisión clínica | DUE + médico + dirección |
| **N4** | Emergencia | 112, traslado, dirección y familia en el momento |

### 6.2 Cierre de la incidencia

- **La cierra siempre un rol de categoría directiva** (decisión del cliente).
- **N0 no se cierra**: no abre nada, es solo constancia.
- **N1 y N2**: puede cerrarlas la misma persona que registró si tiene rol directivo, pero el sistema
  **lo marca como autocierre**.
- **N3 y N4**: quien cierra debe ser **distinto de quien registró**. Si no hay nadie más en ese momento,
  la incidencia queda abierta y sube al panel de dirección.

### 6.3 Un solo libro de incidencias

Los campos son idénticos para una caída, una avería, una queja o un problema con un proveedor:
qué ha pasado · cuándo y quién lo vio · gravedad · a quién avisar · qué se hizo · quién cierra.
**Lo único que cambia es el sujeto.**

→ **Una sola entidad con el sujeto como atributo** (residente · proceso · instalación · proveedor · trabajador),
no cuatro entidades separadas. Razones:

- Una sola pantalla de "qué hay abierto hoy en la residencia" — que es literalmente la métrica de éxito de dirección.
- Gravedad, escalado, cierre y trazabilidad se construyen una vez.
- Un tipo nuevo en 2028 es una fila, no un desarrollo.
- **Casos cruzados**: un residente se cae porque el asidero estaba suelto → incidencia + avería **enlazadas**.
  Con libros separados, la relación causa-efecto se pierde, que es justo lo que AENOR busca en las acciones correctoras.
- Cierra por construcción la **NC 01** (dos mapas de procesos que no cuadran).

**No implica una sola pantalla**: cada sujeto tiene su formulario y su vista. Mismo libro por detrás.
Se reserva la palabra **"incidencia"** para el sujeto residente, que es como lo llama el cliente.

**Alcance de la v1 — pendiente (P51).** Propuesta: residente + queja + avería dentro; proveedor fuera;
no conformidad de calidad en v1 solo si aprieta la auditoría de 2027.

---

## 7. El relevo de turno

Existe ya una **reunión de cambio de turno**. El sistema **no crea una ceremonia nueva: alimenta la que ya hacen**.

- **El relevo es una entidad del sistema.** Lo registrado en las puertas durante el turno se convierte solo
  en el **parte de relevo**: incidencias, "algo no va bien", tareas no hechas, cambios de pauta. Nadie lo escribe.
- **Leer deja rastro.** Quien recoge el turno confirma el parte con su PIN. Cierra el bucle de "la información
  debe fluir entre roles" — no *debería* fluir: queda demostrado que fluyó. Y produce gratis una evidencia de
  comunicación entre turnos que hoy no existe en papel.
- **Dos velocidades de propagación:** lo que puede esperar va al relevo; lo que no puede esperar salta como
  aviso en el momento. Lo que decide en cuál cae es la **gravedad**.

---

## 8. Identidad: persona, rol y capacidad

- **Rol ≠ persona.** Una persona puede acumular varios roles, y la relación es de muchos a muchos **con vigencia**
  (sustituciones, vacaciones, guardias). Caso vivo en la plantilla: Ana Isabel es **TO + Calidad**.
- **Los permisos cuelgan del rol**, nunca de la persona.
- **Los roles tienen categoría**: `operativo · supervisor · directivo`. **Las reglas se escriben contra la
  categoría**, no contra un rol concreto ni contra una persona: "cierra un rol de categoría directiva" viaja
  a los siguientes centros; "cierra Carmen" no sale de Buenaventura.
- **Se elige rol al entrar con el PIN.** Consecuencia directa de D-03 (una pantalla de inicio por rol):
  si tienes dos roles, tienes dos pantallas de inicio.
- **Toda acción se firma con persona + capacidad.** "Lo cerró Ana Isabel" no es evidencia;
  "lo cerró Ana Isabel, como responsable de calidad" sí lo es.

---

## 9. Comunicación a familias

- **Es una dimensión aparte, no un nivel de gravedad.** Una caída sin consecuencias es N1 y la familia
  quiere saberlo el mismo día; un hallazgo N3 puede convenir no comunicarlo hasta tener diagnóstico.
- **Sin avisos automáticos.** El sistema **sugiere** el aviso; **la persona decide y comunica**.
  → Principio general: **el sistema no habla con el exterior por su cuenta.**
- **Constancia en los dos sentidos**, misma lógica de denominador que el "como siempre":
  - **Comunicado** — quién, cuándo, por qué vía, qué se dijo, respuesta de la familia.
  - **No comunicado** — quién lo decidió y por qué.
- Cierra la **observación 10 de AENOR** (registro de comunicación del seguimiento del PAI a la familia).
- **Arrastra el portal de familias** (rama 3): si no hay avisos automáticos, el portal no puede ser un
  directo del residente. Propuesta de dos regímenes:
  - **Publicación automática** — lo que no requiere juicio: actividades, menús, fotos, PAI revisado.
  - **Comunicación deliberada** — todo lo clínico y toda incidencia: pasa siempre por una persona.

---

## 10. Frontera estándar / centro

Decisión de la sesión: **esto es un producto para residencias del que Jardín de Gredos es el cliente cero**,
no una plataforma a medida. La frontera hay que trazarla ahora; es la diferencia entre un producto que escala
y uno que se bifurca por cliente en la tercera venta.

| Estándar del producto (intocable en el centro) | Del centro (configurable) |
|---|---|
| Capas y semántica del catálogo | Qué controles activa (subconjunto) |
| Umbrales clínicos, unidades, rangos de referencia | — *(solo excepción médica por residente)* |
| Escalas validadas y su baremo | Periodicidad de paso, dentro de un rango |
| Motor de gravedad y de escalado | Destinatarios de cada nivel |
| Estructura del PAI | Textos y objetivos de la plantilla |
| Modelo de plazas y pagadores | Tarifas y catálogo de servicios extra |
| Vocabulario de la interfaz | Alias locales (glosario del centro) |
| Roles y permisos | Asignación de personas a roles, zonas y turnos |
| **Fórmula** de cada indicador ISO | **Umbral objetivo** del indicador (44/48, 73,5 %…) |
| Estructura del relevo | Horarios de turno |

---

## 11. Decisiones de la rama

| # | Decisión |
|---|---|
| D-11 | El **catálogo de controles es dato, no código**: una entidad `TipoDeControl` parametrizada. |
| D-12 | La observación se registra **en la puerta y en el momento**, no al final del turno. |
| D-13 | **"Algo no está bien" es un registro válido y completo.** La pantalla no obliga a diagnosticar. |
| D-14 | Toda observación es **relativa a la línea base del residente**. |
| D-15 | **Se registra siempre, también "como siempre"**: sin denominador no hay control. |
| D-16 | **Coste de registro proporcional a la anomalía**, no al tamaño del catálogo. Un toque por residente. |
| D-17 | Nota **de voz + texto corto alternativo**, opcionales. La IA **propone, no decide**; firma la auxiliar. |
| D-18 | **El relevo es una entidad del sistema**, con parte autogenerado y **acuse de recibo por PIN**. |
| D-19 | **Dos velocidades de propagación** (relevo vs aviso inmediato), decididas por la gravedad. |
| D-20 | **Eventos derivados automáticamente** por umbral y por ausencia; no todo evento se declara a mano. |
| D-21 | **Los umbrales clínicos son estándar médico de serie**, versionados. No se configuran por centro. |
| D-22 | **Excepción clínica por residente solo por prescripción médica**, firmada y con vigencia. |
| D-23 | El **árbol de actuación lo firman la médica y la DUE**. Producto aporta motor y plantilla por defecto. |
| D-24 | **`Lesión` es entidad propia** con seguimiento longitudinal, distinta de la observación "piel". |
| D-25 | **Producto multi-centro; Jardín de Gredos es el cliente cero.** Frontera estándar/centro en §10. |
| D-26 | **Gravedad por consecuencia (N0-N4)**, no por causa. |
| D-27 | **La incidencia la cierra siempre un rol de categoría directiva.** N0 no se cierra. |
| D-28 | **N3 y N4 exigen cierre por persona distinta de quien registró**; N1 y N2 admiten autocierre marcado. |
| D-29 | **Rol ≠ persona**: relación muchos a muchos con vigencia; los permisos cuelgan del rol. |
| D-30 | **Los roles tienen categoría** (operativo · supervisor · directivo) y las reglas se escriben contra ella. |
| D-31 | **Se elige rol al entrar con el PIN** y toda acción se firma con **persona + capacidad**. |
| D-32 | **Comunicación a familia = dimensión aparte**, no nivel de gravedad. |
| D-33 | **Sin avisos automáticos al exterior**: el sistema sugiere, la persona decide y comunica. |
| D-34 | Se registra **también la decisión de no comunicar**, con autor y motivo. |
| D-35 | **Un solo libro de incidencias** con el sujeto como atributo; pantallas distintas por sujeto. |

---

## 12. Pendiente en la rama

- **P51 abierta**: qué sujetos entran en el libro de incidencias de la v1.
- Validar la tabla de capa 1 (§3) con el cliente.
- Contrastar el vocabulario de ánimo y cognición **con auxiliares reales**, no con dirección.
- Cerrar el catálogo de eventos y la asignación de cada uno a su nivel (firma clínica).
- Decidir la **visibilidad para familia** control a control → entrada del portal de familias.
- H-05: qué escalas pasan hoy la médica y la DUE, y con qué frecuencia.
- H-10: fuente y mantenimiento del catálogo clínico estándar.
