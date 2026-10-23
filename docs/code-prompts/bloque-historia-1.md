# Bloque historia-1 · ficha clínica, ausencias, ingreso y alta

Rama `historia-1`, worktree `~/Developer/Claude/Projects/mipiacetpv-historia-1`, desde `origin/master`.
PR contra `master`. Escrito el 23-10-2026 desde el proyecto de Jardín de Gredos. Primer bloque de la
**Fase 2** de `docs/residencia/09-hoja-de-ruta.md`. **Corre en paralelo con calidad-1** (ver «Convivir
con calidad-1»).

Lee antes:
1. `docs/residencia/03-historia-residente.md` §1 (ficha), §5 (ausencias), §7 (ingreso y alta) y §8.
   §2, §3, §4 y §6 son historia-2 a historia-5: no se tocan.
2. **Lo que ya existe en la clínica y se reutiliza, no se copia**: `docs/blocks/clinica-1-done.md`
   (acceso, registro de accesos, `ClinicalEntry` inmutable + `ClinicalAddendum`), `clinica-2-done.md`
   (cuestionario versionado en código, alertas que salen de un «Sí»), `clinica-4-done.md`
   (`packages/consentimientos`: plantilla versionada, firma con el dedo, PDF con huella),
   `clinica-6-done.md` (la historia «en diez segundos», funciones puras en un paquete) y
   `clinica-7-done.md` (cifrado por campo).
3. `docs/blocks/residencia-1-done.md` (el residente es un `Client` con `ResidentProfile`, D-49; el alta
   ya existe como `dischargeDate` + motivo cifrado; camas), `residencia-2-done.md` (`queToca`),
   `residencia-4-done.md` (plantilla de gravedad versionada, libro), `residencia-5-done.md` (parte de
   relevo, panel, obligaciones, indicadores) y `residencia-6-done.md`.
4. `docs/residencia/00-decisiones.md`: D-24, D-29 a D-34, D-45, D-49, D-51, D-63, D-65.
5. `docs/residencia/registros-exigidos-inspeccion.md` R20.

## Por qué existe

En una residencia lo que se sabe de cada persona está repartido entre una ficha en papel, el PAI en Word
y la cabeza de la DUE. Las ausencias (un ingreso en el hospital, unos días con la familia) no están en
ningún sitio salvo en los días que alguien teclea a mano para facturar las plazas concertadas. Y el
ingreso de un residente nuevo no tiene lista: lo que falta se descubre cuando lo pide un inspector.

**Esto es producto para cualquier residencia de España**, no para una. Jardín de Gredos vive sólo en el
sembrador.

¿Y qué?: la auxiliar que abre la puerta ve «disfagia: triturado y espesante» sin leer un diagnóstico;
nadie apunta como «no hecho» el aseo de quien está en el hospital; los días de ausencia del mes salen
contados para la factura; y la dirección ve qué ingresos tienen papeles pendientes.

## Decisiones de producto ya tomadas — no se re-debaten

Añádelas a `00-decisiones.md` como **D-90 a D-97** (D-70 a D-89 las reservan calidad-1 y calidad-2,
que corren a la vez; no las uses).

1. **La ficha clínica es la historia de la clínica, ampliada (D-90).** Nada de un segundo sistema:
   acceso, registro de accesos, inmutabilidad y cifrado son los de clinica-1 y clinica-7. Entidades
   nuevas, todas colgando del `Client` residente:
   - `ResidentDiagnosis`: texto, **código CIE-10-ES opcional** (campo, sin catálogo en este bloque),
     activo o resuelto, fechas, si es antecedente quirúrgico, y **marca de alerta** (p. ej.
     anticoagulado).
   - `Allergy`: clase (medicamento · alimento · otra), agente, reacción, gravedad. **«Sin alergias
     conocidas» es un dato que se registra expresamente**, con autor y fecha: no tener filas no es lo
     mismo que no tener alergias, y medicación (Fase 2) bloqueará sobre esa diferencia.
   - `ResidentDevice`: catálogo de serie (silla de ruedas, andador, grúa, sonda, oxígeno, absorbentes,
     audífono, prótesis dental, gafas, otro) con desde/hasta.
   - `DietProfile` **versionado**: textura (normal · blanda · triturada · enteral), espesante (sí/no y
     nivel), restricciones (diabética, sin sal, sin gluten, otras). Cada cambio es una versión nueva.
   - Corregir = versión nueva o anotación, **nunca sobrescribir**. Textos libres cifrados al nacer.
   - Quién escribe: diagnósticos y alergias, médico y DUE; dispositivos, además TO y fisio; dieta,
     médico y DUE. Por capacidad del rol de cuidado (D-50), no por `UserRole`.
2. **Franja de alertas, calculada y no tecleada (D-91).** Función pura en `packages/residencia-plan`:
   de la ficha salen las alertas (alergia grave, diagnóstico marcado, disfagia o textura distinta de
   normal, dispositivo de riesgo como sonda u oxígeno). En la historia y en el admin, arriba. **En la
   puerta, sólo la frase accionable** («Disfagia: triturado y espesante nivel 2», «Alergia: penicilina»),
   nunca el diagnóstico: misma regla que D-51 sobre lo que ve la auxiliar.
3. **Ausencias que pausan, no que fallan (D-92).** `ResidentAbsence`: tipo (ingreso hospitalario ·
   urgencias · vacaciones o salida con familia · consulta externa · **salida no controlada**), inicio,
   fin previsto, fin real, destino, motivo cifrado.
   - Mientras dura, `queToca` **no genera** las ocurrencias del residente (no salen como no hechas), el
     parte de relevo dice **una vez** «ausente: en el hospital desde el martes», la puerta enseña al
     residente como ausente y los **indicadores lo sacan del denominador** esos días.
   - **Salida no controlada** = incidencia **N4** en el libro, con su aviso a guardia: regla nueva en la
     plantilla de gravedad, que sube de versión (`VERSION_DE_LA_PLANTILLA = 2`), igual que D-65 manda.
   - **Vuelta de un ingreso hospitalario o de urgencias**: aparece en el panel como «pendiente de
     revisar tras el ingreso» para la DUE, y se limpia cuando ella confirma la revisión (con su PIN o
     desde el admin; queda quién y cuándo). Cuando existan PAI (historia-2) y medicación, esa
     confirmación se convertirá en sus tareas de revisión y conciliación; aquí no se adelanta nada.
4. **Los días del mes, contados (D-93).** Función pura `diasDelMes(residente, mes)` que devuelve
   **ordinarios, hospital y vacaciones** (más presencia total), que es exactamente lo que necesita la
   facturación de plazas concertadas (`05-plazas-facturacion.md`). **La regla de los días frontera**
   (el día que sale y el día que vuelve) **es dato por comunidad autónoma**, no código: de serie,
   **cuenta dónde pernocta el residente**. Se deja escrito en el done como duda abierta para contrastar
   con la Junta antes de facturacion-1. Pantalla: por residente y por mes, y un resumen del centro.
5. **Ingreso guiado (D-94).** `AdmissionChecklist` por residente con elementos **de serie del
   producto**: datos de identidad completos · cama asignada · contrato firmado (adjunto) ·
   consentimiento de protección de datos · consentimiento de imagen · familiar responsable · alergias
   revisadas (con «sin alergias conocidas» si es el caso) · dieta · dispositivos · plan de cuidados
   vigente. Y dos elementos **con fecha y sin pantalla aún**: escalas iniciales (historia-3) y **PAI
   inicial en 30 días** (historia-2), para que el plazo ya corra. El panel de dirección lista los
   ingresos con elementos pendientes. Cada elemento se marca con autor y fecha o se da por cumplido
   solo cuando el dato existe (p. ej. la cama).
6. **Consentimientos de residencia en `packages/consentimientos` (D-95).** Plantillas nuevas
   «protección de datos del residente» e «imagen», versionadas, con `pendienteDeValidar: true`, firmadas
   por el residente o su representante con el dedo y guardadas en PDF, **sin tocar** el mecanismo de
   clinica-4.
7. **El alta, completa (D-96).** Motivo: traslado · voluntaria · fallecimiento · otra. Al confirmar:
   cierra las líneas vivas del plan, libera la cama, cierra la ausencia abierta si la hay y saca al
   residente de la puerta y del parte. **La historia se conserva** (≥ 5 años, Ley 41/2002). Si la plaza
   es pública o concertada, crea una **obligación con fecha** «comunicar la baja a la administración»
   (plazo que configura el centro; sin plazo de serie inventado).
8. **Pantallas (D-97).** La ficha y el ingreso son del admin (despacho, sin mockup previo, D-76). Lo que
   cambia en la puerta (la frase de alerta y el «ausente») y en la sala (la línea del parte) respeta el
   diseño validado de residencia-3 y -5: **la auxiliar no gana ni un toque**.

## Convivir con calidad-1

calidad-1 está abierto a la vez y **añade un indicador de cumplimentación por turno que sale de
`queToca` + `loQueNoSeHizo`**. Este bloque cambia `queToca` (las ausencias). No toques los indicadores
nuevos de calidad-1; deja la regla de ausencias **dentro de `queToca`**, de modo que cualquier indicador
que lo use la herede sola. Quien mergee segundo resuelve el conflicto de `schema.prisma`, del sembrador y
de `00-decisiones.md`, y lo cuenta en su done.

## El sembrador

Jardín de Gredos con datos de prueba (ningún nombre real): un residente con disfagia y alergia a la
penicilina, otro «sin alergias conocidas», uno en el hospital desde hace tres días, uno que volvió ayer
y está pendiente de revisión, un ingreso de esta semana con dos elementos pendientes y un alta por
traslado del mes pasado con su obligación de comunicar la baja.

## Respeta

- Tenants sin residencia (la clínica de podología incluida) no notan nada: las entidades nuevas
  cuelgan del residente.
- El acceso a la historia y su registro son los de clinica-1; ni un camino nuevo que se salte el
  registro de accesos. Nada de salud en logs.
- Suite, `e2e` y `pnpm e2e:agenda` como estaban; la CI sin Redis.

## Fuera de alcance (declarado)

PAI y sus firmas (historia-2), escalas (historia-3), lesiones (historia-4), sujeciones (historia-5),
medicación, hoja de cocina por dietas (cocina-1), facturación (facturacion-1: este bloque sólo cuenta
los días), catálogo CIE-10 con buscador.

## Cómo se cierra

- Migraciones aditivas con su `down`, sobre una copia con datos de residencia-1 a -6.
- Tests: corregir una alergia deja la anterior intacta; «sin alergias conocidas» y «sin filas» se
  distinguen; la franja de la puerta no lleva diagnósticos; un residente ausente no genera «no hecho»
  ni entra en el denominador; la salida no controlada nace N4 y suena; `diasDelMes` con **tabla de
  casos de oro** (mes completo, ingreso a mitad, ausencia que cruza de mes, alta a mitad, dos ausencias
  en el mismo mes, año bisiesto); el alta cierra plan, cama y ausencia y no borra nada; el checklist da
  por cumplido lo que ya existe.
- Tabla de sabotajes: `UPDATE` de una alergia por SQL · borrar una ausencia · leer la ficha sin pasar
  por el registro de accesos · una regla de gravedad de centro.
- Capturas: ficha con franja, puerta con la frase y con «ausente», parte con el ausente, días del mes,
  ingreso con pendientes, alta.
- CI verde; `docs/blocks/historia-1-done.md` con la metodología y la hoja de ruta actualizada.
- Commits pequeños en español, push y **PR contra `master`**. Ni merges ni despliegues.
