"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  FileText,
  LogOut,
  MessageCircle,
  Settings,
  X,
} from "lucide-react";

const navItems = [
  { href: "/cobrancas", label: "Cobranças", icon: FileText },
  { href: "/configuracoes/whatsapp", label: "WhatsApp", icon: MessageCircle },
  { href: "/configuracoes/whatsapp", label: "Configurações", icon: Settings },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();

  return (
    <>
      {/* Backdrop (mobile only) */}
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
        {/* Header */}
        <div className="h-16 flex items-center justify-between px-6 border-b border-slate-800 shrink-0">
          <span className="text-xl font-bold text-white tracking-wider">
            COBRA<span className="text-emerald-400">PIX</span>
          </span>
          <button
            onClick={onClose}
            className="lg:hidden p-1 text-slate-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-6 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href ||
              pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.label}
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
        </nav>

        {/* Footer — User context + logout */}
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
