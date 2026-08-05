import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";

export function DashboardHeader({ user }: { user: any }) {
  return (
    <header className="flex justify-between items-center py-2 border-b border-slate-200 mb-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Panel de Viabilidad</h1>
        <p className="text-sm text-slate-500">Monitor en tiempo real de licitaciones y análisis IA.</p>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium text-slate-900 leading-none">{user?.name || "Administrador"}</p>
            <p className="text-xs text-slate-500">{user?.email || "admin@pliegonaut.com"}</p>
          </div>
          <Avatar className="h-9 w-9 border border-slate-200">
            <AvatarFallback className="bg-indigo-50 text-indigo-700 font-semibold">
              {user?.name?.charAt(0) || "A"}
            </AvatarFallback>
          </Avatar>
        </div>
        <Button variant="ghost" size="icon" onClick={() => signOut()} className="text-slate-500 hover:text-red-600 hover:bg-red-50">
          <LogOut className="h-5 w-5" />
        </Button>
      </div>
    </header>
  );
}
