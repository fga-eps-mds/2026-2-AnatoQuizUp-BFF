import axios, { type AxiosInstance } from "axios";

import { env } from "@/config/env";

// Cliente da Gemini API, criado so quando GEMINI_API_KEY esta configurada. Sem ela,
// fica null e a rota /ia/perguntar responde 503 (IA generativa desligada).
export const geminiClient: AxiosInstance | null = env.GEMINI_API_KEY
  ? axios.create({
      baseURL: "https://generativelanguage.googleapis.com",
      timeout: env.REQUEST_TIMEOUT_MS,
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    })
  : null;
