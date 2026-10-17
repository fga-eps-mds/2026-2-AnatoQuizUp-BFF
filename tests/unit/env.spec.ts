import { env } from "@/config/env";

describe("config/env", () => {
  it("parseia corretamente os tipos das variaveis de ambiente", () => {
    expect(env.NODE_ENV).toBe("test");
    expect(typeof env.PORT).toBe("number");
    expect(env.PORT).toBeGreaterThan(0);
    expect(env.BACKEND_URL).toMatch(/^https?:\/\//);
    expect(typeof env.GEMINI_API_KEY).toBe("string");
    expect(env.GEMINI_MODEL).toBeTruthy();
    expect(Array.isArray(env.CORS_ORIGINS)).toBe(true);
    expect(typeof env.REQUEST_TIMEOUT_MS).toBe("number");
    expect(env.REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("preserva os valores de process.env apos parse do Zod", () => {
    expect(env.INTERNAL_TOKEN).toBe(process.env.INTERNAL_TOKEN);
    expect(env.JWT_SECRET_KEY).toBe(process.env.JWT_SECRET_KEY);
    expect(env.BACKEND_URL).toBe(process.env.BACKEND_URL);
  });

  it("nao aceita segredos vazios", () => {
    expect(env.INTERNAL_TOKEN).toBeTruthy();
    expect(env.JWT_SECRET_KEY).toBeTruthy();
  });
});
