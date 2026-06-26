import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import multer from "multer";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });
console.log("API KEY:", process.env.OPENAI_API_KEY);

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

let vectorStore = null;
let activePolicy = null;
let indexedChunks = 0;

const embeddings = new OpenAIEmbeddings({
  model: "text-embedding-3-small"
});

const llm = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0.1
});

const prompt = PromptTemplate.fromTemplate(`
You are a careful company policy assistant.
Answer the employee's question using only the policy context below.
If the policy context does not contain the answer, say that the uploaded policy does not provide enough information.
Keep the answer clear, concise, and practical. Mention relevant section/page clues when available.

Policy context:
{context}

Question:
{question}

Answer:
`);

function requireOpenAIKey() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey || apiKey.includes("your_") || apiKey.length < 40) {
    const error = new Error("Add a real OpenAI API key in backend/.env, then restart the server.");
    error.statusCode = 500;
    throw error;
  }
}

function formatDocuments(docs) {
  return docs
    .map((doc, index) => {
      const page = doc.metadata?.loc?.pageNumber || doc.metadata?.page || "unknown";
      return `Source ${index + 1} (page ${page}):\n${doc.pageContent}`;
    })
    .join("\n\n");
}

const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173,http://127.0.0.1:5173")
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
    console.log("Upload request received");
    requireOpenAIKey();
    

    if (!req.file) {
      res.status(400).json({ error: "Please upload a PDF file." });
      return;
    }

    const loader = new PDFLoader(req.file.path, {
      splitPages: true
    });
    const pages = await loader.load();

    if (!pages.length) {
      res.status(400).json({ error: "No readable text was found in this PDF." });
      return;
    }

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 180
    });
    const chunks = await splitter.splitDocuments(pages);

    vectorStore = await MemoryVectorStore.fromDocuments(chunks, embeddings);
    activePolicy = {
      fileName: basename(req.file.originalname),
      uploadedAt: new Date().toISOString()
    };
    indexedChunks = chunks.length;

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

app.post("/api/chat", async (req, res, next) => {
  try {
    requireOpenAIKey();

    const question = String(req.body?.question || "").trim();
    if (!question) {
      res.status(400).json({ error: "Question is required." });
      return;
    }

    if (!vectorStore) {
      res.status(400).json({ error: "Upload and index a company policy PDF first." });
      return;
    }

    const docs = await vectorStore.similaritySearch(question, 5);
    const context = formatDocuments(docs);
    const chain = prompt.pipe(llm).pipe(new StringOutputParser());
    const answer = await chain.invoke({ context, question });

    res.json({
      answer,
      sources: docs.map((doc) => ({
        page: doc.metadata?.loc?.pageNumber || doc.metadata?.page || null,
        preview: doc.pageContent.slice(0, 220)
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const status = error.statusCode || 500;
  const isOpenAIAuthError = error.status === 401 || error.statusCode === 401 || error.code === "invalid_api_key";

  res.status(status).json({
    error: isOpenAIAuthError
      ? "OpenAI rejected the API key. Check backend/.env, paste a valid key, and restart the server."
      : error.message || "Something went wrong."
  });
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
