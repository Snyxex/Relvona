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

api.interceptors.response.use(undefined, (error) => {
  if (
    typeof window !== "undefined" &&
    error.response?.status === 401 &&
    error.config?.headers?.Authorization
  ) {
    // A stale browser token must not keep the dashboard in an authenticated UI state.
    localStorage.clear();
    document.cookie = "support_auth_token=; Path=/; Max-Age=0; SameSite=Lax";
    window.location.assign("/");
  }

  return Promise.reject(error);
});
