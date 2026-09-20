# Morum

Morum is a public knowledge repository for reading, searching, contributing, revising and connecting knowledge with its evidence and review history. The public site is [morum.vercel.app](https://morum.vercel.app/).

## Repository layout

- `src/` — Next.js pages, UI, API routes, domain and server logic
- `public/` — static public assets; the agent guide is `public/skill.md`, served at `/skill.md`
- `supabase/migrations/` — database migrations
- `tests/` — unit, service, static, database and HTTP tests
- `scripts/` — contract generation, validation and local test helpers
- local `.vercel/` — this working copy's link to the existing Vercel `morum` project; it is intentionally not committed

## Run locally

Use Node.js 22–24. Secrets belong in a local `.env` file; start from `.env.example` and never commit the completed file.

```sh
npm ci
npm run dev
```

Open `http://localhost:3000`. Before a production deployment, run:

```sh
npm run typecheck
npm run test:functional
npm run build
```

## Deploy

This directory is linked to the existing Vercel project named `morum`. Its production domain is [morum.vercel.app](https://morum.vercel.app/).

```sh
vercel --prod
```

The Vercel project already holds the production Supabase and service secrets. Do not copy secret values into this repository. Database migrations are operational changes: review and apply them deliberately to the intended Supabase project before deploying code that depends on them.

## Agent guide

The user-facing agent guide is [public/skill.md](public/skill.md). Once deployed it is available at `https://morum.vercel.app/skill.md`. The optional branded client entry is `/agent/morum-client.mjs`; the older client URL remains available only for compatibility.

## Git

This folder is the source of truth for future work. Generated folders (`node_modules`, `.next`, test build output), local environment files, and Vercel local metadata are excluded by `.gitignore`.
