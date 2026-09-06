# Vercel frontend and FastAPI backend

Local development remains `npm run dev` from the repository root. Vite forwards
`/api` to `http://127.0.0.1:8000`; no environment variables are required locally.

## Vercel backend project

Keep the existing working backend project, with Root Directory `backend`.
Vercel detects FastAPI and the exposed `app` in `main.py`, and installs dependencies
from `requirements.txt`. Keep the existing working build settings; no Render start
command, `$PORT` setting, or `PYTHON_VERSION` environment variable is needed.

Set this environment variable in the backend Vercel project:

`FRONTEND_ORIGINS=https://your-frontend.vercel.app`

Replace the example with the actual frontend HTTPS origin, without a path.
Multiple production/custom/preview origins can be comma-separated. Local origins
`http://localhost:5173` and `http://127.0.0.1:5173` remain allowed.
Redeploy the backend after changing its environment variables.
The example files document settings; the backend does not load them automatically.

The existing portfolio state and caches live in process memory. On Vercel, state
can reset or differ between function instances; this connection configuration does
not add persistence or change that existing behavior.

## Vercel frontend

Keep the existing frontend deployment settings. Add:

`VITE_API_URL=https://your-backend.vercel.app`

Use the public backend origin without `/api` or `/docs`. The API wrapper appends
`/api` and the endpoint path. Set this for the relevant Vercel environments and
redeploy: Vite embeds the value during the build. This value is public, not a secret.
Development always uses the local proxy, even if this variable is set locally.
Without it, a production build uses same-origin `/api` requests.

## Verify the connection

1. Open the public backend's `/docs` and `/api/portfolio` URLs.
2. Redeploy the frontend after setting `VITE_API_URL`.
3. Open the frontend and check that `/api/portfolio` requests target the public
   backend and succeed. Ensure its exact frontend origin is in `FRONTEND_ORIGINS`.

No Vite production proxy is needed: the deployed browser calls the backend directly.
