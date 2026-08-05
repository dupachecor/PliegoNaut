"use client";

import { useState, useMemo } from "react";
import type { ContractFilters, LocationGroup } from "@pliegonaut/types";
import { Button } from "@/components/ui/button";
import {
  Filter,
  X,
  Search,
  MapPin,
  Building,
  DollarSign,
  Clock,
  CheckCircle,
  AlertCircle,
  ChevronDown,
} from "lucide-react";

interface Props {
  filters: ContractFilters;
  onFiltersChange: (filters: ContractFilters) => void;
  locations: LocationGroup[];
}

export function FilterBar({ filters, onFiltersChange, locations }: Props) {
  const [expanded, setExpanded] = useState(false);
  const activeCount = Object.values(filters).filter(Boolean).length;

  const updateFilter = (key: keyof ContractFilters, value: any) => {
    onFiltersChange({ ...filters, [key]: value || undefined });
  };

  // Cuando cambia el departamento, resetear el municipio
  const handleDepartmentChange = (department: string) => {
    onFiltersChange({
      ...filters,
      department: department || undefined,
      municipio: undefined,
    });
  };

  // Municipios disponibles según el departamento seleccionado
  const availableMunicipios = useMemo(() => {
    if (!filters.department) {
      // Sin departamento: todos los municipios de todos los departamentos
      return locations.flatMap(l => l.municipios).sort();
    }
    const group = locations.find(
      l => l.department.toLowerCase() === filters.department!.toLowerCase()
    );
    return group?.municipios ?? [];
  }, [filters.department, locations]);

  const clearFilters = () => {
    onFiltersChange({});
  };

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      {/* Barra principal */}
      <div className="p-4 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar por título, entidad o SECOP ID..."
            className="w-full h-10 pl-10 pr-4 rounded-lg border border-input bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-all"
            value={filters.search ?? ""}
            onChange={(e) => updateFilter("search", e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={filters.viableOnly ? "default" : "outline"}
            size="sm"
            onClick={() => updateFilter("viableOnly", !filters.viableOnly)}
            className="h-10 flex items-center gap-1.5"
          >
            <CheckCircle className="w-3.5 h-3.5" />
            Viables
          </Button>

          <Button
            variant={filters.closingSoon ? "default" : "outline"}
            size="sm"
            onClick={() => updateFilter("closingSoon", !filters.closingSoon)}
            className="h-10 flex items-center gap-1.5"
          >
            <Clock className="w-3.5 h-3.5" />
            Cierre Próximo
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className={`h-10 flex items-center gap-1.5 ${activeCount > 0 ? "border-primary text-primary" : ""}`}
          >
            <Filter className="w-3.5 h-3.5" />
            Filtros
            {activeCount > 0 && (
              <span className="ml-1 w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center">
                {activeCount}
              </span>
            )}
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
          </Button>

          {activeCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-10 text-muted-foreground">
              <X className="w-3.5 h-3.5 mr-1" />
              Limpiar
            </Button>
          )}
        </div>
      </div>

      {/* Filtros expandidos */}
      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t border-border animate-fade-in">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <AlertCircle className="w-3 h-3" />
                Estado
              </label>
              <select
                className="w-full h-9 rounded-lg border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={filters.status ?? ""}
                onChange={(e) => updateFilter("status", e.target.value)}
              >
                <option value="">Todos</option>
                <option value="PENDING_ANALYSIS">Pendiente</option>
                <option value="PROCESSING">En análisis</option>
                <option value="VIABLE">Viable</option>
                <option value="REJECTED">Descartada</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <MapPin className="w-3 h-3" />
                Departamento
              </label>
              <select
                className="w-full h-9 rounded-lg border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={filters.department ?? ""}
                onChange={(e) => handleDepartmentChange(e.target.value)}
              >
                <option value="">Todos los departamentos</option>
                {locations.map((l) => (
                  <option key={l.department} value={l.department}>
                    {l.department} ({l.municipios.length})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Building className="w-3 h-3" />
                Municipio
              </label>
              <select
                className="w-full h-9 rounded-lg border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
                value={filters.municipio ?? ""}
                onChange={(e) => updateFilter("municipio", e.target.value)}
                disabled={availableMunicipios.length === 0}
              >
                <option value="">
                  {filters.department
                    ? availableMunicipios.length > 0
                      ? "Todos los municipios"
                      : "Sin municipios"
                    : "Todos los municipios"}
                </option>
                {availableMunicipios.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <DollarSign className="w-3 h-3" />
                Presupuesto Mín.
              </label>
              <input
                type="number"
                placeholder="0"
                className="w-full h-9 rounded-lg border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={filters.minBudget ?? ""}
                onChange={(e) => updateFilter("minBudget", e.target.value ? parseFloat(e.target.value) : undefined)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <DollarSign className="w-3 h-3" />
                Presupuesto Máx.
              </label>
              <input
                type="number"
                placeholder="Sin límite"
                className="w-full h-9 rounded-lg border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={filters.maxBudget ?? ""}
                onChange={(e) => updateFilter("maxBudget", e.target.value ? parseFloat(e.target.value) : undefined)}
              />
            </div>
          </div>

          {/* Chips de filtros activos */}
          {(filters.department || filters.municipio) && (
            <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-border">
              {filters.department && (
                <span className="inline-flex items-center gap-1.5 bg-primary/10 text-primary text-xs px-2.5 py-1.5 rounded-lg font-medium">
                  <MapPin className="w-3 h-3" />
                  {filters.department}
                  <button
                    onClick={() => handleDepartmentChange("")}
                    className="hover:bg-primary/20 rounded-full p-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {filters.municipio && (
                <span className="inline-flex items-center gap-1.5 bg-primary/10 text-primary text-xs px-2.5 py-1.5 rounded-lg font-medium">
                  <Building className="w-3 h-3" />
                  {filters.municipio}
                  <button
                    onClick={() => updateFilter("municipio", undefined)}
                    className="hover:bg-primary/20 rounded-full p-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
