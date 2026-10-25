# inv-mgmt-icmr · Store register

Internal inventory management: stock as an append-only ledger across locations,
low-stock alerts, and a signed request workflow (submit → review → approve →
hand over). Dynamic role-based access, two-factor sign-in for everyone, and a
full audit log.

Stack: Next.js 16 (App Router) · TypeScript · Tailwind v4 · Supabase (Postgres,
Auth with TOTP MFA, RLS) · Netlify.

## How access works

| Role (default)  | Can                                                            |
| --------------- | -------------------------------------------------------------- |
| Admin (hidden)  | Create accounts, assign roles, edit roles, read the audit log  |
| Super User (1)  | Approve / modify / reject reviewed requests; manage accounts   |
| Validator       | Review requests (recommend / not), raise requests              |
| Store Manager   | Catalog, stock movements, hand items over, raise requests      |
| User            | View inventory, raise and follow own requests                  |

Roles are rows in `inventory.roles`; each holds a set of permission keys. Admin
and Super User are locked system roles. Anyone with `roles.manage` can create new
roles or re-mix the others from the Roles page. Every rule is enforced in the
database (RLS + security-definer functions), not only in the UI.

Every member must complete authenticator-app MFA; without it the database
returns nothing except their own profile row.

## Run it offline (Docker)

Everything runs on your machine: Postgres, Supabase Auth (with authenticator
codes), the Data API, a mail catcher and the app. The same migrations and
row-level security as production; nothing points at the hosted project.

```bash
docker compose up --build        # first run: a few minutes
```

| Open                    | What                                             |
| ----------------------- | ------------------------------------------------ |
| http://localhost:3000   | the app                                          |
| http://localhost:8025   | Mailpit: invite and password-reset emails land here |
| localhost:54322         | Postgres (`postgres` / `offline-dev-postgres-password`) |

Demo accounts, all with password `Inventory-Demo-2026`:

| Email                         | Role          |
| ----------------------------- | ------------- |
| admin@inventory.local         | Admin (hidden)|
| super@inventory.local         | Super User    |
| validator@inventory.local     | Validator     |
| store@inventory.local         | Store Manager |
| anil@ / sneha@ / kevin@inventory.local | User |

Each account sets up its authenticator on first sign-in (scan the QR with
Google Authenticator, or click "Can't scan? Show the key"). The seed adds 6
categories, 4 locations, 32 items, six weeks of stock movements and 18 requests
at every stage of the workflow, all with a real audit trail.

- Start over with fresh data: `docker compose down -v && docker compose up`
- Behind a proxy that intercepts HTTPS (npm fails with `SELF_SIGNED_CERT_IN_CHAIN`),
  build the two images with your proxy's CA, then start without rebuilding:
  ```bash
  docker build --secret id=npm_ca,src=ca.pem -t inv-mgmt-offline-setup docker/setup
  docker build --secret id=npm_ca,src=ca.pem -f docker/app/Dockerfile -t inv-mgmt-offline-app \
    --build-arg NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000 \
    --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<ANON key from docker-compose.yml> .
  docker compose up --no-build
  ```
- All secrets in `docker-compose.yml` are throwaway local values. Never use
  them for a real deployment.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in from Supabase → Settings → API
npm run dev
```

The app reads the `inventory` schema. In Supabase → Settings → API → **Exposed
schemas**, add `inventory` (one-time).

### Database

Migrations live in `supabase/migrations/` and are applied to the project in
order. To run the test suite against a scratch Postgres:

```bash
supabase/tests/run.sh        # needs a local psql as the postgres superuser
```

### First admin

Accounts are never self-registered. Bootstrap the first Admin once, in the
Supabase SQL editor, after creating the auth user (Authentication → Users →
Invite):

```sql
insert into inventory.profiles (id, email, full_name, role_id)
select u.id, u.email, 'Your Name', r.id
from auth.users u, inventory.roles r
where u.email = 'you@company.com' and r.key = 'admin';
```

From then on, people are added from the People page.

## Deployment (Netlify)

Set the four environment variables from `.env.example` in the Netlify site
settings. `SUPABASE_SERVICE_ROLE_KEY` is secret: it is used only in
`src/app/(app)/people/actions.ts` to create accounts, ban deactivated users and
reset authenticators, and every such call is written to the audit log.

In Supabase → Authentication → URL configuration, add the site URL and
`https://<site>/auth/callback` to the redirect allow-list.

## Backups

`.github/workflows/db-backup.yml` dumps the `inventory` schema nightly,
encrypts it with [age](https://age-encryption.org) and keeps it as a 90-day
workflow artifact. It needs two repository secrets: `SUPABASE_DB_URL` and
`BACKUP_AGE_PUBLIC_KEY`. The matching private key stays offline with the owner.
