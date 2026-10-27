import React from "react";
import DashboardCards from "../components/admin/DashboardCards";
import SearchHistory from "../components/SearchHistory.jsx";
import UploadedFilesHistory from "../components/admin/UploadedFilesHistory.jsx";
import AccuracyBadge from "../components/AccuracyBadge.jsx";
import { Bot, FileText, Loader2, Send, ShieldCheck, UploadCloud, UserRound } from "lucide-react";
import { API_URL, getFriendlyError, readApiResponse } from "../lib/api.js";

export default function PolicyPage({ session }) {
  const role = session?.role || "user";
  const username = session?.username || "";
  const [file, setFile] = React.useState(null);
  const [policy, setPolicy] = React.useState(null);
  const [chunks, setChunks] = React.useState(0);
  const [uploading, setUploading] = React.useState(false);
  const [asking, setAsking] = React.useState(false);
  const [question, setQuestion] = React.useState("");
  const [messages, setMessages] = React.useState([
    {
      role: "assistant",
      text: "Upload a company policy PDF, then ask questions about rules, benefits, leave, conduct, or compliance. Each search result includes an AI accuracy score."
    }
  ]);
  const [error, setError] = React.useState("");
  const [searches, setSearches] = React.useState([]);
  const [uploads, setUploads] = React.useState([]);
  const [stats, setStats] = React.useState({ total: 0, users: 0, admins: 0, averageAccuracy: 0 });

  React.useEffect(() => {
    let cancelled = false;

    async function loadPolicyStatus() {
      try {
        const response = await fetch(`${API_URL}/api/health`);
        const data = await readApiResponse(response);

        if (!response.ok || cancelled) return;

        setPolicy(data.policy || null);
        setChunks(Number(data.chunks) || 0);
        if (data.policy) {
          setMessages([
            {
              role: "assistant",
              text: `A policy is ready. Ask me anything about ${data.policy.fileName}.`
            }
          ]);
        }
      } catch {
        // Handled when user tries an action
      }
    }

    loadPolicyStatus();
    loadSearches();
    loadUploads();

    return () => {
      cancelled = true;
    };
  }, []);

  async function loadSearches() {
    try {
      const params = new URLSearchParams({ username, role });
      const [historyResponse, statsResponse] = await Promise.all([
        fetch(`${API_URL}/api/searches?${params}`),
        fetch(`${API_URL}/api/search-stats`)
      ]);
      const historyData = await readApiResponse(historyResponse);
      const statsData = await readApiResponse(statsResponse);

      if (historyResponse.ok) {
        setSearches(historyData.searches || []);
      }
      if (statsResponse.ok) {
        setStats(statsData);
      }
    } catch {
      // Optional history during wake-up
    }
  }

  async function loadUploads() {
    if (role !== "admin") return;
    try {
      const response = await fetch(`${API_URL}/api/uploads`);
      const data = await readApiResponse(response);
      if (response.ok) {
        setUploads(data.uploads || []);
      }
    } catch {
      // Optional during wake-up
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
    formData.append("username", username);
    formData.append("role", role);

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
      setFile(null);
      if (data.uploads) {
        setUploads(data.uploads);
      } else {
        await loadUploads();
      }

      setMessages([
        {
          role: "assistant",
          text: `Policy indexed successfully. I can now answer questions from ${data.policy.fileName}.`
        }
      ]);
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
        body: JSON.stringify({ question: cleanQuestion, username, role })
      });
      const data = await readApiResponse(response);

      if (!response.ok) {
        throw new Error(data.error || "Could not get an answer.");
      }

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: data.answer,
          sources: data.sources || [],
          accuracy: data.accuracy,
          accuracyRate: data.accuracyRate ?? data.accuracy?.score
        }
      ]);
      await loadSearches();
    } catch (err) {
      setError(getFriendlyError(err));
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: "I could not answer that yet. Check the policy upload and backend setup."
        }
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
            <p>
              {role === "admin"
                ? "Admin portal: manage company policies, review upload history, and inspect all user searches."
                : "Ask questions about company policies, benefits, code of conduct, and guidance."}
            </p>
          </div>
        </div>

        {role === "admin" && (
          <DashboardCards
            policy={policy}
            chunks={chunks}
            stats={stats}
            uploadsCount={uploads.length}
          />
        )}

        {role === "admin" ? (
          <div className="admin-upload-section">
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

            <UploadedFilesHistory
              uploads={uploads}
              activePolicyName={policy?.fileName}
            />
          </div>
        ) : (
          <div className="upload-panel">
            <div className="status-panel" style={{ border: "0", padding: 0, background: "transparent" }}>
              <span className={policy ? "status-dot ready" : "status-dot"} />
              <div>
                <strong>Read-only access</strong>
                <p>Only administrators can upload or update company documents.</p>
              </div>
            </div>
          </div>
        )}

        <div className="status-panel">
          <span className={policy ? "status-dot ready" : "status-dot"} />
          <div>
            <strong>{policy ? "Active Policy Ready" : "No Policy Indexed"}</strong>
            <p>{policy ? `${policy.fileName} · ${chunks} chunks indexed` : "Upload a PDF document to begin."}</p>
          </div>
        </div>

        <SearchHistory searches={searches} role={role} />

        {error && <div className="error-box">{error}</div>}
      </section>

      <section className="chat-panel">
        <div className="chat-header">
          <div>
            <h2>Ask about company policy</h2>
            <p>Answers are grounded in indexed policy documents with real-time AI accuracy scoring.</p>
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
                {(message.accuracy || typeof message.accuracyRate === "number") && (
                  <AccuracyBadge accuracy={message.accuracy || message.accuracyRate} />
                )}
                {message.sources?.length > 0 && (
                  <div className="sources">
                    {message.sources.slice(0, 3).map((source, sourceIndex) => (
                      <div className="source" key={`${source.page}-${sourceIndex}`}>
                        <strong>Page {source.page || "?"}</strong>
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
                Searching policy context & computing reliability score...
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
