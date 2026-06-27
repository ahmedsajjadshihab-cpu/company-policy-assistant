import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import multer from "multer";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Groq from "groq-sdk";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

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

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 900,
  chunkOverlap: 120
});

let uploadedPolicyText = "";
let activePolicy = null;
let indexedChunks = 0;
let policyChunks = [];
let stats = {
  documentsUploaded: 0,
  questionsAsked: 0,
  users: 0
};
let knownUsers = new Set();

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const execFileAsync = promisify(execFile);

async function extractPdfText(pdfFilePath) {
  const scriptPath = join(__dirname, "extract_pdf_text.py");
  const { stdout } = await execFileAsync("python3", [scriptPath, pdfFilePath], {
    cwd: __dirname
  });
  return String(stdout || "")
    .replace(/\s+/g, " ")
    .trim();
}

const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5176,http://127.0.0.1:5176")
  .split(",")
  .map((origin) => origin.trim());

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreChunk(question, chunkText) {
  const questionTokens = new Set(normalizeText(question).split(" ").filter(Boolean));
  const chunkTokens = new Set(normalizeText(chunkText).split(" ").filter(Boolean));
  const overlap = [...questionTokens].filter((token) => chunkTokens.has(token)).length;

  if (questionTokens.size === 0) {
    return 0;
  }

  const keywordScore = overlap / questionTokens.size;
  const phraseScore = normalizeText(chunkText).includes(normalizeText(question)) ? 0.2 : 0;
  return keywordScore + phraseScore;
}

function retrieveRelevantChunks(question) {
  if (!policyChunks.length) {
    return [];
  }

  return policyChunks
    .map((chunk) => ({ ...chunk, score: scoreChunk(question, chunk.text) }))
    .filter((chunk) => chunk.score >= 0.12)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
}

async function askGroq({ systemContent, userContent }) {
  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: userContent }
    ],
    temperature: 0.7
  });

  return response.choices?.[0]?.message?.content || "No response from Groq.";
}

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
    ready: Boolean(uploadedPolicyText)
  });
});

app.post("/api/upload-policy", upload.single("policy"), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "Please upload a PDF file." });
      return;
    }

    const parsedText = await extractPdfText(req.file.path);

    if (!parsedText) {
      throw new Error("The uploaded PDF did not contain readable text.");
    }

    const splitChunks = (await splitter.splitText(parsedText))
      .map((chunk) => chunk.trim())
      .filter(Boolean);

    uploadedPolicyText = splitChunks.join("\n\n");
    policyChunks = splitChunks.map((chunk) => ({ text: chunk, source: req.file.originalname || "policy.pdf" }));
    indexedChunks = policyChunks.length;
    activePolicy = {
      fileName: req.file.originalname || "policy.pdf",
      uploadedAt: new Date().toISOString(),
      textLength: parsedText.length
    };
    stats.documentsUploaded += 1;

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

app.post("/api/track-login", (req, res) => {
  const username = String(req.body?.username || "").trim().toLowerCase();
  if (username) {
    if (!knownUsers.has(username)) {
      knownUsers.add(username);
      stats.users = knownUsers.size;
    }
  }

  res.json({ ok: true, users: stats.users });
});

app.get("/api/admin-stats", (_req, res) => {
  res.json({
    documentsUploaded: stats.documentsUploaded,
    questionsAsked: stats.questionsAsked,
    users: stats.users
  });
});

app.post("/api/simple-chat", async (req, res, next) => {
  try {
    const message = String(req.body?.message || "").trim();
    if (!message) {
      res.status(400).json({ error: "Message is required." });
      return;
    }

    const reply = await askGroq({
      systemContent: "You are a helpful assistant.",
      userContent: message
    });

    res.json({
      reply,
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

    stats.questionsAsked += 1;

    if (!uploadedPolicyText || !policyChunks.length) {
      res.json({
        answer: "No policy document has been uploaded yet. I can still help with a general answer, but the uploaded PDF context is not available.",
        sources: [],
        grounded: false,
        fallbackUsed: true
      });
      return;
    }

    const relevantChunks = retrieveRelevantChunks(question);

    if (relevantChunks.length > 0) {
      const contextText = relevantChunks.map((chunk) => chunk.text).join("\n\n");
      const answer = await askGroq({
        systemContent: [
          "You are a policy support assistant.",
          "Answer using only the uploaded PDF policy context provided below.",
          "If the answer appears in the policy, respond clearly and concisely from that context.",
          "Do not invent facts that are not in the uploaded policy."
        ].join(" "),
        userContent: `Question: ${question}\n\nPolicy context:\n${contextText}`
      });

      res.json({
        answer,
        sources: relevantChunks.map((chunk) => ({
          page: 1,
          preview: chunk.text.slice(0, 140)
        })),
        grounded: true,
        fallbackUsed: false
      });
      return;
    }

    const fallbackAnswer = await askGroq({
      systemContent: [
        "You are a helpful assistant.",
        "The uploaded policy does not contain enough information for this topic.",
        "Provide a brief general answer only as a fallback, and clearly note that the uploaded policy did not provide enough information."
      ].join(" "),
      userContent: question
    });

    res.json({
      answer: `The uploaded policy does not contain enough information for this topic. Here is a general AI answer instead:\n\n${fallbackAnswer}`,
      sources: [],
      grounded: false,
      fallbackUsed: true
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
