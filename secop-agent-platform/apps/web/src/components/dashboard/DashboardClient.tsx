"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Company, ContractMatch } from "@pliegonaut/types";

import { fetchCompanies, fetchContracts, triggerScanner } from "@/lib/api";
import { ToastContainer, type Toast } from "@/components/ToastContainer";
import { CompanySelector } from "./CompanySelector";
import { ContractsTable } from "./ContractsTable";
import { DashboardHeader } from "./DashboardHeader";
import { AnalyticsSummary } from "./AnalyticsSummary";
import { Button } from "@/components/ui/button";
import { RefreshCcw, Search } from "lucide-react";

export default function DashboardClient({ user }: { user: any }) {
  const queryClient = useQueryClient();
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: Toast["type"] = "info") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const companiesQuery = useQuery<Company[]>({
    queryKey: ["companies"],
    queryFn: fetchCompanies,
  });

  const companies = companiesQuery.data ?? [];

  // Auto-seleccionar la primera empresa si no hay ninguna
  if (!selectedCompanyId && companies.length > 0) {
    setSelectedCompanyId(companies[0].id);
  }

  const contractsQuery = useQuery({
    queryKey: ["contracts", selectedCompanyId],
    queryFn: () => fetchContracts(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 5000, 
  });

  const contracts = contractsQuery.data?.data ?? [];

  const scannerMutation = useMutation({
    mutationFn: triggerScanner,
    onSuccess: () => {
      addToast("Escaneo de SECOP iniciado. Las licitaciones aparecerán pronto.", "success");
      queryClient.invalidateQueries({ queryKey: ["contracts"] });
    },
    onError: (err: Error) => addToast(`Error: ${err.message}`, "error"),
  });

  const filteredContracts = contracts; // Ya están filtrados por la API

  return (
    <div className="flex flex-col gap-8 w-full max-w-7xl mx-auto">
      <DashboardHeader user={user} />
      
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Sidebar / Options */}
        <div className="lg:col-span-1 space-y-6">
          <CompanySelector 
            companies={companies} 
            selectedId={selectedCompanyId} 
            onSelect={setSelectedCompanyId} 
            isLoading={companiesQuery.isLoading}
          />

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="font-semibold text-sm text-slate-900 mb-3">Acciones Rápidas</h3>
            <Button 
              onClick={() => scannerMutation.mutate()} 
              disabled={scannerMutation.isPending}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm flex items-center gap-2"
            >
              {scannerMutation.isPending ? <RefreshCcw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {scannerMutation.isPending ? "Buscando..." : "Forzar Búsqueda SECOP"}
            </Button>
            <p className="text-xs text-slate-500 mt-3 text-center">
              Busca nuevas licitaciones en SECOP según el perfil de tu empresa.
            </p>
          </div>
        </div>

        {/* Main Content */}
        <div className="lg:col-span-3 space-y-6">
          <AnalyticsSummary contracts={filteredContracts} />
          
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h2 className="text-lg font-semibold text-slate-900">Licitaciones Encontradas</h2>
              <span className="bg-slate-100 text-slate-600 text-xs px-2.5 py-1 rounded-full font-medium">
                {filteredContracts.length} contratos
              </span>
            </div>
            <ContractsTable 
              contracts={filteredContracts} 
              isLoading={contractsQuery.isLoading} 
            />
          </div>
        </div>
      </div>

      <ToastContainer toasts={toasts} onRemove={(id) => setToasts(prev => prev.filter(t => t.id !== id))} />
    </div>
  );
}
