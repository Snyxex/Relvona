import axios from "axios";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v1";

export const api = axios.create({
  baseURL: API_BASE_URL,
});

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("token");
    const activeOrgId = localStorage.getItem("active_org_id");

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    if (activeOrgId) {
      config.headers["X-Organization-Id"] = activeOrgId;
    }
  }
  return config;
});
