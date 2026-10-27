# Pasada en hierro de clinica-9 · 27-10-2026

Lenovo TB311FU · APK 1.29.0 (12900) · build 3778719 · cuenta «Clínica demo» · ficha buena: «Carmen Prueba».
Guion: §6 de `docs/blocks/clinica-9-done.md`. Capturas numeradas por paso del guion.
**Ojo:** producción se redesplegó el 27-10 a las 12:51 con `7196eca` (master: calidad-1 + residencias). La pasada mide APK `3778719` contra API `7196eca`.
Para poder dar cita hoy por la tarde se añadió a Rosario un turno **REFUERZO M 14:00–20:00 solo el 27-10** (borrarlo al acabar).

## 6.0 · Antes de nada
- §7 hecho (alias de Rosario, «Consulta diagnóstico», Carmen decidida). Ver H1.
- Check «Catálogo clínico completo»: **verde** (API de superadmin, `readinessChecks`). Único rojo: «Cajero técnico provisionado» (no afecta a la pasada; mirarlo al activar a Rosario).
- adb inalámbrico OK (por mDNS `adb-HA23R1BK-CPi8py._adb-tls-connect._tcp`).

## 6.1 · Recorrido
| # | Resultado | Nota |
|---|---|---|
| 1 | ✅ | «Rosario» con el email debajo; no sale «Paciente (por enlace)». Ojo: la lista es local y el nombre se refresca **al siguiente login** (01-cajeros-recientes) |
| 2 | ✅ | abre en la agenda (02-abre-en-agenda) |
| 3 | ✅ | «Carmen Prueba» encuentra las dos fichas, incluida «Carmen Prueba Demo» (03) |
| 4 | ✅ | «Prueba Carmen» → las dos; «600000001» → la Demo (04a, 04b) |
| 5 | ✅ | «Ya hay fichas parecidas…» con las dos, antes de crear; tocar elige la ficha (05, 05b). **Con el teclado abierto el aviso queda debajo y no se ve** |
| 6 | ✅ | la lista ocupa el alto y se recorre con el panel, sin scroll propio (06) |
| 7 | ✅ | cita jue 29 10:00 · Cura (07a-c). **~10 toques** + tecleo por «Nueva cita». Las horas salen fuera de pantalla tras «Buscar hueco» (otro scroll) |
| 8-9 | ✅ | «Ver la sesión» + «La sesión se abre el día de la cita.» (09) |
| 10 | ✅ con matiz | cabecera «Cita del 29 oct» y franja «Esta cita es del jueves…». El front **no deja pulsar** cerrar (no llega al 409; lo cubre el banco). Pero arriba dice «Sesión en curso», la banda dice «Hoy toca…», deja anotar dolor que pinta como «Hoy» (10a-c) |
| 11 | ✅ | cita hoy 15:00 · Consulta diagnóstico tocando la rejilla: **5 toques** (11c) |
| 12 | ✅ | con **Lucia Prueba** (alta nueva, sin email: Carmen Prueba ya tenía la valoración validada): «No tiene email… ábrele la tablet», solo «Test en la tablet», «Sin alertas todavía» en gris (12) |
| 13 | ✅ | «Devolver la tablet al centro» es un botón grande (13a-b) |
| 14 | ✅ parcial | al devolver pide PIN y vuelve a la agenda del día (14, 14b). Veníamos de Hoy: no distingue «el día en que estaba» de «Hoy» |
| 15 | ✅ | «Paciente: No · corregido por Rosario» (15); y en Carmen «Validada… por Rosario (45/0123)» |
| 16 | ✅ | «Atiende: Rosario», «1.ª · la primera», **sin** «Igual que la última vez» (16a-b) |
| 17 | ✅ | «Riesgo muy bajo · Revisión anual» (17) |
| 18 | ✅ | «Pie izq. · Dedo gordo: Uña encarnada (moderada)» (18) |
| 19 | ✅ | «Firmado por Lucia Prueba… delante de Rosario (Col. 45/0123)» (19b). Se queda en Consentimientos, no vuelve sola a Fotos. **Texto del consentimiento: «de ejemplo, pendiente de revisar por la profesional»** |
| 20 | ✅ **bloqueante 1 cerrado** | tras firmar, siguen Pie de riesgo + General y las 4 comprobaciones (20) |
| 21 | ✅ | «Poca luz · acerca la lámpara» sale y se va con luz (Matías, en mano) (21a-b) |
| 22 | ✅ | no hay botón «Luz» (21a) |
| 23 | ✅ | IWGDF sin «pendiente de validar con Rosario» (17) |
| 24 | ✅ | la hoja dice «Pie de riesgo + General» y la gravedad (24b) |
| 25 | ✅ | «Firmada por Rosario (45/0123)», los dos tipos (25) |
| 26 | ✅ con H5 | ticket «Consulta diagnóstico · 20,00 €» (26) — **pero solo porque se marcó a mano** en «Qué se cobra»; sin tocarlo el pie decía «Nada que cobrar · General: no has marcado nada» (18) |
| 27 | ✅ | «Atendido por: Rosario» ya puesto (27) |
| 28 | ✅ | banda «Lucia Prueba se va sin la próxima cita · la sanitaria propuso 4 semanas» + «Dársela ahora» (28b) |
| 29 | ✅ con H8 | salta al 24/11 con Lucía puesta (29a); pero pide servicio y hora, y **tocar la rejilla borra la paciente** (29b) |
| 30 | ✅ | reservada → la banda desaparece (30) |
| 31 | ✅ | «Ver ticket»: «Clínica demo», «Atiende Rosario», Exento (E1) (31) |
| 32 | ✅ | informe: «Firma: Rosario · Podología · Nº de colegiado 45/0123», sin email (32a-b) |
| 33 | ❌ parcial | iconos de clínica sí; **los nombres largos se cortan**: «biomecánic» en 3 tarjetas y «Biomecáni…» en la barra (33) |
| 34b-35 | ✅ por el paso 1 | cambiar el nombre en Personal llega a «Cajeros recientes» tras el siguiente login. No se repitió |
| 36 | ✅ | Panel › Cajeros sin «Paciente (por enlace)». Texto «Crea al menos un cajero para que pueda iniciar sesión» no encaja en clínica de una persona |
| 37 | ✅ | Agenda · Catálogo no nombra Holded |
| 38 | ❌ | Dispositivos enseña el user-agent crudo («Mozilla/5.0 (Linux; Android 14; TB311FU…»), no «Android 14 · TB311FU · app» |
| 39 | ✅ | sin «Comanderas» en la barra |
| 34a | ✅ | Panel › Personal: solo Rosario, no sale «Paciente (por enlace)» |
| 40 | ✅ | la sesión del panel caducó y al tocar algo fue al login |

## Hallazgos
- **H1** · Guardar Personal sin cambios no manda nada → el alias no se escribe en cuentas existentes (`StaffPage.tsx` · `guardarTarjeta` salta secciones no `sucio()`). Resuelto en la demo con dos guardados.
- **H2** · Agenda · Catálogo dice «no has asignado ninguna categoría» aunque el servidor da el catálogo clínico completo y el servicio hereda «General». Texto/lectura equivocada.
- **H3** · En Historia de paciente, el «atrás» de Android no hace nada.
- **H5** · La cita reservada como «Cura» llega a la sesión como «Pasa a caja: Quiropodia básica 25 €» con «Cura» de extra sin marcar: **el servicio reservado no llega al cobro**. Confirmar con la cita de hoy (Consulta diagnóstico).
- **H6** · Cita de otro día: «Sesión en curso», «Hoy toca» y el dolor «Hoy» en una cita de pasado mañana.
- **H7 · Matías (27-10): «no me gusta nada cómo hacemos lo de la cita, me parece súper tedioso… en el spa lo hemos optimizado mejor… tenemos que reducirlo a la mínima expresión».** Base: ~10 toques por «Nueva cita», 5 tocando la rejilla. Va al bloque común de agenda (embudo del spa).
- **H8** · Tras «Dársela ahora», tocar una hora en la rejilla reabre «Nueva cita» **en blanco** (se pierde la paciente). Además no propone ni servicio ni hora.
- **H9 (config Rosario)** · El tipo Pie de riesgo no tiene servicio en su catálogo → «sin cobro». Decidir con ella si el control de pie de riesgo se cobra.
- **H10 (config Rosario)** · Texto del consentimiento de fotos marcado «de ejemplo, pendiente de revisar por la profesional».
- **H4** · El propietario no puede elegir su PIN: solo «Regenerar» al azar, que se enseña una vez. Matías lo olvidó dos veces en la misma mañana. Requisito suyo del 18-10 sin hacer.

## Resumen
- **Los 15 puntos de clinica-9 se ven en el aparato**, incluido el bloqueante 1 (paso 20). Quedan **dos fallos del guion**: nombres largos cortados (33) y el user-agent crudo en Dispositivos (38).
- **Lo que pesa de cara a Rosario** (no estaba en el guion): **H5** (la consulta reservada no viene marcada en «Qué se cobra»; sin tocarla, «Nada que cobrar»), **H4** (PIN que no se puede elegir), **H8** (tocar la rejilla tras «Dársela ahora» borra la paciente), **H7** (dar cita es tedioso: ~10 toques / 5 por rejilla) y la config: **H9** (pie de riesgo sin servicio), **H10** (texto del consentimiento de ejemplo).
- Datos de prueba creados en la Clínica demo: paciente **Lucia Prueba** (valoración, sesión firmada, foto, consentimiento, ticket #000003 de ensayo, cita 24-11), citas de Carmen Prueba hoy 15:00 y jue 29 10:00, turno REFUERZO solo del 27-10 (caduca solo).
