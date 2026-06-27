import {
  FileText,
  Database,
  MessageCircle,
  ShieldCheck,
  Users,
} from "lucide-react";

import StatCard from "./StatCard";

function DashboardCards({ policy, chunks, stats }) {
  return (
    <div className="dashboard-cards">
      <StatCard
        title="Documents"
        value={stats?.documentsUploaded ?? 0}
        icon={<FileText size={22} />}
      />

      <StatCard
        title="Users"
        value={stats?.users ?? 0}
        icon={<Users size={22} />}
      />

      <StatCard
        title="Questions"
        value={stats?.questionsAsked ?? 0}
        icon={<MessageCircle size={22} />}
      />

      <StatCard
        title="Indexed Chunks"
        value={chunks}
        icon={<Database size={22} />}
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