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
