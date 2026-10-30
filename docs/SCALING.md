# Scaling and going live

## Measured so far

Measured on the development laptop, with the API, MongoDB, Redis and the load generator all on the same machine: a 4-core Ryzen 5 2500U with MongoDB on a 5400rpm hard disk.

| Test | Result |
|---|---|
| Check-ins, 6 API processes, batches of 100 at once | 68 per second, all 400 recorded correctly |
| Door lookup | 60 to 107 per second |
| Public teacher directory (cached) | about 2,000 per second |
| MongoDB reads on this machine | about 1,800 per second |
| Redis reads | about 53,000 per second |

The limit here is MongoDB on this laptop, not the application. These numbers are a floor from weak hardware, not a capacity figure. Nothing has been load tested at production scale yet.

## What's already built for scale

- The API keeps no state between requests, so more processes or servers can be added. `npm run start:cluster` runs one process per core. Run `npm run start:worker` alongside it, exactly once.
- Account checks and public pages are cached in Redis, and rate limits are shared across processes.
- Messages go through queues, so a large send never blocks a request. Failed sends retry.
- Attendance and money rows are separate documents, so no document grows without limit.
- Every teacher-owned collection has a `teacher` field that leads its indexes, ready to be the shard key.

## Suggested production setup

1. **Before any public traffic:** a CDN and firewall in front of the site, such as Cloudflare. Application code can't stop a network-level flood. Rate limits only handle abuse that reaches the server.
2. **Database:** a three-node MongoDB replica set on SSD or NVMe, such as MongoDB Atlas. Never run production on a single node. Turn `autoIndex` off and build indexes during quiet hours.
3. **Redis:** a managed instance with persistence on. Queued messages live there.
4. **API:** at least two servers behind a load balancer, each running the cluster.
5. **Worker:** one separate process. WhatsApp Web keeps a live connection that must exist exactly once.
6. **Uploads:** move to object storage such as S3 or Cloudflare R2. The local `uploads/` folder doesn't work across servers.
7. **Video:** serve from a video host with signed links, such as Bunny Stream or Cloudflare Stream. Video must never stream through the Node servers.
8. **Sharding:** only when one replica set is no longer enough. Shard teacher collections on `teacher`.

## Before going online

- Set `NODE_ENV=production`, new secrets, `CORS_ORIGINS`, `PUBLIC_URL` and real SMTP settings.
- In production, a missing WhatsApp connection is reported as "failed" instead of "simulated".
- Add automatic database backups and test a restore. They aren't built yet.
- Add a privacy policy and terms. The platform holds data about minors.
- Run a load test against the real servers with realistic data before announcing.

## WhatsApp notes

- **Links (`wa.me`)**: the safest. A person presses send on each message.
- **Linked server number**: uses an unofficial WhatsApp Web library. WhatsApp can ban a number for automated sending, so use a number you can afford to lose. It suits small volumes, not the main route for the whole platform.
- **WhatsApp API**: the only route meant for scale. Meta requires pre-approved message templates to start a conversation, and plain text only works within 24 hours of the parent writing first. The current code sends plain text, so template support must be added before real use.
