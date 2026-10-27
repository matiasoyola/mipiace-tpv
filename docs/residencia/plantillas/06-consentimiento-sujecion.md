---
id: consentimiento-sujecion
version: 1
titulo: Consentimiento informado de una medida de sujeción
cuando: cada vez que se prescribe una medida (uno por medida; nunca genérico ni en blanco)
firman: [medico-prescriptor, residente-o-representante]
clinica: true
estado: borrador-pendiente-revision-juridica
---

# Consentimiento informado para una medida de sujeción

Residente: {residente.nombre_completo} · Habitación {cama.habitacion}

> Este documento vale **sólo para la medida que describe**, en las condiciones y hasta la fecha que
> dice. No es un permiso general: cualquier otra medida, o la misma en otras condiciones, necesita su
> propia prescripción y su propio consentimiento (Instrucción 1/2022 de la Fiscalía General del
> Estado; art. 12.6 del Decreto 2/2022).

## 1. Qué se propone

| | |
|---|---|
| Medida | {sujecion.tipo} |
| Por qué | {sujecion.motivo} |
| Pauta exacta (en qué momento y en qué situación concretos; nunca «si precisa») | {sujecion.cuando} |
| Cuánto tiempo como máximo cada vez | {sujecion.duracion_maxima} |
| Hasta cuándo vale este consentimiento | {sujecion.revision} — como máximo [30] días; ese día el médico revisa si sigue haciendo falta y, si sí, se pide un consentimiento nuevo |
| Lo prescribe | {sujecion.medico}, n.º de colegiado {sujecion.colegiado} |

## 2. Lo que ya se ha intentado antes

Una sujeción es **el último recurso**. Antes se han probado estas alternativas, sin resultado
suficiente: {sujecion.alternativas_probadas}.

## 3. Lo que tienes que saber

- **Beneficio que se busca:** evitar el riesgo descrito arriba.
- **Riesgos de la sujeción:** pérdida de fuerza y de movilidad, úlceras, agitación y angustia,
  caídas más graves si intenta liberarse, y en raros casos lesiones o asfixia. Por eso se usa el
  menor tiempo posible y con vigilancia.
- **Cómo se vigila:** el personal comprueba su estado al menos cada [ ] minutos mientras dure, y lo
  anota; se retira en cuanto deja de hacer falta.
- **Nunca** se usa como castigo ni por falta de personal o por comodidad.
- Queda **registrada**: cada vez que se usa, cuánto dura y quién la vigila.

## 4. En una urgencia

Si hay un peligro inminente para ella o para otras personas y no se puede esperar, el profesional
responsable puede aplicar una sujeción según el protocolo del centro; el médico la ratifica o la
retira lo antes posible, se registra y se informa a la residente y a quien la apoya o representa.
Si la medida tiene que seguir, se prescribe y se consiente con este documento.

## 5. Lo que decides

☐ **Doy mi consentimiento** a esta medida, en estas condiciones y hasta la fecha indicada.

☐ **No doy mi consentimiento.** Se me ha explicado qué riesgos supone no aplicarla, y el equipo
buscará otras alternativas.

Puedo **retirar** este consentimiento en cualquier momento, de palabra o por escrito.

**Si la residente puede decidir, firma ella.** Sólo firma su representante cuando ella no está en
condiciones de decidir sobre esta medida.

<!-- si firma un representante -->
Firmo como {representante.base} de la residente, con facultades para este acto. Se le ha explicado
también a ella, de forma adaptada.

☐ La residente **no se opone**.
☐ La residente **se opone**: entonces la medida **no se aplica** con este consentimiento, y el centro
lo pone en conocimiento del Ministerio Fiscal para que se valore la necesidad de autorización judicial.
<!-- fin -->

---

Me lo ha explicado {sujecion.medico}, que la prescribe. Firmado en {lugar}, el {fecha}.

{firmantes}
