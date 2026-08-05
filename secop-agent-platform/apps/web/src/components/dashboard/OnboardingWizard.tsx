"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createCompany } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Anchor,
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  FileText,
  Landmark,
  Loader2,
  MapPin,
  Tag,
  X,
} from "lucide-react";

interface Props {
  onClose?: () => void;
  onComplete: (company: any) => void;
}

const STEPS = [
  { title: "Datos Básicos", icon: Building2 },
  { title: "Códigos UNSPSC", icon: Tag },
  { title: "Ubicación y Presupuesto", icon: MapPin },
  { title: "Confirmación", icon: CheckCircle2 },
];

const COMMON_UNSPSC = [
  { code: "80111500", label: "Servicios de consultoría en administración" },
  { code: "81111800", label: "Servicios de TI y software" },
  { code: "43211500", label: "Equipos de cómputo" },
  { code: "72222300", label: "Servicios de conectividad" },
  { code: "80101500", label: "Servicios de publicidad" },
  { code: "30161500", label: "Equipos de audio y video" },
  { code: "55120000", label: "Servicios de impresión" },
  { code: "81111500", label: "Servicios de ingeniería" },
];

export function OnboardingWizard({ onClose, onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [nit, setNit] = useState("");
  const [description, setDescription] = useState("");
  const [selectedUnspsc, setSelectedUnspsc] = useState<string[]>([]);
  const [customUnspsc, setCustomUnspsc] = useState("");
  const [regions, setRegions] = useState("");
  const [minBudget, setMinBudget] = useState("");
  const [maxBudget, setMaxBudget] = useState("");
  const [workingCapital, setWorkingCapital] = useState("");
  const [liquidity, setLiquidity] = useState("");

  const mutation = useMutation({
    mutationFn: createCompany,
    onSuccess: (data) => onComplete(data),
  });

  const handleSubmit = () => {
    mutation.mutate({
      name,
      nit,
      description,
      website: "",
      unspscCodes: [...selectedUnspsc, ...customUnspsc.split(",").map(c => c.trim()).filter(Boolean)].join(","),
      regions,
      workingCapital: parseFloat(workingCapital) || 0,
      liquidity: parseFloat(liquidity) || 0,
      minBudget: parseFloat(minBudget) || 0,
      maxBudget: parseFloat(maxBudget) || 9999999999,
      emails: "",
      certifications: "[]",
    });
  };

  const toggleUnspsc = (code: string) => {
    setSelectedUnspsc(prev =>
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    );
  };

  const canNext = () => {
    switch (step) {
      case 0: return name.trim() && nit.trim();
      case 1: return selectedUnspsc.length > 0 || customUnspsc.trim();
      case 2: return true;
      case 3: return true;
      default: return false;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-fade-in">
        {/* Header */}
        <div className="gradient-primary text-white p-6 rounded-t-2xl relative">
          {onClose && (
            <button onClick={onClose} className="absolute top-4 right-4 text-white/70 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          )}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
              <Anchor className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Registrar Nueva Empresa</h2>
              <p className="text-blue-100/80 text-sm">Configura tu perfil para encontrar licitaciones</p>
            </div>
          </div>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-1 px-6 pt-6">
          {STEPS.map((s, i) => (
            <div key={i} className="flex items-center flex-1">
              <div className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold shrink-0 ${
                i <= step ? "gradient-primary text-white" : "bg-muted text-muted-foreground"
              }`}>
                {i < step ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-1 ${i < step ? "bg-primary" : "bg-muted"}`} />
              )}
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="p-6">
          {step === 0 && (
            <div className="space-y-5 animate-fade-in">
              <div className="flex items-center gap-2 mb-1">
                <Building2 className="w-4 h-4 text-primary" />
                <h3 className="font-semibold">Datos de la empresa</h3>
              </div>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Nombre de la empresa *</label>
                  <input
                    type="text"
                    placeholder="Ej: TechNaut SAS"
                    className="w-full h-11 rounded-lg border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">NIT *</label>
                  <input
                    type="text"
                    placeholder="Ej: 900123456"
                    className="w-full h-11 rounded-lg border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={nit}
                    onChange={(e) => setNit(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Resumen de actividades</label>
                  <textarea
                    placeholder="Describe brevemente qué hace tu empresa (ej: Desarrollo de software, consultoría TI, soporte técnico...)"
                    className="w-full h-24 rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">Esto ayuda a la IA a entender mejor tu perfil.</p>
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5 animate-fade-in">
              <div className="flex items-center gap-2 mb-1">
                <Tag className="w-4 h-4 text-primary" />
                <h3 className="font-semibold">Códigos UNSPSC</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Selecciona los códigos que mejor representen los productos/servicios de tu empresa.
                Estos códigos se usan para buscar licitaciones relevantes.
              </p>
              <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto pr-2">
                {COMMON_UNSPSC.map((item) => (
                  <button
                    key={item.code}
                    onClick={() => toggleUnspsc(item.code)}
                    className={`text-left px-4 py-3 rounded-lg border text-sm transition-all ${
                      selectedUnspsc.includes(item.code)
                        ? "bg-primary/5 border-primary/30 text-primary font-medium"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <span className="font-mono text-xs">{item.code}</span>
                    <span className="block text-xs mt-0.5 opacity-80">{item.label}</span>
                  </button>
                ))}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">O agregar manualmente (separados por coma)</label>
                <input
                  type="text"
                  placeholder="Ej: 80111500, 43211500"
                  className="w-full h-11 rounded-lg border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={customUnspsc}
                  onChange={(e) => setCustomUnspsc(e.target.value)}
                />
              </div>
              {selectedUnspsc.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedUnspsc.map(code => (
                    <span key={code} className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs px-2 py-1 rounded-md font-mono">
                      {code}
                      <button onClick={() => toggleUnspsc(code)}>
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5 animate-fade-in">
              <div className="flex items-center gap-2 mb-1">
                <MapPin className="w-4 h-4 text-primary" />
                <h3 className="font-semibold">Ubicación y capacidad financiera</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Departamentos (separados por coma)</label>
                  <input
                    type="text"
                    placeholder="Ej: Cundinamarca, Bogotá D.C., Antioquia"
                    className="w-full h-11 rounded-lg border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={regions}
                    onChange={(e) => setRegions(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Capital de trabajo (COP)</label>
                  <input
                    type="number"
                    placeholder="Ej: 500000000"
                    className="w-full h-11 rounded-lg border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={workingCapital}
                    onChange={(e) => setWorkingCapital(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Índice de liquidez</label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="Ej: 2.5"
                    className="w-full h-11 rounded-lg border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={liquidity}
                    onChange={(e) => setLiquidity(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Presupuesto mínimo</label>
                  <input
                    type="number"
                    placeholder="0"
                    className="w-full h-11 rounded-lg border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={minBudget}
                    onChange={(e) => setMinBudget(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Presupuesto máximo</label>
                  <input
                    type="number"
                    placeholder="Sin límite"
                    className="w-full h-11 rounded-lg border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={maxBudget}
                    onChange={(e) => setMaxBudget(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5 animate-fade-in">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <h3 className="font-semibold">Confirmar registro</h3>
              </div>
              <Card className="border-border">
                <CardContent className="p-5 space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Empresa:</span>
                    <span className="font-medium">{name}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">NIT:</span>
                    <span className="font-medium">{nit}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">UNSPSC:</span>
                    <span className="font-medium font-mono text-xs">
                      {[...selectedUnspsc, ...customUnspsc.split(",").map(c => c.trim()).filter(Boolean)].join(", ") || "Sin especificar"}
                    </span>
                  </div>
                  {regions && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Regiones:</span>
                      <span className="font-medium">{regions}</span>
                    </div>
                  )}
                  {description && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Descripción:</span>
                      <span className="font-medium text-right max-w-xs">{description}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
              <p className="text-xs text-muted-foreground text-center">
                Al registrar, el sistema buscará automáticamente licitaciones que coincidan con tu perfil.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 pb-6">
          <Button
            variant="outline"
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Anterior
          </Button>

          {step < STEPS.length - 1 ? (
            <Button
              onClick={() => setStep(step + 1)}
              disabled={!canNext()}
              className="gradient-primary text-white flex items-center gap-2"
            >
              Siguiente
              <ArrowRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={mutation.isPending || !name.trim() || !nit.trim()}
              className="gradient-success text-white flex items-center gap-2"
            >
              {mutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              Registrar Empresa
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
