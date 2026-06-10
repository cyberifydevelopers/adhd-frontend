import { createContext, useContext, useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import { AppSidebar } from "./AppSidebar";
import { cn } from "@/lib/utils";

/** Context to let child components know they're inside a sidebar layout */
const SidebarLayoutCtx = createContext(false);
export const useIsInsideSidebar = () => useContext(SidebarLayoutCtx);

export function SidebarLayout({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <SidebarLayoutCtx.Provider value={true}>
      <div className="flex min-h-screen">
        {/* Desktop sidebar — fixed to viewport height */}
        <aside className="hidden md:flex md:w-64 md:flex-shrink-0">
          <div className="fixed inset-y-0 left-0 z-30 w-64">
            <AppSidebar />
          </div>
        </aside>

        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Mobile sidebar */}
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-50 transform transition-transform duration-200 ease-in-out md:hidden",
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <AppSidebar onClose={() => setSidebarOpen(false)} />
        </aside>

        {/* Main content */}
        <div className="flex flex-1 flex-col min-w-0">
          {/* Mobile top bar */}
          <div className="flex items-center border-b border-border/60 bg-card/95 px-4 py-2 md:hidden">
            <button
              type="button"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              aria-label="Toggle sidebar"
            >
              {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>

          <main className="flex-1 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </SidebarLayoutCtx.Provider>
  );
}
