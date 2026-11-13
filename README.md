# Vol'ubilis association system

Responsive association administration in French, Arabic (RTL) and English. The application
provides member profiles and activation; activity participants and tandem flights; equipment
registers and loans; goods stock, paid sales and purchases; cash and bank ledgers; and
individual WhatsApp notifications with consent tracking. Reports support CSV export and
reference printouts. Passenger health answers are intentionally not stored.

**Deployment status:** This is not a deployed or certified production service. Supabase
integration, hosted PostgreSQL, backup/restore, WhatsApp delivery and association-approved
print layouts require operational verification. The planned in-app administrator creation
and WhatsApp account-setup/reset link delivery are **not implemented**. Do not deploy for
real users until those workflows and the recovery procedure have been completed and tested.
The printouts are reference drafts, not completed health declarations or legally validated
forms. Do not rely on the application for flight-safety clearance.

## Setup and deployment guides

The following official guides complement the app-specific instructions below. Use isolated
test accounts and fictional data; no deployment or live messages are performed by these
instructions.

- **Test environment (Render + Neon):** follow Render's
  [Node/Express deployment guide](https://render.com/docs/deploy-node-express-app),
  [environment-variable instructions](https://render.com/docs/configure-environment-variables)
  and [free-instance limitations](https://render.com/docs/free). Create a separate Neon
  database and obtain its TLS connection string using
  [Neon's connection guide](https://neon.com/docs/connect/connect-from-any-app). For this
  app, use `npm ci && npm run build` as the build command, `npm start` as the start command,
  and set `NODE_ENV=production` and the variables described in
  [Requirements and local setup](#requirements-and-local-setup). Set both public
  `VITE_SUPABASE_*` values at build time. Run migrations separately and observe the
  destructive migration warning below; do not use an existing database without a verified
  backup and an approved maintenance decision.
- **Supabase accounts and sign-in:** see
  [Supabase Auth](https://supabase.com/docs/guides/auth),
  [administrator user creation](https://supabase.com/docs/reference/javascript/auth-admin-createuser),
  [JWT signing keys](https://supabase.com/docs/guides/auth/signing-keys),
  [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), and
  [authenticator-app MFA](https://supabase.com/docs/guides/auth/auth-mfa/totp). Follow
  [Requirements and local setup](#requirements-and-local-setup) to configure the project
  and bootstrap the first special administrator. The administrator user-creation API
  requires a server-side secret; never expose that key in the browser.
- **WhatsApp:** start with Twilio's
  [WhatsApp quickstart](https://www.twilio.com/docs/whatsapp/quickstart),
  [test sandbox](https://www.twilio.com/docs/whatsapp/sandbox) and
  [template approval guide](https://www.twilio.com/docs/whatsapp/tutorial/send-whatsapp-notification-messages-templates).
  Then follow [WhatsApp setup and operation](#whatsapp-setup-and-operation) for this app's
  configuration, consent and manual-dispatch requirements. The sandbox is for testing only;
  real delivery requires provider setup and must not be initiated without authorization.

## Requirements and local setup

- Node.js 22.12 or later and npm.
- PostgreSQL and a database dedicated to this project.
- A Supabase project with asymmetric JWT signing keys and an email/password provider.
  Use a separate Supabase project and database for each environment. Disable public signup,
  enable TOTP enrollment and verification, and disable other sign-in/MFA methods unless
  reviewed. The API accepts only signed authenticated-user JWTs with AAL2 and a `totp`
  authentication method; older projects using only legacy HS256 keys must first enable
  asymmetric signing. Set a short, appropriate JWT lifetime in Supabase; the API verifies
  tokens locally and provider-side session revocations are not immediate.
- A manually created, email-confirmed Supabase user for the initial special administrator.

Copy `.env.example` to `.env`. Set `DATABASE_URL`, the HTTPS project origin in both
`SUPABASE_URL` and `VITE_SUPABASE_URL`, and the project's public anon/publishable key in
`VITE_SUPABASE_ANON_KEY`. The two URLs must identify the same project. Never put a
service-role key in a `VITE_` variable. Never commit `.env` or credentials.

Configure Supabase's Site URL and exact allowed redirect URLs for each environment. Serve
the app over HTTPS outside local development. Use only a trusted, isolated test project for
testing; these settings do not disable Supabase signup automatically. Verify signup is
disabled in its dashboard.

**Before running migrations:** migration `011_flight_sites.sql` irreversibly deletes all
existing flight activities and their participant and tandem records in every database where
it first runs. Before applying it to any database other than disposable test data, create
and verify a backup and follow an approved maintenance procedure. Other association records
are not deleted. A transactional marker prevents subsequent migration runs from repeating
the reset.

```powershell
npm install
npm run db:migrate
npm run admin:bootstrap
npm run dev:api
```

Before `admin:bootstrap`, set `SUPABASE_SERVICE_ROLE_KEY` and
`BOOTSTRAP_ADMIN_USER_ID` to the server-side service-role key and the UUID of the
manually created, email-confirmed user in that same project. The command verifies the
account using Supabase and inserts a special administrator only when the administrators
table is empty. It never replaces or reactivates an existing administrator; rerunning it
fails. Remove the bootstrap credential from the app environment afterwards. Migrations do
not bootstrap users.

In another terminal:

```powershell
npm run dev
```

Open the Vite URL and sign in with email and password. Enroll a TOTP authenticator on first
use, then enter its six-digit code at each sign-in. The special administrator can grant
ordinary administrator access by the UUID of an **already created** Supabase user,
deactivate/reactivate accounts, archive members and view recent
audit entries. Ordinary administrators cannot perform these actions. No general hard-delete
endpoint is provided. One special administrator is enforced in the database.

The current UUID form only authorizes an existing identity; it does not create an account,
verify a phone, or send setup links. A Supabase user not present and active in the
association database is denied access even with a valid token. Account setup/reset links
through Twilio, explicit phone verification and reconciliation of uncertain sends remain
unimplemented; do not send passwords in WhatsApp. Supabase's default email service has
restricted delivery and is not a production onboarding solution.

For a production-style local start, set both `VITE_SUPABASE_*` values **before** running
`npm run build`, then set `NODE_ENV=production` and run `npm start`; the API serves the
built frontend on `PORT`. The Vite values are public build-time configuration, never secrets.
Always require HTTPS, use a protected database connection and restrict database/network
access. Configure exact Supabase redirect URLs for the actual public application origin.

## Using the application

- Choose a module from the centered main menu; use Home to return. Unsaved form changes
  prompt for confirmation before leaving.
- Site Team or Security Manager permissions, independently assigned to administrator accounts
  by the special administrator, allow creating and editing site sheets. Security Managers
  can sign and validate; the special administrator has all site permissions and alone can
  archive sites. Other administrators can view sites but not change them.
- Select the takeoff point on the map or enter its coordinates. Record the site-sheet details,
  wind directions and primary or emergency landing zones. Draw each landing polygon with
  4–7 distinct, non-crossing vertices; use the coordinate fields for keyboard entry.
  Previously recorded landing points remain visible as references, but every retained zone
  must be converted to a polygon before saving the site.
- A site may be saved without landings, but security validation requires at least one valid
  landing, a drawn signature and explicit confirmation. The validation records the signer
  and time; changing site details clears it and requires a new signature. The recorded
  drawing is not a certified digital signature. Site status and validation do not guarantee
  safe conditions or permission to fly.
- New and edited planned flights require an unarchived, open **and validated** site. Existing
  sites become unvalidated after the migration, while existing flight records remain intact.
  Assign site permissions and validate sites before staff need to create or edit flights.
  Flights begin as Planned;
  an administrator can mark them Done or Cancelled. Both statuses are final: only additional
  timestamped notes may be appended afterwards. Flight records retain a site-name snapshot.
- Member records include contact, emergency contact, qualification, licence and insurance
  details; deactivation retains history. Flight participants and borrowers can be members
  or non-members. Participant names are snapshots. Flight edits create revisions and reject
  a stale version; they do not erase old participant records.
- Confirm the Casablanca UTC offset shown when entering an activity, especially around time
  changes; the API checks the supplied offset against its own time-zone database. Keep both
  browser and server time-zone data current.
- Set an explicit opening balance, date and description for each account before recording
  transactions for that account. The opening balance can be set only once; document later
  corrections using a separate ledger entry. Prices and amounts are in MAD with two decimal
  places. Sales and purchases are paid in full immediately. Stock must not become negative.
- A correction uses a linked reversal and a complete replacement in one transaction. A
  reversal can also be recorded separately to cancel an operation. A purchase reversal can
  be blocked if the purchased goods have already been sold; correct stock first using a
  documented adjustment. A reversed receipt remains in the history and is marked reversed.
- Reports can be filtered and exported as CSV. Exported data may contain personal data;
  protect downloaded files. The print action opens a separate print window; allow popups.
  The reference printouts must be checked against the original annexes and approved by the
  association before operational use.

The map uses the open-source Leaflet library and online OpenStreetMap community tiles by
default. The map layer selector also offers OpenTopoMap terrain tiles, including contours
and shaded relief; attribution is shown on the map. Internet access is required, and tile
requests disclose the browser's IP address and viewed map area to the selected tile service.
Coordinate entry remains available if tiles fail. The public tile services do not offer an
unlimited production SLA: comply with the [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
and [OpenTopoMap usage terms](https://opentopomap.org/about), and use a suitable provider for
heavier or production use. Map coordinates and polygons are planning aids,
not a substitute for on-site assessment.

Before applying the site-validation migration to a non-disposable database, take and verify a
backup. Migrations are replayed; existing landing points and flight history are retained,
and no landing polygon is fabricated automatically.

## WhatsApp setup and operation

WhatsApp is disabled unless all five `TWILIO_*` / `WHATSAPP_TEMPLATES_JSON` settings in
`.env.example` are supplied. This implementation uses Twilio's official WhatsApp integration,
an enabled WhatsApp Business sender and approved **no-variable** Content Templates. Obtain
the account, verification, sender, opt-in and template approvals separately and review provider
fees and messaging policy. Example template configuration (replace the placeholder SID):

```text
WHATSAPP_TEMPLATES_JSON=[{"id":"notice-fr","label":"Avis français","contentSid":"HX00000000000000000000000000000000"}]
```

Set `TWILIO_WHATSAPP_FROM` to `whatsapp:+` followed by the sender's international number.
Set `TWILIO_CALLBACK_BASE_URL` to the public HTTPS origin of the application, with no path
or query; it must be reachable by Twilio for authenticated status callbacks. Store the auth
token in a managed secret store, not in source control or client configuration. The system
sends separate messages to opted-in members, not messages to a WhatsApp group. Member
numbers must use international E.164 format, such as `+212...`.

The administrator records evidence of opt-in or opt-out, chooses a template and recipients,
creates a batch, reviews exclusions and explicitly dispatches it. Dispatch sends up to ten
queued messages per action; repeat for remaining queued recipients. Eligibility is checked
again before sending. A provider timeout or interrupted send can have an **unknown** outcome:
never automatically retry it. A special administrator can mark a stuck `sending` recipient
as unknown after checking provider records. Reconcile manually before deciding whether to
create a new batch, since a duplicate message may otherwise result. Status callbacks are
signature-checked; use a real approved template and opt-in for any explicitly authorized
live test.

The special administrator can configure administrator WhatsApp contacts and event settings
in the WhatsApp screen. Each contact is an existing administrator account, with an E.164
number and recorded consent or opt-out evidence; administrators do not need to be members.
For each event, choose an approved no-variable Twilio template and enable that event. All
event settings start disabled. Creating a planned flight, buying or selling goods, adding or
archiving flying gear, and recording financial operations queue individual administrator
notifications in the same database transaction. Corrections and reversals also create a
financial event. A goods trade produces one goods notification, or a financial notification
if goods notifications are disabled, rather than duplicate messages.

Event batches are **not sent automatically**: review and dispatch them on the WhatsApp
screen. A disabled or missing consent, inactive administrator or changed phone number causes
exclusion; eligibility is rechecked when dispatching. Only the special administrator can
change event settings, manage administrator contacts, or archive gear. Gear on an open loan
cannot be archived. This is individual messaging, not an actual WhatsApp group chat.
Templates contain no transaction variables; administrators should consult the app for details.

## Hosting choices

For testing, the intended hosting choice is Render's free web service with Neon's free
PostgreSQL. Both may sleep when idle, and free-tier usage and recovery limits apply; use
fictional data. For live use, Railway is the intended hosting provider, subject to confirming
its cost, region, PostgreSQL persistence, backup and restoration, monitoring, HTTPS, secrets
and Supabase redirect URLs. No resources are provisioned by this repository.
Review each provider's current terms and data location before storing real association data.

## Verification and release checklist

`npm run build` type-checks and builds the frontend. `npm test` covers API behavior using
fake authentication/provider and a PostgreSQL emulator, plus PostgreSQL-engine tests with
PGlite for constraints, signed JWT validation and transactional rollback/corrections. It also
starts a temporary native PostgreSQL server on loopback and checks concurrent sales, loans,
corrections and receipt numbering over multiple connections. The native test needs a supported
platform, permission to run PostgreSQL and bind a local port, and a writable temporary directory;
PostgreSQL cannot run as root. The test stops the server and removes its temporary data.
These checks do not substitute for testing the actual Supabase and hosting environments.

Before deployment, complete the missing onboarding flow; verify project isolation, signup
settings, MFA and HTTPS; configure database TLS, secure network access, secret storage,
monitoring and tested backups. Run migrations as a separate controlled step and follow the
destructive migration warning above. Review data retention and applicable privacy rules.
For lost credentials or an authenticator, a trusted Supabase project operator must verify
identity out of band and use the provider's administrative recovery controls. Disable
association access while resolving the incident, revoke sessions, remove the lost factor
through provider administration if appropriate, restore access and require new TOTP
enrollment. The special administrator is protected from app-side disablement; its recovery
requires an authorized database operator and an independently reviewed, audited procedure.
Test this procedure before relying on it.

Production tests remain necessary for real token issuance, Supabase deployment,
concurrency under the intended production workload, backups/restoration, provider
delivery/callbacks, responsive accessibility and all translated print layouts. No live
messages, cloud resources or external account changes are created by the local tests.
