# ResQ

ResQ is a disaster response and resource allocation platform. MongoDB Atlas is
the authoritative store for durable records and road status, Redis stores
derived rapidly changing operational state, and Neo4j AuraDB holds a derived
district response graph. The backend provides
authenticated REST APIs and Socket.IO events for incidents, facilities,
resources, allocations, and alerts.

## Structure

```text
backend/    Express API and Socket.IO server
frontend/   React, Vite, Tailwind CSS, React Router, and Leaflet
database/   Database design notes and future setup assets
scripts/    Future setup and data seeding scripts
```

## Requirements

- Node.js 20 or newer
- npm

## Configure

Copy `backend/.env.example` to `backend/.env` and
`frontend/.env.example` to `frontend/.env`. The frontend API URL and backend
port have local defaults. Replace the example `MONGODB_URI` in `backend/.env`
with your MongoDB Atlas connection string and set a random `JWT_SECRET` of at
least 32 characters. The local `.env` is ignored by Git. Self-registration is
limited to `CITIZEN` and `VOLUNTEER`; elevated roles are assigned through
account administration.

## Install

```sh
cd backend && npm install --cache ../.npm-cache
cd ../frontend && npm install --cache ../.npm-cache
```

## Run the backend

```sh
cd backend
npm run dev
```

The health endpoint is available at <http://localhost:4000/api/health>.
Protected API routes require `Authorization: Bearer <token>` from the login or
registration response.

## REST API

| Area | Endpoints |
| --- | --- |
| Auth | `POST /api/auth/register`, `POST /api/auth/login` |
| Incidents | `POST /api/incidents`, `GET /api/incidents`, `GET /api/incidents/search?q=`, `GET /api/incidents/:id`, `PATCH /api/incidents/:id`, `PATCH /api/incidents/:id/status`, `DELETE /api/incidents/:id` |
| Facilities | `GET /api/facilities`, `GET /api/facilities/nearby`, `GET /api/facilities/search?q=`, `GET /api/facilities/:id`, `POST /api/facilities`, `PATCH /api/facilities/:id`, `DELETE /api/facilities/:id` |
| Resources | `GET /api/resources`, `POST /api/resources`, `PATCH /api/resources/:id`, `DELETE /api/resources/:id` |
| Allocations | `GET /api/allocations`, `GET /api/allocations/:id`, `POST /api/allocations`, `PATCH /api/allocations/:id` |
| Alerts | `GET /api/alerts`, `POST /api/alerts`, `PATCH /api/alerts/:id/expire`, `DELETE /api/alerts/:id` |
| Analytics (aggregation) | `GET /api/analytics/dashboard`, `/incidents/by-type`, `/incidents/by-severity`, `/incidents/by-status`, `/incidents/by-zone`, `/incidents/trend`, `/incidents/size-buckets`, `/zones/hotspots`, `/facilities/nearest`, `/facilities/utilization`, `/resources/availability`, `/resources/low-stock`, `/allocations/by-status`, `/allocations/response-times`, `/responders/skills` |
| Database introspection | `GET /api/analytics/indexes`, `GET /api/analytics/explain`, `GET /api/analytics/explain/:name`, `GET /api/analytics/redis` |
| Dispatch | `GET /api/dispatch/candidates/:incidentId` |
| Roads | `GET /api/roads`, `GET /api/roads/:roadId`, `POST /api/roads`, `PATCH /api/roads/:roadId`, `PATCH /api/roads/:roadId/status`, `DELETE /api/roads/:roadId` |

List endpoints accept `page` and `limit` query parameters (maximum limit: 100).
The backend validates payloads, applies role checks, and returns JSON errors
with appropriate HTTP status codes.

Dispatch candidates are limited to `RESCUE_LEAD`, `AUTHORITY`, and `ADMIN`
accounts. The service traverses up to four `OPEN` road links, filters for
operational facilities with the incident's requested stock/capacity, and finds
available responders with no active graph assignment. The backend ranks and
returns up to five facilities and responders by travel time. Neo4j must be
configured and seeded with `npm run seed:neo4j` before this endpoint can return
results.

### Authority-confirmed allocation workflow

Submitting an incident persists it to MongoDB, refreshes its Redis live-queue
entry, and emits `incident:created` for authorized zone subscribers. Candidate
lookup is read-only. An authority or admin confirms a selected responder and
facility with `POST /api/allocations`; this is the only allocation creation
path, and it reserves capacity/resources in Redis before saving a `PROPOSED`
allocation and its initial timeline entry in MongoDB. The assigned responder is
notified directly and through the zone event.

The assigned responder advances the allocation with `PATCH /api/allocations/:id`
using `{ "state": "ACCEPTED" }`, then `EN_ROUTE`, `ON_SCENE`, and `COMPLETED`.
Authorities/admins may cancel an active allocation. Each accepted transition
uses a conditional MongoDB update and appends `{ state, at, by }` to the
allocation timeline; terminal states cannot transition again. Cancellation
releases its Redis and MongoDB reservations. Incident status and authorized
Socket.IO events are updated as the workflow progresses.

## Redis operational state

MongoDB remains the system of record. Redis stores the live incident queue and
short-lived incident summaries, responder presence and geolocation, facility
bed and category stock counters, active alert ids and expiring alert summaries,
zone Pub/Sub events, and short-lived incident locks. Set `REDIS_URL` in
`backend/.env` (for local Redis, use
`redis://localhost:6379`). Socket.IO connections require a JWT in the handshake
auth object; responders can publish their presence and authenticated clients
can subscribe to a zone with `zone:subscribe`.

Allocation creation reserves facility capacity and requested resources in Redis
before persisting the allocation and MongoDB counters. Rejected reservations
compensate the Redis `DECR`; MongoDB persistence failures restore Redis counters.
Run the two-caller last-unit concurrency check with:

```sh
cd backend
npm run test:redis
```

The concurrency check uses an atomic Redis-command test double and does not
require a Redis server. The backend reports Redis as disconnected until a Redis
instance is running and `REDIS_URL` is set.

## Real-time events

Authenticated Socket.IO clients send their JWT in the connection `auth.token`
field, then emit `zone:subscribe` with a zone code. The server checks access
before joining the role-specific zone room. Authority and admin users can
subscribe to any zone; responders can coordinate across zones; citizens are
limited to zones where they reported incidents; facility managers are limited
to zones containing facilities they manage.

For radius-targeted alerts, clients should send `client:location` after joining
an authorized zone, with `{ zone_code, location: { type: "Point", coordinates:
[longitude, latitude] } }`. A saved profile location is used until a client
shares a current location. New and cached active alerts are emitted only when
the client is inside the alert radius and the alert has not expired. `GET
/api/alerts` returns unexpired MongoDB alerts and can optionally take
`longitude` and `latitude` query parameters to filter by radius.

The server publishes and emits `incident:created`, `incident:updated`,
`allocation:created`, `allocation:updated`, `facility:updated`,
`resource:updated`, `alert:created`, `responder:location`, and
`responder:status`. Redis Pub/Sub carries events between backend instances;
Socket.IO delivers only to authorized role and zone rooms. Incident event
payloads omit reporter identity and other private fields.

The authority dashboard is available at `/authority`. It loads the selected
zone's incidents and updates the list when incident events arrive, without a
page refresh. Enter an authority/admin JWT; it is kept in the current browser
tab's `sessionStorage` under `resq_token`.

Road segments are durable MongoDB records in the `roads` collection with
`road_id`, `from_zone`, `to_zone`, `status`, and `travel_minutes`. Authorities
and admins can list, read, create, update, and delete them; creation uses
`POST /api/roads` with `{ "from_zone", "to_zone", "status", "travel_minutes" }`.
`PATCH /api/roads/:roadId/status` accepts `{ "status": "FLOODED" }` (also
`OPEN` or `BLOCKED`). MongoDB is canonical; each road projects to two directed
Neo4j `ROAD_TO` relationships with the same `road_id`, `status`, and
`travel_minutes`. Reachability traverses only `OPEN` links. Closing/flooding a
segment flags active allocations whose stored route uses it and sends
`allocation:updated` to each assigned responder.

Seed the repeatable synthetic road network for the district's 20 zones with
`cd backend && npm run seed:roads`. It creates an OPEN ring plus BLOCKED and
FLOODED shortcuts for route-filtering checks.

To run the live API integration checks, start the backend in one terminal and
run `cd backend && npm run test:api` in another. The check uses temporary Atlas
records and removes them afterward.

## Review 2: CRUD, indexing and aggregation

* **CRUD** – every core collection now supports create, read, update and delete
  through the API. Deletes are guarded: incidents/facilities with active
  allocations are refused (409), reserved stock must be released before a
  resource line is deleted, and deleting a facility cascades to its inventory
  lines and Redis counters.
* **Indexes** – 31 secondary indexes (38 including `_id`) across 7 collections: compound, unique, 2dsphere,
  weighted text and partial indexes. `GET /api/analytics/indexes` lists them and
  `GET /api/analytics/explain/:name` returns the `explain('executionStats')`
  plan for six real application queries.
* **Aggregation** – 15 pipelines using `$match`, `$group`, `$facet`, `$lookup`
  (with sub-pipelines), `$geoNear`, `$unwind`, `$bucket`, `$dateToString`,
  `$arrayToObject`, `$filter` and `$switch`.
* **UI** – `/analytics` (charts and tables driven by the pipelines) and
  `/database` (resource/incident CRUD, index catalogue, query plans, Redis
  state) for AUTHORITY/ADMIN accounts.

```sh
cd backend
npm run seed          # base synthetic dataset (250 documents)
npm run seed:roads    # 26 road segments
npm run seed:bulk     # +1,500 incidents and +300 resource lines for index/aggregation demos
npm run demo:queries  # prints CRUD, index, explain and aggregation results
npm run test:crud     # 41 API checks for CRUD, search, geo, aggregation and index endpoints (API must be running)
npm run seed:bulk:clear
```

## Run the frontend

In a second terminal:

```sh
cd frontend
npm run dev
```

Open the Vite URL printed in the terminal (normally <http://localhost:5173>).

## Development seed data

The seed scripts create a repeatable synthetic dataset for the Chennai District
area. The records use generated names and reserved fake phone numbers; they do
not contain real people's personal information. The dataset includes 100 users,
50 incidents, 20 facilities, 50 resources, 20 allocations, and 10 alerts, with
GeoJSON locations around Chennai.

With `backend/.env` configured for the Atlas database, run:

```sh
cd backend
npm run seed
```

The seed uses stable IDs and updates its own records when rerun, without adding
duplicates. All synthetic user accounts share the development-only password
`ResQ-Seed-Only-2026!`. Do not use these accounts or this password in production.

To remove only the records created by the seed scripts, run:

```sh
cd backend
npm run seed:clear
```

## Neo4j AuraDB graph seed

Set `NEO4J_URI`, `NEO4J_USERNAME`, and `NEO4J_PASSWORD` in `backend/.env` for
your AuraDB instance. With MongoDB configured as the current source data, run:

```sh
cd backend
npm run seed:neo4j
```

The loader replaces only nodes tagged as the `resq-district` dataset, then
rebuilds the graph from current facilities, inventory, open incidents,
available/assigned responders, active allocations, teams, and canonical MongoDB
road records. MongoDB `_id` values are retained as Neo4j node `id` values.

## Database synchronization and rebuilds

The API server watches MongoDB change streams for users, incidents, facilities,
resources, allocations, alerts, and roads. Changes are briefly coalesced, then
the affected Redis projections and/or the Neo4j graph are rebuilt from the
current MongoDB records. Redis presence and geolocation are preserved during
background reconciliations; explicit Redis rebuilds recreate them from user
records. Road status and travel time are stored in MongoDB and projected to both
directed `ROAD_TO` relationships.

Run a manual projection rebuild from MongoDB with:

```sh
cd backend
npm run rebuild:redis
npm run rebuild:neo4j
npm run rebuild:all
```

These commands replace derived Redis state and the tagged Neo4j district graph;
they do not delete MongoDB history. Configure `MONGODB_URI`, `REDIS_URL`, and
the Neo4j AuraDB variables before running them.
