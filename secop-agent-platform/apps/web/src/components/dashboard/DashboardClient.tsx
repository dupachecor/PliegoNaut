"use client";

import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Company, ContractMatch, ContractFilters } from "@pliegonaut/types";

import { fetchCompanies, fetchContracts, triggerScanner, fetchLocations } from "@/lib/api";
import { ToastContainer, type Toast } from "@/components/ToastContainer";
import { CompanySelector } from "./CompanySelector";
import { ContractsTable } from "./ContractsTable";
import { DashboardHeader } from "./DashboardHeader";
import { AnalyticsSummary } from "./AnalyticsSummary";
import { FilterBar } from "./FilterBar";
import { SearchPanel } from "./SearchPanel";
import { OnboardingWizard } from "./OnboardingWizard";
import { Button } from "@/components/ui/button";
import { Anchor, RefreshCcw, Search, Plus, Radar, LayoutDashboard } from "lucide-react";

export default function DashboardClient({ user }: { user: any }) {
  const queryClient = useQueryClient();
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [filters, setFilters] = useState<ContractFilters>({});
  const [showSearch, setShowSearch] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [activeTab, setActiveTab] = useState<"dashboard" | "search">("dashboard");

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

  useEffect(() => {
    if (!selectedCompanyId && companies.length > 0) {
      setSelectedCompanyId(companies[0].id);
    }
  }, [companies, selectedCompanyId]);

  const locationsQuery = useQuery({
    queryKey: ["locations", selectedCompanyId],
    queryFn: () => fetchLocations(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const contractsQuery = useQuery({
    queryKey: ["contracts", selectedCompanyId, filters],
    queryFn: () => fetchContracts(selectedCompanyId!, filters),
    enabled: !!selectedCompanyId,
    refetchInterval: 8000,
  });

  const contracts = contractsQuery.data?.data ?? [];
  const summary = contractsQuery.data?.summary;

  const scannerMutation = useMutation({
    mutationFn: triggerScanner,
    onSuccess: () => {
      addToast("Escaneo de SECOP iniciado. Las licitaciones aparecerán pronto.", "success");
      queryClient.invalidateQueries({ queryKey: ["contracts"] });
    },
    onError: (err: Error) => addToast(`Error: ${err.message}`, "error"),
  });

  // Si no hay empresas, mostrar onboarding
  if (!companiesQuery.isLoading && companies.length === 0 && !showOnboarding) {
    return (
      <div className="flex flex-col gap-8 w-full max-w-5xl mx-auto">
        <DashboardHeader user={user} />
        <OnboardingWizard
          onComplete={(company) => {
            setShowOnboarding(false);
            queryClient.invalidateQueries({ queryKey: ["companies"] });
            addToast(`Empresa "${company.name}" registrada exitosamente`, "success");
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full max-w-7xl mx-auto">
      <DashboardHeader user={user} />

      {/* Navigation tabs */}
      <div className="flex items-center gap-1 mb-6 bg-muted/50 rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveTab("dashboard")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
            activeTab === "dashboard"
              ? "bg-white text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <LayoutDashboard className="w-4 h-4" />
          Panel de Viabilidad
        </button>
        <button
          onClick={() => setActiveTab("search")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
            activeTab === "search"
              ? "bg-white text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Search className="w-4 h-4" />
          Búsqueda Manual
        </button>
      </div>

      {activeTab === "dashboard" ? (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Sidebar */}
          <div className="lg:col-span-1 space-y-5">
            <CompanySelector
              companies={companies}
              selectedId={selectedCompanyId}
              onSelect={setSelectedCompanyId}
              isLoading={companiesQuery.isLoading}
            />

            <div className="bg-card rounded-xl border border-border shadow-sm p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Radar className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm">Acciones</h3>
              </div>
              <Button
                onClick={() => scannerMutation.mutate()}
                disabled={scannerMutation.isPending}
                className="w-full gradient-primary text-white shadow-md hover:opacity-90 flex items-center gap-2"
              >
                {scannerMutation.isPending ? (
                  <RefreshCcw className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                {scannerMutation.isPending ? "Buscando..." : "Escanear SECOP"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowOnboarding(true)}
                className="w-full flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Nueva Empresa
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                El escaneo busca licitaciones que coincidan con el perfil UNSPSC de tu empresa.
              </p>
            </div>
          </div>

          {/* Main content */}
          <div className="lg:col-span-3 space-y-5">
            <AnalyticsSummary
              contracts={contracts}
              summary={summary}
              isLoading={contractsQuery.isLoading}
            />

            <FilterBar
              filters={filters}
              onFiltersChange={setFilters}
              locations={locationsQuery.data ?? []}
            />

            <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
              <div className="p-5 border-b border-border flex justify-between items-center bg-muted/30">
                <div className="flex items-center gap-3">
                  <h2 className="text-base font-semibold">Licitaciones Encontradas</h2>
                  <span className="bg-primary/10 text-primary text-xs px-2.5 py-1 rounded-full font-medium">
                    {contractsQuery.data?.total ?? 0} contratos
                  </span>
                </div>
                {contractsQuery.isFetching && (
                  <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                )}
              </div>
              <ContractsTable
                contracts={contracts}
                isLoading={contractsQuery.isLoading}
                onSelectContract={(id) => {}}
              />
            </div>
          </div>
        </div>
      ) : (
        <SearchPanel
          companies={companies}
          selectedCompanyId={selectedCompanyId}
          onSelectCompany={setSelectedCompanyId}
        />
      )}

      {showOnboarding && (
        <OnboardingWizard
          onClose={() => setShowOnboarding(false)}
          onComplete={(company) => {
            setShowOnboarding(false);
            queryClient.invalidateQueries({ queryKey: ["companies"] });
            addToast(`Empresa "${company.name}" registrada exitosamente`, "success");
          }}
        />
      )}

      <ToastContainer toasts={toasts} onRemove={(id) => setToasts(prev => prev.filter(t => t.id !== id))} />
    </div>
  );
}
