import express from "express";
import type { NextFunction, Request, Response } from "express";
import request from "supertest";

jest.mock("@/shared/middlewares/autenticacao.middleware", () => ({
  middlewareAutenticacao: jest.fn((req: Request, _res: Response, next: NextFunction) => {
    req.usuario = { id: "aluno-1", papel: "ALUNO", status: "ATIVO" };
    next();
  }),
}));

jest.mock("@/shared/middlewares/proxy.middleware", () => ({
  criarProxyHandler: jest.fn(() => (req: Request, res: Response) => {
    res.status(200).json({ repassado: true, corpo: req.body });
  }),
}));

jest.mock("@/shared/clients/backend.client", () => ({
  backendClient: { dummy: "mock-client" },
}));

jest.mock("@/shared/clients/quiz.client", () => ({
  quizClient: { get: jest.fn() },
}));

import { encontrarItensNaoAdquiridos } from "@/modules/avatar/posse-avatar";
import { usuariosRouter } from "@/routes/usuarios.routes";
import { quizClient } from "@/shared/clients/quiz.client";

const quizGet = quizClient.get as jest.Mock;

const catalogo = [
  { codigo: "tenis-esportivo-preto", tipo: "CALCADO", adquirido: true },
  { codigo: "bota-coturno", tipo: "CALCADO", adquirido: false },
  { codigo: "luva-goleiro", tipo: "LUVA", adquirido: false },
  { codigo: "trancas", tipo: "CABELO", adquirido: true },
  { codigo: "chapeu-cowboy", tipo: "ACESSORIO", adquirido: false },
];

const aparencia = (over: Record<string, unknown> = {}) => ({
  corCerebro: "rosa",
  cabelo: null,
  acessorio: null,
  luva: null,
  calcado: null,
  ...over,
});

const responderCatalogo = (dados = catalogo, totalPages = 1) =>
  quizGet.mockResolvedValue({ data: { dados, metadados: { totalPages } } });

const criarApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/usuarios", usuariosRouter);
  // Middleware de erro minimo, no formato do BFF.
  app.use((erro: { codigoStatus?: number; codigo?: string; detalhes?: unknown }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(erro.codigoStatus ?? 500).json({ erro: { codigo: erro.codigo, detalhes: erro.detalhes } });
  });
  return app;
};

describe("encontrarItensNaoAdquiridos", () => {
  it("aponta cada campo que usa item da loja nao comprado", () => {
    expect(
      encontrarItensNaoAdquiridos(
        aparencia({ luva: "luva-goleiro", acessorio: "chapeu-cowboy", calcado: "tenis-esportivo-preto" }),
        catalogo,
      ),
    ).toEqual([
      { campo: "acessorio", codigo: "chapeu-cowboy" },
      { campo: "luva", codigo: "luva-goleiro" },
    ]);
  });

  it("aceita itens base, que nao estao no catalogo", () => {
    expect(
      encontrarItensNaoAdquiridos(
        aparencia({ cabelo: "loiro", acessorio: "coroa", luva: "luva-boxe", calcado: "sapato-plantao" }),
        catalogo,
      ),
    ).toEqual([]);
  });

  it("so considera o item do mesmo tipo do campo", () => {
    // "bota-coturno" e CALCADO: usado como luva nao corresponde a nenhum item de LUVA.
    expect(encontrarItensNaoAdquiridos(aparencia({ luva: "bota-coturno" }), catalogo)).toEqual([]);
  });
});

describe("PUT /api/v1/usuarios/meu-avatar - posse dos itens", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("repassa ao Usuario-Service quando todos os itens da loja foram comprados", async () => {
    responderCatalogo();
    const corpo = aparencia({ cabelo: "trancas", calcado: "tenis-esportivo-preto", luva: "luva-boxe" });

    const resposta = await request(criarApp()).put("/api/v1/usuarios/meu-avatar").send(corpo);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({ repassado: true, corpo });
    expect(quizGet).toHaveBeenCalledWith(
      "/api/v1/loja/catalogo",
      expect.objectContaining({
        params: { page: 1, limit: 100 },
        headers: expect.objectContaining({ "x-user-id": "aluno-1" }),
      }),
    );
  });

  it("recusa com 403 e nao repassa quando ha item da loja nao comprado", async () => {
    responderCatalogo();

    const resposta = await request(criarApp())
      .put("/api/v1/usuarios/meu-avatar")
      .send(aparencia({ calcado: "bota-coturno" }));

    expect(resposta.status).toBe(403);
    expect(resposta.body.erro).toEqual({
      codigo: "PROIBIDO",
      detalhes: { itensNaoAdquiridos: [{ campo: "calcado", codigo: "bota-coturno" }] },
    });
  });

  it("nao consulta o catalogo quando o avatar nao usa nenhum item", async () => {
    const resposta = await request(criarApp()).put("/api/v1/usuarios/meu-avatar").send(aparencia());

    expect(resposta.status).toBe(200);
    expect(quizGet).not.toHaveBeenCalled();
  });

  it("percorre todas as paginas do catalogo", async () => {
    quizGet
      .mockResolvedValueOnce({ data: { dados: [catalogo[0]], metadados: { totalPages: 2 } } })
      .mockResolvedValueOnce({ data: { dados: [catalogo[2]], metadados: { totalPages: 2 } } });

    const resposta = await request(criarApp())
      .put("/api/v1/usuarios/meu-avatar")
      .send(aparencia({ luva: "luva-goleiro" }));

    expect(quizGet).toHaveBeenCalledTimes(2);
    expect(resposta.status).toBe(403);
  });

  it("nao salva o avatar quando o Quiz-Service falha", async () => {
    quizGet.mockRejectedValue(new Error("fora do ar"));

    const resposta = await request(criarApp())
      .put("/api/v1/usuarios/meu-avatar")
      .send(aparencia({ calcado: "tenis-esportivo-preto" }));

    expect(resposta.status).toBe(502);
    expect(resposta.body.erro.codigo).toBe("ERRO_DOWNSTREAM");
  });

  it("nao interfere nas outras rotas de usuarios", async () => {
    const resposta = await request(criarApp()).get("/api/v1/usuarios/meu-avatar");

    expect(resposta.status).toBe(200);
    expect(quizGet).not.toHaveBeenCalled();
  });
});
