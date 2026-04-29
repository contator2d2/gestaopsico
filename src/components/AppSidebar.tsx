import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, Calendar, DollarSign, FileText, Heart, Video,
  BarChart3, Settings, LogOut, Sparkles, Bot, Bell, ClipboardList, Shield,
  HelpCircle, MessageSquare, Building2, X, ChevronDown, Megaphone, FileUp,
  MessagesSquare, Upload, Library,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { orgSettingsApi } from "@/lib/portalApi";

type NavItem = { icon: typeof LayoutDashboard; label: string; path: string; roles?: string[] };

const APP_NAME = "Psico Gleego";
const APP_VERSION = import.meta.env.VITE_APP_VERSION || "1.0.0";

const mainNav: NavItem[] = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
  { icon: Users, label: "Pacientes", path: "/pacientes", roles: ["admin", "professional", "psychologist", "superadmin"] },
  { icon: Users, label: "CRM & Leads", path: "/crm", roles: ["admin", "professional", "psychologist", "superadmin"] },
  { icon: Heart, label: "Casais", path: "/casais", roles: ["admin", "professional", "psychologist", "superadmin"] },
  { icon: Calendar, label: "Agenda", path: "/agenda", roles: ["admin", "professional", "psychologist", "secretary", "secretary_financial", "superadmin"] },
  { icon: Library, label: "Recursos Terapêuticos", path: "/recursos", roles: ["admin", "professional", "psychologist", "superadmin"] },
  { icon: FileText, label: "Prontuários", path: "/prontuarios", roles: ["admin", "professional", "psychologist", "superadmin"] },
  { icon: Video, label: "Teleatendimento", path: "/teleatendimento", roles: ["admin", "professional", "psychologist", "superadmin"] },
  { icon: DollarSign, label: "Financeiro", path: "/financeiro", roles: ["admin", "professional", "psychologist", "financial", "secretary_financial", "superadmin"] },
  { icon: ClipboardList, label: "Testes", path: "/testes", roles: ["admin", "professional", "psychologist", "superadmin"] },
  { icon: Sparkles, label: "Assistente IA", path: "/assistente-ia", roles: ["admin", "professional", "psychologist", "superadmin"] },
  { icon: Bot, label: "Secretária IA", path: "/secretaria-ia", roles: ["admin", "professional", "psychologist", "superadmin"] },
  { icon: BarChart3, label: "Relatórios", path: "/relatorios", roles: ["admin", "professional", "psychologist", "financial", "secretary_financial", "superadmin"] },
  { icon: HelpCircle, label: "Ajuda", path: "/ajuda" },
  { icon: Upload, label: "Importação de Dados", path: "/importacao", roles: ["admin", "professional", "psychologist", "superadmin"] },
];

const commNav: NavItem[] = [
  { icon: Bell, label: "Notificações WhatsApp", path: "/notificacoes" },
  { icon: MessageSquare, label: "Mensagens no App", path: "/mensagens", roles: ["admin", "professional", "psychologist", "secretary", "secretary_financial", "superadmin"] },
  { icon: Megaphone, label: "Campanhas", path: "/campanhas", roles: ["admin", "professional", "psychologist", "superadmin"] },
  { icon: FileUp, label: "Envio de Documentos", path: "/documentos", roles: ["admin", "professional", "psychologist", "superadmin"] },
];

interface AppSidebarProps {
  open?: boolean;
  onClose?: () => void;
}

export default function AppSidebar({ open, onClose }: AppSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const [commOpen, setCommOpen] = useState(false);
  const { data: orgSettings } = useQuery({
    queryKey: ["org-settings"],
    queryFn: () => orgSettingsApi.get(),
    enabled: !!user && user.role !== "patient",
  });

  const isPatient = user?.role === "patient";
  const role = user?.role || "professional";
  const userRoles = role === "secretary_financial" ? ["secretary_financial", "secretary", "financial"] : [role];

  const filterByRole = (items: NavItem[]) =>
    isPatient ? [] : items.filter((item) => !item.roles || userRoles.some((r) => item.roles!.includes(r)));

  const navItems = filterByRole(mainNav);
  const commItems = filterByRole(commNav);

  const isCommActive = commNav.some((item) => location.pathname === item.path);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const handleNav = () => {
    onClose?.();
  };

  const roleLabel: Record<string, string> = {
    admin: "Administrador",
    professional: "Profissional",
    psychologist: "Psicólogo(a)",
    secretary: "Secretária",
    financial: "Financeiro",
    secretary_financial: "Secretária + Financeiro",
    superadmin: "Superadmin",
    patient: "Portal do Paciente",
  };

  const clinicName = orgSettings?.businessName || APP_NAME;
  const clinicLogo = orgSettings?.logo || "";

  const sidebarContent = (
    <>
      <div className="flex items-center justify-between px-4 md:px-6 py-4 md:py-6 border-b border-sidebar-border">
        <div className="flex items-center gap-3 min-w-0">
          {clinicLogo ? (
            <img src={clinicLogo} alt={clinicName} className="w-9 h-9 md:w-10 md:h-10 rounded-xl object-contain bg-sidebar-accent p-1 border border-sidebar-border shrink-0" />
          ) : (
            <div className="w-9 h-9 md:w-10 md:h-10 rounded-xl bg-sidebar-accent flex items-center justify-center border border-sidebar-border shrink-0">
              <Building2 className="w-4 h-4 md:w-5 md:h-5 text-sidebar-primary" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="font-display font-bold text-sm text-sidebar-primary truncate">{clinicName}</h1>
            <p className="text-xs text-sidebar-foreground/60 truncate">{roleLabel[role] || "Gestão Clínica"}</p>
          </div>
        </div>
        {/* Close button on mobile */}
        <button onClick={onClose} className="md:hidden p-1 rounded-lg hover:bg-sidebar-accent text-sidebar-foreground/70">
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={handleNav}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                isActive
                  ? "bg-sidebar-accent text-sidebar-primary"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              }`}
            >
              <item.icon className="w-5 h-5 shrink-0" />
              {item.label}
            </Link>
          );
        })}

        {/* Comunicação - collapsible group */}
        {commItems.length > 0 && (
          <div className="mt-2">
            <button
              onClick={() => setCommOpen(!commOpen)}
              className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                isCommActive
                  ? "bg-sidebar-accent text-sidebar-primary"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              }`}
            >
              <div className="flex items-center gap-3">
                <MessagesSquare className="w-5 h-5 shrink-0" />
                Comunicação
              </div>
              <ChevronDown className={`w-4 h-4 shrink-0 transition-transform duration-200 ${commOpen || isCommActive ? "rotate-180" : ""}`} />
            </button>
            {(commOpen || isCommActive) && (
              <div className="ml-4 mt-1 space-y-0.5 border-l border-sidebar-border pl-3">
                {commItems.map((item) => {
                  const isActive = location.pathname === item.path;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={handleNav}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                        isActive
                          ? "bg-sidebar-accent text-sidebar-primary font-medium"
                          : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                      }`}
                    >
                      <item.icon className="w-4 h-4 shrink-0" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </nav>

      <div className="px-3 py-4 border-t border-sidebar-border space-y-1">
        {!isPatient && (role === "superadmin" || role === "admin") && (
          <Link
            to="/admin"
            onClick={handleNav}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-all duration-200"
          >
            <Shield className="w-5 h-5 shrink-0" />
            Superadmin
          </Link>
        )}
        {!isPatient && (
          <Link
            to="/configuracoes"
            onClick={handleNav}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-all duration-200"
          >
            <Settings className="w-5 h-5 shrink-0" />
            Configurações
          </Link>
        )}
        <button
          onClick={() => { handleNav(); handleLogout(); }}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-all duration-200 w-full"
        >
          <LogOut className="w-5 h-5 shrink-0" />
          Sair
        </button>
      </div>

      <div className="px-6 py-4 border-t border-sidebar-border">
        <p className="text-xs font-medium text-sidebar-primary">{APP_NAME}</p>
        <p className="text-[11px] text-sidebar-foreground/60">v{APP_VERSION}</p>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex fixed left-0 top-0 z-40 h-screen w-64 bg-sidebar text-sidebar-foreground flex-col">
        {sidebarContent}
      </aside>

      {/* Mobile overlay + sidebar */}
      {open && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60 md:hidden" onClick={onClose} />
          <aside className="fixed left-0 top-0 z-50 h-screen w-72 bg-sidebar text-sidebar-foreground flex flex-col md:hidden animate-in slide-in-from-left duration-200">
            {sidebarContent}
          </aside>
        </>
      )}
    </>
  );
}
