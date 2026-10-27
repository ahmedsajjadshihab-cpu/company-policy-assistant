# Company Policy RAG Assistant

A full-stack React + Node.js application that enables organizations to index policy PDF documents, perform grounded retrieval-augmented generation (RAG) with AI, track real-time **AI Accuracy & Reliability Scores** for every search result, store all search queries in a persistent **SQLite Database**, and provide administrators with a complete **Uploaded Files History** and audit dashboard. Also includes a general-purpose Chat Bot powered by Groq.

---

## Key Features

- **Real-Time Accuracy & Reliability Scoring**:
  - Every search result (Policy RAG and Chat Bot) is evaluated with a calibrated confidence score (0–100%).
  - Provides categorized reliability levels: **High Reliability** (verified citations), **Moderate Reliability**, and **Low Reliability** (unverified or not found in policy).
  - Displays transparent reasoning badges and source citations for every answer.
- **Persistent Database (SQLite with Auto-Fallback)**:
  - **Searches Database**: Stores every query, response, source citation, similarity metric, accuracy score, and user session.
  - **Uploads History Database**: Stores all administrator policy PDF uploads, file sizes, page counts, chunk stats, and active document statuses.
  - Powered by Node's built-in SQLite engine with automatic JSON fallback for zero-dependency portability.
- **Admin Uploaded Files History & Dashboard**:
  - Dedicated admin section showing the history of all uploaded policy documents, file sizes, page counts, and chunk distributions.
  - Real-time dashboard with search metrics, average AI accuracy score, active policy indicators, and user activity tracking.
- **Role-Based Authentication**:
  - **Admin**: Can upload policy PDFs, view file upload history, inspect all user searches, and access dashboard metrics.
  - **User**: Read-only access to ask questions about company policies and view personal search history.
- **Universal Single-Service Deployment**:
  - Express backend serves the Vite React frontend in production for simple 1-click deployment on Render, Railway, Fly.io, or VPS.

---

## Login Credentials

| Role  | Username | Password  | Capabilities |
|-------|----------|-----------|--------------|
| **Admin** | `admin` | `admin123` | Upload policy PDFs, view uploaded files history, view all user searches & AI accuracy metrics |
| **User**  | `user`  | `user123`  | Search indexed policies, chat with AI, view personal search history with accuracy scores |

---

## Local Setup

### 1. Install dependencies

```bash
npm run install:all
```

### 2. Configure environment variables

```bash
cp backend/.env.example backend/.env
```

Add your Groq API key in `backend/.env`:

```env
GROQ_API_KEY=gsk_...
# Optional: customize model (defaults to openai/gpt-oss-20b or llama-3.3-70b-versatile)
GROQ_MODEL=openai/gpt-oss-20b
PORT=5002
```

> Get a free API key at [console.groq.com](https://console.groq.com).

### 3. Run development servers

```bash
npm run dev
```

- Frontend: [http://localhost:5173](http://localhost:5173)
- Backend API: [http://localhost:5002](http://localhost:5002)

---

## Deploy to Render

The repository includes a ready-to-use `render.yaml` blueprint. The app deploys as a single web service where the Node backend serves both the API endpoints and the built frontend SPA.

1. Commit and push changes to GitHub:
   ```bash
   git add .
   git commit -m "Add accuracy scoring, database persistence, and admin upload history"
   git push origin main
   ```
2. In the [Render Dashboard](https://dashboard.render.com):
   - Choose **New → Web Service** (or connect your existing `company-policy-assistant` service).
   - Link your GitHub repository (`company-policy-assistant`).
   - **Root Directory**: Leave blank (uses repo root).
   - **Build Command**: `npm run install:all && npm run build`
   - **Start Command**: `npm --prefix backend start`
   - **Health Check Path**: `/api/health`
   - **Environment Variables**:
     - `NODE_ENV`: `production`
     - `GROQ_API_KEY`: your Groq API key
3. Click **Deploy Web Service**. Render will automatically build the frontend, start the server, and deploy the application.

---

## Architecture & How It Works

1. **Policy Upload & Chunking**:
   - The admin uploads a company policy PDF.
   - Text is parsed page-by-page using `pdfjs-dist` (pure JS, no native OS binaries required).
   - Documents are split into overlapping semantic chunks with page metadata.
   - Chunks are vectorized using TF-IDF cosine embeddings and indexed into memory.
   - An upload record is saved in the SQLite `uploaded_files` table.
2. **Search & RAG Retrieval**:
   - Users submit policy queries.
   - The vector store retrieves top relevant chunks above the similarity threshold.
   - The LLM synthesizes an answer using strictly grounded policy context and citations.
3. **Accuracy & Reliability Engine**:
   - Scores the match based on cosine similarity, query keyword coverage, citation count, and answer consistency.
   - Detects when policies do not contain requested information and adjusts confidence appropriately.
   - Categorizes each search result into High, Moderate, or Low Reliability with an explainable reason.
4. **Database Persistence**:
   - Every search is logged into the SQLite `searches` table.
   - Admin and users can review past searches, accuracy scores, and cited pages.
