# GESTOR — Torneo de fútbol (microservicios)

Fase 1: base del monorepo. Cada servicio arranca, responde `/health` y `/ready`, escribe
logs estructurados y devuelve errores con el mismo formato. Aún no tiene lógica de negocio.

## Requisitos

Node 22+, pnpm 9 (`corepack enable`), Docker.

## Todo el sistema con un comando

```bash
cp infra/.env.example infra/.env   # opcional: hay valores de desarrollo por defecto
pnpm dev                           # docker compose up --build
```

| Servicio                                            | URL local                                                                                          |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| gateway                                             | http://localhost:8080/health                                                                       |
| auth / teams / matches / discipline / notifications | puertos 3001 a 3005, `/health`                                                                     |
| Postgres                                            | localhost:5432 (5 bases: `auth_db`, `teams_db`, `matches_db`, `discipline_db`, `notifications_db`) |
| MinIO (consola)                                     | http://localhost:9001                                                                              |
| Mailpit (bandeja)                                   | http://localhost:8025                                                                              |

## Sin Docker (solo un servicio)

```bash
pnpm install
PORT=3001 pnpm --filter @gestor/auth dev
```

## Calidad

```bash
pnpm lint && pnpm typecheck && pnpm test
```

## Estructura

```
apps/web/            frontend actual (se adapta en la fase 6)
services/<nombre>/   src/{routes,services,repositories,db/migrations}
packages/shared/     config (Zod), logger, errores, plantilla de servicio
infra/               docker-compose, Dockerfile.dev, init de Postgres
```

## Verificar el aislamiento de bases

```bash
docker compose -f infra/docker-compose.yml exec postgres \
  psql -U auth_user -d teams_db -c "select 1"   # debe fallar: permission denied
```
