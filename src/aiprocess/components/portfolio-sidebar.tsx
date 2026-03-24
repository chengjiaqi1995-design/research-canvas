import { Link, useLocation } from "react-router-dom";
import { cn } from "../lib/portfolio-utils";
import {
  LayoutDashboard,
  List,
  ArrowLeftRight,
  Upload,
  Settings,
  BrainCircuit,
  FileText,
} from "lucide-react";

const navItems = [
  { href: "/portfolio", label: "Dashboard", icon: LayoutDashboard },
  { href: "/portfolio/positions", label: "Positions", icon: List },
  { href: "/portfolio/trade", label: "Trade", icon: ArrowLeftRight },
  { href: "/portfolio/analysis", label: "Analysis", icon: BrainCircuit },
  { href: "/portfolio/research", label: "Research", icon: FileText },
  { href: "/portfolio/import", label: "Import", icon: Upload },
  { href: "/portfolio/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const location = useLocation();
  const pathname = location.pathname;

  return (
    <aside className="hidden md:flex h-screen w-56 flex-col border-r border-[var(--border)]">
      {/* Logo */}
      <div className="flex h-16 items-center px-5 border-b border-[var(--border)]">
        <h1 className="font-serif text-lg tracking-tight">
          <span className="text-[#B8860B]">Portfolio</span>{" "}
          <span className="font-normal">Manager</span>
        </h1>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        <p className="small-caps px-3 pb-2 text-[0.625rem]">Navigation</p>
        {navItems.map((item) => {
          const isActive =
            item.href === "/portfolio"
              ? pathname === "/portfolio"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              to={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-all duration-200",
                isActive
                  ? "text-[#B8860B] font-medium border-l-2 border-[#B8860B] bg-[#B8860B]/5 rounded-l-none"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]/50"
              )}
              style={{ letterSpacing: "0.03em" }}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="px-5 py-3 border-t border-[var(--border)]">
        <p className="small-caps text-[0.5625rem] text-[var(--muted-foreground)]/60">v1.0</p>
      </div>
    </aside>
  );
}

export function MobileNav() {
  const location = useLocation();
  const pathname = location.pathname;

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t border-[var(--border)] bg-[var(--background)] px-1 py-1 safe-bottom">
      {navItems.map((item) => {
        const isActive =
          item.href === "/portfolio"
            ? pathname === "/portfolio"
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            to={item.href}
            className={cn(
              "flex flex-col items-center gap-0.5 px-2 py-1.5 text-[10px] rounded-md transition-colors",
              isActive
                ? "text-[#B8860B] font-medium"
                : "text-[var(--muted-foreground)]"
            )}
          >
            <item.icon className="h-5 w-5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
