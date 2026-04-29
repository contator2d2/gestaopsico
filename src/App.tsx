import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import LandingPage from "./pages/LandingPage";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Pacientes from "./pages/Pacientes";

import Agenda from "./pages/Agenda";
import FinanceiroCompleto from "./pages/FinanceiroCompleto";
import AiAssistant from "./pages/AiAssistant";
import AppLayout from "./components/AppLayout";
import PatientAppLayout from "./components/PatientAppLayout";
import AdminLayout from "./components/AdminLayout";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminOrganizations from "./pages/admin/AdminOrganizations";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminPlans from "./pages/admin/AdminPlans";
import AdminAiAgents from "./pages/admin/AdminAiAgents";
import AdminAiProviders from "./pages/admin/AdminAiProviders";
import AdminSettings from "./pages/admin/AdminSettings";
import AdminWhatsApp from "./pages/admin/AdminWhatsApp";
import AdminBranding from "./pages/admin/AdminBranding";
import SecretarySettings from "./pages/SecretarySettings";
import Notifications from "./pages/Notifications";
import Campanhas from "./pages/Campanhas";
import Documentos from "./pages/Documentos";
import Configuracoes from "./pages/Configuracoes";
import TestManager from "./pages/TestManager";
import CasaisPage from "./pages/CasaisPage";
import PatientHome from "./pages/patient/PatientHome";
import PatientMood from "./pages/PatientMood";
import PatientTests from "./pages/PatientTests";
import PatientMessages from "./pages/patient/PatientMessages";
import PatientSettings from "./pages/patient/PatientSettings";
import PatientAppointments from "./pages/patient/PatientAppointments";
import PatientFinancial from "./pages/patient/PatientFinancial";
import PatientTasks from "./pages/patient/PatientTasks";

import NotFound from "./pages/NotFound";
import HelpPage from "./pages/HelpPage";
import PortalLogin from "./pages/PortalLogin";
import Mensagens from "./pages/Mensagens";
import Prontuarios from "./pages/Prontuarios";
import Relatorios from "./pages/Relatorios";
import Teleatendimento from "./pages/Teleatendimento";
import CompletarCadastro from "./pages/CompletarCadastro";
import ImportacaoDados from "./pages/ImportacaoDados";
import RecursosPage from "./pages/Recursos";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<Login />} />
            <Route path="/p/:slug" element={<PortalLogin />} />
            <Route path="/completar-cadastro/:token" element={<CompletarCadastro />} />
            {/* Admin / Superadmin */}
            <Route element={<ProtectedRoute requiredRole="superadmin"><AdminLayout /></ProtectedRoute>}>
              <Route path="/admin" element={<AdminDashboard />} />
              <Route path="/admin/organizacoes" element={<AdminOrganizations />} />
              <Route path="/admin/usuarios" element={<AdminUsers />} />
              <Route path="/admin/planos" element={<AdminPlans />} />
              <Route path="/admin/agentes-ia" element={<AdminAiAgents />} />
              <Route path="/admin/provedores-ia" element={<AdminAiProviders />} />
              <Route path="/admin/configuracoes" element={<AdminSettings />} />
              <Route path="/admin/branding" element={<AdminBranding />} />
              <Route path="/admin/whatsapp" element={<AdminWhatsApp />} />
            </Route>
            {/* Patient Portal - nested under slug */}
            <Route element={<ProtectedRoute requiredRole="patient"><PatientAppLayout /></ProtectedRoute>}>
              <Route path="/p/:slug/portal" element={<PatientHome />} />
              <Route path="/p/:slug/portal/humor" element={<PatientMood />} />
              <Route path="/p/:slug/portal/testes" element={<PatientTests />} />
              <Route path="/p/:slug/portal/consultas" element={<PatientAppointments />} />
              <Route path="/p/:slug/portal/financeiro" element={<PatientFinancial />} />
              <Route path="/p/:slug/portal/mensagens" element={<PatientMessages />} />
              <Route path="/p/:slug/portal/tarefas" element={<PatientTasks />} />
              <Route path="/p/:slug/portal/configuracoes" element={<PatientSettings />} />
            </Route>
            {/* App normal (professional) */}
            <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/pacientes" element={<Pacientes />} />
              <Route path="/crm" element={<CRM />} />
              <Route path="/app/whatsapp/groups" element={<CRM />} />
              <Route path="/app/whatsapp/channels" element={<CRM />} />
              <Route path="/agenda" element={<Agenda />} />
              <Route path="/financeiro" element={<FinanceiroCompleto />} />
              <Route path="/assistente-ia" element={<AiAssistant />} />
              <Route path="/secretaria-ia" element={<SecretarySettings />} />
              <Route path="/notificacoes" element={<Notifications />} />
              <Route path="/mensagens" element={<Mensagens />} />
              <Route path="/campanhas" element={<Campanhas />} />
              <Route path="/documentos" element={<Documentos />} />
              <Route path="/testes" element={<TestManager />} />
              <Route path="/casais" element={<CasaisPage />} />
              <Route path="/recursos" element={<RecursosPage />} />
              <Route path="/prontuarios" element={<Prontuarios />} />
              <Route path="/relatorios" element={<Relatorios />} />
              <Route path="/teleatendimento" element={<Teleatendimento />} />
              <Route path="/configuracoes" element={<Configuracoes />} />
              <Route path="/importacao" element={<ImportacaoDados />} />
              <Route path="/ajuda" element={<HelpPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
