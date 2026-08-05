"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import type { ContractMatch } from "@pliegonaut/types";
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  FileText,
  ExternalLink,
  Calendar,
  MapPin,
  Building2,
  Route,
  Clock,
  ChevronRight,
  Download,
  Shield,
  DollarSign,
  ClipboardList,
  Loader2,
} from "lucide-react";

interface Props {
  contract: ContractMatch | null;
  isOpen: boolean;
  onClose: () => void;
}

interface PresentationStep {
  paso: number;
  titulo: string;
  descripcion: string;
  fecha_limite: string;
  documentos: string[];
  estado: string;
}

interface PresentationRoute {
  resumen: string;
  pasos: PresentationStep[];
  plazo_total_dias: number;
  fecha_cierre?: string;
  advertencias: string[];
}

export function ContractDetailsModal({ contract, isOpen, onClose }: Props) {
  if (!contract) return null;

  const isCompleted = contract.status === "VIABLE" || contract.status === "REJECTED";
  const hasRoute = contract.presentationRoute && contract.status === "VIABLE";

  let route: PresentationRoute | null = null;
  if (hasRoute) {
    try {
      route = JSON.parse(contract.presentationRoute!);
    } catch {}
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 overflow-hidden bg-background">
        {/* Header */}
        <DialogHeader className="p-6 pb-4 border-b border-border bg-muted/30 shrink-0">
          <div className="flex justify-between items-start gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 font-mono text-xs">
                  {contract.secopId}
                </Badge>
                <Badge variant="outline" className="bg-muted text-muted-foreground text-xs">
                  {contract.phase || contract.contractStatus || contract.status}
                </Badge>
                {isCompleted && contract.viabilityScore !== null && (
                  <Badge className={
                    contract.viabilityScore >= 80 ? "bg-emerald-500 hover:bg-emerald-600" :
                    contract.viabilityScore >= 50 ? "bg-amber-500 hover:bg-amber-600" : "bg-red-500 hover:bg-red-600"
                  }>
                    Score: {contract.viabilityScore}
                  </Badge>
                )}
                {contract.matchScore > 0 && (
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                    Match: {contract.matchScore}%
                  </Badge>
                )}
              </div>
              <DialogTitle className="text-lg font-bold leading-tight line-clamp-2">
                {contract.title}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground mt-1 font-medium">
                {contract.entity}
              </DialogDescription>
              <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
                {contract.department && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {contract.department}{contract.region ? `, ${contract.region}` : ""}
                  </span>
                )}
                {contract.publishedAt && (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    Publicado: {new Date(contract.publishedAt).toLocaleDateString("es-CO")}
                  </span>
                )}
                {contract.closingDate && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Cierre: {new Date(contract.closingDate).toLocaleDateString("es-CO")}
                  </span>
                )}
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">Presupuesto</p>
              <p className="text-xl font-bold">{formatCurrency(contract.budget)}</p>
              {contract.estimatedDuration && (
                <p className="text-xs text-muted-foreground mt-0.5">{contract.estimatedDuration}</p>
              )}
              <a
                href={contract.urlPliego}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary hover:underline flex items-center justify-end gap-1 mt-2 font-medium"
              >
                Ver en SECOP <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </DialogHeader>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {!isCompleted ? (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground space-y-4">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p>El agente IA está analizando el pliego. Esto puede tomar unos minutos...</p>
            </div>
          ) : (
            <Tabs defaultValue={hasRoute ? "ruta" : "resumen"} className="w-full">
              <TabsList className={`grid w-full ${hasRoute ? "grid-cols-4" : "grid-cols-3"} mb-6 bg-muted/50 p-1`}>
                {hasRoute && (
                  <TabsTrigger value="ruta" className="data-[state=active]:bg-background data-[state=active]:shadow-sm flex items-center gap-1.5">
                    <Route className="w-3.5 h-3.5" />
                    Ruta
                  </TabsTrigger>
                )}
                <TabsTrigger value="resumen" className="data-[state=active]:bg-background data-[state=active]:shadow-sm">Resumen</TabsTrigger>
                <TabsTrigger value="legal" className="data-[state=active]:bg-background data-[state=active]:shadow-sm">Legal</TabsTrigger>
                <TabsTrigger value="financiero" className="data-[state=active]:bg-background data-[state=active]:shadow-sm">Financiero</TabsTrigger>
              </TabsList>

              {hasRoute && route && (
                <TabsContent value="ruta" className="mt-0">
                  <PresentationRouteView route={route} contract={contract} />
                </TabsContent>
              )}

              <TabsContent value="resumen" className="mt-0">
                <div className="space-y-5">
                  <div className="bg-muted/30 p-5 rounded-xl border border-border">
                    <h4 className="font-semibold mb-3 flex items-center gap-2">
                      <FileText className="h-4 w-4 text-primary" />
                      Veredicto de la IA
                    </h4>
                    <ReportRenderer content={contract.reportFinal} />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="legal" className="mt-0">
                <div className="bg-card p-5 rounded-xl border border-border">
                  <h4 className="font-semibold mb-3 flex items-center gap-2">
                    <Shield className="h-4 w-4 text-primary" />
                    Análisis Legal
                  </h4>
                  <LegalReportRenderer content={contract.reportLegal} />
                </div>
              </TabsContent>

              <TabsContent value="financiero" className="mt-0">
                <div className="bg-card p-5 rounded-xl border border-border">
                  <h4 className="font-semibold mb-3 flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-primary" />
                    Análisis Financiero
                  </h4>
                  <FinancialReportRenderer content={contract.reportFinancial} />
                </div>
              </TabsContent>
            </Tabs>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PresentationRouteView({ route, contract }: { route: PresentationRoute; contract: ContractMatch }) {
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  return (
    <div className="space-y-6">
      {/* Resumen */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-5 rounded-xl border border-blue-200">
        <h4 className="font-semibold text-blue-900 mb-2 flex items-center gap-2">
          <Route className="h-4 w-4" />
          Ruta de Presentación Paso a Paso
        </h4>
        <p className="text-sm text-blue-800">{route.resumen}</p>
        <div className="flex gap-4 mt-3 text-xs text-blue-700">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Plazo total: {route.plazo_total_dias} días
          </span>
          {route.fecha_cierre && (
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              Cierre: {route.fecha_cierre}
            </span>
          )}
        </div>
      </div>

      {/* Advertencias */}
      {route.advertencias && route.advertencias.length > 0 && (
        <div className="bg-amber-50 p-4 rounded-xl border border-amber-200">
          <h5 className="font-semibold text-amber-800 mb-2 flex items-center gap-2 text-sm">
            <AlertCircle className="w-4 h-4" />
            Advertencias Importantes
          </h5>
          <ul className="space-y-1">
            {route.advertencias.map((adv, i) => (
              <li key={i} className="text-sm text-amber-700 flex items-start gap-2">
                <span className="text-amber-500 mt-0.5">•</span>
                {adv}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Pasos */}
      <div className="space-y-3">
        <h5 className="font-semibold text-sm">Pasos a Seguir</h5>
        {route.pasos.map((paso) => (
          <div
            key={paso.paso}
            className="border border-border rounded-xl overflow-hidden bg-card hover:shadow-sm transition-shadow"
          >
            <button
              onClick={() => setExpandedStep(expandedStep === paso.paso ? null : paso.paso)}
              className="w-full p-4 flex items-center gap-4 text-left"
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                paso.estado === "completado" ? "bg-emerald-100 text-emerald-700" :
                paso.estado === "en_proceso" ? "bg-amber-100 text-amber-700" :
                "bg-muted text-muted-foreground"
              }`}>
                {paso.paso}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{paso.titulo}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{paso.fecha_limite}</p>
              </div>
              <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${
                expandedStep === paso.paso ? "rotate-90" : ""
              }`} />
            </button>
            {expandedStep === paso.paso && (
              <div className="px-4 pb-4 pt-0 border-t border-border animate-fade-in">
                <p className="text-sm text-muted-foreground mt-3 mb-3">{paso.descripcion}</p>
                {paso.documentos && paso.documentos.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      Documentos necesarios:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {paso.documentos.map((doc, i) => (
                        <span key={i} className="inline-flex items-center gap-1 bg-muted/50 text-xs px-2.5 py-1.5 rounded-lg border border-border">
                          <FileText className="w-3 h-3" />
                          {doc}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function LegalReportRenderer({ content }: { content: string | null }) {
  if (!content) return <p className="text-muted-foreground italic text-sm">No hay datos disponibles.</p>;
  try {
    const data = JSON.parse(content);
    if (data.riesgos_habilitantes) {
      return (
        <div className="space-y-4">
          {data.riesgos_habilitantes.map((r: any, i: number) => (
            <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border">
              {r.cumple ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
              )}
              <div>
                <p className="text-sm">{r.descripcion}</p>
                <p className="text-xs text-muted-foreground mt-1">{r.pagina_citada}</p>
              </div>
            </div>
          ))}
          <Badge className={data.es_viable_legalmente ? "bg-emerald-500" : "bg-red-500"}>
            {data.es_viable_legalmente ? "Viable Legalmente" : "No Viable Legalmente"}
          </Badge>
        </div>
      );
    }
    return <pre className="whitespace-pre-wrap text-sm bg-muted/30 p-4 rounded-lg">{JSON.stringify(data, null, 2)}</pre>;
  } catch {
    return <p className="whitespace-pre-wrap text-sm text-muted-foreground">{content}</p>;
  }
}

function FinancialReportRenderer({ content }: { content: string | null }) {
  if (!content) return <p className="text-muted-foreground italic text-sm">No hay datos disponibles.</p>;
  try {
    const data = JSON.parse(content);
    if (data.analisis_indicadores) {
      return (
        <div className="space-y-4">
          {data.analisis_indicadores.map((r: any, i: number) => (
            <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border">
              {r.cumple ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
              )}
              <div>
                <p className="text-sm">{r.descripcion}</p>
                <p className="text-xs text-muted-foreground mt-1">{r.pagina_citada}</p>
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <Badge className={data.es_viable_financieramente ? "bg-emerald-500" : "bg-red-500"}>
              {data.es_viable_financieramente ? "Viable Financieramente" : "No Viable Financieramente"}
            </Badge>
          </div>
          {data.anticipos_y_pagos && (
            <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
              <p className="text-sm text-blue-800">{data.anticipos_y_pagos}</p>
            </div>
          )}
        </div>
      );
    }
    return <pre className="whitespace-pre-wrap text-sm bg-muted/30 p-4 rounded-lg">{JSON.stringify(data, null, 2)}</pre>;
  } catch {
    return <p className="whitespace-pre-wrap text-sm text-muted-foreground">{content}</p>;
  }
}

function ReportRenderer({ content }: { content: string | null }) {
  if (!content) return <p className="text-muted-foreground italic text-sm">No hay datos disponibles.</p>;
  try {
    const data = JSON.parse(content);
    return (
      <div className="space-y-4 text-sm text-muted-foreground">
        <pre className="whitespace-pre-wrap font-sans text-sm text-muted-foreground bg-muted/30 p-4 rounded-lg overflow-x-auto border border-border">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    );
  } catch {
    return <p className="whitespace-pre-wrap text-sm text-muted-foreground">{content}</p>;
  }
}
