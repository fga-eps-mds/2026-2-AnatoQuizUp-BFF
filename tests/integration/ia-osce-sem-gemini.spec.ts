import jwt from "jsonwebtoken";
import request from "supertest";

jest.mock("@/shared/clients/backend.client", () => ({
  backendClient: { request: jest.fn() },
}));

jest.mock("@/shared/clients/quiz.client", () => ({
  quizClient: { request: jest.fn() },
}));

// Sem GEMINI_API_KEY o cliente nasce null: as rotas que dependem do modelo devem
// recusar com 503, e a lista de cenarios deve continuar de pe.
jest.mock("@/shared/clients/gemini.client", () => ({
  geminiClient: null,
}));

import { aplicacao } from "@/config/app";
import { CENARIOS_OSCE } from "@/shared/constants/cenarios-osce";

const SEGREDO = process.env.JWT_SECRET_KEY ?? "test-secret";

const tokenValido = () =>
  jwt.sign({ sub: "u1", papel: "ALUNO", status: "ATIVO" }, SEGREDO, { expiresIn: "5m" });

const CENARIO_ID = CENARIOS_OSCE[0].id;

describe("rotas do OSCE com a Gemini desligada", () => {
  it("ainda lista os cenarios disponiveis", async () => {
    const resposta = await request(aplicacao)
      .get("/api/v1/ia/osce/cenarios")
      .set("Authorization", `Bearer ${tokenValido()}`);

    expect(resposta.status).toBe(200);
    expect(resposta.body.cenarios.length).toBeGreaterThan(0);
  });

  it("recusa uma fala do aluno com 503", async () => {
    const resposta = await request(aplicacao)
      .post(`/api/v1/ia/osce/${CENARIO_ID}/mensagem`)
      .set("Authorization", `Bearer ${tokenValido()}`)
      .send({ mensagem: "Onde dói?", historico: [] });

    expect(resposta.status).toBe(503);
    expect(resposta.body.erro.codigo).toBe("IA_INDISPONIVEL");
  });

  it("recusa a finalizacao da estacao com 503", async () => {
    const resposta = await request(aplicacao)
      .post(`/api/v1/ia/osce/${CENARIO_ID}/finalizar`)
      .set("Authorization", `Bearer ${tokenValido()}`)
      .send({ historico: [] });

    expect(resposta.status).toBe(503);
    expect(resposta.body.erro.codigo).toBe("IA_INDISPONIVEL");
  });
});
