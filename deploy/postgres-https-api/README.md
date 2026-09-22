# PostgreSQL HTTPS API

This optional deployment stack exposes PostgreSQL through an authenticated HTTPS
API for environments that can only make HTTPS requests and cannot speak the
native PostgreSQL wire protocol.

The service itself listens on HTTP port `8000` inside Docker. Public HTTPS is
terminated by Caddy, which routes `/db-api/*` to this container.

## Endpoints

- `GET /v1/health`
- `GET /v1/schema`
- `POST /v1/query`

Authenticate with either header:

```http
Authorization: Bearer <DB_API_KEY>
X-DB-API-Key: <DB_API_KEY>
```

## Deploy

Create a dedicated PostgreSQL role first. Example:

```sql
create role db_api_user login password '<strong-password>';
grant connect on database appdb to db_api_user;
grant usage, create on schema public to db_api_user;
grant select, insert, update, delete, truncate, references, trigger on all tables in schema public to db_api_user;
grant usage, select, update on all sequences in schema public to db_api_user;
grant execute on all functions in schema public to db_api_user;
```

Then create `.env` from `.env.example` and start the service:

```bash
cp .env.example .env
docker compose up -d --build
```

Route it through Caddy:

```caddy
handle_path /db-api* {
	reverse_proxy local-db-api:8000
}
```

## Query Example

```bash
curl -sS https://miantuan.ai/db-api/v1/query \
  -H "Authorization: Bearer $DB_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"sql":"select current_database() as db, current_user as user","readonly":true}'
```

`readonly: true` opens a read-only transaction and rolls back at the end of the
request. For writes, omit it or set it to `false`.

Verified 2026-08-05: with `readonly: true`, an `INSERT` is rejected and the table
is left untouched. The rejection surfaces as a bare `500 Internal Server Error`
with no detail — see "Known rough edge" below.

## Two ways for the application to reach the database

**TCP, when the app can open port 5432.** The application and PostgreSQL share a
Docker network, so the app connects directly and never touches Caddy:

```
APP_STORE_DATABASE_URL=postgresql://db_api_user:<password>@local-postgres:5432/appdb?sslmode=require
```

Use `db_api_user`, not `postgres_admin`: the admin role can create and drop
databases, which the application never needs.

**This API, when it cannot.** Restricted sandboxes, serverless and edge runtimes
often allow nothing but outbound 443. Since 2026-08-05 the application speaks
this API's JSON shape directly:

```
APP_STORE_HTTP_API_URL=https://miantuan.ai/db-api
APP_STORE_HTTP_API_KEY=<token>
```

When set, this takes priority over `APP_STORE_DATABASE_URL` — in an environment
that reaches the database this way, the TCP probe below it is pure waiting
(one connect attempt per resolved address, 4s each).

An earlier version of this file said the application could never use this API,
because `services/app_store.py` only had a Neon-specific `*.neon.tech` HTTP
fallback. That is no longer true: `HttpSqlGateway` in the same file speaks this
API's shape, and all three stores go through it.

## One database, three stores

Whichever channel you pick, it carries **three** stores, not just the app store:

| Store | What it holds |
|---|---|
| App store (`services/app_store.py`) | generated apps, previews, grants |
| Identity (`services/identity_store.py`) | users, email codes, revoked tokens |
| Session blobs (`services/session_blob_store.py`) | session state |

So switching databases is a one-line change — but it moves user accounts and
sessions too. There is no separate identity DSN to forget about, and equally no
way to keep identity on the old host while apps move.

⚠️ **Pointing a dev machine at a shared database uploads that machine's local
sessions.** `session_blob_store.import_local_file_once` copies every session in
the local file archive that the database doesn't already have, once per process,
on startup. It exists for a good reason — without it, upgrading to the
database-backed store makes existing sessions vanish from the UI while still
sitting on disk. But the direction is local → shared, and it fires the first
time a developer sets these variables. Observed 2026-08-05: a dev container's
first startup against the shared database pushed 18 sessions (~3 MB) in nine
seconds. It only ever inserts, never overwrites, so nothing shared is damaged —
but the rows are there and nobody asked for them. Clear `SLIDERULE_SESSIONS_FILE`
(or point it at a scratch path) before connecting a machine that has an
accumulated local archive.

⚠️ Configuring only *part* of a channel is the dangerous state. Before
2026-08-05 the gateway was wired to the app store alone, so setting
`APP_STORE_HTTP_API_URL` while leaving `APP_STORE_DATABASE_URL` empty sent apps
to this API and silently dropped accounts and sessions into a local SQLite file.
Nothing errored. The symptom was "accounts work, but not from another machine".

## Placeholder dialect

This API runs `cur.execute(sql, params)` through psycopg, which is DB-API
`format` paramstyle: `%s`, positional, no reuse. The application's SQL is
written in Postgres numbered style (`$1`, `$2`) because it is shared with the
Neon HTTP backend. `HttpSqlGateway` converts on the way out — and it rewrites
the **parameter list** as well as the text, because `$3, $3` (one value used
twice) has to become two `%s` and two copies of that value. Converting the text
alone yields "the server expected 4 arguments, 3 were given".

## Schema

Tables are created by the application itself (`create table if not exists` in
each store's `_DDL_PG`). Seven tables in `public`:

```
generated_app  generated_app_preview  generated_app_grant
sliderule_user  sliderule_email_code  sliderule_revoked_token
sliderule_session
```

If you pre-create them, copy the DDL verbatim from the `_DDL_PG` constants. A
hand-written variant that merely looks equivalent will pass `create table if not
exists` and then fail at runtime, once rows are already in the table. After
creating them, verify **column names per table** — a wrong column name still
returns `ok`.

## History: migrated off Neon, 2026-08-05

The previous store was Neon. It began returning HTTP 402 on every statement —
`select 1` included — with `"Your project has exceeded the data transfer quota"`.
The likely driver of that quota burn is `generated_app_preview.png_b64`: one
base64 reference image per app, tens to hundreds of KB each, read back on every
gallery load.

The existing data was **abandoned by decision, not migrated** — the source was
unreadable, so there was nothing to copy. The new database started empty.

Two things worth carrying forward:

- **Watch the preview table's egress**, not just its size. It is the reason a
  managed-Postgres transfer quota ran out.
- **A quota block is silent to users.** Every store here is fail-open and
  degrades to local SQLite or JSON when the remote is unreachable, so a dead
  database looks like "the app gallery is empty", not like an error.

## Known rough edge: fixed in code, not yet deployed

`/v1/query` returns a bare `500 Internal Server Error` for any SQL failure —
syntax error, permission denied, statement timeout, read-only violation all look
identical from the client side. Nothing leaks, but nothing diagnoses either.

`app.py` now catches `psycopg.Error` and returns
`400 {"detail": "<sqlstate>: <message>"}` (`_pg_error_detail`). PostgreSQL error
messages carry no row data, so returning them is safe.

**The running container predates that change.** Verified 2026-08-05: a query
against a non-existent table still comes back as a bare `500`. Redeploy to pick
it up:

```bash
docker compose up -d --build
```

Until then, treat any `500` from this API as "some SQL error" and reproduce the
statement locally to find out which.
