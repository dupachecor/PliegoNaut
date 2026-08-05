import type { Company, ContractMatch, PaginatedResponse } from "@pliegonaut/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Error ${res.status}`);
  }
  return res.json();
}

export function fetchCompanies() {
  return request<Company[]>("/api/companies");
}

export function fetchContracts(companyId: string) {
  return request<PaginatedResponse<ContractMatch>>(`/api/contracts/${companyId}?limit=100`);
}

export function triggerScanner() {
  return request<{ message: string }>("/api/trigger-scanner", { method: "POST" });
}
