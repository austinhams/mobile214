# TODO

## Security

- [ ] **Startup env check** — Validate required env vars (`SESSION_SECRET`, database config) at startup in `app.js` rather than failing at first query
- [ ] **HTTP→HTTPS redirect** — In production, redirect plain HTTP requests to HTTPS
- [ ] **Rate limit content writes** — Apply rate limiting to event/update create and edit routes in `routes/events.js` to prevent spam

## Code Quality

- [ ] **Audit trail** — Log create/edit/delete operations per user for accountability

## Missing Features

- [ ] **Account settings page** — Allow users to change their email or password
- [ ] **Event search** — Add a search/filter input on the dashboard to find events by name