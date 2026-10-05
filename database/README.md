# Database setup

MongoDB Atlas is the primary database. The backend Mongoose models use the six
documented collections: `users`, `incidents`, `facilities`, `resources`,
`allocations`, and `alerts`. Their declared indexes are created when the Atlas
connection succeeds. Incident, facility, alert, and user location fields use
GeoJSON Points; the relevant indexes are 2dsphere indexes.

Redis stores rapidly changing operational state such as live incident
summaries, responder presence, capacity/stock counters, and zone event
channels. MongoDB remains the system of record.

Neo4j AuraDB stores the current district response graph for routing and
operational relationships. The repeatable `backend/scripts/seedGraph.js`
projects active incidents, current facilities and inventory, available or
actively assigned responders, active assignments, teams, and zone topology;
it does not copy closed incident/allocation history. Mongo `_id` values are
stored as graph node `id` values. Zone nodes use `zone_code` because the MongoDB
schema has no separate Zone collection.

Copy `backend/.env.example` to `backend/.env`, replace the example
`MONGODB_URI` with a MongoDB Atlas connection string, and allow the development
machine's IP address in the Atlas network access list. Start the backend with
`cd backend && npm run dev`. The health endpoint reports database state at
`/api/health`.

Set `REDIS_URL`, `NEO4J_URI`, `NEO4J_USERNAME`, and `NEO4J_PASSWORD` in
`backend/.env` for those services. Run `cd backend && npm run seed:neo4j` to
load the AuraDB district graph.

## Index catalogue (Review 2)

| Collection | Index | Type | Serves |
| --- | --- | --- | --- |
| users | `phone_1` | unique | login lookup, duplicate-account prevention |
| users | `location_2dsphere` | 2dsphere | responders near a point |
| users | `role_1`, `responder_availability` | single / compound | role checks, available responders by skill |
| incidents | `location_2dsphere` | 2dsphere | geo queries on reports |
| incidents | `status_1_severity_1_reported_at_-1` | compound (ESR) | live triage queue |
| incidents | `status_1_reported_at_-1`, `severity_1_reported_at_-1`, `type_1_reported_at_-1`, `zone_code_1_reported_at_-1`, `reporter_id_1_reported_at_-1` | compound | filtered, newest-first lists |
| incidents | `incident_text_search` | text (weights 5/2) | free-text search over description and needs |
| incidents | `open_incidents_by_zone` | partial (`closed_at: null`) | open-only zone feed |
| facilities | `location_2dsphere` | 2dsphere | `$near` / `$geoNear` nearest facility |
| facilities | `kind_1_operational_1`, `zone_code_1_kind_1` | compound | filtered lists, zone capacity lookup |
| facilities | `facility_text_search` | text | search by name and services |
| resources | `facility_id_1_category_1`, `item_1`, `category_1_quantity_-1` | compound / single | inventory per facility, low-stock reports |
| allocations | `incident_id_1_state_1`, `responder_id_1_state_1`, `facility_id_1_state_1` | compound | active-allocation guards and responder work lists |
| allocations | `allocations_needing_review` | partial (`review_required: true`) | road-closure review queue |
| alerts | `centre_2dsphere`, `expires_at_1`, `zone_code_1_severity_1_expires_at_-1` | 2dsphere / single / compound | radius alerts, active alert lookups |
| roads | `road_id_1`, `from_zone_1_to_zone_1` | unique | canonical road segments |
| roads | `from_zone_1_status_1`, `to_zone_1_status_1` | compound | open-road traversal sync |

Alerts deliberately have no TTL index: expired alerts stay in MongoDB as incident
history, while Redis keys (`alert:<id>:summary`) carry the expiry TTL.
