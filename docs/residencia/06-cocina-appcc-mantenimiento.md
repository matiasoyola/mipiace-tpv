# Residencia · cocina, APPCC, legionela y mantenimiento

Criterio de Claude con delegación de Matías (14-10-2026). Es el **segundo eje de cumplimiento**
(Sanidad, no AENOR) que hoy vive en papel: inspecciones de cocina de 2025 (no se registra el control de
refrigerados ni los cambios de aceite), visita de APPCC y legionela de 2024 (no se apuntan los
terminales revisados, faltaban analíticas) y **0 ficheros de legionela** en el Drive.

¿Y qué?: la próxima inspección de Sanidad se contesta abriendo una pantalla, y una cámara frigorífica
que se para de madrugada avisa antes de tirar el género.

---

## 1. Cocina

- **Menú planificado** por temporada/semana (hoy `MENUS`), con sus platos.
- **Hoja de emplatado** de cada comida, generada de las dietas de los residentes (`03` §1): cuántos
  normal / blando / triturado / con espesante, y **quién tiene restricción** (alergia, diabético, sin
  sal) — con nombre, porque la cocinera emplata para personas. Sin diagnósticos.
- **Cambio de menú**: se registra con motivo de un toque (NC interna de octubre 2025: «la comida
  planificada se cambia y no se registra»).
- La ingesta que registra la auxiliar en la puerta (capa 1) vuelve a cocina como «qué platos no se
  comen» → indicador de cocina que AENOR echa en falta (Obs. 06).

## 2. APPCC

Registros a un toque desde una tablet de cocina (dispositivo `ROOM`-like de zona, o el móvil del rol cocina):

| Registro | Frecuencia | Lo que pidió la inspección |
|---|---|---|
| **Temperatura de cámaras** y congeladores | continua | — |
| **Recepción de materias primas refrigeradas** (proveedor, producto, temperatura, aceptado/rechazado) | cada entrega | sí (02-2025) |
| **Cambio de aceite** de freidora | cada cambio, con aviso por uso | sí (02-2025) |
| Elaboración (lo que hoy es `elaboracion 2026.docx`) | diaria | — |
| Limpieza de cocina por zonas | según plan | «a mejorar» |
| Platos testigo | diaria | — |

**Temperaturas automáticas**: sondas inalámbricas en cámaras y congeladores (ecosistema Shelly, que ya
se instala) que envían la lectura cada pocos minutos. Fuera de rango durante N minutos → **incidencia de
avería N2** con aviso al responsable. El registro diario sale solo; nadie apunta temperaturas.

## 3. Legionela

- **Catálogo de puntos**: depósitos, calentadores y **terminales** (grifos y duchas, colgados de las
  habitaciones del edificio de residencia-1).
- **Rondas** con rotación de terminales: el sistema dice **qué terminales tocan esta semana** y se
  registra temperatura de ACS y purga en cada uno. Responde a «no se apuntan claramente los terminales
  que se revisan».
- **Analíticas** del laboratorio (NABLA): se adjunta el PDF con fecha y resultado; analítica que falta
  según calendario → aviso.
- Tratamientos de choque y limpiezas de depósitos con fecha y responsable.

## 4. Mantenimiento

- **Correctivo**: las averías son incidencias del libro único (D-35, D-38) con **tiempo hasta la
  solución** (indicador de AENOR: <24 h).
- **Preventivo interno**: plan de revisiones del mantenedor de la casa (grúas, camas articuladas,
  timbres, sillas) con su periodicidad; rondas a un toque. Indicador «revisiones periódicas en plazo».
- **Reglamentario con empresas externas**: PCI (mantenedor CINSA, extintores trimestrales, informe anual),
  baja tensión (OCA, 2029), PCI de CERQUO (2034), ascensor si lo hay, etc. Cada elemento con **empresa,
  certificado adjunto y caducidad**; aviso a 60 y 30 días. El caso de la Obs. 02 (falta el informe anual
  de CINSA) sale solo en el panel.

## 5. Formación obligatoria del personal

Manipulador de alimentos, PRL, movilización de residentes…: certificado por persona con caducidad y aviso.

## 6. Entidades

`Menu` / `MenuDish` · `MenuChange` · `KitchenPlatingSheet` (calculada) · `ColdStorageUnit` +
`TemperatureReading` (sensor) · `GoodsReceipt` · `OilChange` · `HaccpRecord` (genérico tipado) ·
`WaterPoint` + `LegionellaRound` + `LabAnalysis` · `Asset` (equipo/instalación) + `MaintenancePlan` +
`MaintenanceVisit` · `RegulatoryCertificate` · `StaffCertification`.
