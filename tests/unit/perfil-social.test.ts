import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import request from "supertest";

import { aplicacao } from "@/config/app";
import { backendClient } from "@/shared/clients/backend.client";
import { quizClient } from "@/shared/clients/quiz.client";
import { CodigoDeErro } from "@/shared/errors/codigos-de-erro";

import { PerfilSocialController } from "@/modules/perfil-social/perfil-social.controller";
import { PerfilSocialService } from "@/modules/perfil-social/perfil-social.service";

jest.mock("@/shared/clients/backend.client", () => ({
  backendClient: { get: jest.fn() },
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

const backendGet = backendClient.get as jest.Mock;
const quizGet = quizClient.get as jest.Mock;

const usuario = {
  id: "usuario-1",
  papel: "ALUNO",
  status: "ATIVO",
};

const amigo = {
  id: "amigo-1",
  nome: "Ana",
  nickname: "ana",
  curso: "Medicina",
  semestre: "3",
};

const amizade = {
  id: "amizade-1",
  criadoEm: "2026-06-01",
  atualizadoEm: "2026-06-01",
  excluidoEm: null,
  usuarioOrigemId: usuario.id,
  usuarioDestinoId: amigo.id,
  statusAmizade: "ATIVO",
  amigo,
};

const metadados = {
  page: 1,
  limit: 10,
  total: 1,
  totalPages: 1,
};

describe("PerfilSocialService", () => {
  const service = new PerfilSocialService();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("agrega cosmeticos e destaques na listagem de amigos", async () => {
    backendGet.mockResolvedValue({
      data: { dados: [amizade], metadados },
    });
    quizGet
      .mockResolvedValueOnce({
        data: { dados: { [amigo.id]: [{ id: "item-1" }] } },
      })
      .mockResolvedValueOnce({
        data: { dados: { [amigo.id]: [{ desbloqueioId: "desbloqueio-1" }] } },
      });

    const resultado = await service.listarAmigosSociais(
      usuario,
      "Bearer token",
      { page: 1, limit: 10 },
    );

    expect(resultado).toEqual({
      dados: [
        expect.objectContaining({
          amigo,
          cosmeticos: [{ id: "item-1" }],
          conquistasDestacadas: [{ desbloqueioId: "desbloqueio-1" }],
        }),
      ],
      metadados,
    });
    expect(quizGet).toHaveBeenNthCalledWith(
      1,
      "/api/v1/inventario/usuarios/equipados",
      expect.objectContaining({ params: { usuarioIds: amigo.id } }),
    );
    expect(quizGet).toHaveBeenNthCalledWith(
      2,
      "/api/v1/conquistas/usuarios/destaques",
      expect.objectContaining({ params: { usuarioIds: amigo.id } }),
    );
  });

  test("nao consulta o Quiz-Service quando a pagina nao possui amigos", async () => {
    backendGet.mockResolvedValue({
      data: {
        dados: [],
        metadados: { ...metadados, total: 0, totalPages: 0 },
      },
    });

    const resultado = await service.listarAmigosSociais(
      usuario,
      "Bearer token",
      {},
    );

    expect(resultado.dados).toEqual([]);
    expect(quizGet).not.toHaveBeenCalled();
  });

  test("usa arrays vazios quando o Quiz-Service nao retorna dados do amigo", async () => {
    backendGet.mockResolvedValue({
      data: { dados: [amizade], metadados },
    });
    quizGet
      .mockResolvedValueOnce({ data: { dados: {} } })
      .mockResolvedValueOnce({ data: { dados: {} } });

    const resultado = await service.listarAmigosSociais(
      usuario,
      "Bearer token",
      {},
    );

    expect(resultado.dados[0]).toEqual(
      expect.objectContaining({
        cosmeticos: [],
        conquistasDestacadas: [],
      }),
    );
  });

  test("busca perfil confirmado em paginas posteriores", async () => {
    backendGet
      .mockResolvedValueOnce({
        data: {
          dados: [],
          metadados: { ...metadados, page: 1, totalPages: 2 },
        },
      })
      .mockResolvedValueOnce({
        data: {
          dados: [amizade],
          metadados: { ...metadados, page: 2, totalPages: 2 },
        },
      });
    quizGet
      .mockResolvedValueOnce({ data: { dados: { [amigo.id]: [] } } })
      .mockResolvedValueOnce({ data: { dados: { [amigo.id]: [] } } });

    const resultado = await service.buscarPerfilSocial(
      usuario,
      "Bearer token",
      amigo.id,
    );

    expect(resultado).toEqual({
      usuario: amigo,
      cosmeticos: [],
      conquistasDestacadas: [],
    });
    expect(backendGet).toHaveBeenCalledTimes(2);
  });

  test("usa dados sociais vazios quando o Quiz-Service omite o usuario", async () => {
    backendGet.mockResolvedValue({
      data: { dados: [amizade], metadados },
    });
    quizGet
      .mockResolvedValueOnce({ data: { dados: {} } })
      .mockResolvedValueOnce({ data: { dados: {} } });

    const resultado = await service.buscarPerfilSocial(
      usuario,
      "Bearer token",
      amigo.id,
    );

    expect(resultado).toEqual({
      usuario: amigo,
      cosmeticos: [],
      conquistasDestacadas: [],
    });
  });

  test("rejeita perfil que nao pertence as amizades confirmadas", async () => {
    backendGet.mockResolvedValue({
      data: {
        dados: [],
        metadados: { ...metadados, total: 0, totalPages: 1 },
      },
    });

    await expect(
      service.buscarPerfilSocial(usuario, "Bearer token", "desconhecido"),
    ).rejects.toMatchObject({
      codigoStatus: 404,
      codigo: CodigoDeErro.NAO_ENCONTRADO,
    });
    expect(quizGet).not.toHaveBeenCalled();
  });
});

describe("PerfilSocialController", () => {
  const service = {
    listarAmigosSociais: jest.fn(),
    buscarPerfilSocial: jest.fn(),
  };
  const controller = new PerfilSocialController(
    service as unknown as PerfilSocialService,
  );
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  const next = jest.fn() as NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("lista amigos autenticados", async () => {
    service.listarAmigosSociais.mockResolvedValue({ dados: [], metadados });
    const request = {
      usuario,
      headers: { authorization: "Bearer token" },
      query: { page: 1 },
    } as unknown as Request;

    await controller.listarAmigos(request, response, next);

    expect(service.listarAmigosSociais).toHaveBeenCalledWith(
      usuario,
      "Bearer token",
      { page: 1 },
    );
    expect(response.status).toHaveBeenCalledWith(200);
  });

  test("busca um perfil autenticado", async () => {
    service.buscarPerfilSocial.mockResolvedValue({ usuario: amigo });
    const request = {
      usuario,
      headers: { authorization: "Bearer token" },
      params: { usuarioId: amigo.id },
    } as unknown as Request;

    await controller.buscarPerfil(request as never, response, next);

    expect(service.buscarPerfilSocial).toHaveBeenCalledWith(
      usuario,
      "Bearer token",
      amigo.id,
    );
    expect(response.json).toHaveBeenCalledWith({
      mensagem: "Perfil social encontrado.",
      dados: { usuario: amigo },
    });
  });

  test.each([
    [{ headers: { authorization: "Bearer token" } }, "Usuario nao autenticado."],
    [{ usuario, headers: {} }, "Token de acesso ausente."],
  ])("encaminha falhas de autenticacao", async (request, mensagem) => {
    await controller.listarAmigos(
      { ...request, query: {} } as unknown as Request,
      response,
      next,
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        codigo: CodigoDeErro.NAO_AUTORIZADO,
        message: mensagem,
      }),
    );
  });

  test("encaminha erro retornado pelo servico", async () => {
    const erro = new Error("downstream");
    service.buscarPerfilSocial.mockRejectedValue(erro);

    await controller.buscarPerfil(
      {
        usuario,
        headers: { authorization: "Bearer token" },
        params: { usuarioId: amigo.id },
      } as never,
      response,
      next,
    );

    expect(next).toHaveBeenCalledWith(erro);
  });
});

describe("GET /api/v1/perfis/:usuarioId/social - validacao do id na rota", () => {
  const SEGREDO = process.env.JWT_SECRET_KEY ?? "test-secret";
  const tokenValido = () =>
    jwt.sign({ sub: usuario.id, papel: "ALUNO", status: "ATIVO" }, SEGREDO, {
      expiresIn: "5m",
    });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("corta com 400 antes de acionar o controller quando o usuarioId e so espaco", async () => {
    const resposta = await request(aplicacao)
      .get("/api/v1/perfis/%20/social")
      .set("Authorization", `Bearer ${tokenValido()}`);

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro.codigo).toBe("REQUISICAO_INVALIDA");
    expect(backendGet).not.toHaveBeenCalled();
  });

  test("segue para o controller quando o usuarioId e valido", async () => {
    backendGet.mockResolvedValue({
      data: {
        dados: [amizade],
        metadados: { ...metadados, page: 1, totalPages: 1 },
      },
    });
    quizGet.mockResolvedValue({ data: { dados: {} } });

    const resposta = await request(aplicacao)
      .get(`/api/v1/perfis/${amigo.id}/social`)
      .set("Authorization", `Bearer ${tokenValido()}`);

    expect(resposta.status).toBe(200);
    expect(backendGet).toHaveBeenCalled();
  });
});
