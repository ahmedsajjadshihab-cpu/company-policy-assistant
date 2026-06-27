import DashboardCards from "../components/admin/DashboardCards";
import React from "react";
import { Bot, FileText, Loader2, Send, ShieldCheck, UploadCloud, UserRound } from "lucide-react";
import { API_URL, getFriendlyError, readApiResponse } from "../lib/api.js";

function readStoredArray(key, fallback = []) {
  try {
    const saved = window.localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
}

function buildSimilarSuggestions(question, recentSearches) {
  const normalized = String(question || "").toLowerCase();
  const suggestions = [];

  if (normalized.includes("leave") || normalized.includes("holiday")) {
    suggestions.push("Annual leave policy");
  }
  if (normalized.includes("conduct") || normalized.includes("behavior")) {
    suggestions.push("Code of conduct");
  }
  if (normalized.includes("remote") || normalized.includes("work")) {
    suggestions.push("Remote work guidelines");
  }
  if (normalized.includes("benefit") || normalized.includes("salary") || normalized.includes("compensation")) {
    suggestions.push("Benefits overview");
  }

  recentSearches.forEach((item) => {
    if (item && item !== question) {
      suggestions.push(item);
    }
  });

  return [...new Set(suggestions)].slice(0, 5);
}

export default function PolicyPage({ role = "user" }) {
  const [file, setFile] = React.useState(null);
  const [policy, setPolicy] = React.useState(null);
  const [chunks, setChunks] = React.useState(0);
  const [uploading, setUploading] = React.useState(false);
  const [asking, setAsking] = React.useState(false);
  const [question, setQuestion] = React.useState("");
  const [messages, setMessages] = React.useState([
    {
      role: "assistant",
      text: "Upload a company policy PDF, then ask questions about rules, benefits, leave, conduct, or compliance."
    }
  ]);
  const [error, setError] = React.useState("");
  const [stats, setStats] = React.useState({ documentsUploaded: 0, questionsAsked: 0, users: 0 });
  const [recentSearches, setRecentSearches] = React.useState(() => readStoredArray("policy-recent", []));
  const [history, setHistory] = React.useState(() => readStoredArray("policy-history", []));
  const [similarSearches, setSimilarSearches] = React.useState([]);

  React.useEffect(() => {
    window.localStorage.setItem("policy-recent", JSON.stringify(recentSearches));
  }, [recentSearches]);

  React.useEffect(() => {
    window.localStorage.setItem("policy-history", JSON.stringify(history));
  }, [history]);

  React.useEffect(() => {
    async function refreshStats() {
      if (role !== "admin") return;

      try {
        const response = await fetch(`${API_URL}/api/admin-stats`);
        const data = await readApiResponse(response);
        if (response.ok) {
          setStats(data);
        }
      } catch {
        // ignore stat refresh failures
      }
    }

    refreshStats();
  }, [role]);

  async function refreshStats() {
    if (role !== "admin") return;

    try {
      const response = await fetch(`${API_URL}/api/admin-stats`);
      const data = await readApiResponse(response);
      if (response.ok) {
        setStats(data);
      }
    } catch {
      // ignore
    }
  }

  async function uploadPolicy(event) {
    event.preventDefault();
    if (!file) {
      setError("Choose a PDF policy document first.");
      return;
    }

    setUploading(true);
    setError("");

    const formData = new FormData();
    formData.append("policy", file);

    try {
      const response = await fetch(`${API_URL}/api/upload-policy`, {
        method: "POST",
        body: formData
      });
      const data = await readApiResponse(response);

      if (!response.ok) {
        throw new Error(data.error || "Upload failed.");
      }

      setPolicy(data.policy);
      setChunks(data.chunks);
      setMessages([
        {
          role: "assistant",
          text: `Policy indexed successfully. I can now answer questions from ${data.policy.fileName}.`
        }
      ]);
      await refreshStats();
    } catch (err) {
      setError(getFriendlyError(err));
    } finally {
      setUploading(false);
    }
  }

  async function askQuestion(event) {
    event.preventDefault();
    const cleanQuestion = question.trim();
    if (!cleanQuestion) return;

    setQuestion("");
    setAsking(true);
    setError("");
    setMessages((current) => [...current, { role: "user", text: cleanQuestion }]);

    try {
      const response = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: cleanQuestion })
      });
      const data = await readApiResponse(response);

      if (!response.ok) {
        throw new Error(data.error || "Could not get an answer.");
      }

      const answerText = data.answer || "I could not answer that yet.";
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: answerText,
          sources: data.sources || []
        }
      ]);

      const nextRecent = [cleanQuestion, ...recentSearches.filter((item) => item.toLowerCase() !== cleanQuestion.toLowerCase())].slice(0, 6);
      setRecentSearches(nextRecent);
      setHistory((current) => [
        {
          question: cleanQuestion,
          answer: answerText,
          grounded: Boolean(data.grounded),
          createdAt: new Date().toISOString()
        },
        ...current
      ].slice(0, 8));
      setSimilarSearches(buildSimilarSuggestions(cleanQuestion, nextRecent));
      await refreshStats();
    } catch (err) {
      setError(getFriendlyError(err));
      setMessages((current) => [
        ...current,
        { role: "assistant", text: "I could not answer that yet. Check the policy upload and backend setup." }
      ]);
    } finally {
      setAsking(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <ShieldCheck size={28} />
          </div>
          <div>
            <h1>Policy Assistant</h1>
            <p>{role === "admin" ? "Admin can upload and update company policy documents." : "Ask questions about company policies and guidance."}</p>
          </div>
        </div>

        {role === "admin" && (
          <DashboardCards
            policy={policy}
            chunks={chunks}
            stats={stats}
          />
        )}

        {role === "admin" ? (
          <form className="upload-panel" onSubmit={uploadPolicy}>
            <label className="file-drop">
              <UploadCloud size={28} />
              <span>{file ? file.name : "Choose policy PDF"}</span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
              />
            </label>
            <button className="primary-button" type="submit" disabled={uploading}>
              {uploading ? <Loader2 className="spin" size={18} /> : <FileText size={18} />}
              {uploading ? "Indexing..." : "Upload & Index"}
            </button>
          </form>
        ) : (
          <div className="upload-panel">
            <div className="status-panel" style={{ border: "0", padding: 0, background: "transparent" }}>
              <span className={policy ? "status-dot ready" : "status-dot"} />
              <div>
                <strong>Read-only access</strong>
                <p>Only admins can upload or update company documents.</p>
              </div>
            </div>
          </div>
        )}

        <div className="status-panel">
          <span className={policy ? "status-dot ready" : "status-dot"} />
          <div>
            <strong>{policy ? "Policy ready" : "No policy indexed"}</strong>
            <p>{policy ? `${policy.fileName} · ${chunks} chunks` : "Upload a PDF to begin."}</p>
          </div>
        </div>

        <div className="history-card">
          <h3>Recent searches</h3>
          {recentSearches.length ? (
            <div className="chip-row">
              {recentSearches.map((item) => (
                <button key={item} type="button" className="chip-button" onClick={() => setQuestion(item)}>
                  {item}
                </button>
              ))}
            </div>
          ) : (
            <p className="history-empty">Your recent searches will appear here.</p>
          )}
        </div>

        <div className="history-card">
          <h3>Similar searches</h3>
          {similarSearches.length ? (
            <div className="chip-row">
              {similarSearches.map((item) => (
                <button key={item} type="button" className="chip-button" onClick={() => setQuestion(item)}>
                  {item}
                </button>
              ))}
            </div>
          ) : (
            <p className="history-empty">Ask a question to see related suggestions.</p>
          )}
        </div>

        <div className="history-card">
          <h3>History</h3>
          {history.length ? (
            <ul className="history-list">
              {history.map((item, index) => (
                <li key={`${item.question}-${index}`}>
                  <strong>{item.question}</strong>
                  <span>{item.grounded ? "Grounded from PDF" : "General AI fallback"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="history-empty">Search history will appear after your first question.</p>
          )}
        </div>

        {error && <div className="error-box">{error}</div>}
      </section>

      <section className="chat-panel">
        <div className="chat-header">
          <div>
            <h2>Ask about company policy</h2>
            <p>Answers use the uploaded document as source context first, then general AI if needed.</p>
          </div>
        </div>

        <div className="messages" aria-live="polite">
          {messages.map((message, index) => (
            <article className={`message ${message.role}`} key={`${message.role}-${index}`}>
              <div className="avatar">
                {message.role === "assistant" ? <Bot size={18} /> : <UserRound size={18} />}
              </div>
              <div className="bubble">
                <p>{message.text}</p>
                {message.sources?.length > 0 && (
                  <div className="sources">
                    {message.sources.slice(0, 3).map((source, sourceIndex) => (
                      <div className="source" key={`${source.page}-${sourceIndex}`}>
                        <strong>Relevant snippet</strong>
                        <span>{source.preview}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </article>
          ))}
          {asking && (
            <article className="message assistant">
              <div className="avatar">
                <Bot size={18} />
              </div>
              <div className="bubble typing">
                <Loader2 className="spin" size={18} />
                Searching policy context...
              </div>
            </article>
          )}
        </div>

        <form className="composer" onSubmit={askQuestion}>
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Example: What is the annual leave policy?"
            disabled={asking}
          />
          <button className="send-button" type="submit" disabled={asking || !question.trim()}>
            <Send size={18} />
          </button>
        </form>
      </section>
    </main>
  );
}
