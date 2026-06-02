import { apiRequest } from "./api";

// ===== Accounts (Contas a Pagar/Receber) =====
export interface Account {
  id: string;
  type: "receivable" | "payable";
  description: string;
  value: number;
  dueDate: string;
  paidAt?: string;
  status: "pending" | "paid" | "overdue" | "cancelled";
  category?: string;
  patientId?: string;
  patient?: { id: string; name: string };
  paymentMethod?: string;
  notes?: string;
  recurrence?: string;
  createdAt: string;
}

export interface AccountsSummary {
  totalReceivable: number;
  totalPayable: number;
  receivedAmount: number;
  paidAmount: number;
  pendingReceivable: number;
  pendingPayable: number;
  overdueReceivable: number;
  cashFlow: number;
  balance: number;
}

export interface PatientFinancialView {
  patient: { id: string; name: string; sessionValue: number; monthlyValue: number | null; billingMode: string };
  stats: {
    totalSessions: number;
    totalChargedSessions: number;
    totalCharged: number;
    totalPaid: number;
    totalPending: number;
    totalOverdue: number;
    unbilledTotal: number;
    unbilledCount: number;
    balance: number;
  };
  sessions: Array<{ id: string; date: string; time: string; duration: number; value: number; type: string; status: string; billed: boolean }>;
  accounts: Array<{ id: string; description: string; value: number; dueDate: string; paidAt?: string; status: string; paymentMethod?: string; notes?: string }>;
}

export interface ConsolidatedCharge {
  patient: { id: string; name: string; phone?: string; email?: string };
  items: Array<{ id: string; description: string; value: number; dueDate: string }>;
  total: number;
  dueDate: string;
  description: string;
}

export const accountsApi = {
  list: (params?: Record<string, string>) =>
    apiRequest<{ data: Account[]; total: number }>(
      `/accounts${params ? `?${new URLSearchParams(params)}` : ""}`
    ),
  summary: (month?: string) =>
    apiRequest<AccountsSummary>(`/accounts/summary${month ? `?month=${month}` : ""}`),
  tabSummary: (month?: string) =>
    apiRequest<Record<string, { count: number; total: number }>>(`/accounts/tab-summary${month ? `?month=${month}` : ""}`),
  patientFinancial: (patientId: string) =>
    apiRequest<PatientFinancialView>(`/accounts/patient/${patientId}/financial`),
  bulkPay: (data: { ids: string[]; paymentMethod?: string; paidAt?: string }) =>
    apiRequest<{ message: string; count: number }>(`/accounts/bulk-pay`, { method: "POST", body: data }),
  bulkCharge: (data: { ids: string[]; dueDate?: string; description?: string }) =>
    apiRequest<{ charges: ConsolidatedCharge[]; totalAmount: number }>(`/accounts/bulk-charge`, { method: "POST", body: data }),
  create: (data: Partial<Account>) =>
    apiRequest<Account>("/accounts", { method: "POST", body: data }),
  update: (id: string, data: Partial<Account>) =>
    apiRequest<Account>(`/accounts/${id}`, { method: "PUT", body: data }),
  delete: (id: string) =>
    apiRequest(`/accounts/${id}`, { method: "DELETE" }),
};

// ===== Mood Entries =====
export interface MoodEntry {
  id: string;
  patientId: string;
  mood: number;
  emotions: string[];
  notes?: string;
  energyLevel?: number;
  sleepQuality?: number;
  anxietyLevel?: number;
  date: string;
  createdAt: string;
}

export interface MoodStats {
  totalEntries: number;
  avgMood: number;
  emotionFrequency: Record<string, number>;
  streak: number;
}

export const moodApi = {
  create: (data: Partial<MoodEntry>) =>
    apiRequest<MoodEntry>("/mood", { method: "POST", body: data }),
  myHistory: (days?: number) =>
    apiRequest<MoodEntry[]>(`/mood/my${days ? `?days=${days}` : ""}`),
  patientMood: (patientId: string, days?: number) =>
    apiRequest<{ entries: MoodEntry[]; stats: MoodStats }>(
      `/mood/patient/${patientId}${days ? `?days=${days}` : ""}`
    ),
  moodAiAnalysis: (patientId: string) =>
    apiRequest<{ success: boolean; analysis: string; totalEntries: number; period: { from: string; to: string }; disclaimer: string }>(
      `/mood/patient/${patientId}/ai-analysis`, { method: "POST" }
    ),
};

// ===== Tests =====
export interface TestQuestion {
  id?: string;
  text: string;
  type: "scale" | "multiple_choice" | "text";
  options: string[];
  orderNum?: number;
  weight?: number;
  reverseScored?: boolean;
}

export interface TestTemplate {
  id: string;
  title: string;
  description?: string;
  category?: string;
  isActive: boolean;
  isPreset?: boolean;
  scoringRules?: {
    type: string;
    ranges?: { min: number; max: number; label: string }[];
    reverseItems?: number[];
  };
  questions: TestQuestion[];
  _count?: { questions: number; assignments: number };
  createdAt: string;
}

export interface TestAssignment {
  id: string;
  templateId: string;
  template: { title: string; description?: string; category?: string; questions?: TestQuestion[] };
  patientId: string;
  patient?: { id: string; name: string };
  status: "pending" | "completed";
  responses: { questionId: string; answer: string }[];
  assignedAt: string;
  completedAt?: string;
  score?: number | null;
  classification?: string | null;
  clinicalRecordId?: string | null;
  professionalAssessment?: string | null;
  professionalConclusion?: string | null;
  aiInterpretation?: string | null;
  _count?: { responses: number };
}

export interface PresetTest {
  title: string;
  description: string;
  category: string;
  scoringRules: any;
  questions: { text: string; type: string; options: string[]; reverseScored?: boolean }[];
}

export const testsApi = {
  // Professional
  listTemplates: () =>
    apiRequest<TestTemplate[]>("/tests/templates"),
  getTemplate: (id: string) =>
    apiRequest<TestTemplate>(`/tests/templates/${id}`),
  createTemplate: (data: Partial<TestTemplate>) =>
    apiRequest<TestTemplate>("/tests/templates", { method: "POST", body: data }),
  updateTemplate: (id: string, data: Partial<TestTemplate>) =>
    apiRequest<TestTemplate>(`/tests/templates/${id}`, { method: "PUT", body: data }),
  deleteTemplate: (id: string) =>
    apiRequest(`/tests/templates/${id}`, { method: "DELETE" }),
  assignTest: (templateId: string, patientId?: string, coupleId?: string) =>
    apiRequest("/tests/assign", { method: "POST", body: { templateId, patientId, coupleId } }),
  listAssignments: () =>
    apiRequest<TestAssignment[]>("/tests/assignments"),
  deleteAssignment: (id: string) =>
    apiRequest(`/tests/assignments/${id}`, { method: "DELETE" }),
  resendAssignment: (id: string) =>
    apiRequest(`/tests/assignments/${id}/resend`, { method: "POST" }),
  getResults: (assignmentId: string) =>
    apiRequest<TestAssignment>(`/tests/assignments/${assignmentId}/results`),
  updateClinicalNote: (assignmentId: string, data: { professionalAssessment?: string; professionalConclusion?: string }) =>
    apiRequest<TestAssignment>(`/tests/assignments/${assignmentId}/clinical-note`, { method: "PATCH", body: data }),
  // Presets
  listPresets: () =>
    apiRequest<PresetTest[]>("/tests/presets"),
  importPreset: (presetIndex: number) =>
    apiRequest<TestTemplate>("/tests/import-preset", { method: "POST", body: { presetIndex } }),
  // JSON import/export
  importJson: (data: any) =>
    apiRequest<TestTemplate>("/tests/import-json", { method: "POST", body: data }),
  exportTemplate: (id: string) =>
    apiRequest<any>(`/tests/templates/${id}/export`),
  // Patient
  myTests: () =>
    apiRequest<TestAssignment[]>("/tests/my"),
  getMyTest: (assignmentId: string) =>
    apiRequest<TestAssignment>(`/tests/my/${assignmentId}`),
  respondTest: (assignmentId: string, responses: { questionId: string; answer: string }[]) =>
    apiRequest(`/tests/my/${assignmentId}/respond`, { method: "POST", body: { responses } }),
};

// ===== Organization Settings (White-label) =====
export interface OrgSettings {
  id: string;
  organizationId: string;
  logo?: string;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  businessName?: string;
  businessPhone?: string;
  businessEmail?: string;
  businessAddress?: string;
  allowPatientBooking?: boolean;
  requireBookingApproval?: boolean;
  portalSlug?: string;
  scheduleStartHour?: number;
  scheduleEndHour?: number;
  patientBookingStartHour?: number;
  patientBookingEndHour?: number;
  sessionDuration?: number;
  bookingWeekdays?: string;
  timezone?: string;
}

export const orgSettingsApi = {
  get: () => apiRequest<OrgSettings | null>("/org-settings"),
  update: (data: Partial<OrgSettings>) =>
    apiRequest<OrgSettings>("/org-settings", { method: "PUT", body: data }),
};

// ===== Patient Portal =====
export interface PatientDashboard {
  upcomingAppointments: Array<{
    id: string;
    date: string;
    time: string;
    type: string;
    mode: string;
    professional: { name: string };
  }>;
  pendingTests: number;
  recentMood: MoodEntry[];
  patientName: string;
  allowBooking?: boolean;
  clinicName?: string | null;
  clinicLogo?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  bookingStartHour?: number;
  bookingEndHour?: number;
  sessionDuration?: number;
  bookingWeekdays?: string;
}

export interface PatientPortalMessage {
  id: string;
  type: "text" | "audio" | "file";
  content: string;
  sender?: "patient" | "professional";
  readAt?: string | null;
  title?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  createdAt: string;
}

export interface AvailabilitySlot {
  time: string;
  available: boolean;
}

export interface AvailabilityResponse {
  slots: AvailabilitySlot[];
  professionalName: string;
  date: string;
}

export const patientPortalApi = {
  createAccess: (data: { patientId: string; email: string; password: string }) =>
    apiRequest("/patient-portal/create-access", { method: "POST", body: data }),
  dashboard: () =>
    apiRequest<PatientDashboard>("/patient-portal/dashboard"),
  appointments: () =>
    apiRequest("/patient-portal/appointments"),
  financial: () =>
    apiRequest<{ payments: any[]; summary: { total: number; paid: number; pending: number } }>(
      "/patient-portal/financial"
    ),
  availability: (date: string) =>
    apiRequest<AvailabilityResponse>(`/patient-portal/availability?date=${date}`),
  book: (data: { date: string; time: string; mode?: string; notes?: string }) =>
    apiRequest("/patient-portal/book", { method: "POST", body: data }),
  listMessages: () =>
    apiRequest<PatientPortalMessage[]>("/patient-portal/messages"),
  sendMessage: (data: { type: "text" | "audio" | "file"; content: string; fileName?: string; mimeType?: string; title?: string }) =>
    apiRequest<PatientPortalMessage>("/patient-portal/messages", { method: "POST", body: data }),
  uploadAudio: async (
    audioBlob: Blob,
    data?: { fileName?: string; mimeType?: string; title?: string }
  ) => {
    const token = localStorage.getItem("auth_token") || localStorage.getItem("token");
    const { API_BASE_URL } = await import("./api");

    const response = await fetch(`${API_BASE_URL}/patient-portal/messages/audio`, {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": data?.mimeType || audioBlob.type || "application/octet-stream",
        ...(data?.fileName ? { "X-File-Name": encodeURIComponent(data.fileName) } : {}),
        ...(data?.mimeType ? { "X-Mime-Type": encodeURIComponent(data.mimeType) } : {}),
        ...(data?.title ? { "X-Message-Title": encodeURIComponent(data.title) } : {}),
      },
      body: audioBlob,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "Erro ao enviar áudio");
    }

    return response.json() as Promise<PatientPortalMessage>;
  },
  listTasks: () =>
    apiRequest<any[]>("/patient-portal/tasks"),
  checkInTask: (id: string) =>
    apiRequest(`/patient-portal/tasks/${id}/check-in`, { method: "POST" }),
};
