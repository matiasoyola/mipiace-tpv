# Auditoría de la app de clínicas · 18-10-2026

**Objetivo (Matías):** auditar la app de clínicas de punta a punta para ver si funciona antes de ir a la clínica de Rosario.
**Escenario:** cuenta «Clínica demo» en producción (NIF de Mi Piace, sin Holded, historia clínica encendida, 17 servicios de Rosario), propietaria «Rosa» (`m.oyola+clinica-demo@mipiace.es`), tablet **Lenovo Tab M11 (TB311FU, Android 14)** con la **APK 1.26.0** instalada desde `/apk`.
**Capturas:** esta carpeta (00…133).
**Recorrido hecho:** alta → contrato → personal → APK → agenda → paciente → valoración (tablet + validación) → sesión → cierre → cobro → segunda visita → historia viva → consentimiento firmado → fotos → informe.
**No probado:** roles (sanitario sin caja, recepcionista), registro de accesos visto desde la dueña, envío del test por email, informe por enlace, bonos.

## Veredicto
**Hoy no se puede ir a la clínica de Rosario.** Las piezas clínicas (valoración, sesión, historia viva, consentimiento, informe) están muy bien de diseño. Pero la puesta en marcha y el día a día rompen en 9 sitios. Los peores: una cita que desaparece y deja el hueco libre, una sesión que no cobra nada y una parte clínica que no se ve si no se sabe un truco.

## Decisión de producto (Matías, 18-10)
**En una clínica se entra por la agenda, no por la caja.** Todo va con cita previa. Al cerrar la sesión el ticket sale hecho con lo de la consulta y quien cobra solo lo confirma. A la vista de cajero se va solo para añadir algo aparte (plantillas, un producto). La venta suelta sigue existiendo, pero no es la entrada.

## Lo que funciona
- Alta super-admin sin Holded, carga del CSV (17 servicios exentos con duración, vista previa limpia), activación con modal.
- Banda «Tu cuenta está en ensayo» (puesta-en-marcha desplegada).
- Contrato de datos: bloquea la historia hasta aceptar, versión + fecha + huella + PDF + revocar + exportar todo.
- `/apk` con código de 6 dígitos → descarga → instalación → vinculación con código del propietario: **a la primera**.
- **Valoración inicial en la tablet: lo mejor del recorrido.** Una pregunta por pantalla, Sí/No grandes, «No lo sé», contador, preguntas de seguimiento, cierre claro. Validación de la sanitaria con correcciones con autor y tres confirmaciones antes del primer tratamiento.
- **Sesión:** franja «Cuidado · Diabetes», tipos de visita, mapa del pie zona → lesión → gravedad, nivel propuesto por lo hecho, dolor con gráfica, consejos, próxima cita, cierre firmado con colegiado.
- **Historia viva a pantalla completa (desde la cita):** «Hoy toca / Dolor / Última vez / Ojo hoy», pie con la lesión activa y su evolución.
- **Consentimiento de fotos** firmado con el dedo, con firmante y testigo con colegiado; PDF a la historia.
- **Fotos** fuera de la galería de la tablet (comprobado) y comparador antes/después por zona.
- **Informe** con tres tipos (resumen, últimas sesiones, derivación) y vista previa.
- Cobro exento: 26,00 € con IVA 0, ticket marcado de prueba.

## BLOQUEANTES (antes de Rosario)
1. **La cita desaparece de la agenda y deja el hueco libre.** Cita lun 19-10 10:00 creada y visible. Tras marcar a la propietaria como sanitaria y volver a entrar la cajera, la agenda sale vacía (con «Todos», tras refrescar) y **«Buscar hueco» ofrece las 10:00 como libres** → doble reserva posible. La cita sigue en Clientes → Historial. Sin tocar nada (confirmado por Matías). Capturas 53, 71–76, 87. Una cita nueva sí se ve.
2. **La sesión no cobra nada tras un alta «completa».** Nivel de quiropodia «sin servicio»; cierre «Nada que cobrar · no hay servicio en su categoría» → 0,00 €. El CSV no deja hechas las marcas de clínica (especialidad en la categoría, niveles, primera valoración). Capturas 104, 107–110.
3. **Dos verdades en el cobro.** «Cobrar en caja» desde la cita mete el servicio **reservado** (26 €), no lo hecho en la sesión (0 €). Si la sesión hace otro nivel u otro tipo, se cobra lo que no se hizo. Captura 112.
4. **Guardar «Es sanitario» falla en silencio** con colegiado «45-0123» (con «45/0123» guarda). Sin la marca, la cita no enseña nada clínico. Capturas 57–61.
5. **El cambio de «sanitario» no llega al TPV hasta re-login.**
6. **Contrato con la razón social equivocada:** «Mi Piace Software, S.L.» → Mi Piace Internet Solutions SL, B45902186, sin NIF. `packages/contrato-encargado/src/contrato.ts:81`.
7. **El cajero técnico de «Probar TPV» sobrevive a la activación**, con acceso a la caja.
8. **PIN (requisito de Matías): personal y cambiable por el propio usuario desde su panel;** la propietaria en Cajeros. Hoy: aleatorio, se enseña una vez, la propietaria no sale ni se puede añadir. *(Bloque propio: toca a todas las verticales.)*
9. **(Matías) La historia del paciente siempre a pantalla completa.** Desde Clientes → ficha → «Historia» sale en el cajón lateral, cortada y desbordada. Capturas 77–80.

## IMPORTANTES
10. **(Matías) Fotos: «elegir la zona antes de disparar no es intuitivo».** El disparador parece activo y no lo está; el aviso queda lejos; el botón de zona no se distingue. Imagen muy oscura con poca luz; icono gigante de «play» mientras arranca la cámara.
11. Historia → «Fotos» pide el consentimiento pero no da botón para firmarlo.
12. Consentimiento: el texto largo se come el gesto de desplazar; la firma solo se alcanza arrastrando por los márgenes.
13. Cerrar la sesión es irreversible y se hace con un toque, sin confirmar.
14. La sesión no preselecciona el tipo de visita de la cita; con diabetes debería recomendar «Pie de riesgo».
15. En la primera visita pregunta «Desde la última visita».
16. Escala de dolor: el «10» cae solo en otra fila.
17. **Email en lugar del nombre** en «Atiende», «Firmada por», «Valoración pedida por», informe, cajeros recientes, barra inferior. El nombre de la activación no llega a ningún sitio.
18. Test en tablet: sin botón para que la sanitaria recupere la tablet; «la podóloga» fijo; «Sí» resaltado antes de contestar; «¿Quién responde?» con doble toque.
19. «Ver ticket» se abre en blanco en Android. El éxito del cobro habla de Holded en una cuenta sin Holded.
20. Panel con sesión caída: no manda al login, pinta un menú equivocado y «No se ha podido cargar el contrato».
21. Pestañas nuevas de Chrome no comparten la sesión del panel (por confirmar con «Recuérdame»).
22. «Crear turno» sin «Válido desde» no hace nada y no avisa.
23. Personal: cuatro botones de guardar; sin «marcar todos» en servicios.
24. Estetoscopio de la agenda abre «Salud de la agenda» con jerga interna.
25. «Buscar hueco»: las horas salen bajo el pliegue.
26. Nuevo cliente: lo tecleado en el buscador no pasa al formulario.
27. Servicios de la cita sin orden útil.
28. Venta: nombres cortados en lo que distingue; iconos de taza.
29. Agenda de una profesional: columna estrecha, citas cortas difíciles de tocar.
30. En la cita, «Cobrar en caja» es el botón más fuerte y «Sesión de hoy» el más suave.
31. `/apk`: «archivo dañino» sin aviso previo.
32. Dispositivos: la tablet como «Mozilla/5.0…»; el de prueba revocado sigue listado.
33. Cajero revocado listado como «revoked-17…» con acciones.

## Menores
- Super-admin con `confirm()` nativo (historia clínica, Holded, sesiones).
- «Comanderas» en el menú de una clínica.
- Email de bienvenida con alias «+» no llega en mipiace.es: en implantación real, comprobar que llega.
