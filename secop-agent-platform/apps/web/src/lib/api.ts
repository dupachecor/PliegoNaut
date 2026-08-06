import type { Company, ContractMatch, PaginatedResponse, ContractFilters, LocationGroup } from "@pliegonaut/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  if (!API_KEY) {
    throw new Error("NEXT_PUBLIC_API_KEY no está configurada en el frontend");
  }
  const res = await fetch(`${API_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
    },
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

export function fetchContracts(companyId: string, filters?: ContractFilters, page = 1, limit = 100) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", String(limit));

  if (filters?.search) params.set("search", filters.search);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.minBudget !== undefined) params.set("minBudget", String(filters.minBudget));
  if (filters?.maxBudget !== undefined) params.set("maxBudget", String(filters.maxBudget));
  if (filters?.department) params.set("department", filters.department);
  if (filters?.municipio) params.set("municipio", filters.municipio);
  if (filters?.viableOnly) params.set("viableOnly", "true");
  if (filters?.closingSoon) params.set("closingSoon", "true");

  return request<PaginatedResponse<ContractMatch>>(`/api/contracts/${companyId}?${params.toString()}`);
}

export function fetchContractDetail(id: string) {
  return request<ContractMatch & { company: Company }>(`/api/contracts/detail/${id}`);
}

export function fetchDepartments(companyId: string) {
  return request<string[]>(`/api/contracts/${companyId}/departments`);
}

export function fetchLocations(companyId: string) {
  return request<LocationGroup[]>(`/api/contracts/${companyId}/locations`);
}

export function fetchMunicipios(companyId: string, department?: string) {
  const params = department ? `?department=${encodeURIComponent(department)}` : "";
  return request<string[]>(`/api/contracts/${companyId}/municipios${params}`);
}

export function triggerScanner() {
  return request<{ message: string }>("/api/trigger-scanner", { method: "POST" });
}

export function manualSearch(params: {
  unspscCodes?: string[];
  minBudget?: number;
  maxBudget?: number;
  department?: string;
  municipio?: string;
  searchText?: string;
}) {
  return request<{ results: any[]; total: number }>("/api/search", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export function createCompany(data: Omit<Company, "id" | "createdAt" | "updatedAt">) {
  return request<Company>("/api/companies", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateCompany(id: string, data: Partial<Company>) {
  return request<Company>(`/api/companies/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteCompany(id: string) {
  return request<void>(`/api/companies/${id}`, { method: "DELETE" });
}
