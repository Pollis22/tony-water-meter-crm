# Tony's Territory — Water Meter CRM

A Salesforce-style CRM purpose-built for **Tony Robertson**, EJP Sales territory rep covering East Michigan municipal water and public works departments. Tracks 103 prospect accounts across 22 Michigan counties, scores them by revenue potential, and plans optimized field-sales routes.

## What it does

- **103 pre-loaded accounts** — every Michigan municipality with a water meter footprint, geocoded, with endpoint counts, county, tier, and AI-generated sales insights.
- **0–100 priority score** per account based on tier (T1 > T2 > T3), endpoint volume, and AMI/NRW/enterprise signals — with a "why this score" explanation on every record.
- **Route Planner** — multi-select accounts on a Leaflet map, OSRM nearest-neighbor optimization, save named routes, export to Google Maps, print itinerary.
- **Pipeline management** — Kanban board for opportunities (Discovery → Closed Won/Lost), tasks, notes, and contacts across the full territory.
- **Reports** — KPIs, county-level pipeline, CSV export of every account.

## Tech stack

- **Frontend**: React 18 + TypeScript, Vite, Tailwind CSS, shadcn/ui, TanStack Query, wouter (hash routing), Leaflet/react-leaflet, Recharts
- **Backend**: Node + Express
- **Database**: SQLite via better-sqlite3 + Drizzle ORM
- **Routing**: Public OSRM API for road-network optimization
- **Geocoding**: Pre-baked lat/lng (Nominatim) for all 103 seed accounts

## Quick start

```bash
npm install
npm run dev
```

The dev server runs Express + Vite on `http://localhost:5000`. The database (`data.db`) is auto-seeded with 103 accounts on first start.

## Production build

```bash
npm run build
NODE_ENV=production node dist/index.cjs
```

Static client is emitted to `dist/public`; server bundle is `dist/index.cjs`.

## Project structure

```
client/src/
  pages/          # Dashboard, Accounts, AccountDetail, RoutePlanner,
                  # Tasks, Notes, Contacts, Opportunities, Reports, Settings
  components/     # AppLayout, sidebar, top bar, shadcn/ui primitives
  lib/            # queryClient, utils
server/
  index.ts        # Express bootstrap + Vite middleware
  routes.ts       # /api/accounts, /api/notes, /api/tasks, /api/optimize-route, ...
  storage.ts      # Drizzle storage layer
  seed.ts         # 103-account seed (runs on empty DB)
shared/
  schema.ts       # Drizzle tables + Zod schemas (single source of truth)
```

## Data model

- `accounts` — municipality, county, tier, endpoints, score, status, priority, follow-up date, AI insight, lat/lng
- `contacts` — primary + extras per account
- `tasks` — global task list, optional accountId
- `notes` — global notes, optional accountId
- `activities` — audit trail
- `opportunities` — deal stage, amount, close date
- `routes` — saved named routes (ordered stop list, distance, drive time)

## Scoring model (0–100)

| Component        | Weight | Notes                                                       |
| ---------------- | ------ | ----------------------------------------------------------- |
| Tier             | 40     | T1 = 40, T2 = 25, T3 = 12                                   |
| Endpoint volume  | 35     | log-scaled against territory max                            |
| Enterprise / AMI | 15     | flagged when meter count + AMI/NRW signals indicate upgrade |
| Recency / status | 10     | nurture / contacted / proposal weighting                    |

The "why this score" string is rendered on each account detail page.

## AI sales insights

Each account ships with a brief, fact-grounded insight. Where source data is unavailable, the insight explicitly says **"unknown"** rather than fabricating a hard fact.

## Deployment

This project is deployed to Perplexity's `pplx.app` hosting. The Vite client is served from S3; the Express backend (port 5000) handles `/api/*` calls via proxy. SQLite persists across redeploys when the db file is named `data.db` in the project root.

## License

Internal use — EJP Sales / Tony Robertson territory.
