import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import multer from "multer";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

// LangChain imports
import { ChatGroq } from "@langchain/groq";
import { Document } from "@langchain/core/documents";
import { Embeddings } from "@langchain/core/embeddings";

// pdfjs-dist import for Node.js ESM environment
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const app = express();
const port = Number(process.env.PORT || 5002);
const uploadDir = join(__dirname, "../uploads");

if (!existsSync(uploadDir)) {
  mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf" || extname(file.originalname).toLowerCase() === ".pdf") {
      cb(null, true);
      return;
    }
    cb(new Error("Only PDF files are allowed."));
  }
});

// Custom TF-IDF Embeddings class conforming to the LangChain Embeddings interface
class SimpleTfidfEmbeddings extends Embeddings {
  constructor() {
    super({});
    this.vocab = [];
    this.vocabIndex = new Map();
    this.idf = [];
  }

  tokenize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/gi, " ")
      .split(/\s+/)
      .filter(w => w.length > 2); // Filter short words/stopwords
  }

  async embedDocuments(documents) {
    // 1. Extract vocabulary and document frequencies
    const docTokens = documents.map(doc => this.tokenize(doc));
    const wordSet = new Set();
    const docFreq = new Map();

    for (const tokens of docTokens) {
      const uniqueTokens = new Set(tokens);
      for (const token of uniqueTokens) {
        wordSet.add(token);
        docFreq.set(token, (docFreq.get(token) || 0) + 1);
      }
    }

    this.vocab = Array.from(wordSet);
    this.vocabIndex = new Map(this.vocab.map((w, idx) => [w, idx]));

    // 2. Compute IDF for each word in vocabulary
    const numDocs = documents.length;
    this.idf = this.vocab.map(word => {
      const df = docFreq.get(word) || 0;
      // Standard smooth IDF formula
      return Math.log(1 + (numDocs / (df || 1)));
    });

    // 3. Generate term-frequency vectors
    return docTokens.map(tokens => this._vectorize(tokens));
  }

  async embedQuery(query) {
    const tokens = this.tokenize(query);
    return this._vectorize(tokens);
  }

  _vectorize(tokens) {
    const vector = new Array(this.vocab.length).fill(0);
    // Term Frequency (TF)
    for (const token of tokens) {
      if (this.vocabIndex.has(token)) {
        const idx = this.vocabIndex.get(token);
        vector[idx] += 1;
      }
    }
    // Multiply TF by IDF
    for (let i = 0; i < vector.length; i++) {
      if (vector[i] > 0) {
        vector[i] = vector[i] * this.idf[i];
      }
    }
    // L2 Normalize
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= magnitude;
      }
    }
    return vector;
  }
}

// In-Memory Vector Store implementation with cosine similarity search (equivalent to MemoryVectorStore)
class SimpleVectorStore {
  constructor(embeddings) {
    this.embeddings = embeddings;
    this.documents = [];
    this.vectors = [];
  }

  async addDocuments(documents) {
    this.documents.push(...documents);
    const texts = documents.map(doc => doc.pageContent);
    const newVectors = await this.embeddings.embedDocuments(texts);
    this.vectors.push(...newVectors);
  }

  async similaritySearch(query, k = 4) {
    const queryVector = await this.embeddings.embedQuery(query);
    const scores = this.vectors.map((vec, idx) => {
      // Dot product of normalized vectors represents cosine similarity
      let dotProduct = 0;
      const len = Math.min(vec.length, queryVector.length);
      for (let i = 0; i < len; i++) {
        dotProduct += vec[i] * queryVector[i];
      }
      return { doc: this.documents[idx], score: dotProduct };
    });

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, k).map(item => item.doc);
  }
}

// Custom Recursive Character Splitter to split document text into chunks
function splitTextIntoChunks(text, chunkSize = 1000, chunkOverlap = 200) {
  const words = text.split(/\s+/);
  const chunks = [];
  let currentChunkWords = [];
  let currentLength = 0;

  for (const word of words) {
    currentChunkWords.push(word);
    currentLength += word.length + 1; // including space

    if (currentLength >= chunkSize) {
      chunks.push(currentChunkWords.join(" "));
      
      // Calculate overlapping words to preserve context
      const overlapWords = [];
      let overlapLen = 0;
      for (let i = currentChunkWords.length - 1; i >= 0; i--) {
        const w = currentChunkWords[i];
        if (overlapLen + w.length + 1 <= chunkOverlap) {
          overlapWords.unshift(w);
          overlapLen += w.length + 1;
        } else {
          break;
        }
      }
      currentChunkWords = overlapWords;
      currentLength = overlapLen;
    }
  }

  if (currentChunkWords.length > 0) {
    chunks.push(currentChunkWords.join(" "));
  }

  return chunks;
}

// In-Memory state for active policy and vector store
let activePolicy = null;
let indexedChunks = 0;
let vectorStore = null;

// Initialize Groq LLM via LangChain class
const chatGroq = new ChatGroq({
  apiKey: process.env.GROQ_API_KEY,
  model: "llama-3.3-70b-versatile",
  temperature: 0.7
});

const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5176,http://127.0.0.1:5176")
  .split(",")
  .map((origin) => origin.trim());

app.use(
  cors({
    origin(origin, callback) {
      const isLocalViteOrigin = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || "");

      if (!origin || allowedOrigins.includes(origin) || isLocalViteOrigin) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS blocked request from ${origin}`));
    }
  })
);
app.use(express.json({ limit: "1mb" }));

// Helper function to extract page-by-page text from PDF buffer using pdfjs-dist
async function extractTextFromPdfBuffer(buffer) {
  const data = new Uint8Array(buffer);
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;
  const pages = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => item.str).join(" ").trim();
    if (pageText) {
      pages.push({ text: pageText, pageNumber: i });
    }
  }
  return pages;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    policy: activePolicy,
    chunks: indexedChunks,
    ready: Boolean(vectorStore)
  });
});

app.post("/api/upload-policy", upload.single("policy"), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "Please upload a PDF file." });
      return;
    }

    // 1. Read PDF file into memory buffer
    const buffer = readFileSync(req.file.path);

    // 2. Parse text page-by-page
    const pages = await extractTextFromPdfBuffer(buffer);
    if (pages.length === 0) {
      throw new Error("Could not extract any text from the uploaded PDF.");
    }

    // 3. Convert pages to LangChain Documents and split them
    const chunkedDocs = [];
    for (const p of pages) {
      const chunks = splitTextIntoChunks(p.text, 1000, 200);
      for (const chunk of chunks) {
        chunkedDocs.push(
          new Document({
            pageContent: chunk,
            metadata: { page: p.pageNumber, source: req.file.originalname }
          })
        );
      }
    }

    // 4. Index into in-memory Vector Store
    const embeddings = new SimpleTfidfEmbeddings();
    const store = new SimpleVectorStore(embeddings);
    await store.addDocuments(chunkedDocs);
    vectorStore = store;

    // 5. Update local state
    activePolicy = {
      fileName: req.file.originalname || "policy.pdf",
      uploadedAt: new Date().toISOString()
    };
    indexedChunks = chunkedDocs.length;

    // 6. Cleanup temp uploaded file
    unlinkSync(req.file.path);

    res.json({
      message: "Policy indexed successfully.",
      policy: activePolicy,
      chunks: indexedChunks
    });
  } catch (error) {
    console.error("UPLOAD ERROR:");
    console.error(error);

    if (req.file?.path && existsSync(req.file.path)) {
      unlinkSync(req.file.path);
    }

    next(error);
  }
});

app.post("/api/simple-chat", async (req, res, next) => {
  try {
    const message = String(req.body?.message || "").trim();
    if (!message) {
      res.status(400).json({ error: "Message is required." });
      return;
    }

    const response = await chatGroq.invoke([{ role: "user", content: message }]);

    res.json({
      reply: response.content || "No response from Groq.",
      model: "llama-3.3-70b-versatile"
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/chat", async (req, res, next) => {
  try {
    const question = String(req.body?.question || "").trim();
    if (!question) {
      res.status(400).json({ error: "Question is required." });
      return;
    }

    let response;
    let sources = [];

    // Perform RAG if a policy is uploaded and indexed
    if (vectorStore) {
      // 1. Retrieve the top 4 most relevant chunks
      const relevantDocs = await vectorStore.similaritySearch(question, 4);

      // 2. Prepare structured context
      const context = relevantDocs
        .map((doc) => `[Page ${doc.metadata.page}]: ${doc.pageContent}`)
        .join("\n\n");

      // 3. Prepare sources metadata for frontend Q&A citation
      sources = relevantDocs.map((doc) => ({
        page: doc.metadata.page,
        preview: doc.pageContent.slice(0, 150) + (doc.pageContent.length > 150 ? "..." : "")
      }));

      // 4. Invoke LLM with grounded context
      response = await chatGroq.invoke([
        {
          role: "system",
          content: `You are a helpful policy assistant. Answer the user's question using ONLY the provided policy context below. If the answer is not in the context, say that the uploaded policy does not provide enough information.\n\nContext:\n${context}`
        },
        { role: "user", content: question }
      ]);
    } else {
      // Fallback to ungrounded policy assistant if no policy is uploaded yet
      response = await chatGroq.invoke([
        {
          role: "system",
          content: "You are a helpful policy assistant."
        },
        { role: "user", content: question }
      ]);
    }

    res.json({
      answer: response.content || "No response from Groq.",
      sources
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const status = error.statusCode || error.status || 500;
  const message = error.message || "Something went wrong.";
  res.status(status).json({ error: message });
});

const server = app.listen(port, () => {
  console.log(`Policy RAG backend running on http://localhost:${port}`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Stop the other server or set a different PORT in backend/.env.`);
    process.exit(1);
  }

  throw error;
});
