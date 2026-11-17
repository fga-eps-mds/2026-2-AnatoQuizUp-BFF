import axios from "axios";

import { env } from "@/config/env";

// Cliente HTTP pre-configurado para o ChatbotOSCE (simulacao de casos clinicos OSCE).
// Mesma ideia do quizClient: baseURL e timeout centralizados.
export const chatbotOsceClient = axios.create({
  baseURL: env.CHATBOT_OSCE_URL,
  timeout: env.REQUEST_TIMEOUT_MS,
  headers: { "Content-Type": "application/json" },
});
