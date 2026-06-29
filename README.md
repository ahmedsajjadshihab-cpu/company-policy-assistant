# Company Policy RAG Assistant

A React + Node app that lets a company upload a policy PDF and ask questions answered with RAG over the uploaded document. Includes a simple chat page powered by Groq.

## Stack

- Frontend: React, Vite, JavaScript
- Backend: Node.js, Express, Multer, Groq, pdfjs-dist (pure JavaScript — no Python)
- AI: Groq (`llama-3.3-70b-versatile`)
- Document input: PDF upload and keyword-based chunk retrieval

## Login

| Role  | Username | Password  |
|-------|----------|-----------|
| Admin | admin    | admin123  |
| User  | user     | user123   |

Only **admin** can upload PDFs. Users can chat and ask questions.

## Local setup

1. Install dependencies:

   ```bash
   npm run install:all
   ```

2. Create the backend environment file:

   ```bash
   cp backend/.env.example backend/.env
   ```

3. Paste your Groq API key in `backend/.env`:

   ```env
   GROQ_API_KEY=gsk_...
   ```

   Get a free key at [console.groq.com](https://console.groq.com).

4. Run the app:

   ```bash
   npm run dev
   ```

5. Open the frontend at [http://localhost:5173](http://localhost:5173)

The backend runs on [http://localhost:5002](http://localhost:5002).

## Deploy to Render

This repo includes a [Render Blueprint](https://render.com/docs/blueprint-spec) at `render.yaml`.

### Option A — Blueprint (recommended)

1. Push this repo to GitHub.
2. In [Render Dashboard](https://dashboard.render.com), click **New → Blueprint**.
3. Connect the repo and apply the blueprint.
4. When prompted, set **GROQ_API_KEY** for the backend service (leave blank in repo; paste in Render UI).
5. Wait for both services to deploy:
   - `company-policy-assistant-backend` (Node web service)
   - `company-policy-assistant-frontend` (static site)

Render wires the frontend build to the backend URL automatically via `VITE_API_URL`.

### Option B — Manual backend only

1. **New → Web Service** on Render.
2. Connect repo, set **Root Directory** to `backend`.
3. Build command: `npm install`
4. Start command: `npm start`
5. Add environment variables:
   - `GROQ_API_KEY` — your Groq key
   - `CLIENT_ORIGIN` — your frontend URL (e.g. `https://your-app.onrender.com`)
6. Deploy and note the backend URL (e.g. `https://your-backend.onrender.com`).

For the frontend, either deploy as a Render static site with `VITE_API_URL` set to your backend URL at build time, or run locally pointing at the deployed backend.

### Notes for production

- Uploaded policy data is stored **in memory** and resets when the backend restarts or redeploys.
- Render free-tier services spin down after inactivity; the first request may take ~30s to wake up.
- Do not commit `.env` files or API keys.

## How it works

1. Upload a PDF policy document.
2. The backend extracts text and splits it into chunks.
3. When you ask a question, relevant chunks are retrieved by keyword overlap.
4. Groq answers using the policy context, with a general fallback if nothing matches.

## Pages

- `/` — Policy Assistant (PDF upload + Q&A)
- `/chat` — Simple chat bot
