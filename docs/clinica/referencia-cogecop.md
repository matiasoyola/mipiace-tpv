# Software de referencia · COGECOP «Gestión Clínica»

Lo que se sabe del programa que usa hoy la clínica piloto (Rosario, podología), para copiar lo
bueno y mejorarlo. Recogido el 07-10-2026 de los manuales públicos del CGCOP y de una foto de su
pantalla de acceso. **No se ha visto el programa por dentro**: lo que el manual no cuenta está
marcado como desconocido.

---

## 1 · Qué es

| | |
|---|---|
| Nombre | Gestión Clínica COGECOP |
| Quién lo da | Consejo General de Colegios Oficiales de Podólogos (CGCOP), **gratis** a los colegiados |
| Quién lo hace | WIT Solutions (Avilés), con el Colegio de Asturias. En uso desde ~2013 |
| Coste real | Mantenimiento **180 € + IVA/año** a WIT Solutions. Soporte de terceros: Zilon Informática |
| Versión actual | 2026.4 · la clínica piloto tiene la **2024.4** («poyfis17» como empresa) |
| Plataforma | Solo Windows, escritorio, local. Sin móvil, sin tablet, sin nube |

**Para el negocio:** es el programa que trae «el Colegio», así que lo vamos a encontrar en casi
todas las podólogas. Quien se pase a mipiacetpv viene con historias que migrar.

---

## 2 · Estructura técnica

- Aplicación **.NET Framework 4.8**, informes con **SAP Crystal Reports 13**.
- Base de datos **Firebird 2.5.1** (servidor local). Al crear una empresa pide la contraseña
  `masterkey`, que es la de fábrica de Firebird (usuario `SYSDBA`).
- **Una «Empresa» del login = una base de datos.** Multiempresa desde el desplegable del login.
- **Adjuntos fuera de la base:** fotos, vídeos y PDFs firmados van a una **carpeta de Windows por
  paciente** (Ficha → Adjuntos → Adjuntos Paciente).
- **Copia de seguridad:** usuario Administrador → Configuración de personal → pestaña
  Administrador → «Crear copia de seguridad de la BBDD».
- Instalación delicada: hay que seguir un orden (Crystal Reports → Firebird → Actualizar), y los
  artículos de soporte tratan errores de conexión a la base de datos y usuarios bloqueados tras
  3 intentos.
- Envío a Hacienda: TicketBAI (País Vasco), con certificado Izenpe o FNMT. **Verifactu no aparece
  en el manual.**

**Para migrar:** la copia de Firebird + la carpeta de adjuntos. Se restaura en local, se saca el
esquema y se escribe el importador. Antes, contrato de encargado de tratamiento firmado (son datos
de salud).

---

## 3 · Menús y pantallas

Barra principal: **Módulo Clínico · Gestión · Personal · Configuración · Varios**.
Accesos rápidos: **Agenda · Pacientes · Factura · Estadística**.

### 3.1 · Módulo Clínico

**Listado de pacientes**
- Columnas: Nombre, Apellidos, NIF, Móvil, Historial.
- Un buscador por columna, con tres modos: `<!>` = todos (con o sin dato), vacío = sólo los que no
  tienen ese dato, texto = coincidencia.
- Botones: Buscar/Actualizar, Añadir, Editar, Borrar, Imprimir.

**Ficha del paciente**
- Datos de identificación + morfología, actividad física, tipo de calzado, profesión, cómo nos
  conoció, grupo sanguíneo, tipo de analítica, tipo de anestesia.
- Pestañas: **visitas · forma de pago · antecedentes familiares · antecedentes personales ·
  alergias · observaciones · archivos adjuntos · documentos**.
- Imprime la ficha y el historial clínico. Acceso directo a la agenda.

**Visitas — el corazón del modelo clínico**
- Cada visita tiene un **tipo: Quiropodia · Biomecánica · Cirugía · Pie de riesgo · General**, y
  cada tipo abre su propia subpantalla con sus listas.
- Listado de visitas filtrable por paciente, fechas (desde/hasta), tipo y «No repetir»;
  exporta a **Excel**.
- **Inalterables:** pasadas unas horas una visita no se puede modificar ni borrar. Anularla o
  cambiarla de fecha queda escrito en la ficha.

**Paciente-Especialista**
- Se elige un especialista y se le añaden o quitan pacientes.

**Agenda**
- Vista de un día, de un rango de días o de una semana.
- Huecos de 60 / 30 / 15 / 10 / 5 minutos (clic derecho). Tiempo de cita prefijado en la
  configuración.
- La cita se crea pinchando en el hueco.

**Banco de imágenes**
- Fotos con descripción de la patología. Se buscan **por paciente o por patología** (entre
  pacientes).

**Estadísticas**
- Pacientes o visitas en un rango de fechas, por edad, sexo, morfología, actividad física y
  diagnóstico.

### 3.2 · Gestión
- **Facturas emitidas** por **serie** (corriente o rectificativa): paciente, forma de pago,
  concepto y precio **escritos a mano**; número automático; imprime a texto.
- Listado de facturas emitidas · **Conceptos · Series · Titulares** (quién paga) **· Mutuas**.
- **Facturas recibidas**, proveedores, tipos de gasto.
- Estadísticas por tipo de gasto y por tipo de cirugía.

### 3.3 · Personal
- Usuarios de la clínica con claves y permisos. Sólo el administrador los cambia.

### 3.4 · Configuración (todas son listas editables)
| Sección | Listas |
|---|---|
| Paciente | Sexo, grupo sanguíneo, profesión, cómo nos conoció, morfología, actividad física, tipos de calzado, tipo de analítica, tipo de anestesia |
| Quiropodia | Patologías, tratamientos (carga desde Excel) |
| Biomecánica | Tratamiento, tipo de pie descriptivo, diagnóstico |
| Cirugía | Tratamiento, diagnóstico, sintomatología, patomecánica, ángulos |
| Pie de riesgo | Factores de riesgo, complicaciones asociadas, tratamientos (con úlcera / sin úlcera), diagnósticos |
| Recetas | Carga del talonario oficial en XML (identificando al prescriptor) · recetas tipificadas (plantillas que se asignan al paciente) |
| Mailing | Cartas a todos los pacientes o a un listado filtrado |
| Datos de la aplicación | Datos generales (nombre, razón social, nº de colegiado, CIF, logo, tiempo de cita, **documentos libres** = consentimientos) · aviso legal de la tableta de firma · texto LOPD y consentimiento · Hacienda: envío de facturas |

### 3.5 · Firma de documentos
- **Integrada:** tableta Wacom STU-430 (la STU-530 está descatalogada). Ficha → Documentos →
  Añadir → Firmar; el documento firmado queda en la ficha.
- **Con otra tableta:** PDF desde plantilla, firmado con el software del fabricante y copiado a
  mano en la carpeta de adjuntos del paciente.
- Se firman el consentimiento informado (p. ej. cirugía) y el documento LOPD.

### 3.6 · Varios
- Desconectar, Salir, Acerca de.

---

## 4 · Comparación con lo nuestro

| Tema | COGECOP | mipiacetpv |
|---|---|---|
| Dónde funciona | PC Windows de la consulta | iPad / Android, nube + offline |
| Cobro | Factura escrita a mano | La sesión pasa sola a caja; bonos |
| Valoración inicial | No consta | La rellena el paciente antes (pieza 1) |
| Exploración | Listas por tipo de visita | Mapa del pie (pieza 2) |
| Evolución | No consta | Dolor 0–10 con gráfica (pieza 3) |
| Firma | Tableta Wacom concreta | Con el dedo en la tablet (pieza 5) |
| Recordatorios | No | Previstos (email, luego WhatsApp) |
| Acceso por sanitario | Paciente-Especialista a mano | Se da solo al asignar la cita; registro de accesos |
| Inalterabilidad | Visitas bloqueadas a las horas | Sesión cerrada = solo anotaciones con autor |
| Mantenimiento | 180 €/año + instalación delicada | Incluido |

---

## 5 · Ideas para copiar y mejorar (pendientes de validar con Matías, una a una)

1. **Tipos de visita** con listas propias (Quiropodia, Biomecánica, Cirugía, Pie de riesgo,
   General). En la sesión se elige el tipo y sólo salen los botones de ese tipo.
2. **Listas clínicas configurables e importables.** Las de Rosario ya están en su COGECOP: se
   migran como punto de partida.
3. **Campos de la ficha:** morfología, actividad física, tipo de calzado, profesión, grupo
   sanguíneo, antecedentes familiares y personales, alergias.
4. **Banco de imágenes buscable por patología**, entre pacientes.
5. **Recetas** tipificadas y talonario.
6. **Estadísticas clínicas** por diagnóstico, edad, sexo…
7. **Mutuas y titular pagador.** La hoja de precios de Rosario estaba junto a papeles de FIATC
   Seguros.
8. **Mailing filtrado**, en nuestro caso por email o WhatsApp.

Los servicios de Rosario (`docs/implantaciones/rosario/catalogo-tpv.csv`) ya se agrupan en esos
tipos: Quiropodia (básica, completa, extra, domicilio, cura, papiloma), Biomecánica (exploración,
revisiones, órtesis) y Cirugía (fenol, avulsión).

---

## 6 · Lo que NO se sabe todavía

- El esquema real de la base de datos (tablas y campos).
- Si cada tipo de visita tiene más campos que las listas de configuración.
- Si existe mapa del pie, gráfica de evolución o informe para el paciente.
- Cómo se ve cada pantalla. Una foto de la ficha de un paciente y de una visita de cada tipo
  bastaría.

## Fuentes

- Manual de uso 2024: https://cgcop.es/wp-content/uploads/2024/01/Manual-Gestion-Clinicas-2024.pdf
- Manual de uso (versión anterior): https://copomur.es/wp-content/uploads/2017/03/MANUAL-PROGRAMA-GESTIO%CC%81N-COGECOP.pdf
- Manual de instalación y actualización: https://cgcop.es/wp-content/uploads/2025/05/Manual-de-Instalacion-Actualizacion-COGECOP.pdf
- Página del software (2026.4, Firebird 2.5.1): https://cgcop.es/software-gestion-de-clinicas/
- Preguntas frecuentes (oct 2020): https://cgcop.es/wp-content/uploads/2020/10/DUDAS-FRECUENTES-PROGRAMA-OCT-2020.pdf
- Firma digital: https://cgcop.es/programa-gestion-de-clinicas-firma-digital/
- Error de conexión a la base de datos: https://cgcop.es/error-de-conexion-a-la-base-de-datos/
- Coste y desarrollador (COPOMUR): https://copomur.es/programa-informatico-de-gestion-gratuito/
- Origen del programa (Revista Española de Podología): https://www.revesppod.com/Documentos/ArticulosNew/X0210123814502173.pdf
