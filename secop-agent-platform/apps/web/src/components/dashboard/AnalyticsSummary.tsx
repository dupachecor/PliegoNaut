import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, CheckCircle, Clock, AlertTriangle, TrendingUp, Calendar, Radar } from "lucide-react";
import type { ContractMatch } from "@pliegonaut/types";

interface Props {
  contracts: ContractMatch[];
  summary?: {
    total: number;
    pending: number;
    processing: number;
    viable: number;
    rejected: number;
  };
  isLoading?: boolean;
}

export function AnalyticsSummary({ contracts, summary, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <Card key={i} className="border-border shadow-sm">
            <CardContent className="p-5">
              <Skeleton className="h-3 w-20 mb-3" />
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const stats = summary ?? {
    total: contracts.length,
    viable: contracts.filter(c => c.status === "VIABLE").length,
    pending: contracts.filter(c => c.status === "PENDING_ANALYSIS" || c.status === "PROCESSING").length,
    rejected: contracts.filter(c => c.status === "REJECTED").length,
  };

  const closingSoon = contracts.filter(c => {
    if (!c.closingDate) return false;
    const days = Math.ceil((new Date(c.closingDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return days <= 7 && days > 0;
  }).length;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        title="Licitaciones"
        value={stats.total}
        icon={<Radar className="h-5 w-5" />}
        color="text-primary"
        bgColor="bg-primary/10"
      />
      <StatCard
        title="Altamente Viables"
        value={stats.viable}
        icon={<CheckCircle className="h-5 w-5" />}
        color="text-emerald-600"
        bgColor="bg-emerald-500/10"
        subtitle={stats.total > 0 ? `${Math.round((stats.viable / stats.total) * 100)}% del total` : undefined}
      />
      <StatCard
        title="En Análisis"
        value={stats.pending}
        icon={<Clock className="h-5 w-5" />}
        color="text-amber-600"
        bgColor="bg-amber-500/10"
      />
      <StatCard
        title="Cierre Próximo"
        value={closingSoon}
        icon={<Calendar className="h-5 w-5" />}
        color="text-red-600"
        bgColor="bg-red-500/10"
        subtitle="≤ 7 días"
      />
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  color,
  bgColor,
  subtitle,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  subtitle?: string;
}) {
  return (
    <Card className="border-border shadow-sm hover:shadow-md transition-shadow">
      <CardContent className="p-5">
        <div className="flex justify-between items-start">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
            <p className="text-3xl font-bold tracking-tight">{value}</p>
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <div className={`p-2.5 rounded-xl ${bgColor} ${color}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
