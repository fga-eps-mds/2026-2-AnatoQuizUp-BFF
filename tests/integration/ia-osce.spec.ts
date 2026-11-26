// O proxy do OSCE so e montado quando CHATBOT_OSCE_URL existe (sem ela o BFF responde
// 503). O teste define a variavel antes de carregar a aplicacao para nao depender do
// .env de quem roda (no CI ela nao existe).
process.env.CHATBOT_OSCE_URL ??= "http://chatbot-osce.test";

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
          "x-internal-token": process.env.INTERNAL_TOKEN,
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

  // Confirma que /melhorar-texto (botao de IA do editor de caso, ChatbotOSCE PR #5)
  // ja passa pelo proxy generico de /ia/osce sem precisar de nenhuma rota dedicada no
  // BFF: o rewrite de montarUrl e o corpo/metodo sao repassados como vieram. O BFF nao
  // decide papel (PROFESSOR vs ALUNO) aqui — isso e responsabilidade do ChatbotOSCE.
  it("repassa POST /melhorar-texto (corpo e metodo) ao ChatbotOSCE sem rota dedicada", async () => {
    chatbotOsceMock.request.mockResolvedValue({
      status: 200,
      data: { textoMelhorado: "Paciente relata dor toracica ha dois dias." },
      headers: {},
    });

    const resposta = await request(aplicacao)
      .post("/api/v1/ia/osce/melhorar-texto")
      .set("Authorization", `Bearer ${tokenValido()}`)
      .send({ campo: "titulo", texto: "paciente c/ dor no peito ha 2 dias" });

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({ textoMelhorado: "Paciente relata dor toracica ha dois dias." });
    expect(chatbotOsceMock.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "/osce/melhorar-texto",
        data: { campo: "titulo", texto: "paciente c/ dor no peito ha 2 dias" },
      }),
    );
  });

  it("repassa 403 do ChatbotOSCE quando o usuario autenticado nao e professor", async () => {
    chatbotOsceMock.request.mockResolvedValue({
      status: 403,
      data: { erro: { codigo: "PROIBIDO", mensagem: "Este recurso e exclusivo para professores." } },
      headers: {},
    });

    const resposta = await request(aplicacao)
      .post("/api/v1/ia/osce/melhorar-texto")
      .set("Authorization", `Bearer ${tokenValido()}`)
      .send({ campo: "titulo", texto: "paciente c/ dor no peito" });

    expect(resposta.status).toBe(403);
    expect(resposta.body.erro.codigo).toBe("PROIBIDO");
  });
});
