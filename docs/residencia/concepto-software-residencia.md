# Concepto de software — Residencia Jardin de Gredos

> **Copia en el repo** del documento fuente del proyecto «Jardin de Gredos» (`claude/concepto-software-residencia.md`),
> traída el 15-10-2026. Es el concepto inicial (agosto 2026) y está superado en varios puntos: las decisiones
> vinculantes viven en `00-decisiones.md`; si discrepan, manda `00-decisiones.md`.

> Idea de producto para Jardin de Gredos (cliente de Mi Piace).
> Residencia de mayores, negocio familiar, en **Buenaventura (Toledo) — Castilla-La Mancha**.
> **49 plazas autorizadas** (48 en 2026, todas ocupadas). **19 concertadas** con Bienestar Social (JCCM).
> Sistema de calidad de referencia: **ISO 9001:2015**, certificado por AENOR (expira 2028-03-18).
> Estado: concepto inicial · Fecha: 2026-08-15 · Revisado con la auditoría AENOR 2026 y el inventario del Drive.

---

## 0. De qué estamos hablando

Empezó como "una tablet en la puerta con botones de hecho" y ha crecido a una
**plataforma de gestión de residencia** con la operativa de calidad como puerta de entrada:
registro de cuidados a pulsaciones, historia clínica, panel de dirección en tiempo real,
capa de IA de calidad e integración con **Holded** para facturación.

El principio de arranque de Mi Piace manda: **docs antes que código**, y aquí lo urgente
NO es el front (es casi trivial) sino el **modelo de dominio**: cómo se traduce ISO 9001,
la historia clínica y la facturación a un modelo de datos sólido.

## 1. Problema que resuelve

La residencia trabaja con un sistema de calidad **ISO 9001** (registros de cuidados,
control de tareas, trazabilidad, mejora continua). Hoy eso suele hacerse a posteriori,
en papel o de memoria, como carga administrativa separada del trabajo real y difícil de auditar.
El ciclo PDCA de ISO (verificar/actuar) se concentra en la auditoría anual, con datos reconstruidos a mano.

La idea le da la vuelta: **el registro de calidad se genera solo, como subproducto de la
operativa diaria**. No se rellena — se produce al trabajar.

**Driver regulatorio confirmado:** la Consejería de Bienestar Social de la JCCM exige un
**sistema informático** a la residencia. AENOR lo tiene abierto como observación repetida
(Obs. 03) y como riesgo del proceso CALIDAD ("no se dispone de programa informatizado").
Este proyecto es la acción correctora pendiente. Fecha límite natural: auditoría del **20-07-2027**.

## 2. La idea en una frase

Una **tablet en la puerta de cada habitación** que actúa como ancla de identidad
(residente + nº de dormitorio) y desde la que el personal ejecuta y registra los cuidados
**a pulsaciones, sin escribir nada**, alimentando en tiempo real el sistema de calidad ISO 9001,
la historia clínica, el panel de dirección y la facturación; con una **capa de IA** que genera
las tareas y cierra el ciclo de mejora continua.

## 3. Flujo base (en la habitación)

1. Tablet fija en la puerta con el/los residentes de esa habitación siempre en pantalla.
2. El auxiliar pulsa al residente.
3. Se identifica con **PIN** (queda registrado quién actúa).
4. Ve **qué tareas tocan** en esa habitación en ese momento.
5. **Marca "hecho"** con un toque al completarlas.
6. El sistema registra automáticamente: tarea, quién, cuándo, estado (hecho / pendiente / fuera de hora).

## 4. Principio de diseño irrenunciable

**Todo a pulsaciones. Cero escritura.** Cualquier función que exija teclear queda descartada
o se reformula como selección/toque. Es la clave para que el personal lo adopte de verdad.
Sin adopción no hay datos, y sin datos la capa de IA no funciona.

**Presupuesto de interacción acordado con dirección:** ≤30 min por jornada de 8 h y auxiliar,
≈15 s por registro **con el desplazamiento incluido**. El toque cuesta 2 s; el desplazamiento, 13.
Por eso el registro tiene que ocurrir donde ocurre el cuidado.

## 5. Módulos de la plataforma

- **Núcleo operativo / calidad** — residentes, PAI, catálogo de tareas, registro sellado
  (quién-cuándo-dónde), estados, no conformidades, acciones correctoras. Es el corazón.
- **Historia clínica / médica** — diagnósticos, medicación, evolución, constantes, incidencias.
  **Categoría especial de datos (RGPD art. 9)** → condiciona la arquitectura entera (ver §6bis).
- **Panel de dirección** — visión en tiempo real, indicadores ISO, alertas, y un
  **calendario de obligaciones de gestión** (personal, facturación, compras) con su periodicidad.
- **Portal / informes de familias** — informes personalizados de la atención.
- **Integración Holded (facturación)** — ocupación de plazas, mensualidades y servicios extra
  → facturas. Holded como fuente de verdad de facturación (ver §6ter).
- **Capa de IA — "cerebro de calidad"** (Fase tardía, ver §7).

## 6. Arquitectura — orden de trabajo (Mi Piace: docs antes que código)

1. **Toma de requisitos** — con dirección / responsable de calidad y personal de cuidado.
2. **Arquitectura de datos (BBDD)** — el modelo de dominio. Lo más urgente y lo que más pesa.
3. **Arquitectura de sistema** — offline-first en tablets + sync, backend, roles, seguridad.
4. **Módulos** — núcleo operativo → historia clínica → dirección → familias.
5. **Integraciones** — Holded (facturación).
6. **Front** — al final; cuelga de todo lo anterior.

## 6bis. Historia clínica → implicaciones (no es un módulo más)

Al llevar historia clínica manejamos **datos de salud (categoría especial, RGPD art. 9)**. Exige:
cifrado en reposo y tránsito, control de acceso por rol muy fino, **registro de accesos**
(quién ha consultado qué historia), gestión de consentimientos, retención/borrado, y
probablemente medidas tipo Esquema Nacional de Seguridad. Se diseña desde el día uno, no se añade después.
Encaja de lleno con la **asesoría RGPD que Mi Piace ya ofrece** al cliente — mismo hilo de trabajo.

**Situación de partida (medida, no supuesta):** ≥420 ficheros con datos personales en el Drive,
de ellos ≥160 de salud, **triplicados** en tres copias del mismo árbol, sin control de acceso granular,
sin consentimientos individuales, y con la última auditoría LOPD documentada en **2015**.

## 6ter. Integración Holded (facturación)

Holded es el ERP del cliente. Holded expone **API REST** (contactos, documentos/facturas, productos),
así que la integración es viable. El trabajo real es de diseño, no técnico:

- Mapa **plaza / servicio / mensualidad / extra → factura**.
- **Quién manda**: la plataforma es la **fuente de verdad del residente**; Holded queda reducido
  a lo financiero. Hoy Holded contiene residentes, tarifas y documentación personal — hay que sacarlo.
- Modelo de pagadores: una plaza puede tener **dos pagadores simultáneos** (JCCM + residente),
  con **copago según ingresos** y, en las temporales, **vigencia con fecha de fin**.
- **Servicios extra configurables**, consumos acumulados en el periodo y **una liquidación mensual**
  que viaja a Holded. El residente no maneja dinero en su día a día.
- Queda como **ADR de integración** (confirmar alcance real de la API de Holded al abordarlo).

## 7. La capa de IA — "cerebro de calidad" (Fase tardía)

La IA convierte ISO 9001 de foto anual en sistema vivo, cerrando el ciclo PDCA solo:

- **Genera las tareas por residente** (a partir de PAI, dependencia y procesos ISO) y las reajusta.
- **Detecta no conformidades en tiempo real** y **propone la acción correctora** (ISO cláusula 10).
- **Redacta** informes de familias e indicadores para revisión por la dirección (ISO cláusula 9).
- **Anticipa riesgos** (caídas, úlceras por presión…) a partir de patrones.

**No se empieza por aquí.** Necesita meses de datos limpios. Es Fase 3.
**Gobierno / límite:** la IA **propone y asiste**; validación y responsabilidad, siempre humanas.

## 8. Usuarios

- **Auxiliares / personal de cuidado** — cuidados personales y limpieza del dormitorio.
- **Enfermería (DUE)** — medicación.
- **Médico** — seguimiento de patologías.
- **Terapeutas (TO / fisio)** — sus actividades diarias.
- **Dirección** — visión en tiempo real, indicadores ISO, alertas, obligaciones del mes.
- **Administración** — facturación (vía Holded).
- **Familias** — informes personalizados.

Cada rol aporta la información del residente que le corresponde y **todo vive intercomunicado**:
historia única, no silos por departamento. Y **una pantalla de inicio por rol**, no una sola.

## 9. Valor

- **Cumplimiento ISO 9001 automático y trazable** (evidencia con quién-cuándo-dónde).
- **Cero papeleo** y cero registro "de memoria".
- **Mejora continua real y continua** (PDCA cerrado por la IA, no una vez al año).
- **Historia clínica digital** y trazable.
- **Facturación automática** conectada a la operativa (Holded).
- **Visión en vivo** para dirección y **confianza de las familias**.
- Respaldo ante **auditorías, inspecciones y reclamaciones** sin buscar nada.

## 10. Roadmap por fases

- **Fase 0 — Descubrimiento (consultoría):** toma de requisitos + arquitectura de datos + ADRs.
  Sin código. Es donde arranca de verdad.
- **Fase 1 — Habitación (MVP):** registro de cuidados por pulsación + panel de dirección básico.
  Validación con usuario real antes de escalar.
- **Fase 2 — Historia clínica + extensiones:** módulo clínico, comidas, medicación, terapias.
- **Fase 3 — Integración Holded (facturación).**
- **Fase 4 — Capa de IA.**
- **Futuro:** analítica avanzada, producto multi-residencia.

## 11. Preguntas abiertas / a decidir

- ¿ISO 9001 propio, o además **normativa autonómica de Castilla-La Mancha (JCCM)** con registros obligatorios?
- ¿El alcance de la v1 cubre solo ISO/operativa, o también el eje **APPCC + reglamentario**
  (legionela, PCI, baja tensión) que hoy también vive en papel?
- Catálogo de **tareas por tipo** y definición de "en hora" (hoy no se mide).
- Alcance real del **módulo de historia clínica** (qué recoge, qué roles, integración con enfermería).
- **Hosting**: cloud (preferencia del cliente) vs. servidor local vs. **offline-first en tablet + sync**.
- **Hardware**: nº de tablets, montaje, red, coste. (Aparcado por decisión del cliente.)
- **Holded**: alcance de la API para el mapa de facturación.
- Encaje comercial: ¿a medida para Jardin de Gredos o producto multi-residencia?
- **RGPD / datos de salud**: cifrado, roles, registro de accesos, base legal, y la **frecuencia de evaluación
  del Plan de Protección de Datos**, que la propia NC de AENOR señala como indefinida desde 2022.

## 12. Próximos pasos sugeridos

1. **Fase 0**: guion de toma de requisitos con la residencia (dirección, calidad, enfermería, auxiliares).
2. Mapear procesos y registros **ISO 9001** → primer boceto del **modelo de datos**.
   Ojo: la NC 01 de 2026 es exactamente un problema de modelo (8 procesos en indicadores vs. 4 en riesgos);
   una entidad `Proceso` única la cierra por construcción.
3. Lista de **ADRs** a decidir (offline-first, seguridad clínica, Holded, dónde vive la IA, hosting).
4. Recién después: mockup de la pantalla de puerta + validación con usuario real.
