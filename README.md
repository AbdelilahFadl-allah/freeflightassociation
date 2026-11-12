# Vol'ubilis association system

Responsive association administration in French, Arabic (RTL) and English. The application
provides member profiles and activation; activity participants and tandem flights; equipment
registers and loans; goods stock, paid sales and purchases; cash and bank ledgers; and
individual WhatsApp notifications with consent tracking. Reports support CSV export and
reference printouts. Passenger health answers are intentionally not stored.

**Deployment status:** This is a locally tested implementation, not a deployed or certified
production service. Entra authentication, Azure-hosted PostgreSQL, Azure networking,
backup/restore, the WhatsApp provider, complete translations and association-approved print
layouts still need integration and operational verification in the intended environment.
The printouts are reference drafts, not completed health declarations or legally validated
forms. Do not rely on the application for flight-safety clearance.

## Requirements and local setup

- Node.js 22.12 or later and npm.
- PostgreSQL and a database dedicated to this project.
- A Microsoft Entra tenant, a SPA app registration and a separate API app registration.
  Configure the API to issue **v2 access tokens**, expose a delegated `access_as_user` scope,
  authorize the SPA for that scope and grant the necessary consent. Configure the local Vite
  origin as a SPA redirect URI. Invite guest administrators into this tenant where needed.
- The tenant object ID of the initial special administrator.

Copy `.env.example` to `.env` and set the database URL, tenant ID, API and SPA client IDs,
API audiences, delegated scope and initial special administrator object ID.
`ENTRA_API_AUDIENCES` must contain the actual `aud` value of API access tokens; the Vite
scope is the full delegated scope URI. The bootstrap ID is the user's object ID in this
tenant, including for a guest. Never commit `.env` or credentials.

**Before running migrations:** migration `011_flight_sites.sql` irreversibly deletes all
existing flight activities and their participant and tandem records in every database where
it first runs. Before applying it to any database other than disposable test data, create
and verify a backup and follow an approved maintenance procedure. Other association records
are not deleted. A transactional marker prevents subsequent migration runs from repeating
the reset.

```powershell
npm install
npm run db:migrate
npm run dev:api
```

In another terminal:

```powershell
npm run dev
```

Open the Vite URL and sign in. The special administrator can grant ordinary administrator
access by tenant object ID, deactivate/reactivate accounts, archive members and view recent
audit entries. Ordinary administrators cannot perform these actions. No general hard-delete
endpoint is provided. One special administrator is enforced in the database.

For a production-style local start, set the three `VITE_ENTRA_*` values **before** running
`npm run build`, then set `NODE_ENV=production` and run `npm start`; the API serves the
built frontend on `PORT`. The Vite values are public build-time configuration, never secrets.
Always require HTTPS, use a protected database connection and restrict database/network
access. Configure an Entra redirect URI matching the actual public application origin.

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

The map uses the open-source Leaflet library and online OpenStreetMap community tiles with
attribution. Internet access is required for tiles, and tile requests disclose the browser's
IP address and viewed map area to the tile service. Coordinate entry remains available if
tiles fail. The public tile service is not an unlimited production SLA: comply with its
[tile usage policy](https://operations.osmfoundation.org/policies/tiles/) and use a suitable
tile provider for heavier or production use. Map coordinates and polygons are planning aids,
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
and Entra redirect URIs. These choices do not deploy resources or replace Entra sign-in.
Review each provider's current terms and data location before storing real association data.

## Verification and release checklist

`npm run build` type-checks and builds the frontend. `npm test` covers API behavior using
fake authentication/provider and a PostgreSQL emulator, plus PostgreSQL-engine tests with
PGlite for constraints, signed JWT validation and transactional rollback/corrections. It also
starts a temporary native PostgreSQL server on loopback and checks concurrent sales, loans,
corrections and receipt numbering over multiple connections. The native test needs a supported
platform, permission to run PostgreSQL and bind a local port, and a writable temporary directory;
PostgreSQL cannot run as root. The test stops the server and removes its temporary data.
These checks do not substitute for testing the actual Entra tenant and Azure environment.

Before deploying, confirm the Azure subscription, region and budget; configure App Service,
managed PostgreSQL, secure network access, secret storage, monitoring, Entra MFA and least
privilege. The database migration is transactional and should be run as a separate,
controlled deployment step. Azure PostgreSQL provides automated backups and point-in-time
recovery; configure retention and practice restoration to a separate server. Review and test
the administrator recovery procedure, data retention and applicable Moroccan privacy rules.
The bootstrap operation does not reactivate an existing account; changing the bootstrap ID
does not automatically transfer the special role. Role recovery requires an authorized
database administrator and a reviewed, audited procedure.

Production tests remain necessary for real token issuance, tenant guests, Azure deployment,
concurrency under the intended production workload, backups/restoration, provider
delivery/callbacks, responsive accessibility and all translated print layouts. No live
messages, cloud resources or external account changes are created by the local tests.
