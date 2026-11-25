import jwt from "jsonwebtoken";
import request from "supertest";

jest.mock("@/shared/clients/quiz.client", () => ({
  quizClient: {
    request: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
  },
}));

import { aplicacao } from "@/config/app";
import { env } from "@/config/env";
import { quizClient } from "@/shared/clients/quiz.client";

const quizRequestMock = quizClient.request as jest.Mock;
const quizPostMock = quizClient.post as jest.Mock;
const quizPutMock = quizClient.put as jest.Mock;

describe("questoesRouter", () => {
  let token: string;

  beforeEach(() => {
    jest.clearAllMocks();
    token = jwt.sign(
      { id: "professor-1", email: "professor@anatoquizup.com", papel: "PROFESSOR", status: "ATIVO" },
      env.JWT_SECRET_KEY,
      { expiresIn: "1h" },
    );
  });

  // --- TESTES DE GET (PROXY) ---
  test("exige Authorization para listar questoes", async () => {
    const resposta = await request(aplicacao).get("/api/v1/questoes");

    expect(resposta.status).toBe(401);
    expect(quizRequestMock).not.toHaveBeenCalled();
  });

  test("encaminha questoes autenticadas para o Quiz-Service via Proxy", async () => {
    quizRequestMock.mockResolvedValueOnce({
      status: 200,
      headers: { "content-type": "application/json" },
      data: { dados: [], metadados: { page: 1, limit: 10, total: 0, totalPages: 1 } },
    });

    const resposta = await request(aplicacao)
      .get("/api/v1/questoes")
      .set("Authorization", `Bearer ${token}`);

    expect(resposta.status).toBe(200);
    expect(quizRequestMock).toHaveBeenCalled();
  });

  // --- TESTES DE POST (CRIAR QUESTÃO) ---
  test("cria uma nova questao com imagem com sucesso", async () => {
    quizPostMock.mockResolvedValueOnce({
      status: 201,
      data: { id: "q1", titulo: "Nova questao" },
    });

    const resposta = await request(aplicacao)
      .post("/api/v1/questoes")
      .set("Authorization", `Bearer ${token}`)
      .field("titulo", "Minha Questão")
      .attach("imagem", Buffer.from("conteudo-fake"), "foto.png");

    expect(resposta.status).toBe(201);
    expect(resposta.body.id).toBe("q1");
    expect(quizPostMock).toHaveBeenCalled();
  });

  test("cria uma questao processando corretamente objetos aninhados no body (linhas 23-24)", async () => {
    quizPostMock.mockResolvedValueOnce({ status: 201, data: { id: "q2" } });

    const resposta = await request(aplicacao)
      .post("/api/v1/questoes")
      .set("Authorization", `Bearer ${token}`)
      .send({ alternativas: { a: "Verdadeiro", b: "Falso" } }); 

    expect(resposta.status).toBe(201);
    expect(quizPostMock).toHaveBeenCalled();
  });

  test("retorna erro e repassa o status se o Quiz-Service falhar na criacao (ex: 400)", async () => {
    quizPostMock.mockRejectedValueOnce({
      response: {
        status: 400,
        data: { erro: "Dados invalidos" },
      },
    });

    const resposta = await request(aplicacao)
      .post("/api/v1/questoes")
      .set("Authorization", `Bearer ${token}`)
      .field("titulo", "Falha");

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro).toBe("Dados invalidos");
  });

  // --- TESTES DE PUT (ATUALIZAR QUESTÃO) ---
  test("atualiza uma questao com sucesso", async () => {
    quizPutMock.mockResolvedValueOnce({
      status: 200,
      data: { id: "123", titulo: "Atualizado" },
    });

    const resposta = await request(aplicacao)
      .put("/api/v1/questoes/123")
      .set("Authorization", `Bearer ${token}`)
      .field("titulo", "Atualizado");

    expect(resposta.status).toBe(200);
    expect(resposta.body.titulo).toBe("Atualizado");
    expect(quizPutMock).toHaveBeenCalled();
  });

  test("atualiza uma questao processando objetos aninhados no body (linhas 72-73)", async () => {
    quizPutMock.mockResolvedValueOnce({ status: 200, data: { id: "123" } });

    const resposta = await request(aplicacao)
      .put("/api/v1/questoes/123")
      .set("Authorization", `Bearer ${token}`)
      .send({ metadados: { tag: "anatomia-basica" } }); 

    expect(resposta.status).toBe(200);
    expect(quizPutMock).toHaveBeenCalled();
  });

  test("retorna erro estruturado do Quiz-Service na atualizacao (ex: 404 - linha 81)", async () => {
    quizPutMock.mockRejectedValueOnce({
      response: {
        status: 404,
        data: { erro: "Questao nao encontrada" },
      },
    });

    const resposta = await request(aplicacao)
      .put("/api/v1/questoes/123")
      .set("Authorization", `Bearer ${token}`)
      .field("titulo", "Falha");

    expect(resposta.status).toBe(404);
    expect(resposta.body.erro).toBe("Questao nao encontrada");
  });

  test("rejeita upload com formato de arquivo nao suportado", async () => {
    const resposta = await request(aplicacao)
      .post("/api/v1/questoes")
      .set("Authorization", `Bearer ${token}`)
      .field("titulo", "Falha")
      .attach("imagem", Buffer.from("conteudo-fake"), {
        filename: "documento.pdf",
        contentType: "application/pdf",
      });

    expect(resposta.status).toBe(500);
    expect(quizPostMock).not.toHaveBeenCalled();
  });

  test("retorna 500 generico se o Quiz-Service estourar erro sem resposta estruturada", async () => {
    quizPutMock.mockRejectedValueOnce(new Error("Erro interno fatal"));

    const resposta = await request(aplicacao)
      .put("/api/v1/questoes/123")
      .set("Authorization", `Bearer ${token}`)
      .field("titulo", "Atualizado");

    expect(resposta.status).toBe(500);
    expect(resposta.body.erro).toBe("Erro ao atualizar questão no BFF.");
  });
});