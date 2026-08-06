"use client";

import { useState, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { manualSearch } from "@/lib/api";
import { DEPARTAMENTOS, getMunicipios } from "@/lib/colombia";
import type { Company } from "@pliegonaut/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Search,
  Loader2,
  ExternalLink,
  MapPin,
  Calendar,
  Clock,
  Building2,
  Tag,
  DollarSign,
  AlertCircle,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { PliegoButton } from "./PliegoButton";

// SECOP I (Procesos f789-7hwg o Integrado rpmr-utcd): no expone fechas de cierre fiables;
// el estado y la modalidad se muestran de forma distinta a SECOP II.
const isSecop1Source = (source: string) =>
  source === "secop_i_procesos" || source === "secop_i_integrado" || source === "secop_integrado";

interface Props {
  companies: Company[];
  selectedCompanyId: string | null;
  onSelectCompany: (id: string | null) => void;
}

export function SearchPanel({ companies, selectedCompanyId, onSelectCompany }: Props) {
  const [searchText, setSearchText] = useState("");
  const [minBudget, setMinBudget] = useState("");
  const [maxBudget, setMaxBudget] = useState("");
  const [department, setDepartment] = useState("");
  const [municipio, setMunicipio] = useState("");
  const [onlyActive, setOnlyActive] = useState(false);

  const searchMutation = useMutation({
    mutationFn: manualSearch,
  });

  const handleSearch = () => {
    searchMutation.mutate({
      searchText: searchText || undefined,
      minBudget: minBudget ? parseFloat(minBudget) : undefined,
      maxBudget: maxBudget ? parseFloat(maxBudget) : undefined,
      department: department || undefined,
      municipio: municipio || undefined,
    });
  };

   // Deduplicate results by secopId to prevent React key warnings
  const results = useMemo(() => {
    const raw = searchMutation.data?.results ?? [];
    const seen = new Set();
    const deduped = raw.filter((r: any) => {
      if (seen.has(r.secopId)) return false;
      seen.add(r.secopId);
      return true;
    });
    if (onlyActive) {
      return deduped.filter((r: any) => r.isExpired !== true);
    }
    return deduped;
  }, [searchMutation.data?.results, onlyActive]);

  const municipioOptions = useMemo(() => {
    if (!department) return [];
    return getMunicipios(department);
  }, [department]);

  return (
    <div className="space-y-5">
      {/* Formulario de búsqueda */}
      <Card className="border-border shadow-sm">
        <CardContent className="p-5">
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Search className="w-4 h-4 text-primary" />
              <h3 className="font-semibold text-sm">Búsqueda Manual en SECOP II</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-xs font-medium text-muted-foreground">Texto libre</label>
                <input
                  type="text"
                  placeholder="Buscar por descripción..."
                  className="w-full h-10 rounded-lg border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Presupuesto mín.</label>
                <input
                  type="number"
                  placeholder="0"
                  className="w-full h-10 rounded-lg border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={minBudget}
                  onChange={(e) => setMinBudget(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Presupuesto máx.</label>
                <input
                  type="number"
                  placeholder="Sin límite"
                  className="w-full h-10 rounded-lg border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={maxBudget}
                  onChange={(e) => setMaxBudget(e.target.value)}
                />
              </div>
            </div>

             <div className="flex items-end gap-3 flex-wrap">
               <div className="space-y-1.5 flex-1 min-w-[180px]">
                 <label className="text-xs font-medium text-muted-foreground">Departamento</label>
                 <select
                   className="w-full h-10 rounded-lg border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                   value={department}
                   onChange={(e) => {
                     setDepartment(e.target.value);
                     setMunicipio("");
                   }}
                 >
                  <option value="">Todos</option>
                  {DEPARTAMENTOS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                 </select>
               </div>

               <div className="space-y-1.5 flex-1 min-w-[180px]">
                 <label className="text-xs font-medium text-muted-foreground">Municipio</label>
                 <select
                   className="w-full h-10 rounded-lg border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
                   value={municipio}
                   onChange={(e) => setMunicipio(e.target.value)}
                   disabled={!department}
                 >
                   <option value="">{department ? "Todos" : "Selecciona un departamento"}</option>
                   {municipioOptions.map((m) => (
                     <option key={m} value={m}>{m}</option>
                   ))}
                 </select>
               </div>

               <div className="flex items-center gap-2 pb-1">
                 <label className="flex items-center gap-2 cursor-pointer select-none">
                   <input
                     type="checkbox"
                     checked={onlyActive}
                     onChange={(e) => setOnlyActive(e.target.checked)}
                     className="w-4 h-4 rounded border-input accent-primary cursor-pointer"
                   />
                   <span className="text-xs font-medium text-muted-foreground">Solo no vencidos</span>
                 </label>
               </div>

               <Button
                 onClick={handleSearch}
                 disabled={searchMutation.isPending}
                 className="h-10 gradient-primary text-white shadow-md hover:opacity-90 px-6"
               >
                 {searchMutation.isPending ? (
                   <Loader2 className="w-4 h-4 animate-spin" />
                 ) : (
                   <Search className="w-4 h-4 mr-2" />
                 )}
                 Buscar
               </Button>
             </div>
          </div>
        </CardContent>
      </Card>

      {/* Resultados */}
      {searchMutation.isError && (
        <Card className="border-red-500/30">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-600">
                  {(searchMutation.error as any)?.message || 'Error al buscar'}
                </p>
                {(searchMutation.error as any)?.message?.includes('limitando') && (
                  <p className="text-xs text-muted-foreground mt-1">
                    SECOP tiene un límite de consultas por minuto. Espera unos segundos e intenta de nuevo.
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {searchMutation.isSuccess && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{results.length} resultados</span>
            {searchMutation.isPending && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
          </div>

          {results.length === 0 ? (
            <Card className="border-border">
              <CardContent className="p-8 text-center">
                <AlertCircle className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No se encontraron licitaciones con esos filtros.</p>
                <p className="text-xs text-muted-foreground mt-1">Intenta ampliar los criterios de búsqueda.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {results.map((r: any) => (
                <Card key={r.secopId} className="border-border shadow-sm hover:shadow-md transition-shadow">
                  <CardContent className="p-5">
                    <div className="flex justify-between items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-mono text-primary bg-primary/10 px-2 py-0.5 rounded">
                            {r.secopId}
                          </span>
                          <span className="text-xs text-muted-foreground">{r.phase}</span>
                        </div>
                        <h4 className="font-medium text-sm leading-snug line-clamp-2 mb-2">
                          {r.title}
                        </h4>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Building2 className="w-3 h-3" />
                            {r.entity}
                          </span>
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {r.department}
                          </span>
                           {/* Fecha de publicación - siempre gris */}
                           {isSecop1Source(r.source) ? (
                            r.modality ? (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Tag className="w-3 h-3" />
                                <span>{r.modality}</span>
                              </span>
                            ) : null
                          ) : r.publishedAt ? (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Calendar className="w-3 h-3" />
                              <span>Publicado: {new Date(r.publishedAt).toLocaleDateString("es-CO")}</span>
                            </span>
                          ) : null}
                          
                           {/* Fecha de cierre - manejo robusto */}
                           {r.isExpired ? (
                             <span className="flex items-center gap-1 text-xs text-red-500">
                               <Clock className="w-3 h-3 text-red-500" />
                               <span>
                                 {isSecop1Source(r.source)
                                   ? "Vencido / Cerrado"
                                   : r.closingDate
                                     ? `Vencido: ${new Date(r.closingDate).toLocaleDateString("es-CO")}`
                                     : "Vencido"}
                               </span>
                             </span>
                           ) : r.closingDate ? (
                             <span className={`flex items-center gap-1 text-xs font-medium ${
                               new Date(r.closingDate) < new Date() 
                                 ? 'text-red-500' 
                                 : 'text-green-600'
                             }`}>
                               <Clock className={`w-3 h-3 ${
                                 new Date(r.closingDate) < new Date() 
                                   ? 'text-red-500' 
                                   : 'text-green-600'
                               }`} />
                               <span>
                                 Cierre: {new Date(r.closingDate).toLocaleDateString("es-CO")}
                                 {new Date(r.closingDate) < new Date() && ' (Vencido)'}
                               </span>
                             </span>
                           ) : (
                             <span className="flex items-center gap-1 text-xs text-green-600">
                               <Clock className="w-3 h-3 text-green-600" />
                               <span>{isSecop1Source(r.source) ? r.status || "Activo" : "Activo"}</span>
                             </span>
                           )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold text-primary">{formatCurrency(r.budget)}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{r.duration}</p>
                        <div className="flex items-center justify-end gap-2 mt-2">
                          <PliegoButton secopId={r.secopId} />
                          <a
                            href={r.urlPliego}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            Ver en SECOP
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
