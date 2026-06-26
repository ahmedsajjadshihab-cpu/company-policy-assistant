import React from "react";
import { Bot, FileText, Loader2, Send, ShieldCheck, UploadCloud, UserRound } from "lucide-react";
import { API_URL, getFriendlyError, readApiResponse } from "../lib/api.js";

export default function PolicyPage() {
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

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: data.answer,
          sources: data.sources || []
        }
      ]);
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
            <p>Company rules, grounded in your PDF.</p>
          </div>
        </div>

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

        <div className="status-panel">
          <span className={policy ? "status-dot ready" : "status-dot"} />
          <div>
            <strong>{policy ? "Policy ready" : "No policy indexed"}</strong>
            <p>{policy ? `${policy.fileName} · ${chunks} chunks` : "Upload a PDF to begin."}</p>
          </div>
        </div>

        {error && <div className="error-box">{error}</div>}
      </section>

      <section className="chat-panel">
        <div className="chat-header">
          <div>
            <h2>Ask about company policy</h2>
            <p>Answers use the uploaded document as source context.</p>
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
