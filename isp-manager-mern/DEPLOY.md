# Deploying to Vercel (2 separate projects)

This repo has two apps — `backend/` (Express API) and `frontend/` (React app).
Deploy each as its own Vercel project.

## 1. Push to GitHub
Push this whole folder (backend + frontend) to a GitHub repo. Vercel deploys from Git.

## 2. Backend project
- In Vercel: **New Project** → import the repo → set **Root Directory** to `backend`.
- Framework preset: **Other** (it already has a `vercel.json`).
- Environment variables (Project Settings → Environment Variables):
  - `MONGODB_URI` — your Atlas connection string
  - `JWT_SECRET` — a long random string
  - `JWT_EXPIRE` — e.g. `30d`
  - `NODE_ENV` — `production`
  - `CLIENT_URL` — your frontend's Vercel URL once you have it (see step 4). Can be comma-separated if you need more than one origin.
- Deploy. Test `https://<your-backend>.vercel.app/api/health` — should return `{"status":"OK", ...}`.

## 3. Frontend project
- **New Project** → same repo → set **Root Directory** to `frontend`.
- Framework preset: **Create React App** (auto-detected).
- Environment variable:
  - `REACT_APP_API_URL` — `https://<your-backend>.vercel.app/api`
- Deploy.

## 4. Connect them
Once both are deployed you'll have two URLs. Go back into the **backend** project's env
vars and set `CLIENT_URL` to the frontend's URL, then redeploy the backend so CORS allows it.

## Notes / things already fixed for you
- `backend/api/index.js` is the single real entrypoint (used by both `npm start` locally
  and by Vercel) — it now actually mounts all routes (auth, customers, payments, expenses,
  dashboard, whatsapp). Previously only a health-check route was wired up here, so the
  deployed API would have 404'd on every real endpoint.
- CORS now reads allowed origins from `CLIENT_URL` instead of being hardcoded to
  `localhost`.
- MongoDB connection is cached across serverless invocations instead of reconnecting
  every request.
- `.env` files were removed from this package (they contain secrets and are gitignored
  anyway) — use `.env.example` as a template and set the real values as Vercel env vars.
- **`bcryptjs` and `jsonwebtoken` were missing from `backend/package.json`** even though
  the auth code requires them. Locally this worked because they happened to already be
  installed in `node_modules`, but a fresh `npm install` (which is exactly what Vercel
  does) would not have installed them, and every login/register call would have crashed
  with "Cannot find module". Added both with the versions your existing lockfile already
  expected.
- **Customer search was missing a MongoDB text index.** `getCustomers` runs a `$text`
  search, but the `Customer` model never defined one — every search request would have
  thrown a database error. Added the text index on name/customerId/phone/address.
- Added `select: false` to the `User` password field so it's never accidentally returned
  by a query that forgets to exclude it (login and change-password already explicitly
  request it, so no behavior changes there).

## Local dev (unchanged)
```
cd backend && npm install && npm start      # http://localhost:5000
cd frontend && npm install && npm start     # http://localhost:3000
```
