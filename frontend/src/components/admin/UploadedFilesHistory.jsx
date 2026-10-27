import React from "react";
import { FileText, CheckCircle2, History, Layers, Clock, HardDrive } from "lucide-react";

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDateTime(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return isoString;
  }
}

export default function UploadedFilesHistory({ uploads = [], activePolicyName }) {
  return (
    <div className="upload-history-card">
      <div className="upload-history-header">
        <div className="upload-history-title">
          <History size={18} className="text-accent" />
          <h3>Uploaded Files History</h3>
        </div>
        <span className="history-count-badge">
          {uploads.length} {uploads.length === 1 ? "file" : "files"}
        </span>
      </div>

      {uploads.length === 0 ? (
        <div className="upload-history-empty">
          <FileText size={32} className="muted-icon" />
          <p>No policy files uploaded yet.</p>
          <span>Uploaded PDF documents will appear here with index stats.</span>
        </div>
      ) : (
        <ul className="upload-history-list">
          {uploads.map((file) => {
            const isCurrent = file.isActive || (activePolicyName && file.originalName === activePolicyName);

            return (
              <li key={file.id} className={`upload-history-item ${isCurrent ? "active-item" : ""}`}>
                <div className="upload-file-icon">
                  <FileText size={20} />
                </div>
                <div className="upload-file-details">
                  <div className="upload-file-name-row">
                    <strong className="upload-file-name" title={file.originalName}>
                      {file.originalName}
                    </strong>
                    {isCurrent ? (
                      <span className="file-status-pill active">
                        <CheckCircle2 size={12} /> Active Policy
                      </span>
                    ) : (
                      <span className="file-status-pill archived">Archived</span>
                    )}
                  </div>
                  <div className="upload-file-meta">
                    <span>
                      <HardDrive size={12} className="meta-icon" /> {formatBytes(file.fileSize)}
                    </span>
                    <span>•</span>
                    <span>
                      <Layers size={12} className="meta-icon" /> {file.pageCount} {file.pageCount === 1 ? "page" : "pages"} ({file.chunksCount} chunks)
                    </span>
                    <span>•</span>
                    <span>
                      <Clock size={12} className="meta-icon" /> {formatDateTime(file.uploadedAt)}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
