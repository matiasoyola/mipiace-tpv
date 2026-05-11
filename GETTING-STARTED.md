# Cómo pasar este proyecto a Claude Code

Esta carpeta tiene **la especificación** del TPV Holded, pero no el código.
El código lo vas a escribir con **Claude Code** dentro de esta misma carpeta.

## 1. Instalar Claude Code (si aún no lo tienes)

En tu Mac, abre Terminal y ejecuta:

```bash
npm install -g @anthropic-ai/claude-code
```

(Necesitas Node.js 18+. Si no lo tienes, instálalo desde
https://nodejs.org/ o con `brew install node`.)

Luego haz login:

```bash
claude login
```

## 2. Abrir Claude Code en esta carpeta

```bash
cd "/Users/matiasoyolasanchez/Documents/Claude/Projects/Holded"
claude
```

Claude Code arrancará dentro de esta carpeta. Verá automáticamente el
`README.md` y los documentos de `docs/`.

## 3. Primer prompt sugerido

Una vez dentro de Claude Code, copia y pega esto como primer mensaje:

> Lee `README.md` y todo lo que hay en `docs/`. Después dime:
> 1. Un resumen en una página de lo que vamos a construir.
> 2. Las **3 dudas más críticas** que tienes antes de empezar a codear.
> 3. Una propuesta de **estructura de monorepo** para arrancar la Fase 0 del
>    roadmap (spike de integración con Holded).
>
> No escribas código todavía. Quiero validar plan contigo antes.

## 4. Siguiente paso: Fase 0

Cuando hayáis alineado el plan, pídele que ejecute la **Fase 0** del
roadmap (`docs/05-roadmap.md`): el spike de integración con Holded.
Esto es lo más arriesgado del proyecto, conviene resolverlo antes de
invertir tiempo en UI.

## 5. Lo que NO debes esperar de Claude Code

- No va a registrar tu app en developers.holded.com por ti. Esa parte
  (crear app, obtener `client_id` / `client_secret`, definir redirect URIs)
  la tienes que hacer manualmente en la web de Holded. Cuando lo tengas,
  pásale las credenciales en un `.env` (te las pedirá).
- No va a configurar tu VPS de Hostinger automáticamente. Para desplegar
  te dará el `docker-compose.yml` y un script de provisión, pero la
  ejecución en el VPS la haces tú con SSH (o le pides que te guíe paso a
  paso).

## 6. Si necesitas iterar la especificación

Vuelve aquí (Cowork) cuando:
- Quieras modificar la spec funcional, los flujos o el roadmap.
- Necesites un documento nuevo (manual de cajero, FAQ comercial, etc.).
- Quieras revisar decisiones de arquitectura sin abrir un editor.

Claude Code es para construir; Cowork es para pensar, decidir y documentar.

---

**Suerte. Cualquier duda, vuelve a abrir Cowork y lo afinamos.**
