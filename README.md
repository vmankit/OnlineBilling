# Santu Hardware — Billing &amp; Inventory

iPad-first POS and inventory system for **SANTU HARDWARE**, Main Road Ishuwapur, Saran, Bihar 841411.

```
frontend/   React 18 + TypeScript + Vite + Tailwind + TanStack Query (PWA)  → Vercel
backend/    Node 20 + TypeScript + Fastify + node-postgres + Zod (REST)     → Render
            PostgreSQL 15+                                                  → Render
```

---

## Delivery status

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Project setup · database · authentication · layout · items · customers | **Done** |
| 2 | POS · cart · sales invoice · stock deduction · payments · dashboard · A4 invoice | **Done** |
| 3 | Purchase · suppliers · stock ledger · stock adjustments · sales returns | **Done** |
| 4 | Reports · CSV export · A4 + thermal 58/80 mm printing · invoice templates | **Done** |
| 5 | Offline cart · code splitting · integration test suite | **Done** |

Navigation entries for unbuilt modules are shown greyed out with their phase, rather
than linking to empty screens.

Verified end to end against PostgreSQL 17: migrations, seed, and a 57-test suite
covering every rule in the brief. See **Testing** below.

---

## Running locally

### 1. PostgreSQL

Any PostgreSQL 14+ will do. With Docker:

```bash
docker run --name santu-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=santu_hardware -p 5432:5432 -d postgres:16
```

### 2. Backend

```bash
cd backend
cp .env.example .env      # then edit DATABASE_URL and JWT_SECRET
npm install
npm run migrate           # creates the schema
npm run seed              # units, roles, admin user, demo catalogue
npm run dev               # http://localhost:4000
```

The seed prints the admin credentials it created (defaults:
`admin@santuhardware.in` / `Admin@12345` — change `SEED_ADMIN_*` in `.env`
before seeding a real deployment).

### 3. Frontend

```bash
cd frontend
cp .env.example .env      # VITE_API_URL=http://localhost:4000
npm install
npm run dev               # http://localhost:5173
```

---

## Deployment

### Database — Render PostgreSQL

1. Render dashboard → **New → PostgreSQL**, name `santu-hardware-db`.
2. Copy the **Internal Database URL** for the API service.

### Backend — Render Web Service

1. **New → Web Service**, connect this repository, set **Root Directory** to `backend`.
2. Build command `npm ci && npm run build`, start command `npm start`.
3. Environment variables:

   | Key | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | internal URL from the database above |
   | `DATABASE_SSL` | `true` |
   | `JWT_SECRET` | a long random string (Render can generate one) |
   | `CORS_ORIGIN` | your Vercel URL, e.g. `https://santu-hardware.vercel.app` |

4. Health check path: `/health`.
5. Migrations run automatically on boot. Seed once from the Render shell:
   `npm run seed`.

`render.yaml` at the repo root describes all of this as blueprint infrastructure if
you prefer `render.com/deploy`.

### Frontend — Vercel

1. **Add New → Project**, import the repository, set **Root Directory** to `frontend`.
2. Framework preset: Vite. Build `npm run build`, output `dist`.
3. Environment variable `VITE_API_URL` = your Render API URL (no trailing slash).
4. Redeploy after setting `CORS_ORIGIN` on the backend to the Vercel domain.

### Installing on the iPad

Open the Vercel URL in Safari → Share → **Add to Home Screen**. The app then runs
standalone, full-screen, with its own icon.

---

## Architecture notes

**Layering.** React components render; `src/services` owns server state via
TanStack Query; `backend/src/modules/*` own HTTP + validation; `backend/src/services`
own business rules that must not live in a route handler (unit conversion, document
numbering, auditing).

**Money and quantities.** Money is `numeric(14,2)`, quantity `numeric(18,4)`.
Both are parsed into JS numbers at the driver level and rounded through
`utils/number.ts` before they reach the database.

**Units.** Every unit belongs to a dimension (`COUNT`, `WEIGHT`, `VOLUME`,
`LENGTH`) with a factor to that dimension's base unit — `FEET → 0.3048 METER`,
`GRAM → 0.001 KG`. Selling one foot of pipe stocked in metres deducts
0.3048, never 1. Item-scoped rows in `unit_conversions` override the dimensional
maths for relationships with no physical factor ("1 BOX of this item = 12 PCS").

**Packaging variants.** An item carries a stock unit; each `item_variants` row is a
separately sellable pack (1 L / 4 L / 10 L / 20 L) with its own barcode, prices and
stock, and a `pack_size` that says how much of the stock unit one pack consumes.

**Stock.** `stock` holds the current balance; `stock_transactions` is the
append-only ledger behind it. Nothing writes `stock` without writing the matching
ledger row in the same transaction.

**Atomicity.** `withTransaction()` in `backend/src/db/pool.ts` is the only sanctioned
way to write multi-table documents. Invoice + stock + payment succeed together or
not at all.

**History is immutable.** Invoice lines snapshot item name, code, HSN, rate, MRP and
cost at the moment of sale. Changing an item's price later cannot alter a bill that
has already been issued. Price changes are written to `audit_logs` separately from
the item update itself.

**Quotations.** A quotation holds a price open without touching stock or money.
Its lines snapshot the quoted rate, so when it is converted the POS can show
exactly which rates have drifted from the item master and make the operator pick
one — in a dialog that Escape and backdrop clicks cannot dismiss. Conversion locks
the quotation inside the sale's transaction, so the same estimate can never become
two invoices, and the bill carries `quotation_id` back to it.

**Returns.** A return is capped at sold-minus-already-returned, per line, in the
database as well as the UI. Stock goes back in the same proportion it left, so a
part return of a converted line (feet sold from metre stock) stays exact. The refund
clears any outstanding balance on that invoice first; the remainder becomes a cash
refund or a credit note.

**Thermal receipts.** 58 mm and 80 mm receipts follow the shop's own printed
bill: logo, black trade strip, address with GSTIN and phones, a titled document
header, the item table, a bold TOTAL, a UPI Scan & Pay QR, the exchange note and
the terms. Sales and quotations share one layout through `toThermal.ts`, so the
two documents can never drift apart — only the title and the money rows differ.
The GSTIN prints as shop identity; no tax is calculated on any bill.

**Printing.** One invoice renders as A4, 80 mm or 58 mm. `@page` cannot be
selected by an attribute, so `usePrintFormat` injects the page-size rule and sets
`<html data-print-format>` immediately before opening the dialog, then cleans up on
`afterprint`. Thermal sizes use `size: 80mm auto` so a continuous roll is not padded
to a full sheet. PDFs come from the same dialog — AirPrint on iPad, "Save as PDF"
on desktop — which keeps the output identical to what the printer produces.

**Profit.** `sales_invoice_items.cost_amount` snapshots the cost of goods at the
moment of sale. Deriving it later by joining `item_variants` would silently rewrite
last month's margin every time a purchase price or pack size changed.

**Invoice numbering.** `invoice_sequences` is bumped with `UPDATE … RETURNING`
inside the document's own transaction, so two concurrent bills can never collide and
an aborted bill releases its number. Prefixes are configurable and support
`{YYYY}` / `{YY}` / `{MM}`. The default series is `INV-00001` — `SINV` is not used.

---

## Testing

```bash
cd backend && npm test
```

57 tests. The unit tests cover unit conversion and bill arithmetic; the integration
suite in `src/test/workflows.test.ts` runs the whole Fastify stack against a real
PostgreSQL database that is dropped, migrated and seeded on every run — because the
rules worth testing (atomic rollback, row locking, unique invoice numbers) only
exist in the database, and a mocked driver would prove nothing.

Covered: login and credential-enumeration resistance · item and customer creation ·
fuzzy search · barcode lookup · sale with stock deduction · invoice numbering ·
foot-from-metre unit conversion · split payment · partial payment and the customer
ledger · later receipts against dues · purchase raising stock · sales return with
over-return rejection · price-drift detection · historical price immutability ·
**transaction rollback** (a bill with one unsellable line leaves no invoice, no
stock movement and no consumed invoice number) · concurrent invoice numbering ·
cancellation returning stock while the invoice stays on file · role permissions ·
stock adjustment with unit conversion · reports, CSV export and the error envelope.

Point the suite at a different database with `TEST_DATABASE_URL`. It never touches
the shop's data.

## Security

- bcrypt password hashing (cost 12), JWT bearer tokens, role + permission guards.
- Every query is parameterised; Zod validates every request body and query string.
- Helmet security headers, per-route rate limiting (10 login attempts/minute).
- Secrets live only in environment variables. `.env` is git-ignored; `.env.example`
  documents every variable.
- Unexpected errors are logged server-side and returned as a generic message —
  stack traces never reach the browser.

---

## Local database without admin rights

The Windows PostgreSQL service needs elevation to start. If you cannot elevate,
run a private cluster from the same installed binaries — no admin needed, and your
existing install is untouched:

```bash
& "C:\Program Files\PostgreSQL\17\bin\initdb.exe" -D ".pgdata" -U postgres -A trust -E UTF8
```

```bash
& "C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe" -D ".pgdata" -o "-p 5433" -l ".pgdata\server.log" start
```

Then `DATABASE_URL=postgresql://postgres@localhost:5433/santu_hardware`.

`-A trust` means no password on local connections, which is fine for a development
cluster that only listens on localhost. Never use it for the shop's real data —
production runs on managed PostgreSQL with a password and SSL.
