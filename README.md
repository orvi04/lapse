# Lapse

Social productivity and accountability web app (installable PWA): make up to 3 daily promises, run focus sessions with a low-power timelapse, and post to a friends-only feed that rolls over every 24 hours.

- Frontend: Vite + React + TypeScript, hosted on GitHub Pages
- Backend: Supabase (Auth, Postgres with RLS, Storage)
- Migrations: `supabase/migrations/`

## Develop

```
npm install
npm run dev
```

The Supabase URL and publishable key in `src/lib/supabase.ts` are public by design. Data access is enforced by Row Level Security.
