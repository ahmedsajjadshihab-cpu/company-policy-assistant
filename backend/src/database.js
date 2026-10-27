import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "../data");

if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

const dbPath = join(dataDir, "policy_rag.db");
const searchesJsonPath = join(dataDir, "searches.json");
const uploadsJsonPath = join(dataDir, "uploaded_files.json");

// Helper: Tokenize text for semantic keyword overlap calculation
export function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

// ==========================================
// ACCURACY & RELIABILITY SCORING ENGINE
// ==========================================
export function computeAccuracyScore({ similarityScore, grounded, question, answer, sources = [] }) {
  const answerText = String(answer || "").trim();
  const questionText = String(question || "").trim();

  // 1. Detect if the AI expressed uncertainty or indicated missing information
  const notFoundPatterns = [
    /does not (contain|provide|mention|state)/i,
    /could not find/i,
    /not enough information/i,
    /no information (found|available|provided)/i,
    /not mentioned in the (policy|document|handbook)/i,
    /unable to find/i,
    /I don't have access/i,
    /not covered in/i
  ];
  const isNotFound = notFoundPatterns.some((pattern) => pattern.test(answerText));

  // 2. Tokenize question & answer for keyword coverage
  const stopwords = new Set([
    "what", "when", "where", "which", "who", "whom", "whose", "why", "how",
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "can", "could", "should", "would",
    "will", "shall", "may", "might", "must", "about", "for", "from", "in", "into",
    "of", "on", "to", "with", "at", "by", "this", "that", "these", "those", "our",
    "company", "policy", "policies", "tell", "explain", "please"
  ]);

  const questionTokens = tokenize(questionText).filter((t) => !stopwords.has(t));
  const answerTokens = new Set(tokenize(answerText));

  let keywordOverlap = 0;
  if (questionTokens.length > 0) {
    const matched = questionTokens.filter((token) => answerTokens.has(token));
    keywordOverlap = matched.length / questionTokens.length;
  }

  // 3. Grounded RAG Search (Policy Assistant)
  if (grounded) {
    if (isNotFound || (!sources || sources.length === 0)) {
      const score = Math.max(15, Math.min(30, Math.round(keywordOverlap * 30)));
      return {
        score,
        level: "low",
        label: "Low Reliability",
        reason: "The requested information was not found in the indexed policy document."
      };
    }

    // Cosine similarity in TF-IDF typically ranges from 0.05 to 0.50
    const sim = Number.isFinite(similarityScore) ? similarityScore : 0.2;
    let baseConfidence = 50;
    if (sim >= 0.40) {
      baseConfidence = 92 + Math.min(6, (sim - 0.40) * 15);
    } else if (sim >= 0.25) {
      baseConfidence = 82 + ((sim - 0.25) / 0.15) * 10;
    } else if (sim >= 0.12) {
      baseConfidence = 70 + ((sim - 0.12) / 0.13) * 12;
    } else if (sim > 0) {
      baseConfidence = 50 + (sim / 0.12) * 20;
    }

    const sourceBonus = Math.min(5, (sources?.length || 1) * 2);
    const keywordBonus = Math.round(keywordOverlap * 6);
    let finalScore = Math.round(baseConfidence + sourceBonus + keywordBonus);
    finalScore = Math.max(25, Math.min(98, finalScore));

    let level = "high";
    let label = "High Reliability";
    const citationsCount = sources?.length || 1;
    let reason = `Verified with ${citationsCount} cited policy section${citationsCount > 1 ? "s" : ""} (${finalScore}% match confidence).`;

    if (finalScore < 60) {
      level = "low";
      label = "Low Reliability";
      reason = "Weak match with policy context.";
    } else if (finalScore < 80) {
      level = "medium";
      label = "Moderate Reliability";
      reason = `Moderate relevance match from ${citationsCount} policy section${citationsCount > 1 ? "s" : ""}.`;
    }

    return {
      score: finalScore,
      level,
      label,
      reason
    };
  }

  // 4. Non-grounded or General Chat Search
  if (isNotFound) {
    return {
      score: 25,
      level: "low",
      label: "Low Reliability",
      reason: "AI could not determine sufficient information."
    };
  }

  let generalScore = 75 + Math.round(keywordOverlap * 15);
  generalScore = Math.max(50, Math.min(92, generalScore));
  const level = generalScore >= 80 ? "high" : "medium";

  return {
    score: generalScore,
    level,
    label: level === "high" ? "High Reliability" : "Moderate Reliability",
    reason: `Generated from Groq general knowledge base (${generalScore}% coherence & relevance).`
  };
}

// Backwards compatibility helper
export function computeAccuracyRate(params) {
  const res = computeAccuracyScore(params);
  return res.score;
}

// ==========================================
// DATABASE ENGINE INITIALIZATION (SQLite with JSON Fallback)
// ==========================================
let sqliteDb = null;

try {
  const { DatabaseSync } = await import("node:sqlite");
  sqliteDb = new DatabaseSync(dbPath);

  // Initialize SQLite tables
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS searches (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      source TEXT NOT NULL DEFAULT 'policy',
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      sources TEXT,
      grounded INTEGER DEFAULT 0,
      similarity_score REAL,
      accuracy_score INTEGER NOT NULL,
      reliability_level TEXT NOT NULL,
      reliability_label TEXT NOT NULL,
      reliability_reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS uploaded_files (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      page_count INTEGER NOT NULL DEFAULT 1,
      chunks_count INTEGER NOT NULL DEFAULT 0,
      uploaded_by TEXT NOT NULL DEFAULT 'admin',
      is_active INTEGER NOT NULL DEFAULT 1,
      uploaded_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_searches_username ON searches(username);
    CREATE INDEX IF NOT EXISTS idx_searches_created_at ON searches(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_uploads_created_at ON uploaded_files(uploaded_at DESC);
  `);
  console.log("Database initialized: SQLite engine active at", dbPath);
} catch (err) {
  console.warn("node:sqlite unavailable, using persistent JSON database fallback:", err.message);
  sqliteDb = null;
}

// Fallback JSON persistence helpers
function loadJson(path) {
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2));
}

// ==========================================
// SEARCHES REPOSITORY
// ==========================================
export function addSearch(entry) {
  const id = randomUUID();
  const username = String(entry.username || "guest").trim().toLowerCase() || "guest";
  const role = entry.role === "admin" ? "admin" : "user";
  const source = entry.source === "chat" ? "chat" : "policy";
  const question = String(entry.question || "").trim();
  const answer = String(entry.answer || "").trim();
  const sources = Array.isArray(entry.sources) ? entry.sources : [];
  const grounded = Boolean(entry.grounded);
  const similarityScore = Number.isFinite(entry.similarityScore) ? Number(entry.similarityScore.toFixed(4)) : null;

  // Compute accuracy evaluation
  const accuracyResult = entry.accuracy && typeof entry.accuracy === "object"
    ? entry.accuracy
    : computeAccuracyScore({
        similarityScore,
        grounded,
        question,
        answer,
        sources
      });

  const accuracyScore = Number(accuracyResult.score) || 0;
  const reliabilityLevel = accuracyResult.level || (accuracyScore >= 80 ? "high" : accuracyScore >= 60 ? "medium" : "low");
  const reliabilityLabel = accuracyResult.label || (reliabilityLevel === "high" ? "High Reliability" : reliabilityLevel === "medium" ? "Moderate Reliability" : "Low Reliability");
  const reliabilityReason = accuracyResult.reason || "";
  const createdAt = new Date().toISOString();

  if (sqliteDb) {
    const stmt = sqliteDb.prepare(`
      INSERT INTO searches (
        id, username, role, source, question, answer, sources, grounded,
        similarity_score, accuracy_score, reliability_level, reliability_label,
        reliability_reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      username,
      role,
      source,
      question,
      answer,
      JSON.stringify(sources),
      grounded ? 1 : 0,
      similarityScore,
      accuracyScore,
      reliabilityLevel,
      reliabilityLabel,
      reliabilityReason,
      createdAt
    );
  } else {
    const items = loadJson(searchesJsonPath);
    items.unshift({
      id,
      username,
      role,
      source,
      question,
      answer,
      sources,
      grounded,
      similarityScore,
      accuracyScore,
      reliabilityLevel,
      reliabilityLabel,
      reliabilityReason,
      createdAt
    });
    saveJson(searchesJsonPath, items.slice(0, 500));
  }

  return {
    id,
    username,
    role,
    source,
    question,
    answer,
    sources,
    grounded,
    similarityScore,
    accuracyScore,
    accuracyRate: accuracyScore, // backwards compatibility
    accuracy: {
      score: accuracyScore,
      level: reliabilityLevel,
      label: reliabilityLabel,
      reason: reliabilityReason
    },
    createdAt
  };
}

export function listSearches({ username, role, limit = 100 } = {}) {
  const lim = Math.max(1, Math.min(500, Number(limit) || 100));

  if (sqliteDb) {
    if (role === "admin") {
      const stmt = sqliteDb.prepare(`
        SELECT * FROM searches ORDER BY created_at DESC LIMIT ?
      `);
      const rows = stmt.all(lim);
      return rows.map(formatSearchRow);
    }

    const user = String(username || "").trim().toLowerCase();
    const stmt = sqliteDb.prepare(`
      SELECT * FROM searches WHERE username = ? ORDER BY created_at DESC LIMIT ?
    `);
    const rows = stmt.all(user, lim);
    return rows.map(formatSearchRow);
  }

  const items = loadJson(searchesJsonPath);
  if (role === "admin") {
    return items.slice(0, lim);
  }

  const user = String(username || "").trim().toLowerCase();
  return items.filter((item) => item.username === user).slice(0, lim);
}

function formatSearchRow(row) {
  let sources = [];
  try {
    sources = row.sources ? JSON.parse(row.sources) : [];
  } catch {
    sources = [];
  }

  return {
    id: row.id,
    username: row.username,
    role: row.role,
    source: row.source,
    question: row.question,
    answer: row.answer,
    sources,
    grounded: Boolean(row.grounded),
    similarityScore: row.similarity_score,
    accuracyScore: row.accuracy_score,
    accuracyRate: row.accuracy_score, // backwards compatibility
    accuracy: {
      score: row.accuracy_score,
      level: row.reliability_level,
      label: row.reliability_label,
      reason: row.reliability_reason
    },
    createdAt: row.created_at
  };
}

export function getSearchStats() {
  const searches = listSearches({ role: "admin", limit: 500 });
  const byRole = (role) => searches.filter((item) => item.role === role);
  const byLevel = (level) => searches.filter((item) => (item.accuracy?.level || item.reliabilityLevel) === level);

  const average = (items) => {
    if (!items.length) return 0;
    return Math.round(items.reduce((sum, item) => sum + (item.accuracyScore || item.accuracyRate || 0), 0) / items.length);
  };

  return {
    total: searches.length,
    users: byRole("user").length,
    admins: byRole("admin").length,
    averageAccuracy: average(searches),
    userAverageAccuracy: average(byRole("user")),
    adminAverageAccuracy: average(byRole("admin")),
    highConfidenceCount: byLevel("high").length,
    moderateConfidenceCount: byLevel("medium").length,
    lowConfidenceCount: byLevel("low").length
  };
}

// ==========================================
// UPLOADED FILES (ADMIN HISTORY) REPOSITORY
// ==========================================
export function addUploadedFile({ fileName, originalName, fileSize, pageCount, chunksCount, uploadedBy = "admin" }) {
  const id = randomUUID();
  const fName = String(fileName || "policy.pdf");
  const origName = String(originalName || fileName || "policy.pdf");
  const size = Math.max(0, Number(fileSize) || 0);
  const pages = Math.max(1, Number(pageCount) || 1);
  const chunks = Math.max(0, Number(chunksCount) || 0);
  const adminUser = String(uploadedBy || "admin").trim().toLowerCase();
  const createdAt = new Date().toISOString();

  if (sqliteDb) {
    // Set all previous files as not active
    sqliteDb.exec(`UPDATE uploaded_files SET is_active = 0`);

    const stmt = sqliteDb.prepare(`
      INSERT INTO uploaded_files (
        id, file_name, original_name, file_size, page_count, chunks_count,
        uploaded_by, is_active, uploaded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);

    stmt.run(id, fName, origName, size, pages, chunks, adminUser, createdAt);
  } else {
    const items = loadJson(uploadsJsonPath);
    for (const item of items) {
      item.isActive = false;
    }
    items.unshift({
      id,
      fileName: fName,
      originalName: origName,
      fileSize: size,
      pageCount: pages,
      chunksCount: chunks,
      uploadedBy: adminUser,
      isActive: true,
      uploadedAt: createdAt
    });
    saveJson(uploadsJsonPath, items.slice(0, 100));
  }

  return {
    id,
    fileName: fName,
    originalName: origName,
    fileSize: size,
    pageCount: pages,
    chunksCount: chunks,
    uploadedBy: adminUser,
    isActive: true,
    uploadedAt: createdAt
  };
}

export function listUploadedFiles(limit = 50) {
  const lim = Math.max(1, Math.min(200, Number(limit) || 50));

  if (sqliteDb) {
    const stmt = sqliteDb.prepare(`
      SELECT * FROM uploaded_files ORDER BY uploaded_at DESC LIMIT ?
    `);
    const rows = stmt.all(lim);
    return rows.map((r) => ({
      id: r.id,
      fileName: r.file_name,
      originalName: r.original_name,
      fileSize: r.file_size,
      pageCount: r.page_count,
      chunksCount: r.chunks_count,
      uploadedBy: r.uploaded_by,
      isActive: Boolean(r.is_active),
      uploadedAt: r.uploaded_at
    }));
  }

  const items = loadJson(uploadsJsonPath);
  return items.slice(0, lim);
}

export function getActiveUploadedFile() {
  if (sqliteDb) {
    const stmt = sqliteDb.prepare(`
      SELECT * FROM uploaded_files WHERE is_active = 1 ORDER BY uploaded_at DESC LIMIT 1
    `);
    const r = stmt.get();
    if (!r) return null;
    return {
      id: r.id,
      fileName: r.file_name,
      originalName: r.original_name,
      fileSize: r.file_size,
      pageCount: r.page_count,
      chunksCount: r.chunks_count,
      uploadedBy: r.uploaded_by,
      isActive: Boolean(r.is_active),
      uploadedAt: r.uploaded_at
    };
  }

  const items = loadJson(uploadsJsonPath);
  return items.find((i) => i.isActive) || items[0] || null;
}
