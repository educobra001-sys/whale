# EduCobra

A multi-teacher education platform. Each teacher runs a private "room" with their own assistants, students, money and content. Students have one global ID and can join any teacher.

Built on the `Educational_Sys` structure: TypeScript, Express, MongoDB (Mongoose), Redis, BullMQ, zod. The front-end is plain HTML and ES modules with no build step.

## Run it locally

Double-click `start-local.bat`, then open http://127.0.0.1:4000.

By hand:

```
npm run db:start     start MongoDB and Redis (data stays in .data/)
npm run build        compile TypeScript
npm run seed         add test accounts (--reset wipes the local database first)
npm start            start the server
npm run db:stop      stop MongoDB and Redis
```

MongoDB and Redis are expected in `D:\dev\tools`. Set `EDUCOBRA_TOOLS` to use another folder.

`npm run seed` prints every test account. The owner signs in at `login.html?role=owner`, with the password from `.env`.

With no SMTP or bot settings, nothing leaves the machine. Verification codes appear on screen, and messages are recorded as "simulated".

## Layout

```
src/
  app.controller.ts   Express app and startup
  cluster.ts          one API process per CPU core
  worker.ts           background jobs: messages, WhatsApp, Telegram, monthly invoices
  common/             errors, security, Redis, tenant scope, shared helpers
  db/model/           schemas (teaching.ts = per teacher, platform.ts = owner level)
  db/plugin/          tenant guard, account ids
  db/repository/      data access used by every service
  middleware/         auth, roles, permissions, plan sections, rate limits
  module/<name>/      controller + service + validation for each feature
  test/               end-to-end API tests
front-end/            all portals, including assets/js/views/owner
docs/                 scaling guide and the original front-end contract
```

## Rules the code depends on

- **Teacher isolation is enforced in one place.** `db/plugin/tenant.plugin.ts` forces every query on teacher-owned data onto the signed-in teacher, and throws if there is no scope. Crossing teachers needs an explicit `runAsPlatform`.
- **Money moves inside transactions**, and balance checks are part of the update. Never read a balance and write it back.
- **Never put a shared document inside a busy transaction.** Every scan touching one document makes them collide and retry. That's why attendance has its own collection and the session counter is updated after commit.
- **A new section** needs a catalogue entry in `common/enum/feature.enum.ts` and `requireFeature` on its routes.

## Tests

`npm test` runs against the local database in `educobra_test`, which it wipes, and Redis database 1. It covers isolation between teachers, money under concurrent requests, approvals, plans, billing, affiliates, ads, messaging and attack traffic.

## Share a temporary link with friends

Run `start-public.bat`. It starts the server with error details hidden and prints a temporary Cloudflare link. Run `stop-public.bat` to close it. The link works only while this computer is on, and changes on every start.
