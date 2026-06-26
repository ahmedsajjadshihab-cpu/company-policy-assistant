import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import multer from "multer";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Groq from "groq-sdk";
import pdfParse from "pdf-parse";

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

let uploadedPolicyText = "";
let activePolicy = null;
let indexedChunks = 0;

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
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

    const data = await pdfParse(req.file.path);
    uploadedPolicyText = (data.text || "").slice(0, 12000);
    activePolicy = {
      fileName: req.file.originalname || "policy.pdf",
      uploadedAt: new Date().toISOString()
    };
    indexedChunks = uploadedPolicyText ? 1 : 0;

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

    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: message }],
      temperature: 0.7
    });

    res.json({
      reply: response.choices?.[0]?.message?.content || "No response from Groq.",
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

    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: uploadedPolicyText
            ? `You are a helpful policy assistant. Answer using only the uploaded policy content below. If the answer is not in the policy, say that the uploaded policy does not provide enough information.\n\nPolicy content:\n${uploadedPolicyText}`
            : "You are a helpful policy assistant."
        },
        { role: "user", content: question }
      ],
      temperature: 0.7
    });

    res.json({
      answer: response.choices?.[0]?.message?.content || "No response from Groq.",
      sources: []
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
