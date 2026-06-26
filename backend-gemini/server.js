import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import Groq from "groq-sdk";

dotenv.config();

const app = express();
const uploadDir = path.join(process.cwd(), "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5176,http://127.0.0.1:5176")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

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

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf" || path.extname(file.originalname).toLowerCase() === ".pdf") {
      cb(null, true);
      return;
    }
    cb(new Error("Only PDF files are allowed."));
  }
});

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

let uploadedPolicyText = "";
let uploadedPolicyName = "";

async function askGroq(question, context = "") {
  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: context
          ? `You are a helpful policy assistant. Answer from the uploaded policy context only. If the answer is not in the policy, say that the uploaded policy does not provide enough information.\n\nPolicy context:\n${context}`
          : "You are a helpful assistant."
      },
      { role: "user", content: question }
    ],
    temperature: 0.7
  });

  return response.choices?.[0]?.message?.content || "No response from Groq.";
}

app.post("/api/simple-chat", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    if (!message) {
      return res.status(400).json({ error: "Message is required." });
    }

    const reply = await askGroq(message);

    res.json({ reply, model: "llama-3.3-70b-versatile" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const question = String(req.body?.question || "").trim();
    if (!question) {
      return res.status(400).json({ error: "Question is required." });
    }

    const answer = await askGroq(question, uploadedPolicyText);

    res.json({ answer, sources: [] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/upload-policy", upload.single("policy"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Please upload a PDF file." });
    }

    const pdfParser = new PDFParse();
    const data = await pdfParser.parse(req.file.path);
    uploadedPolicyText = data.text?.slice(0, 12000) || "";
    uploadedPolicyName = req.file.originalname || "policy.pdf";

    fs.unlinkSync(req.file.path);

    res.json({
      message: "Policy indexed successfully.",
      policy: { fileName: uploadedPolicyName, uploadedAt: new Date().toISOString() },
      chunks: uploadedPolicyText ? 1 : 0
    });
  } catch (error) {
    console.error(error);
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, policy: uploadedPolicyName || null, ready: Boolean(uploadedPolicyText) });
});

app.post("/chat", async (req, res) => {
  const { question } = req.body;
  if (!question || !String(question).trim()) {
    return res.status(400).json({ error: "Question is required." });
  }
  const answer = await askGroq(String(question));
  res.json({ answer });
});

app.get("/", (_req, res) => {
  res.send("Groq Backend Running!");
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

const PORT = Number(process.env.PORT || 5003);

app.listen(PORT, () => {
  console.log(`🚀 Groq Backend Running on http://localhost:${PORT}`);
});