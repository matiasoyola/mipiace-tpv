#!/usr/bin/env bash
# Commit del backoff Holded (v1.9.9) — Mi Piace TPV.
# Los 3 ficheros ya están escritos en el repo; esto solo los versiona.
# NO hace push ni deploy: esos dos pasos los decides tú al final.
set -uo pipefail

REPO="$HOME/Developer/Claude/Projects/mipiacetpv"
cd "$REPO" || { echo "❌ No encuentro el repo en $REPO"; exit 1; }

echo "▶ 1/5 · Quito el lock zombie de git (si existe)"
rm -f .git/index.lock 2>/dev/null || true

echo "▶ 2/5 · Compruebo que git lee los ficheros del cambio"
if ! git --no-optional-locks status --porcelain -- packages/holded-client >/dev/null 2>&1; then
  cat <<'EOF'
❌ git no puede leer el árbol de trabajo.
   Casi seguro es iCloud: la carpeta está en Documentos y hay ficheros
   "en la nube". Arréglalo una vez:
     Finder → carpeta Holded → clic derecho → "Descargar ahora"
     (o Ajustes de iCloud → desactivar "Optimizar almacenamiento del Mac")
   Y vuelve a lanzar este script.
EOF
  exit 1
fi

echo "▶ 3/5 · Creo la rama v1-9-9-holded-backoff"
git checkout -b v1-9-9-holded-backoff 2>/dev/null || git checkout v1-9-9-holded-backoff

echo "▶ 4/5 · Corro los tests del paquete holded-client"
if ! pnpm --filter @mipiacetpv/holded-client test; then
  echo "❌ Los tests no pasan. Paro aquí; no commiteo nada roto."
  exit 1
fi

echo "▶ 5/5 · Commit (solo los 3 ficheros del cambio)"
git add packages/holded-client/src/retry.ts \
        packages/holded-client/src/client.ts \
        packages/holded-client/test/client-retry.test.ts
git commit -m "v1.9.9 · backoff + Retry-After en cliente Holded (429/5xx/red, solo GET idempotente)"

cat <<'EOF'

✅ Commit hecho en la rama v1-9-9-holded-backoff.

Lo que falta es SOLO tuyo (yo no publico ni despliego producción):
  git push -u origin v1-9-9-holded-backoff
  # → espera CI verde
  # → merge --no-ff en master
  # → bash infra/deploy.sh    (sin migración; rollback = sha anterior)
EOF
