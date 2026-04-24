"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  CalendarClock,
  ChevronDown,
  Database,
  FileText,
  HandCoins,
  LogOut,
  MessageCircle,
  MessageSquareText,
  Settings,
  X,
} from "lucide-react";

const dashboardItem = {
  href: "/",
  label: "Dashboard",
  icon: FileText,
};

const mainItems = [
  {
    href: "/cobrancas",
    label: "Cobranças",
    icon: HandCoins,
  },
];

const settingsItems = [
  {
    href: "/configuracoes/cobranca",
    label: "Cobranca",
    icon: CalendarClock,
  },
  { href: "/configuracoes/whatsapp", label: "WhatsApp", icon: MessageCircle },
  {
    href: "/configuracoes/templates",
    label: "Templates",
    icon: MessageSquareText,
  },
  {
    href: "/configuracoes/conecte-seu-banco",
    label: "Pagamento",
    icon: Database,
  },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

function isCurrentPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [settingsOpen, setSettingsOpen] = useState(true);
  const DashboardIcon = dashboardItem.icon;

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 text-slate-300 flex flex-col
          transition-transform duration-200 ease-out
          lg:static lg:translate-x-0
          ${open ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        <div className="h-16 flex items-center justify-between px-6 border-b border-slate-800 shrink-0">
          <span className="text-xl font-bold text-white tracking-wider">
            COBRA<span className="text-emerald-400">PIX</span>
          </span>
          <button
            onClick={onClose}
            className="lg:hidden p-1 text-slate-400 hover:text-white transition-colors"
            aria-label="Fechar menu"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 px-3 py-6 overflow-y-auto">
          <div className="space-y-1">
            <Link
              href={dashboardItem.href}
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm ${
                isCurrentPath(pathname, dashboardItem.href)
                  ? "bg-emerald-500/15 text-emerald-400 font-semibold border-l-[3px] border-emerald-400 pl-[9px]"
                  : "hover:bg-slate-800 hover:text-white"
              }`}
            >
              <DashboardIcon size={18} />
              <span>{dashboardItem.label}</span>
            </Link>

            {mainItems.map((item) => {
              const Icon = item.icon;
              const isActive = isCurrentPath(pathname, item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm ${
                    isActive
                      ? "bg-emerald-500/15 text-emerald-400 font-semibold border-l-[3px] border-emerald-400 pl-[9px]"
                      : "hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>

          <div className="mt-5">
            <button
              type="button"
              onClick={() => setSettingsOpen((current) => !current)}
              aria-expanded={settingsOpen}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
            >
              <span className="flex items-center gap-2">
                <Settings size={15} />
                Configuracoes
              </span>
              <ChevronDown
                size={15}
                className={`transition-transform ${
                  settingsOpen ? "rotate-0" : "-rotate-90"
                }`}
              />
            </button>

            {settingsOpen && (
              <div className="mt-1 ml-4 space-y-1 border-l border-slate-800 pl-3">
                {settingsItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = isCurrentPath(pathname, item.href);

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-sm ${
                        isActive
                          ? "bg-emerald-500/15 text-emerald-400 font-semibold"
                          : "hover:bg-slate-800 hover:text-white"
                      }`}
                    >
                      <Icon size={17} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </nav>

        <div className="p-4 border-t border-slate-800 space-y-3 shrink-0">
          {session?.user && (
            <div className="px-3 py-2">
              <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">
                Empresa
              </p>
              <p className="text-sm text-slate-300 font-medium truncate mt-0.5">
                {session.user.name || session.user.email}
              </p>
            </div>
          )}
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm hover:bg-red-500/10 hover:text-red-400 transition-colors"
          >
            <LogOut size={18} />
            <span>Sair</span>
          </button>
        </div>
      </aside>
    </>
  );
}
