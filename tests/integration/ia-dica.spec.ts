import jwt from "jsonwebtoken";
import request from "supertest";

jest.mock("@/shared/clients/backend.client", () => ({
  backendClient: { request: jest.fn() },
}));

jest.mock("@/shared/clients/quiz.client", () => ({
  quizClient: { get: jest.fn() },
}));

jest.mock("@/shared/clients/ai.client", () => ({
  aiClient: null,
}));

import { aplicacao } from "@/config/app";
import { quizClient } from "@/shared/clients/quiz.client";

const SEGREDO = process.env.JWT_SECRET_KEY ?? "test-secret";

const tokenValido = () =>
  jwt.sign({ sub: "u1", papel: "ALUNO", status: "ATIVO" }, SEGREDO, { expiresIn: "5m" });

const quizMock = quizClient as unknown as { get: jest.Mock };

beforeEach(() => {
  quizMock.get.mockReset();
});

describe("GET /api/v1/ia/dica", () => {
  it("retorna 401 sem token de acesso", async () => {
    const resposta = await request(aplicacao).get("/api/v1/ia/dica");
    expect(resposta.status).toBe(401);
  });

  it("retorna 404 HISTORICO_INSUFICIENTE quando o aluno nao respondeu nenhuma questao", async () => {
    quizMock.get.mockResolvedValue({ data: { totalRespondidas: 0, porTema: [] } });

    const resposta = await request(aplicacao)
      .get("/api/v1/ia/dica")
      .set("Authorization", `Bearer ${tokenValido()}`);

    expect(resposta.status).toBe(404);
    expect(resposta.body.erro.codigo).toBe("HISTORICO_INSUFICIENTE");
  });

  it("retorna 401 quando o token nao traz identificador do usuario", async () => {
    const tokenSemSub = jwt.sign({ papel: "ALUNO", status: "ATIVO" }, SEGREDO, {
      expiresIn: "5m",
    });

    const resposta = await request(aplicacao)
      .get("/api/v1/ia/dica")
      .set("Authorization", `Bearer ${tokenSemSub}`);

    expect(resposta.status).toBe(401);
    expect(quizMock.get).not.toHaveBeenCalled();
  });

  it("escolhe o tema de pior desempenho entre varios temas fora de Tranquilo", async () => {
    quizMock.get.mockResolvedValue({
      data: {
        totalRespondidas: 20,
        porTema: [
          { nome: "Torax", taxaAcerto: 90, status: "Tranquilo" },
          { nome: "Cranio", taxaAcerto: 60, status: "Atenção" },
          { nome: "Abdomen", taxaAcerto: 30, status: "Crítico" },
        ],
      },
    });

    const resposta = await request(aplicacao)
      .get("/api/v1/ia/dica")
      .set("Authorization", `Bearer ${tokenValido()}`);

    expect(resposta.status).toBe(200);
    expect(resposta.body.dica).toContain("Abdomen");
  });

  it("retorna a dica com base no tema de pior desempenho do aluno", async () => {
    quizMock.get.mockResolvedValue({
      data: {
        totalRespondidas: 10,
        porTema: [
          { nome: "Torax", taxaAcerto: 90, status: "Tranquilo" },
          { nome: "Cranio", taxaAcerto: 40, status: "Crítico" },
        ],
      },
    });

    const resposta = await request(aplicacao)
      .get("/api/v1/ia/dica")
      .set("Authorization", `Bearer ${tokenValido()}`);

    expect(resposta.status).toBe(200);
    expect(resposta.body.dica).toContain("Cranio");
  });

  it('retorna a mensagem padrao quando nenhum tema esta "Atencao"/"Critico"', async () => {
    quizMock.get.mockResolvedValue({
      data: {
        totalRespondidas: 5,
        porTema: [{ nome: "Torax", taxaAcerto: 100, status: "Tranquilo" }],
      },
    });

    const resposta = await request(aplicacao)
      .get("/api/v1/ia/dica")
      .set("Authorization", `Bearer ${tokenValido()}`);

    expect(resposta.status).toBe(200);
    expect(resposta.body.dica).toContain("tranquilo");
  });
});
