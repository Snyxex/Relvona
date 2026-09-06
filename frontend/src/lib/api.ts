import axios from "axios";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v1";

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const activeOrgId = localStorage.getItem("active_org_id");
    if (activeOrgId) {
      config.headers["X-Organization-Id"] = activeOrgId;
    }
  }
  return config;
});

api.interceptors.response.use(undefined, (error) => {
  if (
    typeof window !== "undefined" &&
    error.response?.status === 401
  ) {
    // Organization selection is UI state only; no credential is stored here.
    localStorage.removeItem("active_org_id");
    window.location.assign("/");
  }

  return Promise.reject(error);
});
