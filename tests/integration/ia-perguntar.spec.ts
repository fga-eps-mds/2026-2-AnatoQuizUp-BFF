import jwt from "jsonwebtoken";
import request from "supertest";

jest.mock("@/shared/clients/backend.client", () => ({
  backendClient: { request: jest.fn() },
}));

jest.mock("@/shared/clients/quiz.client", () => ({
  quizClient: { request: jest.fn() },
}));

jest.mock("@/shared/clients/gemini.client", () => ({
  geminiClient: { post: jest.fn() },
}));

import { aplicacao } from "@/config/app";
import { geminiClient } from "@/shared/clients/gemini.client";

const SEGREDO = process.env.JWT_SECRET_KEY ?? "test-secret";

const tokenValido = () =>
  jwt.sign({ sub: "u1", papel: "ALUNO", status: "ATIVO" }, SEGREDO, { expiresIn: "5m" });

const geminiMock = geminiClient as unknown as { post: jest.Mock };

beforeEach(() => {
  geminiMock.post.mockReset();
});

describe("POST /api/v1/ia/perguntar - Gemini habilitada", () => {
  it("devolve o texto da resposta quando a Gemini retorna um candidato", async () => {
    geminiMock.post.mockResolvedValue({
      data: { candidates: [{ content: { parts: [{ text: "O femur e o osso mais longo." }] } }] },
    });

    const resposta = await request(aplicacao)
      .post("/api/v1/ia/perguntar")
      .set("Authorization", `Bearer ${tokenValido()}`)
      .send({ pergunta: "Por que o femur e tao grande?", tema: "Sistema Esquelético" });

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({ resposta: "O femur e o osso mais longo." });
    expect(geminiMock.post).toHaveBeenCalledWith(
      expect.stringContaining(":generateContent"),
      expect.objectContaining({
        contents: [
          expect.objectContaining({
            parts: [expect.objectContaining({ text: expect.stringContaining("Sistema Esquelético") })],
          }),
        ],
      }),
    );
  });

  it("retorna 502 quando a Gemini nao devolve nenhum candidato (bloqueio de seguranca)", async () => {
    geminiMock.post.mockResolvedValue({ data: { candidates: [] } });

    const resposta = await request(aplicacao)
      .post("/api/v1/ia/perguntar")
      .set("Authorization", `Bearer ${tokenValido()}`)
      .send({ pergunta: "Pergunta qualquer" });

    expect(resposta.status).toBe(502);
    expect(resposta.body.erro.codigo).toBe("ERRO_DOWNSTREAM");
  });
});
