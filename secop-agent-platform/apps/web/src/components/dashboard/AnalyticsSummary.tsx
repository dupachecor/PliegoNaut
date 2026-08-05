import { Card, CardContent } from "@/components/ui/card";
import { FileText, CheckCircle, Clock, AlertTriangle } from "lucide-react";
import type { ContractMatch } from "@pliegonaut/types";

export function AnalyticsSummary({ contracts }: { contracts: ContractMatch[] }) {
  const stats = {
    total: contracts.length,
    viable: contracts.filter(c => c.status === "VIABLE").length,
    pending: contracts.filter(c => c.status === "PENDING_ANALYSIS" || c.status === "PROCESSING").length,
    discarded: contracts.filter(c => c.status === "REJECTED").length,
  };

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard 
        title="Licitaciones Totales" 
        value={stats.total} 
        icon={<FileText className="h-5 w-5 text-blue-600" />} 
        bg="bg-blue-50" 
      />
      <StatCard 
        title="Altamente Viables" 
        value={stats.viable} 
        icon={<CheckCircle className="h-5 w-5 text-emerald-600" />} 
        bg="bg-emerald-50" 
      />
      <StatCard 
        title="En Análisis (IA)" 
        value={stats.pending} 
        icon={<Clock className="h-5 w-5 text-amber-600" />} 
        bg="bg-amber-50" 
      />
      <StatCard 
        title="Descartadas" 
        value={stats.discarded} 
        icon={<AlertTriangle className="h-5 w-5 text-red-600" />} 
        bg="bg-red-50" 
      />
    </div>
  );
}

function StatCard({ title, value, icon, bg }: { title: string, value: number, icon: React.ReactNode, bg: string }) {
  return (
    <Card className="border border-slate-200 shadow-sm overflow-hidden">
      <CardContent className="p-5">
        <div className="flex justify-between items-start">
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{title}</p>
            <p className="text-3xl font-bold text-slate-900">{value}</p>
          </div>
          <div className={`p-2.5 rounded-lg ${bg}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
