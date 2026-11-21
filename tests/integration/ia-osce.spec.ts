import { AxiosError } from "axios";
import jwt from "jsonwebtoken";
import request from "supertest";

jest.mock("@/shared/clients/backend.client", () => ({
  backendClient: { request: jest.fn() },
}));

jest.mock("@/shared/clients/quiz.client", () => ({
  quizClient: { get: jest.fn() },
}));

jest.mock("@/shared/clients/gemini.client", () => ({
  geminiClient: null,
}));

jest.mock("@/shared/clients/chatbotOsce.client", () => ({
  chatbotOsceClient: { request: jest.fn() },
}));

import { aplicacao } from "@/config/app";
import { chatbotOsceClient } from "@/shared/clients/chatbotOsce.client";

const SEGREDO = process.env.JWT_SECRET_KEY ?? "test-secret";

const tokenValido = () =>
  jwt.sign({ sub: "u1", papel: "ALUNO", status: "ATIVO" }, SEGREDO, { expiresIn: "5m" });

const chatbotOsceMock = chatbotOsceClient as unknown as { request: jest.Mock };

beforeEach(() => {
  chatbotOsceMock.request.mockReset();
});

describe("ia/osce - proxy para o ChatbotOSCE", () => {
  it("retorna 401 sem token de acesso", async () => {
    const resposta = await request(aplicacao).get("/api/v1/ia/osce/casos");
    expect(resposta.status).toBe(401);
    expect(chatbotOsceMock.request).not.toHaveBeenCalled();
  });

  // Regressao do fix 2437214: sem o rewrite de prefixo (/api/v1/ia/osce -> /osce), o
  // ChatbotOSCE recebia /api/v1/ia/osce/... e respondia 404. Esse teste falha se o
  // rewrite de montarUrl voltar a ser removido ou a perder a query string.
  it("reescreve o prefixo da URL e preserva a query string ao repassar ao ChatbotOSCE", async () => {
    chatbotOsceMock.request.mockResolvedValue({ status: 200, data: { ok: true }, headers: {} });

    const resposta = await request(aplicacao)
      .get("/api/v1/ia/osce/casos?especialidade=cardiologia&pagina=2")
      .set("Authorization", `Bearer ${tokenValido()}`);

    expect(resposta.status).toBe(200);
    expect(chatbotOsceMock.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/osce/casos?especialidade=cardiologia&pagina=2",
      }),
    );
  });

  it("repassa o token interno e a identidade do usuario autenticado ao ChatbotOSCE", async () => {
    chatbotOsceMock.request.mockResolvedValue({ status: 200, data: { ok: true }, headers: {} });

    await request(aplicacao)
      .get("/api/v1/ia/osce/casos")
      .set("Authorization", `Bearer ${tokenValido()}`);

    expect(chatbotOsceMock.request).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-internal-token": "test-internal-token",
          "x-user-id": "u1",
          "x-user-papel": "ALUNO",
          "x-user-status": "ATIVO",
        }),
      }),
    );
  });

  it("retorna 502 quando o ChatbotOSCE esta fora do ar", async () => {
    const erro = new AxiosError("connect ECONNREFUSED");
    erro.code = "ECONNREFUSED";
    chatbotOsceMock.request.mockRejectedValue(erro);

    const resposta = await request(aplicacao)
      .get("/api/v1/ia/osce/casos")
      .set("Authorization", `Bearer ${tokenValido()}`);

    expect(resposta.status).toBe(502);
    expect(resposta.body.erro.codigo).toBe("ERRO_DOWNSTREAM");
  });

  it("retorna 504 quando o ChatbotOSCE excede o timeout", async () => {
    const erro = new AxiosError("timeout of 15000ms exceeded");
    erro.code = "ECONNABORTED";
    chatbotOsceMock.request.mockRejectedValue(erro);

    const resposta = await request(aplicacao)
      .get("/api/v1/ia/osce/casos")
      .set("Authorization", `Bearer ${tokenValido()}`);

    expect(resposta.status).toBe(504);
    expect(resposta.body.erro.codigo).toBe("TIMEOUT_DOWNSTREAM");
  });
});
