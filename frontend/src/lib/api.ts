import axios from "axios";

const API_BASE_URL = "http://localhost:8000/api/v1";

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: { "Content-Type": "application/json" },
});

// Attach the stored token to every outgoing request automatically.
apiClient.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("access_token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

export async function registerUser(email: string, password: string): Promise<string> {
  const res = await apiClient.post("/auth/register", { email, password });
  return res.data.access_token;
}

export async function loginUser(email: string, password: string): Promise<string> {
  const res = await apiClient.post("/auth/login", { email, password });
  return res.data.access_token;
}