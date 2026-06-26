# Company Policy RAG Assistant

A small React + Node app that lets a company upload a policy PDF and ask questions answered with RAG over the uploaded document.

## Stack

- Frontend: React, Vite, JavaScript, orange/white minimal UI
- Backend: Node.js, Express, Multer
- RAG: LangChain, OpenAI embeddings/chat model, local in-memory vector store
- Document input: PDF upload and chunking

## Setup

1. Install dependencies:

   ```bash
   npm run install:all
   ```

2. Create the backend environment file:

   ```bash
   cp backend/.env.example backend/.env
   ```

3. Add your OpenAI API key in `backend/.env`.

4. Run the app:

   ```bash
   npm run dev
   ```

5. Open the frontend at:

   ```text
   http://localhost:5173
   ```

The backend runs on `http://localhost:5002`.

## How It Works

1. The company uploads a PDF policy document.
2. The backend extracts text from the PDF and splits it into chunks.
3. LangChain creates embeddings and stores them in a local vector store.
4. When the user asks a question, the backend retrieves relevant policy chunks.
5. The AI answers using only the retrieved policy context and returns source previews.

## Notes

- This starter uses an in-memory vector store, so uploaded policy data resets when the backend restarts.
- For production, replace `MemoryVectorStore` with a persistent vector database such as Chroma, Pinecone, Weaviate, Qdrant, or pgvector.
- Do not commit your `.env` file or API keys.
