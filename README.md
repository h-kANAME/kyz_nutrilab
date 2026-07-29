# KYZ NutriLab

Trackeo de alimentación multi-usuario (mobile-first), auth Google (solo Client ID), plan editable, semana con carrusel, y asistente AI (texto + imagen). Stack: React (Vite PWA) + Fastify + SQLite.

## Arranque local (Docker)

```bash
cp .env.example .env
# Editar GOOGLE_CLIENT_ID, VITE_GOOGLE_CLIENT_ID, JWT_SECRET, LLM keys
docker compose up --build
```

Abrir [http://127.0.0.1:8088](http://127.0.0.1:8088).

Health: `GET /api/healthz`.

### Google Cloud Console

1. Crear OAuth Client ID tipo **Web application**.
2. Authorized JavaScript origins:
   - `http://localhost:8088`
   - `https://nutrilab.kyz-apps.site` (prod)
3. No hace falta Client Secret (GIS ID token).

### Allowlist

`ALLOWED_GOOGLE_EMAILS=user1@gmail.com,user2@gmail.com`  
En local se permite `*` (prohibido en producción: el API rechaza `*` si `NODE_ENV=production`).

### LLM

`LLM_PROVIDER=gemini|openai|deepseek` + la API key correspondiente.  
DeepSeek: texto OK; visión (foto) no soportada en este adapter.

## Desarrollo sin Docker (opcional)

```bash
npm install
# API
cd apps/api && set -a && source ../../.env && set +a && npm run dev
# Web (proxy /api → :8080)
cd apps/web && npm run dev
```

## Producción (Dokploy)

| Campo | Valor |
|-------|--------|
| Compose Path | `./docker-compose.dokploy.yml` |
| Domain host | `nutrilab.kyz-apps.site` |
| Service | `nutrilabcaddy` |
| Port | `80` |
| HTTPS | Let's Encrypt |

Env mínimas en Dokploy:

- `PUBLIC_ORIGIN=https://nutrilab.kyz-apps.site`
- `GOOGLE_CLIENT_ID` / `VITE_GOOGLE_CLIENT_ID`
- `ALLOWED_GOOGLE_EMAILS` (lista real, sin `*`)
- `JWT_SECRET` (≥32 chars)
- `LLM_PROVIDER` + keys

Datos persistentes: volumen `nutrilab_sqlite` (DB + uploads).

## Estructura

```
apps/api   Fastify + better-sqlite3
apps/web   React PWA
deploy/    Caddy reverse proxy config
```

## Seguridad

- Cookie JWT httpOnly / SameSite=Lax / Secure en HTTPS
- Helmet, rate-limit en auth/AI
- CORS estricto a `PUBLIC_ORIGIN`
- Uploads: jpeg/png/webp ≤5MB, path por userId
- Contenedores non-root (API) + `no-new-privileges`
