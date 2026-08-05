import { Skeleton } from "@/components/ui/skeleton";
import { Building2, CheckCircle2 } from "lucide-react";
import type { Company } from "@pliegonaut/types";

interface Props {
  companies: Company[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  isLoading: boolean;
}

export function CompanySelector({ companies, selectedId, onSelect, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <Skeleton className="h-4 w-32 mb-2" />
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
      <h3 className="font-semibold text-sm text-slate-900 mb-3 flex items-center gap-2">
        <Building2 className="h-4 w-4 text-indigo-500" />
        Empresas Registradas
      </h3>
      <div className="space-y-2">
        {companies.map((company) => (
          <button
            key={company.id}
            onClick={() => onSelect(company.id)}
            className={`w-full text-left px-4 py-3 rounded-lg text-sm transition-all border ${
              selectedId === company.id 
                ? "bg-indigo-50 border-indigo-200 text-indigo-800 font-medium shadow-sm" 
                : "bg-white border-slate-100 text-slate-600 hover:bg-slate-50 hover:border-slate-200"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="truncate">
                <p className="truncate">{company.name}</p>
                <p className="text-xs opacity-70 font-normal mt-0.5">NIT: {company.nit}</p>
              </div>
              {selectedId === company.id && <CheckCircle2 className="h-4 w-4 text-indigo-600 flex-shrink-0" />}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
