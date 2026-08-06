"use client";

import { useCallback, useState } from "react";
import { fetchDocuments, openDocument, type ProcessDocumentListItem } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FileText, Loader2, ChevronDown } from "lucide-react";

interface Props {
  secopId: string;
  size?: "default" | "sm" | "lg" | "icon";
}

/**
 * Botón "Ver pliego" (Fase 2.5).
 * - Carga la lista de documentos bajo demanda (lazy) al primer click.
 * - Sin documentos → no se renderiza.
 * - Un documento → lo abre directamente.
 * - Varios (pliego, addendos, avisos) → dropdown para elegir.
 */
export function PliegoButton({ secopId, size = "sm" }: Props) {
  const [docs, setDocs] = useState<ProcessDocumentListItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);

  const load = useCallback(async () => {
    if (docs !== null || loading) return;
    setLoading(true);
    try {
      const res = await fetchDocuments(secopId);
      setDocs(res.documents ?? []);
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, [secopId, docs, loading]);

  const handleOpen = useCallback(
    async (doc: ProcessDocumentListItem) => {
      setOpening(true);
      try {
        await openDocument(secopId, doc.id, doc.fileName);
      } finally {
        setOpening(false);
      }
    },
    [secopId],
  );

  // No cargado todavía → botón que dispara la carga
  if (docs === null) {
    return (
      <Button
        variant="outline"
        size={size}
        onClick={load}
        disabled={loading}
        className="h-8 text-xs flex items-center gap-1.5 text-primary border-primary/30 hover:bg-primary/5"
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <FileText className="h-3.5 w-3.5" />
        )}
        Pliego
      </Button>
    );
  }

  // Sin documentos → oculto
  if (docs.length === 0) return null;

  // Un solo documento → abrir directo
  if (docs.length === 1) {
    return (
      <Button
        variant="outline"
        size={size}
        onClick={() => handleOpen(docs[0])}
        disabled={opening}
        className="h-8 text-xs flex items-center gap-1.5 text-primary border-primary/30 hover:bg-primary/5"
      >
        {opening ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <FileText className="h-3.5 w-3.5" />
        )}
        Ver pliego
      </Button>
    );
  }

  // Varios documentos → dropdown
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size={size}
          className="h-8 text-xs flex items-center gap-1.5 text-primary border-primary/30 hover:bg-primary/5"
        >
          <FileText className="h-3.5 w-3.5" />
          Pliego
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-xs">
        {docs.map((doc) => (
          <DropdownMenuItem
            key={doc.id}
            onSelect={() => handleOpen(doc)}
            disabled={opening}
            className="flex items-start gap-2"
          >
            <FileText className="h-4 w-4 shrink-0 mt-0.5" />
            <span className="truncate">{doc.fileName}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
