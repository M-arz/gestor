# GESTOR — Torneo de fútbol (microservicios)

Fase 1: base del monorepo. Fase 2: `auth-service` y gateway (ver sección _Autenticación_). Cada servicio arranca, responde `/health` y `/ready`, escribe
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
| Postgres                                            | localhost:5433 (5 bases: `auth_db`, `teams_db`, `matches_db`, `discipline_db`, `notifications_db`) |
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

## Autenticación (fase 2)

Rutas públicas, todas por el gateway (`/api/auth/...`): `register`, `register-admin`, `login`,
`refresh`, `logout`, `forgot-password`, `reset-password`. Protegida: `me`.

- Contraseñas con Argon2id. Bloqueo progresivo desde el 5.º fallo (1, 2, 4... hasta 60 min).
- Token de acceso de 15 min (en la respuesta) y refresh rotativo de 7 días (cookie `HttpOnly`,
  `SameSite=Strict`). Reutilizar un refresh viejo revoca toda la sesión.
- Las cuentas `admin` solo se crean con un código de un solo uso:

```bash
docker compose -f infra/docker-compose.yml exec -w /app/services/auth auth \
  pnpm codigo-admin --correo persona@dominio.com --dias 7
```

- Migraciones: `pnpm --filter @gestor/auth db:generate` crea una nueva a partir de `schema.ts`;
  se aplican solas al arrancar `auth` en local. Nunca edites una migración ya aplicada.
- Los eventos (`usuario.registrado`, `usuario.recuperacion_solicitada`) se guardan en
  `eventos_salida`; el publicador hacia Redis llega con la fase 5.

## Equipos y jugadores (fase 3)

Todo por el gateway, con sesión (`Authorization: Bearer <accessToken>`):

| Método y ruta                                                 | Quién                                                                         |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `POST /api/teams/equipos`                                     | delegado (crea el suyo)                                                       |
| `GET /api/teams/equipos`                                      | delegado: los suyos · admin: los inscritos en sus torneos                     |
| `GET/PATCH/DELETE /api/teams/equipos/:id`                     | datos básicos: cualquiera con sesión · cambios: solo su delegado              |
| `PUT /api/teams/equipos/:id/escudo`                           | su delegado (multipart, campo `archivo`, PNG/JPG/WebP, máx. 2 MB)             |
| `GET/POST /api/teams/equipos/:id/jugadores`                   | ver: su delegado o admins de torneos donde esté inscrito · crear: su delegado |
| `PATCH/DELETE /api/teams/jugadores/:id`                       | su delegado                                                                   |
| `PUT/GET /api/teams/jugadores/:id/foto`                       | su delegado (ver: también admins del torneo)                                  |
| `GET /api/teams/jugadores/:id/carnet`                         | igual que ver plantilla                                                       |
| `POST /api/teams/jugadores/:id/anonimizar`                    | su delegado (derecho de supresión)                                            |
| `GET /api/public/equipos/:id`, `/api/public/escudos/:archivo` | público: solo nombre, municipio y escudo                                      |

- El **documento** se guarda cifrado (AES-256-GCM) y con un hash con clave; nunca se devuelve completo.
- Un **menor de 18** solo queda `habilitado` con `autorizacionAcudiente: true`.
- Dentro de un equipo no se repiten documento ni dorsal. La regla de documento único **por torneo** es de `matches-service` (fase 4).
- Las fotos de jugadores no son públicas: el navegador debe pedirlas con el token y mostrarlas como blob, no con `<img src>` directo.

## Torneos, partidos y posiciones (fase 4)

Con sesión (`/api/matches/...`):

| Ruta                                                                                                                    | Quién                                                                       |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `POST /torneos`, `GET /torneos`, `GET/PATCH /torneos/:id`, `POST /torneos/:id/estado`                                   | crear: cuenta `admin` · gestionar: administradores **de ese torneo**        |
| `GET/POST /torneos/:id/administradores`, `DELETE .../:usuarioId`                                                        | administradores del torneo (agregar por correo; siempre queda al menos uno) |
| `POST /torneos/:id/inscripciones`                                                                                       | delegado, con **su** equipo (queda `pendiente`)                             |
| `GET /torneos/:id/inscripciones`, `POST /inscripciones/:id/aceptar` / `rechazar`                                        | administradores del torneo                                                  |
| `DELETE /inscripciones/:id`, `GET /mis-inscripciones`, `GET /inscripciones/:id/plantilla`                               | delegado dueño o administradores                                            |
| `POST /torneos/:id/grupos`, `.../grupos/generar`, `PUT /inscripciones/:id/grupo`                                        | administradores                                                             |
| `POST /torneos/:id/fixture/generar`, `POST /torneos/:id/partidos`, `PATCH /partidos/:id`, `POST /partidos/:id/cancelar` | administradores                                                             |
| `PUT /partidos/:id/resultado`                                                                                           | administradores (marcador + goles, asistencias y tarjetas)                  |
| `GET /partidos/:id`, `GET /torneos/:id/estadisticas`                                                                    | cualquier usuario con sesión                                                |

Públicas (sin sesión, solo lectura, caché de 5 s): `GET /api/public/torneos`, `/torneos/:id`,
`/torneos/:id/posiciones`, `/torneos/:id/posiciones.xlsx` (Excel) y `/torneos/:id/partidos`.

- Estados del torneo: `borrador` → `inscripciones_abiertas` → `en_juego` → `finalizado` → `archivado`.
- **Documento único por torneo**: lo garantiza un índice en la base. Si dos jugadores comparten documento, el
  segundo queda `en_conflicto` y no puede figurar en partidos. Un menor sin autorización queda `sin_autorizacion`.
- La tabla se recalcula **en la misma transacción** que guarda el resultado. Desempates configurables por torneo
  (`criteriosDesempate`): `diferencia_gol`, `goles_favor`, `goles_contra`, `victorias`, `enfrentamiento_directo`.
- Para probarlo en local sin el broker de eventos (llega en la fase 5), `matches` y `teams` ya tienen
  los manejadores de eventos; el flujo completo se verifica en las pruebas.
