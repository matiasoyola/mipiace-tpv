# Plantillas de documentos de la residencia · borrador v1

Escritas desde cero por Mi Piace el 27-10-2026 para Jardín de Gredos, sin partir de los papeles
antiguos del centro (el contrato de 2021 citaba la LOPD 15/1999, derogada, y sometía a la familia al
fuero del centro, que es una cláusula abusiva con consumidores). **Son la siembra del bloque
`residencia-ingreso-documentos`** y cualquier residencia que encienda el módulo parte de ellas.

## Estado: BORRADOR · pendiente de revisión jurídica

Ninguna se puede usar para firmar hasta que **(1)** la revise un abogado o la asesoría del centro y
**(2)** la apruebe la dirección del centro en *Configuración → Plantillas* (que la publica como
versión 1). En el programa salen con la marca «Borrador · pendiente de revisión», igual que los
consentimientos de clínica salen con `pendienteDeValidar: true`. Lo que va entre `[corchetes]` es una
decisión del centro que falta (horarios, importes, plazos propios): no es un hueco que rellene la
ficha, es texto que el centro tiene que escribir antes de aprobar.

## Las plantillas

| Fichero | Documento | Cuándo se pide | Quién firma |
|---|---|---|---|
| `01-contrato-de-estancia.md` | Contrato de estancia (condiciones generales) | Siempre | Residente o representante, y el centro |
| `02a-anexo-economico-plaza-privada.md` | Anexo económico · plaza privada o temporal | Plaza privada o temporal | Residente o representante, y el centro |
| `02b-anexo-economico-plaza-concertada.md` | Anexo económico · plaza concertada | Plaza concertada | Residente o representante, y el centro |
| `03-reglamento-de-regimen-interior.md` | Reglamento de régimen interior (y su resumen en lectura fácil) | Siempre (se entrega; el contrato acredita que se recibe) | — |
| `04-proteccion-de-datos.md` | Información y consentimientos de protección de datos | Siempre | Residente o representante |
| `05-imagen.md` | Autorización de imagen (por usos, cada uno con su sí o no) | Siempre (puede decir que no a todo) | Residente o representante |
| `06-consentimiento-sujecion.md` | Consentimiento informado de una medida de sujeción | Cada vez que se prescribe una (una por medida) | Residente o representante, y el médico que la prescribe |
| `07-salidas.md` | Salidas del centro: quién acompaña y si sale solo | Siempre | Residente o representante |
| `08-guardador-de-hecho.md` | Declaración de guardador de hecho | Si firma un guardador de hecho | El guardador |
| `09-inventario-de-pertenencias.md` | Inventario de pertenencias | Siempre (al ingreso, y cada vez que entra algo de valor) | Auxiliar y residente o familia |
| `10-mandato-sepa.md` | Orden de domiciliación SEPA (CORE) | Si paga por recibo | Titular de la cuenta |

## Los huecos (se rellenan solos con la ficha)

Si a un documento le falta un hueco, el programa no deja generarlo y lleva al campo (decisión 8 del
prompt). Lista cerrada; un hueco nuevo se añade aquí y en el código a la vez.

- **Centro**: `{centro.razon_social}` `{centro.nif}` `{centro.nombre_comercial}` `{centro.domicilio}`
  `{centro.telefono}` `{centro.email}` `{centro.registro_autorizacion}`
  `{centro.director}` `{centro.dpd_contacto}` `{centro.aseguradora}` `{centro.poliza}`
  `{centro.acreedor_sepa}`
- **Residente**: `{residente.nombre_completo}` `{residente.dni}` `{residente.fecha_nacimiento}`
  `{residente.domicilio_anterior}` `{residente.nss}`
- **Quien apoya o representa**: `{representante.nombre_completo}` `{representante.dni}`
  `{representante.parentesco}` `{representante.base}` `{representante.acreditacion}`
  `{representante.telefono}` `{representante.email}` `{representante.domicilio}`. **Ojo con la
  base**: el **guardador de hecho apoya, no representa** (firma «con el apoyo de», art. 264 CC); sólo
  representan el curador con facultades de representación, el apoderado con poder suficiente y quien
  tenga autorización judicial para el acto. La residente firma siempre que pueda.
- **Plaza y cama**: `{plaza.tipo}` `{plaza.fecha_ingreso}` `{plaza.fecha_fin}` (sólo temporal)
  `{cama.habitacion}` `{cama.letra}` `{cama.tipo_habitacion}` (individual · doble)
- **Concertada**: `{concesion.resolucion}` `{concesion.fecha}` `{concesion.grado}`
  `{concesion.regimen}` `{concesion.aportacion}`
- **Dinero**: `{tarifa.nombre}` `{tarifa.precio_mensual}` `{tarifa.iva}` `{tarifa.precio_dia}`
  `{tarifa.fianza}` `{pago.forma}` `{pago.dia_cobro}` `{pago.titular}` `{pago.titular_nif}`
  `{pago.titular_domicilio}` `{pago.iban}` `{pago.bic}` `{pago.entidad}` `{pago.factura_a}`
  `{pago.referencia_mandato}`
- **Sujeción**: `{sujecion.tipo}` `{sujecion.motivo}` `{sujecion.alternativas_probadas}`
  `{sujecion.cuando}` `{sujecion.duracion_maxima}` `{sujecion.revision}` `{sujecion.medico}`
  `{sujecion.colegiado}`
- **Contactos**: `{contactos.informados}` (los contactos que la residente elige para recibir información)
- **Generales**: `{fecha}` `{lugar}` `{firmantes}`

## Normativa en la que se apoyan (verificada el 27-10-2026)

- Ley 14/2010, de Servicios Sociales de Castilla-La Mancha (derechos, art. 7; deberes, art. 8).
- Ley 5/2010, de derechos y deberes en materia de salud de Castilla-La Mancha (historia clínica,
  art. 31.2) y Ley 6/2005, de declaración de voluntades anticipadas (instrucciones previas).
- Decreto 2/2022, de 18 de enero, condiciones básicas de los centros de atención especializada para
  personas mayores de Castilla-La Mancha: reglamento de régimen interior (arts. 8 y 12.1), derechos y
  deberes (arts. 9 y 10), intimidad (12.5), contenciones con prescripción facultativa, consentimiento
  informado, registro y protocolo (12.6), procedimientos contra el ingreso involuntario y
  comunicación a los órganos judiciales (12.7), PIAP (5.2).
- Instrucción 1/2022 de la Fiscalía General del Estado sobre contenciones mecánicas y farmacológicas.
- Ley 41/2002, de autonomía del paciente (consentimiento informado).
- Código Civil tras la Ley 8/2021 (medidas de apoyo; guarda de hecho, arts. 263 a 267, y en especial
  el 264: el guardador necesita autorización judicial para representar) y art. 763 de la LEC
  (internamiento no voluntario: autorización judicial **previa**; sólo en urgencia, comunicación en
  24 horas; STC 13/2016 lo aplica a residencias).
- RGPD (UE) 2016/679 (arts. 6, 7, 9, 13 y 15 a 22) y Ley Orgánica 3/2018 (LOPDGDD).
- Ley Orgánica 1/1982 (derecho a la propia imagen; art. 3.2: si consiente un representante legal,
  comunicación previa al Ministerio Fiscal).
- Texto refundido de la Ley General para la Defensa de los Consumidores y Usuarios (RDL 1/2007):
  cláusulas abusivas (arts. 82 a 91), en especial las modificaciones unilaterales sin motivos tasados
  (art. 85.3) y la sumisión a un fuero distinto del domicilio del consumidor (art. 90.2); respuesta
  a reclamaciones en un mes como máximo (art. 21.3).
- Reglamento (UE) 260/2012 y rulebook SEPA Core de la EPC (mandato).

## Lo que tiene que decidir alguien antes de aprobarlas

1. **IVA de las plazas privadas** (pendiente de la asesoría, ya anotado en plaza-y-pago): el anexo
   privado lleva `{tarifa.iva}` y no afirma un tipo.
2. **Fianza**: el borrador la deja opcional y con tope de un mes, devuelta al terminar. Si el centro
   no la quiere, se quita la cláusula.
3. **Reserva de plaza en ausencias de la plaza privada**: porcentaje del precio que se cobra
   (`[ ]` en el anexo). En concertada manda la resolución de la Junta.
4. **Preaviso de baja**: el borrador pone 15 días naturales.
5. **Ingreso de quien no puede decidir**: el contrato y el guion recogen la comunicación al juzgado
   (art. 763 LEC). Que el abogado confirme el procedimiento que quiere el centro (art. 12.7 del
   Decreto 2/2022 exige tenerlo por escrito).
6. **Delegado de protección de datos**: si el centro lo tiene designado (trata datos de salud a gran
   escala de forma habitual; que lo valore el abogado), su contacto va en `{centro.dpd_contacto}`.
7. **El reglamento** lleva muchos `[ ]` de funcionamiento real (horarios, servicios, precios no
   incluidos): los rellena la dirección, no el programa. Se ofrece también en lectura fácil; el art.
   8.1 del Decreto 2/2022 lo exige expresamente a los centros de la Junta, y para un centro privado es
   buena práctica (que lo confirme el abogado).
8. **Delegado de protección de datos**: probablemente obligatorio (art. 37.1.c RGPD, datos de salud a
   gran escala; art. 34.1 LOPDGDD si el centro tiene servicio sanitario autorizado). Por eso el
   documento de datos ya no lo trata como opcional. Y antes de encender la lectura automática de
   documentos: **evaluación de impacto** (art. 35 RGPD) y el mecanismo concreto de transferencia
   internacional según el contrato con el proveedor.
9. **Desistimiento**: si las firmas se recogen a distancia (preingreso desde casa), que el abogado
   confirme que el contrato está excluido del derecho de desistimiento de 14 días por ser de
   servicios sociales (art. 93.a TRLGDCU); si no lo está, hay que añadir el formulario.
10. **Garante del pago**: el contrato dice que nunca es condición del ingreso. Si el centro quiere
    ofrecerlo, falta su documento (voluntario y aparte).
11. **Arbitraje de consumo**: si el centro está adherido o no (cláusula 10.2 del contrato).
12. **Responsabilidad por pertenencias**: el borrador no limita la responsabilidad del centro más
    allá de la ley (depósito necesario, arts. 1783-1784 CC; art. 86 TRLGDCU).

## Revisión del 27-10-2026

Una revisión independiente encontró y se corrigieron: la firma del guardador de hecho como
representante (ahora firma como apoyo), la «ratificación» posterior del ingreso de quien no puede
decidir (ahora autorización previa; sólo urgencia con comunicación en 24 h), la sujeción demasiado
abierta (pauta exacta, revisión de 30 días como máximo, caso de urgencia, y si la residente se opone
la medida no se aplica), la imagen en web y redes firmada por otro (queda en No salvo comunicación
al Fiscal), la foto de identificación (pasa a ser medida de seguridad con base en el art. 9.2.h y
sale del documento de imagen), la subida de precio sin criterio (ahora IPC), la información a la
familia sin autorización, la baja de plaza concertada por el centro, las salidas restringidas sin
acuerdo, el mandato SEPA sin dirección del deudor y el preaviso de los cargos. **Sigue siendo un
borrador: la revisión jurídica que vale es la del abogado del centro.**
