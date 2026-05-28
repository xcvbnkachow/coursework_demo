import * as SecureStore from "expo-secure-store";
import { NativeModules, Platform } from "react-native";

const TOKEN_KEY = "work_nearby_token";
const LOCAL_NETWORK_API_URL = "http://192.168.1.64:8000";
const FALLBACK_LOCAL_NETWORK_API_URL = "http://192.168.1.65:8000";
const REQUEST_TIMEOUT_MS = 7000;

function getExpoHost() {
  const scriptUrl = NativeModules.SourceCode?.scriptURL;
  if (typeof scriptUrl !== "string") return null;

  const match = scriptUrl.match(/^[a-z]+:\/\/([^/:]+)/i);
  return match?.[1] ?? null;
}

export function getCandidateApiUrls() {
  const urls = new Set<string>();

  if (process.env.EXPO_PUBLIC_API_URL) {
    urls.add(process.env.EXPO_PUBLIC_API_URL.trim().replace(/\/+$/, ""));
  }

  if (Platform.OS !== "web") {
    urls.add(LOCAL_NETWORK_API_URL);
    urls.add(FALLBACK_LOCAL_NETWORK_API_URL);
  }

  const expoHost = getExpoHost();
  if (expoHost && expoHost !== "localhost" && expoHost !== "127.0.0.1") {
    urls.add(`http://${expoHost}:8000`);
  }

  if (Platform.OS === "android") {
    urls.add("http://10.0.2.2:8000");
  }

  if (Platform.OS === "web") {
    urls.add("http://localhost:8000");
    urls.add("http://127.0.0.1:8000");
  }

  return Array.from(urls);
}

export function getDefaultApiUrl() {
  return getCandidateApiUrls()[0] ?? "http://localhost:8000";
}

export async function setToken(token: string) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.localStorage.setItem(TOKEN_KEY, token);
    return;
  }

  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function getToken() {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.localStorage.getItem(TOKEN_KEY);
  }

  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function clearToken() {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.localStorage.removeItem(TOKEN_KEY);
    return;
  }

  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const failedUrls: string[] = [];

  for (const baseUrl of getCandidateApiUrls()) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let message = `Ошибка ${response.status}`;
        try {
          const body = await response.json();
          message = body.detail || message;
        } catch {
          const detail = await response.text();
          message = detail || message;
        }
        throw new Error(message);
      }

      return response.json() as Promise<T>;
    } catch (error) {
      clearTimeout(timeoutId);

      if (
        error instanceof Error &&
        error.name !== "AbortError" &&
        !error.message.includes("Network request failed") &&
        !error.message.includes("Failed to fetch")
      ) {
        throw error;
      }

      failedUrls.push(baseUrl);
    }
  }

  throw new Error(`Не удалось подключиться к backend. Проверенные адреса: ${failedUrls.join(", ")}`);
}

export const api = {
  health: () => request<{ status: string }>("/"),

  async register(payload: { email: string; password: string; full_name: string; active_mode: "worker" | "employer" }) {
    const response = await request<{ access_token: string; token_type?: string }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    await setToken(response.access_token);
    return response;
  },

  async login(payload: { email: string; password: string }) {
    const response = await request<{ access_token: string; token_type?: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    await setToken(response.access_token);
    return response;
  },

  profile: () => request("/profile"),
  updateProfile: (payload: unknown) => request("/profile", { method: "PATCH", body: JSON.stringify(payload) }),
  myOrders: () => request("/orders/my"),

  nearbyOrders: (
    lat: number,
    lng: number,
    radiusKm = 20000,
    params?: { category?: string; minPrice?: number; maxPrice?: number },
  ) => {
    const query = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
      radius_km: String(radiusKm),
    });

    if (params?.category) query.set("category", params.category);
    if (params?.minPrice !== undefined) query.set("min_price", String(params.minPrice));
    if (params?.maxPrice !== undefined) query.set("max_price", String(params.maxPrice));

    return request(`/orders/nearby?${query.toString()}`);
  },

  createOrder: (payload: unknown) => request("/orders", { method: "POST", body: JSON.stringify(payload) }),
  orderResponses: (orderId: string) => request(`/orders/${orderId}/responses`),
  assignWorker: (orderId: string, responseId: string) =>
    request(`/orders/${orderId}/assign`, { method: "POST", body: JSON.stringify({ response_id: responseId }) }),
  startOrder: (orderId: string) => request(`/orders/${orderId}/start`, { method: "POST" }),
  messages: (orderId: string) => request(`/orders/${orderId}/messages`),
  sendMessage: (orderId: string, text: string) =>
    request(`/orders/${orderId}/messages`, { method: "POST", body: JSON.stringify({ text }) }),
  completeOrder: (orderId: string) => request(`/orders/${orderId}/complete`, { method: "POST" }),
  cancelOrder: (orderId: string) => request(`/orders/${orderId}/cancel`, { method: "POST" }),
  respond: (orderId: string, comment?: string) =>
    request(`/orders/${orderId}/responses`, { method: "POST", body: JSON.stringify({ comment }) }),
};
