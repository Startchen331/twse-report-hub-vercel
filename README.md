# TWSE Report Hub - Vercel Deploy Package

This package is ready for Vercel deployment.

Included UI features:

- Responsive desktop/mobile layout
- Restores the last query and result from browser localStorage
- Shows recent user search history below the query button

## Structure

- index.html / styles.css / app.js: static frontend
- api/*.js: Vercel serverless API routes
- lib/twse.js: TWSE query and parsing logic
- vercel.json: Vercel function and security header settings

## Deploy

Upload/import this folder to Vercel.

Recommended settings:

- Framework preset: Other
- Install command: npm install
- Build command: leave empty
- Output directory: leave empty

After deployment, test:

- /
- /api/status
- /api/search?companyCode=2330&type=quarterly&startYear=2026&endYear=2026
