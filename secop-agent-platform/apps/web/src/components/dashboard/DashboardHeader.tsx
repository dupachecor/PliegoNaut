import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { signOut } from "next-auth/react";
import { Anchor, LogOut, Bell } from "lucide-react";

export function DashboardHeader({ user }: { user: any }) {
  return (
    <header className="flex justify-between items-center py-4 mb-6 border-b border-border">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl gradient-primary flex items-center justify-center">
          <Anchor className="w-4.5 h-4.5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight">PliegoNaut</h1>
          <p className="text-xs text-muted-foreground">Panel de Viabilidad de Licitaciones</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium leading-none">{user?.name || "Administrador"}</p>
            <p className="text-xs text-muted-foreground">{user?.email || "admin@pliegonaut.com"}</p>
          </div>
          <Avatar className="h-9 w-9 border-2 border-primary/20">
            <AvatarFallback className="gradient-primary text-white font-semibold text-sm">
              {user?.name?.charAt(0)?.toUpperCase() || "A"}
            </AvatarFallback>
          </Avatar>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => signOut()}
          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg"
        >
          <LogOut className="h-4.5 w-4.5" />
        </Button>
      </div>
    </header>
  );
}
