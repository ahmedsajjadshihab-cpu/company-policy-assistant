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

The app deploys as **one Node web service**. The backend serves the built frontend at `/` and APIs at `/api`.

1. Push this repo to GitHub.
2. In [Render Dashboard](https://dashboard.render.com), open your existing web service **or** create **New → Web Service**.
3. Connect this repo and use the **repository root** (do not set Root Directory to `backend` or `frontend`).
4. Build command: `npm run install:all && npm run build`
5. Start command: `npm --prefix backend start`
6. Health check path: `/api/health`
7. Environment variables:
   - `NODE_ENV` = `production`
   - `GROQ_API_KEY` = your Groq key
8. Deploy, then open the Render URL (for example `https://company-policy-assistant.onrender.com`).

If an old backend-only service is still live, visiting it will show `Cannot GET /` because it had no website. Use this combined service instead.

Free-tier services sleep after idle time; the first request can take about 30 seconds.

## How it works

1. Upload a PDF policy document.
2. The backend extracts text and splits it into chunks.
3. When you ask a question, relevant chunks are retrieved by keyword overlap.
4. Groq answers using the policy context, with a general fallback if nothing matches.

## Pages

- `/` — Policy Assistant (PDF upload + Q&A)
- `/chat` — Simple chat bot
