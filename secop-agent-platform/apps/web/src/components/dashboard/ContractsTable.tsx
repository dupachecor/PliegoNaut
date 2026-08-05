import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/utils";
import { ExternalLink, FileSearch, Eye } from "lucide-react";
import type { ContractMatch } from "@pliegonaut/types";
import { ContractDetailsModal } from "./ContractDetailsModal";

export function ContractsTable({ contracts, isLoading }: { contracts: ContractMatch[], isLoading: boolean }) {
  const [selectedContract, setSelectedContract] = useState<ContractMatch | null>(null);

  if (isLoading) {
    return (
      <div className="p-5 space-y-4">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }

  if (contracts.length === 0) {
    return (
      <div className="p-12 text-center flex flex-col items-center justify-center">
        <FileSearch className="h-12 w-12 text-slate-300 mb-4" />
        <h3 className="text-lg font-medium text-slate-900">No hay licitaciones</h3>
        <p className="text-sm text-slate-500 max-w-sm mt-1">
          No hemos encontrado licitaciones que coincidan con tu perfil actualmente. Haz clic en "Forzar Búsqueda" para revisar nuevamente.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader className="bg-slate-50/50">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[300px] font-semibold text-slate-700">Entidad / Título</TableHead>
              <TableHead className="font-semibold text-slate-700 text-right">Presupuesto</TableHead>
              <TableHead className="font-semibold text-slate-700 text-center">Estado</TableHead>
              <TableHead className="font-semibold text-slate-700 text-center">Score</TableHead>
              <TableHead className="text-right font-semibold text-slate-700">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contracts.map((contract) => (
              <TableRow key={contract.id} className="hover:bg-slate-50 transition-colors">
                <TableCell className="align-top py-4">
                  <div className="font-medium text-slate-900 line-clamp-1" title={contract.entity}>
                    {contract.entity}
                  </div>
                  <div className="text-xs text-slate-500 mt-1 line-clamp-2" title={contract.title}>
                    {contract.title}
                  </div>
                  <div className="text-xs text-slate-400 mt-2 font-mono">{contract.secopId}</div>
                </TableCell>
                <TableCell className="align-top py-4 text-right whitespace-nowrap">
                  <span className="font-medium text-slate-700">{formatCurrency(contract.budget)}</span>
                </TableCell>
                <TableCell className="align-top py-4 text-center">
                  <StatusBadge status={contract.status} />
                </TableCell>
                <TableCell className="align-top py-4 text-center">
                  <ScoreBadge score={contract.viabilityScore} status={contract.status} />
                </TableCell>
                <TableCell className="align-top py-4 text-right">
                  <div className="flex justify-end gap-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="h-8 text-xs flex items-center gap-1.5"
                      onClick={() => setSelectedContract(contract)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Ver Detalles
                    </Button>
                    <a href={contract.urlPliego} target="_blank" rel="noreferrer">
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-500 hover:text-indigo-600">
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </a>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ContractDetailsModal 
        contract={selectedContract} 
        isOpen={!!selectedContract} 
        onClose={() => setSelectedContract(null)} 
      />
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "PENDING_ANALYSIS":
      return <Badge variant="outline" className="bg-slate-100 text-slate-600 border-slate-200">En Cola</Badge>;
    case "PROCESSING":
      return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 animate-pulse">Analizando (IA)</Badge>;
    case "VIABLE":
      return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">Viable</Badge>;
    case "REJECTED":
      return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">Descartada</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function ScoreBadge({ score, status }: { score: number | null, status: string }) {
  if (status !== "VIABLE" && status !== "REJECTED") return <span className="text-xs text-slate-400">-</span>;
  if (score === null) return <span className="text-xs text-slate-400">N/A</span>;
  
  if (score >= 80) return <span className="inline-flex items-center justify-center px-2 py-1 rounded text-xs font-bold bg-emerald-100 text-emerald-800">{score}/100</span>;
  if (score >= 50) return <span className="inline-flex items-center justify-center px-2 py-1 rounded text-xs font-bold bg-amber-100 text-amber-800">{score}/100</span>;
  return <span className="inline-flex items-center justify-center px-2 py-1 rounded text-xs font-bold bg-red-100 text-red-800">{score}/100</span>;
}
