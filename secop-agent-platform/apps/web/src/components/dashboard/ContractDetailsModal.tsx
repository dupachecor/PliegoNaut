import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import type { ContractMatch } from "@pliegonaut/types";
import { CheckCircle2, XCircle, AlertCircle, FileText, ExternalLink } from "lucide-react";

interface Props {
  contract: ContractMatch | null;
  isOpen: boolean;
  onClose: () => void;
}

export function ContractDetailsModal({ contract, isOpen, onClose }: Props) {
  if (!contract) return null;

  const isCompleted = contract.status === "VIABLE" || contract.status === "REJECTED";

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-0 overflow-hidden bg-white">
        <DialogHeader className="p-6 pb-4 border-b border-slate-100 bg-slate-50/50 shrink-0">
          <div className="flex justify-between items-start gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 uppercase tracking-wider text-[10px]">
                  {contract.secopId}
                </Badge>
                {isCompleted && contract.viabilityScore !== null && (
                  <Badge variant="default" className={
                    contract.viabilityScore >= 80 ? "bg-emerald-500" : 
                    contract.viabilityScore >= 50 ? "bg-amber-500" : "bg-red-500"
                  }>
                    Score: {contract.viabilityScore}/100
                  </Badge>
                )}
              </div>
              <DialogTitle className="text-xl font-bold text-slate-900 leading-tight">
                {contract.title}
              </DialogTitle>
              <DialogDescription className="text-slate-600 mt-1 font-medium">
                {contract.entity}
              </DialogDescription>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-slate-500 uppercase font-semibold tracking-wider">Presupuesto</p>
              <p className="text-xl font-bold text-slate-900">{formatCurrency(contract.budget)}</p>
              <a 
                href={contract.urlPliego} 
                target="_blank" 
                rel="noreferrer"
                className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center justify-end gap-1 mt-2 font-medium"
              >
                Ver en SECOP <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6">
          {!isCompleted ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-500 space-y-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
              <p>El agente IA está leyendo y analizando el pliego. Esto puede tomar unos minutos...</p>
            </div>
          ) : (
            <Tabs defaultValue="resumen" className="w-full">
              <TabsList className="grid w-full grid-cols-3 mb-6 bg-slate-100/50 p-1">
                <TabsTrigger value="resumen" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">Resumen Ejecutivo</TabsTrigger>
                <TabsTrigger value="legal" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">Análisis Legal</TabsTrigger>
                <TabsTrigger value="financiero" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">Análisis Financiero</TabsTrigger>
              </TabsList>
              
              <TabsContent value="resumen" className="mt-0">
                <div className="space-y-6">
                  <div className="bg-slate-50 p-5 rounded-xl border border-slate-100">
                    <h4 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                      <FileText className="h-4 w-4 text-indigo-500" />
                      Veredicto de la IA
                    </h4>
                    <ReportRenderer content={contract.reportFinal} />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="legal" className="mt-0">
                <div className="bg-white p-5 rounded-xl border border-slate-200">
                  <ReportRenderer content={contract.reportLegal} />
                </div>
              </TabsContent>

              <TabsContent value="financiero" className="mt-0">
                 <div className="bg-white p-5 rounded-xl border border-slate-200">
                  <ReportRenderer content={contract.reportFinancial} />
                </div>
              </TabsContent>
            </Tabs>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReportRenderer({ content }: { content: string | null }) {
  if (!content) return <p className="text-slate-400 italic text-sm">No hay datos disponibles.</p>;
  
  try {
    const data = JSON.parse(content);
    return (
      <div className="space-y-4 text-sm text-slate-700">
        <pre className="whitespace-pre-wrap font-sans text-sm text-slate-600 bg-slate-50 p-4 rounded-lg overflow-x-auto border border-slate-100">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    );
  } catch (e) {
    return <p className="whitespace-pre-wrap text-sm text-slate-700">{content}</p>;
  }
}
