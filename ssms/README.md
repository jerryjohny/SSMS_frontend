# SSMS CRA Frontend

This frontend was generated with `npx create-react-app ssms --template typescript --use-npm` and then adapted to the SSMS requirements.

## Key structure

- `src/components/Auth`: role switch and tenant access summary
- `src/components/Layout`: app shell and bottom navigation
- `src/components/Profile`: current sale composer
- `src/components/Queue`: pending debt, credit, and pickup list
- `src/components/SellerHome`: product search, browse, and barcode flow
- `src/data`: mock fallback data
- `src/hooks`: app hooks
- `src/pages`: page-level composition
- `src/utils`: API, typing, and sales helpers

## Commands

- `npm start`: run the CRA dev server over HTTPS on `0.0.0.0:3000`
- `npm run build`: create a production build
- `npm test -- --watchAll=false`: run tests once

## Environment

Development already uses [.env.development](</d:/Germano/Germano/P/SSMS/SSMS_frontend/ssms/.env.development>) with:

- `HOST=0.0.0.0`
- `HTTPS=true`
- `REACT_APP_API_BASE_URL=/api/v1` for local proxied backend, or a full URL like `https://your-api-host/api/v1` for a remote backend

When `REACT_APP_API_BASE_URL` is relative, CRA proxies `/api/*` and `/media/*` to `DEV_BACKEND_PROXY_TARGET` (default `http://127.0.0.1:8000`), so the frontend can stay on HTTPS while Django still runs on plain HTTP locally.

When `REACT_APP_API_BASE_URL` is absolute, no local proxy is used and the browser talks directly to that backend. In that case the backend must allow the frontend origin via CORS.

Copy `.env.example` to `.env` only if you need to override the default API base.
