// API Configuration
export const API_BASE_URL = 
  (typeof window !== 'undefined' && window.location.hostname === 'localhost' 
    ? "http://localhost:3001/api" 
    : "/api");

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
}

function getAuthToken(): string | null {
  return localStorage.getItem("auth_token") || localStorage.getItem("token");
}

export async function apiRequest<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, headers = {} } = options;

  const token = getAuthToken();
  const defaultHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token) {
    defaultHeaders["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method,
    headers: { ...defaultHeaders, ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Unauthorized");
    }

    const error = await response.json().catch(() => ({ message: "Erro desconhecido" }));
    const errObj: any = new Error(error.message || error.error || `Erro ${response.status}`);
    errObj.details = error.details;
    throw errObj;
  }

  return response.json();
}

// Auth
export const authApi = {
  login: (email: string, password: string) =>
    apiRequest<{ token: string; user: { id: string; name: string; email: string; role: string } }>("/auth/login", {
      method: "POST",
      body: { email, password },
    }),
  register: (data: { name: string; email: string; password: string; planId?: string }) =>
    apiRequest<{ token: string; user: { id: string; name: string; email: string; role: string } }>("/auth/register", { method: "POST", body: data }),
  me: () => apiRequest<{ id: string; name: string; email: string; role: string }>("/auth/me"),
  updateProfile: (data: { name?: string; phone?: string; crp?: string; specialty?: string }) =>
    apiRequest<{ id: string; name: string; email: string; role: string; crp?: string; phone?: string; specialty?: string }>("/auth/profile", { method: "PATCH", body: data }),
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    apiRequest<{ message: string }>("/auth/change-password", { method: "PATCH", body: data }),
  logout: () => {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("token");
  },
};

// Setup
export const setupApi = {
  promoteSuperadmin: () =>
    apiRequest<{ message: string; user: { id: string; name: string; email: string; role: string } }>(
      "/setup/promote-superadmin", { method: "POST" }
    ),
  promoteByEmail: (email: string, role: string = "superadmin") =>
    apiRequest<{ message: string; user: { id: string; name: string; email: string; role: string } }>(
      "/setup/promote-by-email", { method: "POST", body: { email, role } }
    ),
};

// Pacientes
export const pacientesApi = {
  list: (params?: { search?: string; page?: number }) =>
    apiRequest<{ data: Patient[]; total: number }>(`/pacientes?${new URLSearchParams(params as Record<string, string>)}`),
  get: (id: string) => apiRequest<Patient>(`/pacientes/${id}`),
  create: (data: Partial<Patient>) => apiRequest<Patient>("/pacientes", { method: "POST", body: data }),
  update: (id: string, data: Partial<Patient>) => apiRequest<Patient>(`/pacientes/${id}`, { method: "PUT", body: data }),
  delete: (id: string) => apiRequest(`/pacientes/${id}`, { method: "DELETE" }),
  lookupCep: (cep: string) =>
    apiRequest<{ cep: string; street: string; complement: string; neighborhood: string; city: string; state: string }>(`/pacientes/cep/${cep}`),
  validateCpf: (cpf: string) =>
    apiRequest<{ valid: boolean; exists?: boolean; message?: string }>(`/pacientes/validate-cpf/${cpf}`),
  generateRegistrationLink: (id: string) =>
    apiRequest<{ link: string; token: string; patient_phone: string }>(`/pacientes/${id}/registration-link`, { method: "POST" }),
};

// Consultas
export const consultasApi = {
  list: (params?: Record<string, string>) =>
    apiRequest<Consulta[]>(`/consultas?${new URLSearchParams(params || {})}`),
  get: (id: string) => apiRequest<Consulta>(`/consultas/${id}`),
  create: (data: Partial<Consulta>) => apiRequest<Consulta>("/consultas", { method: "POST", body: data }),
  update: (id: string, data: Partial<Consulta>) => apiRequest<Consulta>(`/consultas/${id}`, { method: "PUT", body: data }),
  cancel: (id: string) => apiRequest(`/consultas/${id}/cancel`, { method: "POST" }),
  attend: (id: string) => apiRequest<{ message: string; receivableCreated: boolean }>(`/consultas/${id}/attend`, { method: "POST" }),
  miss: (id: string, charge: boolean = true) =>
    apiRequest<{ message: string; receivableCreated: boolean }>(`/consultas/${id}/miss`, { method: "POST", body: { charge } }),
  resetStatus: (id: string) => apiRequest<{ message: string }>(`/consultas/${id}/reset-status`, { method: "POST" }),
  approve: (id: string) => apiRequest(`/consultas/${id}/approve`, { method: "POST" }),
  reject: (id: string) => apiRequest(`/consultas/${id}/reject`, { method: "POST" }),
  sessionsByPatient: (month?: string) =>
    apiRequest<{
      month: string;
      patients: Array<{
        id: string;
        name: string;
        billingMode: string;
        sessionValue: number | null;
        sessions: Array<{
          id: string;
          date: string;
          time: string;
          duration: number;
          type: string;
          mode: string;
          status: string;
          attended: boolean;
          value: number;
          accountId: string | null;
          accountStatus: string | null;
          accountPaidAt: string | null;
        }>;
        totals: { attended: number; missed: number; pending: number; totalValue: number; paidValue: number; dueValue: number };
      }>;
    }>(`/consultas/sessions-by-patient/list${month ? `?month=${month}` : ""}`),
};

// Casais
export const casaisApi = {
  list: () => apiRequest<Casal[]>("/casais"),
  get: (id: string) => apiRequest<Casal>(`/casais/${id}`),
  create: (data: { patient1_id: string; patient2_id: string; name: string }) =>
    apiRequest<Casal>("/casais", { method: "POST", body: data }),
  update: (id: string, data: { name?: string; patient1_id?: string; patient2_id?: string }) =>
    apiRequest<Casal>(`/casais/${id}`, { method: "PUT", body: data }),
  delete: (id: string) => apiRequest(`/casais/${id}`, { method: "DELETE" }),
  records: (id: string) => apiRequest<any[]>(`/casais/${id}/prontuarios`),
};

// Prontuários
export const prontuariosApi = {
  listAll: (params?: { patientId?: string; coupleId?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.patientId) searchParams.set("patientId", params.patientId);
    if (params?.coupleId) searchParams.set("coupleId", params.coupleId);
    const qs = searchParams.toString();
    return apiRequest<Prontuario[]>(`/prontuarios${qs ? `?${qs}` : ""}`);
  },
  list: (pacienteId: string) => apiRequest<Prontuario[]>(`/prontuarios?patientId=${pacienteId}`),
  get: (id: string) => apiRequest<Prontuario>(`/prontuarios/${id}`),
  create: (data: Partial<Prontuario>) => apiRequest<Prontuario>("/prontuarios", { method: "POST", body: data }),
  update: (id: string, data: Partial<Prontuario>) => apiRequest<Prontuario>(`/prontuarios/${id}`, { method: "PUT", body: data }),
};

// Financeiro
export const financeiroApi = {
  list: (params?: { month?: string; status?: string; startDate?: string; endDate?: string }) => {
    const clean: Record<string, string> = {};
    if (params) Object.entries(params).forEach(([k, v]) => { if (v) clean[k] = v; });
    return apiRequest<Pagamento[]>(`/financeiro?${new URLSearchParams(clean)}`);
  },
  summary: (month?: string) =>
    apiRequest<FinanceiroSummary>(`/financeiro/summary${month ? `?month=${month}` : ""}`),
  update: (id: string, data: Partial<Pagamento>) =>
    apiRequest<Pagamento>(`/financeiro/${id}`, { method: "PUT", body: data }),
};

// Invoices / Faturas
export const invoicesApi = {
  patientSessions: (patientId: string, params?: Record<string, string>) =>
    apiRequest<any[]>(`/invoices/patient-sessions/${patientId}${params ? `?${new URLSearchParams(params)}` : ""}`),
  generate: (data: { patientId: string; sessionIds: string[]; description?: string; dueDate?: string; paymentMethod?: string }) =>
    apiRequest<any>("/invoices/generate", { method: "POST", body: data }),
  monthlyReport: (month?: string) =>
    apiRequest<any>(`/invoices/monthly-report${month ? `?month=${month}` : ""}`),
};

// Import
export const importApi = {
  csv: (data: { rows: { date: string; description: string; value: string; category?: string }[]; bankName?: string; accountName?: string }) =>
    apiRequest<{ imported: number; total: number; message: string }>("/import/csv", { method: "POST", body: data }),
  ofx: (data: { content: string; bankName?: string }) =>
    apiRequest<{ imported: number; total: number; balance: number | null; message: string }>("/import/ofx", { method: "POST", body: data }),
};

// WhatsApp
export const whatsappApi = {
  getGroups: () => apiRequest<any[]>("/whatsapp/groups"),
  getChannels: () => apiRequest<any[]>("/whatsapp/channels"),
  addGroupParticipants: (groupId: string, participants: string[]) =>
    apiRequest<any>(`/whatsapp/groups/${groupId}/participants`, { method: "POST", body: { participants } }),
};

// Events
export const eventsApi = {
  list: () => apiRequest<any[]>("/events"),
  get: (id: string) => apiRequest<any>(`/events/${id}`),
  create: (data: any) => apiRequest<any>("/events", { method: "POST", body: data }),
  update: (id: string, data: any) => apiRequest<any>(`/events/${id}`, { method: "PUT", body: data }),
  delete: (id: string) => apiRequest(`/events/${id}`, { method: "DELETE" }),
  addParticipation: (eventId: string, patientId: string, status?: string) =>
    apiRequest<any>(`/events/${eventId}/participation`, { method: "POST", body: { patientId, status } }),
};

// Dashboard
export const dashboardApi = {
  summary: () => apiRequest<DashboardSummary>("/dashboard/summary"),
};

// Types
export interface Patient {
  id: string;
  name: string;
  nickname?: string;
  cpf: string;
  birth_date: string;
  phone: string;
  email: string;
  address?: string;
  cep?: string;
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  whatsapp_valid?: boolean;
  gender: string;
  emergency_contact?: string;
  clinical_notes?: string;
  health_history?: string;
  medications?: string;
  allergies?: string;
  status: "active" | "inactive";
  billing_mode?: "per_session" | "monthly";
  monthly_value?: number;
  session_value?: number;
  charge_notification_mode?: "whatsapp" | "email" | "sms";
  charge_day?: number;
  charge_time?: string;
  charge_enabled?: boolean;
  registration_token?: string;
  registration_completed?: boolean;
  tags?: string[];
  is_mentorado?: boolean;
  created_at: string;
  // Mapa Clínico fields
  emotional_patterns?: string;
  triggers?: string;
  defense_mechanisms?: string;
  dominant_themes?: string;
}

export interface Consulta {
  id: string;
  patient_id?: string;
  couple_id?: string;
  type: "individual" | "couple";
  date: string;
  time: string;
  duration: number;
  value: number;
  status: "scheduled" | "completed" | "cancelled";
  payment_status: "pending" | "paid" | "overdue" | "cancelled";
  mode: "video" | "in_person";
  attended?: boolean;
  notes?: string;
  patient?: Patient;
  recurring?: boolean;
  recurrenceFrequency?: 'weekly' | 'biweekly';
  recurrenceDuration?: '1m' | '2m';
}

export interface Casal {
  id: string;
  name: string;
  patient1: Patient;
  patient2: Patient;
  created_at: string;
}

export interface Prontuario {
  id: string;
  patient_id?: string;
  couple_id?: string;
  appointment_id?: string;
  type: "individual" | "couple";
  date: string;
  content: string;
  ai_content?: string;
  professional_id: string;
  created_at: string;
  patient?: { id: string; name: string };
  couple?: { id: string; name: string };
  appointment?: { id: string; date: string; time: string; type: string };
}

export interface Pagamento {
  id: string;
  consulta_id: string;
  patient_name: string;
  date: string;
  value: number;
  method: "pix" | "card" | "cash" | "insurance";
  status: "pending" | "paid" | "overdue" | "cancelled";
  type: "individual" | "couple";
}

export interface FinanceiroSummary {
  total_revenue: number;
  received: number;
  pending: number;
  average_ticket: number;
}

export interface DashboardSummary {
  today_appointments: number;
  total_patients: number;
  monthly_revenue: number;
  pending_payments: number;
  today_schedule: Consulta[];
  recent_patients: Patient[];
}
