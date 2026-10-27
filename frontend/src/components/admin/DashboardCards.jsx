import {
  FileText,
  Database,
  MessageCircle,
  ShieldCheck,
  Percent,
  Users
} from "lucide-react";

import StatCard from "./StatCard";

function DashboardCards({ policy, chunks, stats, uploadsCount }) {
  return (
    <div className="dashboard-cards">
      <StatCard
        title="Uploaded Files"
        value={typeof uploadsCount === "number" ? uploadsCount : (policy ? 1 : 0)}
        icon={<FileText size={22} />}
      />

      <StatCard
        title="Indexed Chunks"
        value={chunks}
        icon={<Database size={22} />}
      />

      <StatCard
        title="Searches Stored"
        value={stats?.total ?? 0}
        icon={<MessageCircle size={22} />}
      />

      <StatCard
        title="Avg Accuracy"
        value={`${stats?.averageAccuracy ?? 0}%`}
        icon={<Percent size={22} />}
      />

      <StatCard
        title="User Searches"
        value={stats?.users ?? 0}
        icon={<Users size={22} />}
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
