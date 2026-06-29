import {
  FileText,
  Database,
  MessageCircle,
  ShieldCheck,
} from "lucide-react";

import StatCard from "./StatCard";

function DashboardCards({ policy, chunks, messages }) {
  return (
    <div className="dashboard-cards">
      <StatCard
        title="Documents"
        value={policy ? 1 : 0}
        icon={<FileText size={22} />}
      />

      <StatCard
        title="Indexed Chunks"
        value={chunks}
        icon={<Database size={22} />}
      />

      <StatCard
        title="Questions"
        value={messages.length}
        icon={<MessageCircle size={22} />}
      />

      <StatCard
        title="Status"
        value={policy ? "Ready" : "Waiting"}
        icon={<ShieldCheck size={22} />}
      />
    </div>
  );
}

export default DashboardCards;