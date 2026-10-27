import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import multer from "multer";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

// LangChain imports
import { ChatGroq } from "@langchain/groq";
import { Document } from "@langchain/core/documents";
import { Embeddings } from "@langchain/core/embeddings";

// pdfjs-dist import for Node.js ESM environment
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  addSearch,
  computeAccuracyScore,
  computeAccuracyRate,
  getSearchStats,
  listSearches,
  addUploadedFile,
  listUploadedFiles,
  getActiveUploadedFile
} from "./database.js";

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
    const results = await this.similaritySearchWithScore(query, k);
    return results.map(({ doc }) => doc);
  }

  async similaritySearchWithScore(query, k = 4) {
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
    return scores.slice(0, k);
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

// Model fallback list - tries each in order until one works
const GROQ_FALLBACK_MODELS = [
  "llama3-8b-8192",
  "llama3-70b-8192",
  "llama-3.1-8b-instant",
  "mixtral-8x7b-32768",
  "gemma2-9b-it"
];

const groqModel = process.env.GROQ_MODEL || GROQ_FALLBACK_MODELS[0];
let resolvedModel = groqModel;

function ensureGroqIsConfigured() {
  if (!process.env.GROQ_API_KEY) {
    const error = new Error("The server is missing GROQ_API_KEY. Add it to backend/.env and restart the server.");
    error.status = 503;
    throw error;
  }
}

function getChatGroq(modelOverride) {
  ensureGroqIsConfigured();
  return new ChatGroq({
    apiKey: process.env.GROQ_API_KEY,
    model: modelOverride || resolvedModel,
    temperature: 0.7
  });
}

// Try to resolve the best available model on startup
async function resolveGroqModel() {
  if (!process.env.GROQ_API_KEY) return;

  // If user explicitly set GROQ_MODEL, trust it
  if (process.env.GROQ_MODEL) {
    resolvedModel = process.env.GROQ_MODEL;
    console.log(`[Groq] Using configured model: ${resolvedModel}`);
    return;
  }

  const modelsToTry = GROQ_FALLBACK_MODELS;
  for (const model of modelsToTry) {
    try {
      const testClient = new ChatGroq({
        apiKey: process.env.GROQ_API_KEY,
        model,
        temperature: 0.7
      });
      await testClient.invoke([{ role: "user", content: "hi" }]);
      resolvedModel = model;
      console.log(`[Groq] Using model: ${resolvedModel}`);
      return;
    } catch (err) {
      console.warn(`[Groq] Model "${model}" unavailable: ${err.message?.slice(0, 80)} — trying next...`);
    }
  }
  console.warn("[Groq] All fallback models failed. Chat will return errors until GROQ_MODEL is set.");
}

const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5176,http://127.0.0.1:5176")
  .split(",")
  .map((origin) => origin.trim());

app.use(
  cors({
    origin(origin, callback) {
      const isLocalViteOrigin = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || "");
      const isVercelOrigin = (origin || "").endsWith(".vercel.app");
      const isRenderOrigin = (origin || "").endsWith(".onrender.com");

      if (!origin || allowedOrigins.includes(origin) || isLocalViteOrigin || isVercelOrigin || isRenderOrigin) {
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

app.get("/api/searches", (req, res) => {
  const username = String(req.query.username || "").trim();
  const role = req.query.role === "admin" ? "admin" : "user";
  res.json({ searches: listSearches({ username, role }) });
});

app.get("/api/search-stats", (_req, res) => {
  res.json(getSearchStats());
});

app.get("/api/uploads", (_req, res) => {
  res.json({ uploads: listUploadedFiles() });
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

    // 5. Update local state and record in database
    activePolicy = {
      fileName: req.file.originalname || "policy.pdf",
      uploadedAt: new Date().toISOString()
    };
    indexedChunks = chunkedDocs.length;

    // Persist active PDF copy for server restarts
    try {
      const activePdfPath = join(__dirname, "../data/active_policy.pdf");
      writeFileSync(activePdfPath, buffer);
    } catch (saveErr) {
      console.warn("Could not save active policy copy:", saveErr.message);
    }

    const uploadRecord = addUploadedFile({
      fileName: req.file.originalname || "policy.pdf",
      originalName: req.file.originalname || "policy.pdf",
      fileSize: req.file.size || buffer.length,
      pageCount: pages.length,
      chunksCount: chunkedDocs.length,
      uploadedBy: req.body?.username || "admin"
    });

    // 6. Cleanup temp uploaded file
    unlinkSync(req.file.path);

    res.json({
      message: "Policy indexed successfully.",
      policy: activePolicy,
      chunks: indexedChunks,
      upload: uploadRecord,
      uploads: listUploadedFiles()
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
    ensureGroqIsConfigured();
    const message = String(req.body?.message || "").trim();
    if (!message) {
      res.status(400).json({ error: "Message is required." });
      return;
    }

    const history = Array.isArray(req.body?.history)
      ? req.body.history
          .slice(-12)
          .filter((item) => item && ["user", "assistant"].includes(item.role))
          .map((item) => ({ role: item.role, content: String(item.content || "").trim() }))
          .filter((item) => item.content)
      : [];

    const groqClient = getChatGroq();
    let response;
    try {
      response = await groqClient.invoke([
        {
          role: "system",
          content: "You are a helpful, concise assistant. Use the conversation history to maintain context."
        },
        ...history,
        { role: "user", content: message }
      ]);
    } catch (modelErr) {
      // Try fallback models if configured model fails
      let lastErr = modelErr;
      for (const fallbackModel of GROQ_FALLBACK_MODELS) {
        if (fallbackModel === resolvedModel) continue;
        try {
          const fallbackClient = getChatGroq(fallbackModel);
          response = await fallbackClient.invoke([
            {
              role: "system",
              content: "You are a helpful, concise assistant. Use the conversation history to maintain context."
            },
            ...history,
            { role: "user", content: message }
          ]);
          resolvedModel = fallbackModel;
          console.log(`[Groq] Switched to fallback model: ${fallbackModel}`);
          break;
        } catch (fallbackErr) {
          lastErr = fallbackErr;
        }
      }
      if (!response) throw lastErr;
    }

    const reply = response.content || "No response from Groq.";
    const accuracy = computeAccuracyScore({
      similarityScore: null,
      grounded: false,
      question: message,
      answer: reply,
      sources: []
    });

    const saved = addSearch({
      username: req.body?.username,
      role: req.body?.role,
      source: "chat",
      question: message,
      answer: reply,
      sources: [],
      grounded: false,
      similarityScore: null,
      accuracy
    });

    res.json({
      reply,
      model: groqModel,
      accuracy: saved.accuracy,
      accuracyRate: saved.accuracyScore,
      searchId: saved.id
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/chat", async (req, res, next) => {
  try {
    ensureGroqIsConfigured();
    const question = String(req.body?.question || "").trim();
    if (!question) {
      res.status(400).json({ error: "Question is required." });
      return;
    }

    let response;
    let sources = [];
    let grounded = false;
    let similarityScore = null;
    let answer = "";

    // Perform RAG if a policy is uploaded and indexed
    if (vectorStore) {
      // 1. Retrieve the top 4 most relevant chunks
      const matches = await vectorStore.similaritySearchWithScore(question, 4);
      const relevantMatches = matches.filter(({ score }) => score > 0);
      const relevantDocs = relevantMatches.map(({ doc }) => doc);

      if (relevantDocs.length === 0) {
        answer = "I could not find that information in the uploaded policy. Try using policy-specific terms or ask an administrator for clarification.";
        const accuracy = computeAccuracyScore({
          similarityScore: 0,
          grounded: false,
          question,
          answer,
          sources: []
        });

        const saved = addSearch({
          username: req.body?.username,
          role: req.body?.role,
          source: "policy",
          question,
          answer,
          sources: [],
          grounded: false,
          similarityScore: 0,
          accuracy
        });

        res.json({
          answer,
          sources: [],
          accuracy: saved.accuracy,
          accuracyRate: saved.accuracyScore,
          searchId: saved.id
        });
        return;
      }

      similarityScore = relevantMatches[0]?.score ?? 0;
      grounded = true;

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
      const groqClientRag = getChatGroq();
      let ragResponse;
      try {
        ragResponse = await groqClientRag.invoke([
          {
            role: "system",
            content: `You are a helpful policy assistant. Answer the user's question using ONLY the provided policy context below. If the answer is not in the context, say that the uploaded policy does not provide enough information.\n\nContext:\n${context}`
          },
          { role: "user", content: question }
        ]);
      } catch (modelErr) {
        let lastErr = modelErr;
        for (const fallbackModel of GROQ_FALLBACK_MODELS) {
          if (fallbackModel === resolvedModel) continue;
          try {
            const fb = getChatGroq(fallbackModel);
            ragResponse = await fb.invoke([
              {
                role: "system",
                content: `You are a helpful policy assistant. Answer the user's question using ONLY the provided policy context below. If the answer is not in the context, say that the uploaded policy does not provide enough information.\n\nContext:\n${context}`
              },
              { role: "user", content: question }
            ]);
            resolvedModel = fallbackModel;
            break;
          } catch (fallbackErr) {
            lastErr = fallbackErr;
          }
        }
        if (!ragResponse) throw lastErr;
      }
      response = ragResponse;
    } else {
      // Fallback to ungrounded policy assistant if no policy is uploaded yet
      const groqClientFallback = getChatGroq();
      let ungroundedResponse;
      try {
        ungroundedResponse = await groqClientFallback.invoke([
          {
            role: "system",
            content: "You are a helpful policy assistant."
          },
          { role: "user", content: question }
        ]);
      } catch (modelErr) {
        let lastErr = modelErr;
        for (const fallbackModel of GROQ_FALLBACK_MODELS) {
          if (fallbackModel === resolvedModel) continue;
          try {
            const fb = getChatGroq(fallbackModel);
            ungroundedResponse = await fb.invoke([
              {
                role: "system",
                content: "You are a helpful policy assistant."
              },
              { role: "user", content: question }
            ]);
            resolvedModel = fallbackModel;
            break;
          } catch (fallbackErr) {
            lastErr = fallbackErr;
          }
        }
        if (!ungroundedResponse) throw lastErr;
      }
      response = ungroundedResponse;
    }

    answer = response.content || "No response from Groq.";
    const accuracy = computeAccuracyScore({
      similarityScore,
      grounded,
      question,
      answer,
      sources
    });

    const saved = addSearch({
      username: req.body?.username,
      role: req.body?.role,
      source: "policy",
      question,
      answer,
      sources,
      grounded,
      similarityScore,
      accuracy
    });

    res.json({
      answer,
      sources,
      accuracy: saved.accuracy,
      accuracyRate: saved.accuracyScore,
      searchId: saved.id
    });
  } catch (error) {
    next(error);
  }
});

const frontendDist = join(__dirname, "../../frontend/dist");

if (existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      next();
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }

    res.sendFile(join(frontendDist, "index.html"));
  });
}

app.use((error, _req, res, _next) => {
  const status = error.code === "LIMIT_FILE_SIZE" ? 413 : error.statusCode || error.status || 500;
  const message = error.code === "LIMIT_FILE_SIZE"
    ? "The PDF is too large. Upload a file smaller than 15 MB."
    : error.message || "Something went wrong.";
  res.status(status).json({ error: message });
});

// Restore active policy on startup if database has a record
async function restoreActivePolicy() {
  try {
    const activeFile = getActiveUploadedFile();
    const activePdfPath = join(__dirname, "../data/active_policy.pdf");
    if (activeFile && existsSync(activePdfPath)) {
      const buffer = readFileSync(activePdfPath);
      const pages = await extractTextFromPdfBuffer(buffer);
      if (pages.length > 0) {
        const chunkedDocs = [];
        for (const p of pages) {
          const chunks = splitTextIntoChunks(p.text, 1000, 200);
          for (const chunk of chunks) {
            chunkedDocs.push(
              new Document({
                pageContent: chunk,
                metadata: { page: p.pageNumber, source: activeFile.originalName }
              })
            );
          }
        }
        const embeddings = new SimpleTfidfEmbeddings();
        const store = new SimpleVectorStore(embeddings);
        await store.addDocuments(chunkedDocs);
        vectorStore = store;
        activePolicy = {
          fileName: activeFile.originalName,
          uploadedAt: activeFile.uploadedAt
        };
        indexedChunks = chunkedDocs.length;
        console.log(`[Startup] Restored active policy: ${activeFile.originalName} (${indexedChunks} chunks)`);
      }
    }
  } catch (err) {
    console.warn("[Startup] Notice: Could not restore active policy:", err.message);
  }
}

restoreActivePolicy();
resolveGroqModel();

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`Policy RAG backend running on port ${port}`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Stop the other server or set a different PORT in backend/.env.`);
    process.exit(1);
  }

  throw error;
});
