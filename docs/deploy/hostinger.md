# Despliegue mipiacetpv en Hostinger VPS

Manual paso a paso para desplegar mipiacetpv en el VPS 3 Hostinger
(`srv1582207.hstgr.cloud`, IP `76.13.142.28`, Frankfurt, Ubuntu 24.04 LTS,
KVM 1: 1 vCPU + 4 GB RAM + 50 GB NVMe).

## Pre-requisitos

- Acceso SSH al VPS (`ssh root@76.13.142.28`, password en hPanel).
- Dominio `mipiacetpv.tech` ya registrado.
- Cuenta de Resend (o SMTP equivalente) para email transaccional —
  opcional para el primer arranque, requerido antes del piloto.

## 1 · Configurar DNS (en hPanel)

En el panel de dominio de `mipiacetpv.tech`, añadir 3 registros A
apuntando al IP del VPS:

```
A     @           76.13.142.28    TTL 3600
A     www         76.13.142.28    TTL 3600
A     admin       76.13.142.28    TTL 3600
A     api         76.13.142.28    TTL 3600
```

La propagación tarda entre 1 minuto y 30 minutos. Verificar con:

```bash
dig +short mipiacetpv.tech
dig +short admin.mipiacetpv.tech
dig +short api.mipiacetpv.tech
```

Los tres tienen que devolver `76.13.142.28` antes de continuar — si
no, Caddy fallará al pedir certificado SSL a Let's Encrypt.

## 2 · Cambiar password root SSH (recomendado)

En hPanel → VPS → Acceso root → "Cambiar". Guarda la nueva password
en tu gestor.

Mejor todavía: añade una clave SSH pública en hPanel → VPS → Clave SSH
y deshabilita el login por password después:

```bash
# En el VPS, después de configurar la clave:
sed -i 's/^#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd
```

## 3 · Firewall mínimo

En hPanel → VPS → Firewall, abrir solo:

- TCP 22 (SSH) — restringido a tu IP si es estática.
- TCP 80 (HTTP, para Let's Encrypt challenges).
- TCP 443 (HTTPS).

Bloquear todo lo demás. Postgres y Redis NO se exponen al exterior
(quedan en el bridge network de Docker).

## 4 · Bootstrap inicial

SSH al VPS y lanza el script:

```bash
ssh root@76.13.142.28

# Bajar y correr el bootstrap (es idempotente, puedes correrlo varias veces)
curl -sSL https://raw.githubusercontent.com/matiasoyola/mipiace-tpv/master/infra/bootstrap-hostinger.sh | bash
```

La primera vez te dirá "rellena los secretos REPLACE_ME en
`/opt/mipiacetpv/infra/.env.production`" y parará. Genera los secretos
y rellénalos:

```bash
cd /opt/mipiacetpv

# Genera los 4 secretos que necesitas:
echo "JWT_ACCESS_SECRET=$(openssl rand -base64 48)"
echo "JWT_REFRESH_SECRET=$(openssl rand -base64 48)"
echo "SUPER_ADMIN_JWT_SECRET=$(openssl rand -base64 48)"
echo "HOLDED_KEY_ENCRYPTION_SECRET=$(openssl rand -base64 32)"
echo "POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-32)"

# Editar el .env:
nano infra/.env.production
```

**IMPORTANTE — guarda esos secretos en tu gestor de passwords (1Password,
Bitwarden, Apple Passwords) antes de cerrar el editor.** Si pierdes
`HOLDED_KEY_ENCRYPTION_SECRET`, no podrás desencriptar las API keys de
Holded de tus tenants existentes — recovery es imposible sin restore
de backup.

Después de rellenar, vuelve a lanzar:

```bash
bash /opt/mipiacetpv/infra/bootstrap-hostinger.sh
```

El script construirá las imágenes (~5-10 min la primera vez),
levantará postgres y redis, aplicará las migraciones Prisma (B1–B9),
y arrancará api + worker + caddy.

## 5 · Verificar

```bash
# Logs de cada servicio
docker compose --env-file infra/.env.production -f infra/docker-compose.prod.yml logs api --tail=50
docker compose --env-file infra/.env.production -f infra/docker-compose.prod.yml logs worker --tail=50
docker compose --env-file infra/.env.production -f infra/docker-compose.prod.yml logs caddy --tail=50

# Health check
curl https://api.mipiacetpv.tech/health
```

Caddy obtendrá los certificados Let's Encrypt automáticamente al
primer acceso a cada dominio. Si falla, comprueba que los DNS están
propagados y vuelve a forzar:

```bash
docker compose --env-file infra/.env.production -f infra/docker-compose.prod.yml restart caddy
```

## 6 · Crear el primer super-admin

```bash
docker compose --env-file infra/.env.production -f infra/docker-compose.prod.yml exec api \
  pnpm --filter @mipiacetpv/api super-admin:create
```

Interactivo: pide email + password (mín 12 chars). Después puedes
loguearte en `https://admin.mipiacetpv.tech/superadmin/login`.

## 7 · Configurar backups automáticos

```bash
# Crontab del root: dump diario a las 04:00
crontab -e
# Añadir:
0 4 * * * /opt/mipiacetpv/infra/backup-postgres.sh >> /var/log/mipiacetpv-backup.log 2>&1
```

Los backups quedan en `/opt/mipiacetpv/backups/`. Retención por defecto
30 días. Opcional: configurar Backblaze B2 con `b2 authorize-account`
y exportar `MIPIACETPV_B2_BUCKET=<bucket>` antes del cron para copia
off-site.

## 8 · Configurar Resend para email transaccional

1. Crear cuenta en `resend.com` (free tier: 3.000 emails/mes, suficiente para piloto).
2. Añadir dominio `mipiacetpv.tech` como sending domain.
3. Crear los registros DNS que Resend te indica (SPF, DKIM, DMARC) en
   hPanel → DNS de `mipiacetpv.tech`.
4. Esperar verificación (~5-15 min).
5. Crear una API key.
6. Editar `infra/.env.production` con `SMTP_PASS=<api-key-de-resend>`.
7. Reiniciar el stack:

```bash
docker compose --env-file infra/.env.production -f infra/docker-compose.prod.yml restart api worker
```

## 9 · Actualizaciones

Cualquier deploy posterior:

```bash
ssh root@76.13.142.28
cd /opt/mipiacetpv
bash infra/bootstrap-hostinger.sh
```

El script hace `git pull` + rebuild + restart. Los datos en
postgres/redis sobreviven (volúmenes persistentes).

## Comandos útiles para soporte

```bash
# Estado de todos los servicios
docker compose --env-file infra/.env.production -f infra/docker-compose.prod.yml ps

# Reiniciar un servicio individual
docker compose --env-file infra/.env.production -f infra/docker-compose.prod.yml restart api

# Acceso a Postgres
docker compose --env-file infra/.env.production -f infra/docker-compose.prod.yml exec postgres \
  psql -U mipiacetpv -d mipiacetpv

# Acceso a Redis
docker compose --env-file infra/.env.production -f infra/docker-compose.prod.yml exec redis redis-cli

# Disparar resync manual para un tenant
docker compose --env-file infra/.env.production -f infra/docker-compose.prod.yml exec api \
  pnpm --filter @mipiacetpv/api resync <tenantId>

# Restore desde backup (PELIGROSO — pisa la BD)
gunzip < /opt/mipiacetpv/backups/mipiacetpv-YYYYMMDD-HHMMSS.sql.gz | \
  docker compose --env-file infra/.env.production -f infra/docker-compose.prod.yml exec -T postgres \
  psql -U mipiacetpv -d mipiacetpv
```

## Recursos del VPS · monitoreo

KVM 1 va justo (4 GB RAM, 1 vCPU). Vigilar:

```bash
# Uso de RAM y CPU por contenedor
docker stats --no-stream

# Uso de disco
df -h /
du -sh /opt/mipiacetpv/backups
```

Si la RAM se acerca al 90% sostenido, opciones:

- Subir plan a KVM 2 (8 GB / 2 cores). Hostinger permite upgrade
  in-place sin reinstalar.
- Reducir `mem_limit` de `worker` a 512m si los jobs son ligeros.
- Mover Postgres a managed (Neon, Supabase) y dejar más RAM al stack.
