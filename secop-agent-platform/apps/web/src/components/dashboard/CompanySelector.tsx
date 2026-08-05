import { Skeleton } from "@/components/ui/skeleton";
import { Building2, CheckCircle2, ChevronRight } from "lucide-react";
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
      <div className="bg-card p-5 rounded-xl border border-border shadow-sm space-y-4">
        <Skeleton className="h-4 w-32 mb-2" />
        <Skeleton className="h-14 w-full rounded-lg" />
        <Skeleton className="h-14 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="bg-card p-5 rounded-xl border border-border shadow-sm">
      <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
        <Building2 className="h-4 w-4 text-primary" />
        Empresas Registradas
      </h3>
      <div className="space-y-2">
        {companies.map((company) => (
          <button
            key={company.id}
            onClick={() => onSelect(company.id)}
            className={`w-full text-left px-4 py-3.5 rounded-lg text-sm transition-all border group ${
              selectedId === company.id
                ? "bg-primary/5 border-primary/20 text-primary font-medium shadow-sm"
                : "bg-transparent border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="truncate flex-1">
                <p className="truncate font-medium">{company.name}</p>
                <p className="text-xs opacity-70 font-normal mt-0.5">
                  NIT: {company.nit}
                </p>
                <p className="text-xs opacity-50 font-normal mt-0.5">
                  {company.unspscCodes?.split(',').length || 0} códigos UNSPSC
                </p>
              </div>
              {selectedId === company.id ? (
                <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0 ml-2" />
              ) : (
                <ChevronRight className="h-4 w-4 opacity-0 group-hover:opacity-50 flex-shrink-0 ml-2 transition-opacity" />
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
