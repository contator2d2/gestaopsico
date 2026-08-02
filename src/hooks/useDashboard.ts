import { useQuery } from "@tanstack/react-query";
import { dashboardApi, type DashboardSummary, type FinancialHealth } from "@/lib/api";

export function useDashboardSummary() {
  return useQuery<DashboardSummary>({
    queryKey: ["dashboard", "summary"],
    queryFn: () => dashboardApi.summary(),
    staleTime: 30_000,
  });
}

export function useFinancialHealth() {
  return useQuery<FinancialHealth>({
    queryKey: ["dashboard", "financial-health"],
    queryFn: () => dashboardApi.financialHealth(),
    staleTime: 30_000,
  });
}
