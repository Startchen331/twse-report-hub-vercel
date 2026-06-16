# Deployment

This app needs a Node.js host because `/api/search` and `/api/download` fetch and parse TWSE pages at request time.

GitHub Pages is not suitable for the full app because it only serves static files.

Recommended public hosts:

- Render
- Railway
- Fly.io
- Vercel with Node/serverless adaptation

## Vercel

This repository includes Vercel serverless functions under `api/`.

1. Push this folder to a GitHub repository.
2. Import the repository in Vercel.
3. Use the project root as the root directory.
4. Keep the default install command, or use `npm install`.
5. No build command is required for the static frontend.
6. After deploy, test:
   - `/`
   - `/api/status`
   - a short `/api/search` query

`vercel.json` sets a 60-second function duration for TWSE lookups.

## Render

1. Push this folder to a GitHub repository.
2. In Render, create a new Web Service from the repository.
3. Use:
   - Build command: `npm install`
   - Start command: `npm start`
   - Health check path: `/healthz`
4. After deploy, open the Render URL and test a short query.

`render.yaml` is included for blueprint-style setup.

## Public Safety Notes

- `/api/status` returns health metadata only, not query logs.
- Query and download APIs have basic rate limiting.
- Search is limited to at most 10 years per request.
- Download parameters are validated before proxying to TWSE.
