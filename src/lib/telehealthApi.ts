import { apiRequest } from "./api";

export interface TelehealthSession {
  id: string;
  professionalId: string;
  patientId?: string;
  coupleId?: string;
  appointmentId?: string;
  meetingLink?: string;
  status: "waiting" | "capturing" | "uploaded" | "completed";
  startedAt?: string;
  endedAt?: string;
  duration?: number;
  transcription?: string;
  structuredContent?: string;
  aiOrganizedContent?: string;
  processingStatus: "none" | "uploaded" | "transcribing" | "organizing" | "completed" | "error";
  processingError?: string;
  recordId?: string;
  consentAccepted: boolean;
  createdAt: string;
  patient?: { id: string; name: string };
  couple?: { id: string; name: string };
  auditLogs?: { id: string; action: string; details?: string; createdAt: string }[];
}

export const telehealthApi = {
  list: () => apiRequest<TelehealthSession[]>("/telehealth"),
  get: (id: string) => apiRequest<TelehealthSession>(`/telehealth/${id}`),
  create: (data: { patientId?: string; coupleId?: string; appointmentId?: string; meetingLink?: string }) =>
    apiRequest<TelehealthSession>("/telehealth", { method: "POST", body: data }),
  start: (id: string) => apiRequest<TelehealthSession>(`/telehealth/${id}/start`, { method: "POST" }),
  stop: (id: string) => apiRequest<TelehealthSession>(`/telehealth/${id}/stop`, { method: "POST" }),
  getStatus: (id: string) => apiRequest<Pick<TelehealthSession, "id" | "status" | "processingStatus" | "processingError" | "recordId" | "transcription" | "structuredContent">>(`/telehealth/${id}/status`),
  retry: (id: string) => apiRequest<{ message: string }>(`/telehealth/${id}/retry`, { method: "POST" }),
  update: (id: string, data: { patientId?: string; meetingLink?: string }) =>
    apiRequest<TelehealthSession>(`/telehealth/${id}`, { method: "PATCH", body: data }),
  delete: (id: string) => apiRequest<{ message: string }>(`/telehealth/${id}`, { method: "DELETE" }),
  process: (id: string) => apiRequest<{ message: string }>(`/telehealth/${id}/process`, { method: "POST" }),

  uploadAudio: async (id: string, audioBlob: Blob, notes?: { motivo?: string; anotacoes?: string; agentId?: string }) => {
    const token = localStorage.getItem("auth_token") || localStorage.getItem("token");
    const { API_BASE_URL } = await import("./api");
    const resp = await fetch(`${API_BASE_URL}/telehealth/${id}/upload`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        ...(notes?.motivo ? { "X-Session-Motivo": encodeURIComponent(notes.motivo) } : {}),
        ...(notes?.anotacoes ? { "X-Session-Anotacoes": encodeURIComponent(notes.anotacoes) } : {}),
        ...(notes?.agentId ? { "X-Session-Agent": notes.agentId } : {}),
      },
      body: audioBlob
    });
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || "Erro ao enviar áudio");
    return resp.json();
  },

  // Segmented recording: upload one segment (fault-tolerant, retriable)
  uploadSegment: async (id: string, index: number, blob: Blob, opts?: { maxRetries?: number; onAttempt?: (n: number) => void }) => {
    const token = localStorage.getItem("auth_token") || localStorage.getItem("token");
    const { API_BASE_URL } = await import("./api");
    const maxRetries = opts?.maxRetries ?? 4;
    let lastErr: any = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      opts?.onAttempt?.(attempt);
      try {
        const resp = await fetch(`${API_BASE_URL}/telehealth/${id}/upload-segment`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/octet-stream",
            "X-Segment-Index": String(index),
          },
          body: blob
        });
        if (!resp.ok) {
          const detail = await resp.json().catch(() => ({}));
          throw new Error(detail.error || detail.details || `HTTP ${resp.status}`);
        }
        return resp.json();
      } catch (err: any) {
        lastErr = err;
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
        }
      }
    }
    throw lastErr || new Error("Falha ao enviar segmento");
  },

  finalizeSegments: async (id: string, notes?: { motivo?: string; anotacoes?: string; agentId?: string }) => {
    const token = localStorage.getItem("auth_token") || localStorage.getItem("token");
    const { API_BASE_URL } = await import("./api");
    const resp = await fetch(`${API_BASE_URL}/telehealth/${id}/finalize`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(notes || {})
    });
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || "Erro ao finalizar áudio");
    return resp.json();
  },
};
