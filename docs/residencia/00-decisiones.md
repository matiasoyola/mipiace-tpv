# Residencia · decisiones de cierre de la Fase 0 (14-10-2026)

Vertical de **residencias de mayores** sobre el núcleo de mipiacetpv. Cliente cero: **Jardín de Gredos**
(Buenaventura, Toledo · 49 plazas · ~20 concertadas con la JCCM · ISO 9001 con AENOR).

Origen: toma de requisitos con Matías (sesiones 15-08 y 19-08, decisiones D-01 a D-35), comparación con
mipiacetpv (14-10, D-36 y D-37) y **cierre por criterio de Claude** de todo lo que quedaba abierto
(14-10, D-38 a D-60), con delegación expresa de Matías: *«dejo que apliques tu criterio a todas las
dudas que queden por resolver, quiero que empecemos ya»*.

Documentos fuente (proyecto «Jardin de Gredos»; copia en `docs/residencia/` desde el 15-10-2026): `concepto-software-residencia.md`,
`respuestas-requisitos-fase0.md`, `rama-catalogo-de-controles.md`, `residencia-sobre-mipiacetpv.md`,
`auditoria-aenor-2026-analisis.md`.

---

## 1. Lo que ya estaba decidido (resumen)

- **Todo a pulsaciones, cero escritura.** Presupuesto: ≤30 min por jornada y auxiliar; ≤15 s por
  registro con el desplazamiento incluido → **tablet en la puerta de cada habitación** (D-05).
- **Coste de registro proporcional a la anomalía** (D-16): un toque en «como siempre» por residente;
  sólo se despliega lo que se desvía.
- **El catálogo de controles es dato, no código** (D-11): entidad `TipoDeControl` con capas
  1 ejecución · 2 observación · 3a constante · 3b escala · 4 evento.
- **Eventos derivados** por umbral y por ausencia (D-20). Umbrales clínicos **de serie**, versionados;
  excepción por residente sólo por prescripción médica (D-21, D-22).
- **Gravedad por consecuencia N0-N4** (D-26); cierre por rol de categoría directiva, N3/N4 por persona
  distinta de quien registró (D-27, D-28). **Un solo libro de incidencias** con el sujeto como atributo (D-35).
- **Relevo de turno como entidad**, parte autogenerado y acuse de recibo con PIN (D-18, D-19).
- **Rol ≠ persona**, roles con categoría (operativo · supervisor · directivo), se elige rol al entrar,
  toda acción firmada con persona + capacidad (D-29 a D-31).
- **El sistema no habla con el exterior por su cuenta**; se registra también la decisión de no
  comunicar a la familia (D-32 a D-34).
- **Multi-centro; Jardín de Gredos es cliente cero** (D-25).
- **Holded siempre opcional** (D-36). **Vertical técnica sobre mipiacetpv, producto comercial propio** (D-37).

## 2. Cierre de lo abierto (criterio de Claude, 14-10-2026)

### Alcance de la v1

| # | Decisión | Por qué |
|---|---|---|
| D-38 | **Libro de incidencias v1: residente, queja y avería.** Proveedor fuera. No conformidad de calidad entra cuando se acerque la auditoría (bloque propio en primavera 2027). (P51) | Es lo que se vive a diario; la NC se apoya en el mismo libro y no cambia el modelo. |
| D-39 | **La v1 es la Fase 1 del concepto: la habitación + el panel de dirección.** Dentro: residentes y habitaciones, personal y roles, catálogo de controles (capas 1, 2 y 3a), plan de cuidados por residente, la puerta, eventos derivados, libro de incidencias, relevo y panel de dirección. | Es el mínimo que produce evidencia ISO sin que nadie escriba, que es la métrica de éxito. |
| D-40 | **Fuera de la v1:** escalas 3b (se reutiliza `ClinicalAssessment` en Fase 2), medicación, `Lesión`, portal de familias, facturación de plazas, IA, APPCC y reglamentario. | Cada una es un bloque grande con su propio riesgo; ninguna hace falta para que la puerta funcione. |
| D-41 | **La medicación en la v1 sólo existe como tarea de capa 1** («dispensación hecha»). La cadena prescribe → prepara → administra con propagación en tiempo real (D-10) es Fase 2. | Es la pieza de más riesgo clínico; mejor sobre un núcleo ya probado en planta. |
| D-42 | **Calendario de obligaciones de dirección en la v1**, mínimo: obligación con periodicidad, responsable y hecho/no hecho. Catálogo inicial lo carga Mi Piace con Matías. (H-04) | Es la mitad de la métrica de éxito de dirección («la tarea que toque ese día del mes»). |

### Arquitectura (ADRs)

| # | Decisión | Por qué |
|---|---|---|
| D-43 | **ADR-01 cerrado: offline-first + sync, heredado de mipiacetpv.** El wifi se mide igualmente (H-08), pero ya no bloquea: un punto muerto sólo retrasa la subida. | Está resuelto y probado en producción. |
| D-44 | **ADR-03 cerrado: multi-tenant de mipiacetpv.** Un centro = un tenant. Un grupo con varios centros = varios tenants (agrupación, más adelante). | Es el modelo que ya existe. |
| D-45 | **ADR-05 cerrado: las garantías clínicas de clinica-1 se aplican a todo lo de la residencia.** Lo clínico no se borra (`Restrict`), es inmutable (anotaciones), sólo lo ve quien debe y todo acceso se apunta. Conservación ≥5 años (Ley 41/2002). Cifrado por campo fuera de la v1, igual que en la clínica. | Mismo marco legal, mismo código. |
| D-46 | **ADR-02: no hay IA en la v1 ni notas de voz.** El botón «algo no va bien» lleva **texto corto opcional** y selección de dimensión. La voz entra con la capa de IA (Fase 4), con proveedor con DPA, en la UE y sin retención del audio. | La voz sin IA que la transcriba es un audio que nadie escucha. |
| D-47 | **Hosting: el mismo de mipiacetpv** (VPS en la UE). Mi Piace es encargado de tratamiento con su DPA (`docs/legal/dpa-encargado-tratamiento.md`, a extender a residencias). | No se mantiene una segunda infraestructura. |
| D-48 | **La residencia se enciende por tenant con un interruptor del super-admin** (`residenciaEnabled`), mismo patrón que `clinicalRecordsEnabled`. No es un `BusinessType` nuevo. Un tenant de residencia tiene además la clínica encendida y la caja apagada por defecto. | Mismo patrón que el resto de verticales (ADR-R6); el `BusinessType` sólo cambia iconografía. |

### Modelo

| # | Decisión | Por qué |
|---|---|---|
| D-49 | **El residente es un `Client` de mipiacetpv con un perfil 1:1** (`ResidentProfile`), igual que `StaffProfile` amplía a `User`. Hereda gratis historia, accesos, registro de accesos, consentimientos, fotos e informes. | Reutiliza toda la clínica sin duplicar nada. |
| D-50 | **Roles de cuidado aparte del rol de negocio.** El `UserRole` del TPV se queda como está. Los roles de residencia (auxiliar, DUE, médico, TO, fisio, limpieza, calidad, dirección…) son **catálogo de datos con categoría**, y la asignación persona-rol es **muchos a muchos con vigencia**. Los permisos de residencia cuelgan del rol de cuidado. | Cumple D-29/D-30 sin tocar las ~60 rutas de caja que miran `UserRole`. |
| D-51 | **Todo el personal que registra es sanitario a efectos de acceso** (`isClinician`), con alcance por **zona/planta** en vez de por paciente: la auxiliar ve lo accionable de los residentes de su zona. La DUE y el médico, todos. | La selección por cita de la clínica no tiene sentido en una residencia: no hay citas, hay zonas y turnos. |
| D-52 | **La puerta es un dispositivo nuevo `ROOM`** emparejado a una habitación, con la misma APK en «modo puerta» (como la tablet de cocina). No abre turno, no cobra, no factura. | Mismo patrón que `KITCHEN` en kds-1. |
| D-53 | **El plan de cuidados por residente es dato**: qué controles le tocan, con qué periodicidad y en qué turno. Se precarga desde el catálogo por perfil (válido / semiasistido / dependiente) y se ajusta a mano. La frecuencia **no** se lee del PAI en prosa. (H-03) | El PAI es prosa; convertirlo en plan ejecutable es justo el valor del producto. La IA lo leerá en Fase 4. |
| D-54 | **Turnos del centro configurables** (por defecto mañana 08-15, tarde 15-22, noche 22-08). El registro se adscribe al turno en que ocurre. | Es la unidad del relevo y del plan. |

### Clínica y calidad

| # | Decisión | Por qué |
|---|---|---|
| D-55 | **Escalas de la casa: Barthel, Lobo, Tinetti y Norton**; se pasan con `ClinicalAssessment` en Fase 2. (H-05: se da por buena la elección de 2012 y se corrige si la médica dice otra cosa.) | Están elegidas y coinciden con los indicadores de AENOR. |
| D-56 | **Plantilla de gravedad por defecto** (ver §3), de serie. El sistema funciona con ella desde el día uno. (H-07) *(La condición de firma clínica queda sustituida por D-65.)* | D-23 manda que la firmen ellas; pero sin plantilla no hay reglas de aviso y no se puede empezar. |
| D-57 | **Catálogo clínico estándar: lo mantiene Mi Piace**, lo valida la médica del cliente cero y se revisa **una vez al año** o cuando cambie una guía, con versión y fecha. (H-10) | Alguien tiene que ser dueño; el producto es el que lo distribuye. |
| D-58 | **Relevo por centro y por turno**: parte único del turno saliente, lo confirma con PIN al menos una persona del entrante; la DUE confirma el suyo si está de turno. Cuántos asisten y cómo se ajusta tras observar un turno real. (H-09) | Empieza simple y se afina con observación. |
| D-59 | **Vocabulario de ánimo y cognición: el propuesto en la rama de controles**, editable como dato. Se contrasta en la observación de turno, sin bloquear. | Es dato: cambiarlo no es un desarrollo. |
| D-60 | **Visibilidad para la familia: todo interno por defecto.** Cada control lleva el atributo desde ya, pero no hay portal en la v1. (H-11) | El atributo es una columna hoy; el portal, un bloque mañana. |

### Tras residencia-1 (14-10-2026)

| # | Decisión | Por qué |
|---|---|---|
| D-61 | **Quien dirige el centro entra como OWNER del tenant.** Roles de cuidado y zonas los asigna sólo el OWNER (decisión 6 de residencia-1), y no se abre al encargado. | Decidir quién ve datos de salud es de quien dirige; se resuelve configurando, sin tocar código. |
| D-62 | **DNI y NSS cifrados en reposo antes del piloto con residentes reales.** Bloque corto propio antes del piloto. | Hoy están en claro, igual que en la clínica; con datos reales no puede seguir así. |

### Tras clinica-7 (15-10-2026)

| # | Decisión | Por qué |
|---|---|---|
| D-63 | **residencia-1b cifra con la maquinaria de clinica-7** (DEK por tenant, AAD por fila) los identificadores y los textos libres de residencia-1 y -2: `resident_profiles.dni`, `nss` y `discharge_reason`; `care_plan_items.reason` y `close_reason`; `bed_assignments.reason`. Quedan en claro, declarados, `care_plan_items.control_code` y la frecuencia (sostienen el índice único de línea viva), el nivel y grado de dependencia (plantillas y lista) y las fechas de estancia. **El registro de cuidados de residencia-3 nace cifrado.** | Amplía D-62 con lo que §18 de `clinica-7-done.md` encontró en claro; los textos libres son lo barato de cifrar porque nadie los consulta en SQL, y el contrato de encargado ya promete medidas técnicas. |

### Tras el mockup de la puerta (15-10-2026)

| # | Decisión | Por qué |
|---|---|---|
| D-64 | **El mockup de la puerta (seis pantallas) lo valida Matías**, en lugar de la observación de turno con auxiliares: se ha criado en la residencia y conoce el trabajo de planta. Se añade **la foto del residente junto a su nombre**, en la puerta en reposo y en «lo que toca», **sólo con consentimiento de imagen** anotado en la ficha (sin él, iniciales). El botón «avisar a la enfermera» no se pinta hasta que el aviso sea real (residencia-4). | La foto ayuda a la suplente y a quien no conoce a cada residente; en un pasillo la ve cualquiera, de ahí el consentimiento. Un botón que parece avisar y no avisa es peor que no tenerlo. |

### Tras residencia-3 (18-10-2026)

| # | Decisión | Por qué |
|---|---|---|
| D-65 | **La plantilla de gravedad (§3) es de serie y la fija Mi Piace.** Funciona desde el primer día, sin estado «pendiente de firma» ni validación clínica previa; es dato versionado del producto y un centro no la toca (D-21). La médica sólo pauta excepciones por residente (D-22). **Sustituye a D-23 y a la condición de firma de D-56.** | Decisión de Matías: *«nosotros mandamos; lo que les demos vamos a tener que enseñarles a usarlo»*. La plantilla es estándar de práctica clínica y una versión nueva es una fila, no un desarrollo. |
| D-66 | **El aviso inmediato suena en un móvil de guardia**: la misma APK en «modo guardia», canal enfermería o responsable. Quien lo coge entra con su PIN al empezar el turno. N2 → enfermería; **si no hay enfermera de guardia o nadie acusa en 5 min, suena en el teléfono de la dirección o del responsable de guardia**; N3-N4 → los dos a la vez. **Al servicio sanitario de guardia, como recomendación**: el móvil muestra a quién llamar y la llamada la hace la persona (D-33). Sin red, la puerta dice que el aviso no ha salido. | Respuesta de Matías (18-10). Una tablet fija o las puertas no encuentran a la enfermera si está en otra planta; un aviso que parece salir y no sale es peor que no tenerlo. |
| D-67 | **El relevo se lee y se confirma en una tablet fija en la sala donde ya se reúne el turno**: `DeviceKind` nuevo, la misma APK en «modo relevo», emparejada al centro. Con PIN, cada uno ve el parte dentro de su alcance (D-51) y lo confirma; el parte está confirmado cuando cada zona con contenido tiene una confirmación de quien la cubre o una de alcance total. | Respuesta de Matías (18-10). El sistema alimenta la reunión de cambio de turno que ya existe en vez de inventar otra (rama de controles §7). |

### Antes del piloto (18-10-2026)

| # | Decisión | Por qué |
|---|---|---|
| D-68 | **PIN de cuidado por alcance**: **4 cifras** para quien tiene alcance por zona (auxiliares) y **6 cifras** para quien tiene alcance total (DUE, médico, calidad, dirección). Quien tenga los dos tipos de rol, 6. Vale para puerta, sala y móvil de guardia. La auxiliar no gana ni un toque. | Respuesta de Matías (18-10). Una tablet robada permite probar las combinaciones contra el roster cacheado: con 6 cifras, sacar el PIN de quien lo ve todo cuesta cien veces más. Quien entra cuarenta veces por turno sigue con 4. |
| D-69 | **`care_plan_items.control_code` se queda en claro**, como ya estaba en D-63, y deja de anotarse como deuda. | Respuesta de Matías (18-10). Quien tiene acceso a la base ya ve en claro fechas, turnos y residentes; cifrarlo exige índices ciegos y sacar los indicadores de SQL sin ganar protección real. |

### Lo que NO se decide por criterio (son hechos que aporta el cliente, no bloquean)

- H-01 · ordenador origen de los `.lnk` (fichas de 2025).
- H-02 · tablas de la JCCM: ya resueltas para la facturación de concertadas en la carpeta operativa
  (`calculo.py`); se reutilizan cuando llegue la facturación de plazas.
- H-06 · ratios de personal por turno: sale de configurar el centro.
- H-08 · medición del wifi: tarea de la visita.
- **Limpiar `MODELO PAI.doc`** (tiene datos reales de un residente): urgente e independiente del software.

## 3. Plantilla de gravedad de serie (D-65)

| Evento | Nivel |
|---|---|
| «Algo no va bien» sin más | N1 |
| Caída sin lesión aparente | N1 |
| Caída con lesión o golpe en la cabeza | N3 |
| Temperatura ≥ 37,5 °C y < 38 °C | N1 |
| Temperatura ≥ 38 °C | N2 |
| Temperatura ≥ 39,5 °C | N3 |
| Saturación < 92 % | N2 · < 88 % → N3 |
| TA sistólica ≥ 180 o ≤ 90 | N2 |
| Glucemia < 70 o > 300 mg/dl | N2 · < 50 → N3 |
| Vómito | N1 · repetido en el turno → N2 |
| Sin deposición > 3 días (derivado) | N1 |
| Ingesta «nada» en dos comidas seguidas (derivado) | N1 |
| Residente no localizado / salida no autorizada | N4 |
| Pérdida de consciencia, dificultad respiratoria grave, dolor torácico | N4 |
| Queja de familia o residente | N1 |
| Avería que afecta a la seguridad (asidero, timbre, cama) | N2 |
| Avería sin riesgo | N0 |

## 4. Hoja de ruta de bloques (v1)

| Bloque | Qué construye |
|---|---|
| **residencia-1 · cimientos** | Interruptor, residentes (perfil 1:1 sobre `Client`), plantas, habitaciones y camas, roles de cuidado con categoría y vigencia, turnos del centro, dispositivo `ROOM`. Pantallas de admin. |
| residencia-2 · catálogo y plan | `TipoDeControl` como dato con su semilla (capas 1, 2, 3a), plan de cuidados por residente y perfil. |
| residencia-3 · la puerta | Modo puerta: PIN → rol → residente → lo que toca → hecho; «como siempre»; «algo no va bien»; registro sellado offline. **Validación con auxiliares reales antes de seguir.** |
| residencia-4 · eventos e incidencias | Constantes, umbrales de serie, eventos derivados (umbral y ausencia), libro único con gravedad, escalado y cierre. |
| residencia-5 · relevo y dirección | Parte de relevo autogenerado con acuse; panel de dirección con incidencias abiertas, obligaciones del día e indicadores básicos. |

Antes de residencia-3: mockup de la pantalla de puerta y observación de un turno.
Todo lo que queda fuera de la v1 está diseñado en `02` a `08`, y ordenado en `09-hoja-de-ruta.md`.
