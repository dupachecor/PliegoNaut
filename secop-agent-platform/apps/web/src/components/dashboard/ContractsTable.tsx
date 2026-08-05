"use client";

import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/utils";
import { ExternalLink, FileSearch, Eye, Calendar, MapPin, TrendingUp, Clock, Route } from "lucide-react";
import type { ContractMatch } from "@pliegonaut/types";
import { ContractDetailsModal } from "./ContractDetailsModal";

interface Props {
  contracts: ContractMatch[];
  isLoading: boolean;
  onSelectContract?: (id: string) => void;
}

export function ContractsTable({ contracts, isLoading, onSelectContract }: Props) {
  const [selectedContract, setSelectedContract] = useState<ContractMatch | null>(null);

  if (isLoading) {
    return (
      <div className="p-5 space-y-4">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="flex gap-4">
            <Skeleton className="h-16 flex-1 rounded-lg" />
            <Skeleton className="h-16 w-24 rounded-lg" />
            <Skeleton className="h-16 w-20 rounded-lg" />
            <Skeleton className="h-16 w-20 rounded-lg" />
            <Skeleton className="h-16 w-28 rounded-lg" />
          </div>
        ))}
      </div>
    );
  }

  if (contracts.length === 0) {
    return (
      <div className="p-12 text-center flex flex-col items-center justify-center">
        <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
          <FileSearch className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">No hay licitaciones</h3>
        <p className="text-sm text-muted-foreground max-w-sm mt-1">
          No se encontraron licitaciones con los filtros actuales. Intenta ajustar los filtros o ejecuta un escaneo SECOP.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto scrollbar-thin">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow className="hover:bg-transparent border-border">
              <TableHead className="min-w-[280px] font-semibold text-foreground">Licitación</TableHead>
              <TableHead className="font-semibold text-foreground text-right">Presupuesto</TableHead>
              <TableHead className="font-semibold text-foreground text-center">Estado</TableHead>
              <TableHead className="font-semibold text-foreground text-center">Match</TableHead>
              <TableHead className="font-semibold text-foreground text-center">Score</TableHead>
              <TableHead className="font-semibold text-foreground text-center">Cierre</TableHead>
              <TableHead className="text-right font-semibold text-foreground">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contracts.map((contract) => (
              <TableRow key={contract.id} className="hover:bg-muted/30 transition-colors border-border">
                <TableCell className="align-top py-4">
                  <div className="font-medium line-clamp-1" title={contract.entity}>
                    {contract.entity}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 line-clamp-2" title={contract.title}>
                    {contract.title}
                  </div>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-xs text-muted-foreground font-mono">{contract.secopId}</span>
                    {contract.department && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {contract.department}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="align-top py-4 text-right whitespace-nowrap">
                  <span className="font-semibold text-sm">{formatCurrency(contract.budget)}</span>
                  {contract.estimatedDuration && (
                    <p className="text-xs text-muted-foreground mt-0.5">{contract.estimatedDuration}</p>
                  )}
                </TableCell>
                <TableCell className="align-top py-4 text-center">
                  <StatusBadge status={contract.status} />
                </TableCell>
                <TableCell className="align-top py-4 text-center">
                  <MatchScoreBadge score={contract.matchScore} />
                </TableCell>
                <TableCell className="align-top py-4 text-center">
                  <ViabilityScoreBadge score={contract.viabilityScore} status={contract.status} />
                </TableCell>
                <TableCell className="align-top py-4 text-center">
                  <ClosingDateBadge date={contract.closingDate} />
                </TableCell>
                <TableCell className="align-top py-4 text-right">
                  <div className="flex justify-end gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs flex items-center gap-1.5"
                      onClick={() => setSelectedContract(contract)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Detalles
                    </Button>
                    {contract.presentationRoute && contract.status === "VIABLE" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs flex items-center gap-1.5 text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                        onClick={() => setSelectedContract(contract)}
                      >
                        <Route className="h-3.5 w-3.5" />
                        Ruta
                      </Button>
                    )}
                    <a href={contract.urlPliego} target="_blank" rel="noreferrer">
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-primary">
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
  const config: Record<string, { label: string; className: string }> = {
    PENDING_ANALYSIS: { label: "En Cola", className: "bg-slate-100 text-slate-600 border-slate-200" },
    PROCESSING: { label: "Analizando", className: "bg-amber-50 text-amber-700 border-amber-200 animate-pulse" },
    VIABLE: { label: "Viable", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    REJECTED: { label: "Descartada", className: "bg-red-50 text-red-700 border-red-200" },
    ERROR: { label: "Error", className: "bg-red-100 text-red-800 border-red-300" },
  };
  const c = config[status] || { label: status, className: "" };
  return <Badge variant="outline" className={c.className}>{c.label}</Badge>;
}

function MatchScoreBadge({ score }: { score: number }) {
  if (score === 0) return <span className="text-xs text-muted-foreground">-</span>;
  const color = score >= 70 ? "text-emerald-700 bg-emerald-50 border-emerald-200" :
    score >= 40 ? "text-amber-700 bg-amber-50 border-amber-200" :
    "text-slate-600 bg-slate-50 border-slate-200";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-bold border ${color}`}>
      <TrendingUp className="w-3 h-3" />
      {score}%
    </span>
  );
}

function ViabilityScoreBadge({ score, status }: { score: number | null; status: string }) {
  if (status !== "VIABLE" && status !== "REJECTED") return <span className="text-xs text-muted-foreground">-</span>;
  if (score === null) return <span className="text-xs text-muted-foreground">N/A</span>;
  const color = score >= 80 ? "text-emerald-700 bg-emerald-50 border-emerald-200" :
    score >= 50 ? "text-amber-700 bg-amber-50 border-amber-200" :
    "text-red-700 bg-red-50 border-red-200";
  return (
    <span className={`inline-flex items-center justify-center px-2 py-1 rounded-md text-xs font-bold border ${color}`}>
      {score}
    </span>
  );
}

function ClosingDateBadge({ date }: { date: string | null }) {
  if (!date) return <span className="text-xs text-muted-foreground">-</span>;
  const d = new Date(date);
  const days = Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const formatted = d.toLocaleDateString("es-CO", { day: "numeric", month: "short" });

  if (days < 0) {
    return <span className="text-xs text-muted-foreground line-through">{formatted}</span>;
  }
  if (days <= 3) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-bold bg-red-50 text-red-700 border border-red-200">
        <Clock className="w-3 h-3" />
        {days}d
      </span>
    );
  }
  if (days <= 7) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
        {days}d
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">{formatted}</span>;
}
