import type { NextFunction, Request, Response } from "express";

import { backendClient } from "@/shared/clients/backend.client";
import { quizClient } from "@/shared/clients/quiz.client";
import { CodigoDeErro } from "@/shared/errors/codigos-de-erro";

import { RankingController } from "@/modules/ranking/ranking.controller";
import { RankingService } from "@/modules/ranking/ranking.service";
import { rankingRouter } from "@/modules/ranking/ranking.routes";

jest.mock("@/shared/clients/backend.client", () => ({
  backendClient: { get: jest.fn() },
}));

jest.mock("@/shared/clients/quiz.client", () => ({
  quizClient: { get: jest.fn() },
}));

const backendGet = backendClient.get as jest.Mock;
const quizGet = quizClient.get as jest.Mock;

const usuarioAluno = { id: "u1", papel: "ALUNO", status: "ATIVO" };
const usuarioProfessor = { id: "p1", papel: "PROFESSOR", status: "ATIVO" };
const auth = "Bearer token";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("RankingService.rankingGeral", () => {
  const service = new RankingService();

  test("ordena por XP antes dos acertos e devolve XP, nivel e elo de cada aluno", async () => {
    backendGet.mockResolvedValue({
      data: {
        dados: [
          { id: "u1", nome: "Joao", nickname: "joao", curso: "Medicina", semestre: "3" },
          { id: "u2", nome: "Ana", nickname: "ana", curso: null, semestre: null },
          { id: "u3", nome: "Bia", nickname: "bia", curso: null, semestre: null },
        ],
      },
    });
    quizGet.mockImplementation((url: string) => {
      if (url.includes("pontuacoes")) {
        return Promise.resolve({
          data: {
            dados: [
              // Mais acertos, porem menos XP: fica atras de quem tem mais XP.
              { usuarioId: "u2", xpTotal: 90, nivel: 1, elo: "Curioso", totalAcertos: 50, totalRespondidas: 60, ultimaAtividade: null },
              { usuarioId: "u1", xpTotal: 1520, nivel: 6, elo: "Interno", totalAcertos: 10, totalRespondidas: 20, ultimaAtividade: null },
            ],
          },
        });
      }
      return Promise.resolve({ data: { dados: {} } });
    });

    const resultado = await service.rankingGeral(usuarioAluno, auth);

    expect(resultado.dados.map((entrada) => entrada.usuarioId)).toEqual(["u1", "u2", "u3"]);
    expect(resultado.dados[0]).toMatchObject({ posicao: 1, xpTotal: 1520, nivel: 6, elo: "Interno" });
    expect(resultado.dados[1]).toMatchObject({ posicao: 2, xpTotal: 90, nivel: 1, elo: "Curioso" });
    // Quem nunca pontuou aparece com 0 XP no nivel 1 e elo Curioso.
    expect(resultado.dados[2]).toMatchObject({ posicao: 3, xpTotal: 0, nivel: 1, elo: "Curioso" });
    expect(resultado.usuarioAtual).toMatchObject({ usuarioId: "u1", posicao: 1, xpTotal: 1520, elo: "Interno" });
  });

  test("ordena por acertos, destaca o usuario atual e anexa cosmeticos", async () => {
    backendGet.mockResolvedValue({
      data: {
        dados: [
          { id: "u1", nome: "Joao", nickname: "joao", curso: "Medicina", semestre: "3" },
          { id: "u2", nome: "Ana", nickname: "ana", curso: null, semestre: null },
        ],
      },
    });
    quizGet.mockImplementation((url: string) => {
      if (url.includes("pontuacoes")) {
        return Promise.resolve({
          data: {
            dados: [
              { usuarioId: "u2", totalAcertos: 5, totalRespondidas: 6, ultimaAtividade: null },
              { usuarioId: "u1", totalAcertos: 2, totalRespondidas: 4, ultimaAtividade: null },
            ],
          },
        });
      }
      return Promise.resolve({ data: { dados: { u1: [{ tipo: "AVATAR" }] } } });
    });

    const resultado = await service.rankingGeral(usuarioAluno, auth);

    expect(resultado.totalParticipantes).toBe(2);
    expect(resultado.dados[0]).toMatchObject({ usuarioId: "u2", posicao: 1, totalAcertos: 5 });
    expect(resultado.dados[1]).toMatchObject({
      usuarioId: "u1",
      posicao: 2,
      ehUsuarioAtual: true,
      cosmeticos: [{ tipo: "AVATAR" }],
    });
    expect(resultado.usuarioAtual?.usuarioId).toBe("u1");
    expect(backendGet).toHaveBeenCalledWith(
      "/api/v1/usuarios/visiveis",
      expect.objectContaining({ params: undefined }),
    );
  });

  test("professor recebe incluirPrivados=true", async () => {
    backendGet.mockResolvedValue({ data: { dados: [] } });
    quizGet.mockResolvedValue({ data: { dados: [] } });

    await service.rankingGeral(usuarioProfessor, auth);

    expect(backendGet).toHaveBeenCalledWith(
      "/api/v1/usuarios/visiveis",
      expect.objectContaining({ params: { incluirPrivados: "true" } }),
    );
  });

  test("respeita o limite cortando a lista", async () => {
    backendGet.mockResolvedValue({
      data: {
        dados: [
          { id: "a", nome: "A", nickname: null, curso: null, semestre: null },
          { id: "b", nome: "B", nickname: null, curso: null, semestre: null },
          { id: "c", nome: "C", nickname: null, curso: null, semestre: null },
        ],
      },
    });
    quizGet.mockResolvedValue({ data: { dados: [] } });

    const resultado = await service.rankingGeral(usuarioAluno, auth, 2);

    expect(resultado.dados).toHaveLength(2);
    expect(resultado.totalParticipantes).toBe(3);
  });

  test("nao quebra quando a busca de cosmeticos falha", async () => {
    backendGet.mockResolvedValue({
      data: { dados: [{ id: "u1", nome: "Joao", nickname: null, curso: null, semestre: null }] },
    });
    quizGet.mockImplementation((url: string) => {
      if (url.includes("pontuacoes")) {
        return Promise.resolve({ data: { dados: [] } });
      }
      return Promise.reject(new Error("equipados indisponivel"));
    });

    const resultado = await service.rankingGeral(usuarioAluno, auth);

    expect(resultado.dados[0].cosmeticos).toEqual([]);
  });

  test("aplica todos os desempates (respondidas, atividade e nome)", async () => {
    backendGet.mockResolvedValue({
      data: {
        dados: [
          { id: "a", nome: "Ana", nickname: null, curso: null, semestre: null },
          { id: "b", nome: "Bia", nickname: null, curso: null, semestre: null },
          { id: "c", nome: "Caio", nickname: null, curso: null, semestre: null },
          { id: "d", nome: "Davi", nickname: null, curso: null, semestre: null },
        ],
      },
    });
    quizGet.mockImplementation((url: string) => {
      if (url.includes("pontuacoes")) {
        return Promise.resolve({
          data: {
            dados: [
              { usuarioId: "a", totalAcertos: 5, totalRespondidas: 10, ultimaAtividade: "2026-02-01T00:00:00.000Z" },
              { usuarioId: "b", totalAcertos: 5, totalRespondidas: 8, ultimaAtividade: null },
              { usuarioId: "c", totalAcertos: 5, totalRespondidas: 8, ultimaAtividade: "2026-01-01T00:00:00.000Z" },
              { usuarioId: "d", totalAcertos: 5, totalRespondidas: 8, ultimaAtividade: "2026-01-01T00:00:00.000Z" },
            ],
          },
        });
      }
      return Promise.resolve({ data: { dados: {} } });
    });

    const resultado = await service.rankingGeral(usuarioAluno, auth);

    expect(resultado.dados.map((e) => e.usuarioId)).toEqual(["c", "d", "b", "a"]);
  });
});

describe("RankingService.rankingAmigos", () => {
  const service = new RankingService();

  test("filtra amigos privados/nao confirmados e inclui o proprio usuario", async () => {
    backendGet.mockImplementation((url: string) => {
      if (url === "/api/v1/amizade") {
        return Promise.resolve({
          data: {
            dados: [
              { statusAmizade: "ATIVO", amigo: { id: "f1", nome: "Ana", nickname: "ana", curso: null, semestre: null, visivel: true } },
              { statusAmizade: "ATIVO", amigo: { id: "f2", nome: "Bia", nickname: "bia", curso: null, semestre: null, visivel: false } },
              { statusAmizade: "PENDENTE", amigo: { id: "f3", nome: "Cleo", nickname: "cleo", curso: null, semestre: null, visivel: true } },
            ],
          },
        });
      }
      return Promise.resolve({ data: { dados: { id: "u1", nome: "Eu", papel: "ALUNO" } } });
    });
    quizGet.mockImplementation((url: string) => {
      if (url.includes("pontuacoes")) {
        return Promise.resolve({
          data: {
            dados: [
              { usuarioId: "u1", totalAcertos: 3, totalRespondidas: 3, ultimaAtividade: null },
              { usuarioId: "f1", totalAcertos: 1, totalRespondidas: 2, ultimaAtividade: null },
            ],
          },
        });
      }
      return Promise.resolve({ data: { dados: {} } });
    });

    const resultado = await service.rankingAmigos(usuarioAluno, auth);

    expect(resultado.totalParticipantes).toBe(2);
    expect(resultado.dados.map((e) => e.usuarioId)).toEqual(["u1", "f1"]);
    expect(resultado.usuarioAtual?.usuarioId).toBe("u1");
  });
});

describe("RankingService.rankingTurma", () => {
  const service = new RankingService();

  test("resolve nomes, ordena por acertos e usa fallback quando falta nome", async () => {
    quizGet.mockImplementation((url: string) => {
      if (url.includes("individual")) {
        return Promise.resolve({
          data: {
            alunos: [
              { alunoId: "a1", totalRespondidas: 4, totalAcertos: 2, taxaAcerto: 50, ultimaAtividade: null },
              { alunoId: "a2", totalRespondidas: 6, totalAcertos: 5, taxaAcerto: 83, ultimaAtividade: null },
            ],
          },
        });
      }
      return Promise.resolve({ data: { dados: {} } });
    });
    backendGet.mockResolvedValue({
      data: { dados: [{ id: "a2", nome: "Beatriz", nickname: "bia" }] },
    });

    const resultado = await service.rankingTurma(usuarioProfessor, auth, "turma-1");

    expect(resultado.totalAlunos).toBe(2);
    expect(resultado.dados[0]).toMatchObject({ alunoId: "a2", posicao: 1, nome: "Beatriz" });
    expect(resultado.dados[1]).toMatchObject({ alunoId: "a1", posicao: 2, nome: "Aluno" });
  });

  test("nao consulta nomes quando a turma nao tem alunos", async () => {
    quizGet.mockImplementation((url: string) => {
      if (url.includes("individual")) {
        return Promise.resolve({ data: { alunos: [] } });
      }
      return Promise.resolve({ data: { dados: {} } });
    });

    const resultado = await service.rankingTurma(usuarioProfessor, auth, "turma-vazia");

    expect(resultado.dados).toEqual([]);
    expect(backendGet).not.toHaveBeenCalled();
  });

  test("desempata por respondidas e por nome", async () => {
    quizGet.mockImplementation((url: string) => {
      if (url.includes("individual")) {
        return Promise.resolve({
          data: {
            alunos: [
              { alunoId: "a1", totalRespondidas: 5, totalAcertos: 3, taxaAcerto: 60, ultimaAtividade: null },
              { alunoId: "a2", totalRespondidas: 4, totalAcertos: 3, taxaAcerto: 75, ultimaAtividade: null },
              { alunoId: "a3", totalRespondidas: 4, totalAcertos: 3, taxaAcerto: 75, ultimaAtividade: null },
            ],
          },
        });
      }
      return Promise.resolve({ data: { dados: {} } });
    });
    backendGet.mockResolvedValue({
      data: {
        dados: [
          { id: "a1", nome: "Bruno", nickname: null },
          { id: "a2", nome: "Ana", nickname: null },
          { id: "a3", nome: "Caio", nickname: null },
        ],
      },
    });

    const resultado = await service.rankingTurma(usuarioProfessor, auth, "turma-1");

    expect(resultado.dados.map((e) => e.alunoId)).toEqual(["a2", "a3", "a1"]);
  });
});

describe("RankingService.rankingLista", () => {
  const service = new RankingService();

  test("ordena por acertos e repassa metadados da lista", async () => {
    quizGet.mockImplementation((url: string) => {
      if (url.includes("/listas/")) {
        return Promise.resolve({
          data: {
            listaTurmaId: "lt1",
            nomeLista: "Lista de Anatomia",
            totalQuestoes: 5,
            desempenhoAlunos: [
              { alunoId: "a1", status: "SUBMETIDA", totalAcertos: 4, taxaAcerto: 80, submissaoEm: "2026-06-01T10:00:00.000Z" },
              { alunoId: "a2", status: "NAO_RESPONDEU", totalAcertos: 0, taxaAcerto: 0, submissaoEm: null },
            ],
          },
        });
      }
      return Promise.resolve({ data: { dados: {} } });
    });
    backendGet.mockResolvedValue({
      data: { dados: [{ id: "a1", nome: "Ana", nickname: "ana" }, { id: "a2", nome: "Bia", nickname: "bia" }] },
    });

    const resultado = await service.rankingLista(usuarioProfessor, auth, "turma-1", "lt1");

    expect(resultado.nomeLista).toBe("Lista de Anatomia");
    expect(resultado.totalQuestoes).toBe(5);
    expect(resultado.dados[0]).toMatchObject({ alunoId: "a1", posicao: 1, status: "SUBMETIDA" });
    expect(resultado.dados[1]).toMatchObject({ alunoId: "a2", posicao: 2 });
  });

  test("desempata por taxa, submissao (inclusive nula) e nome", async () => {
    quizGet.mockImplementation((url: string) => {
      if (url.includes("/listas/")) {
        return Promise.resolve({
          data: {
            listaTurmaId: "lt1",
            nomeLista: "L",
            totalQuestoes: 5,
            desempenhoAlunos: [
              { alunoId: "p", status: "SUBMETIDA", totalAcertos: 5, taxaAcerto: 100, submissaoEm: "2026-01-01T00:00:00.000Z" },
              { alunoId: "q", status: "SUBMETIDA", totalAcertos: 3, taxaAcerto: 90, submissaoEm: "2026-01-05T00:00:00.000Z" },
              { alunoId: "r", status: "SUBMETIDA", totalAcertos: 3, taxaAcerto: 70, submissaoEm: "2026-01-02T00:00:00.000Z" },
              { alunoId: "s", status: "NAO_RESPONDEU", totalAcertos: 3, taxaAcerto: 70, submissaoEm: null },
              { alunoId: "t", status: "SUBMETIDA", totalAcertos: 3, taxaAcerto: 70, submissaoEm: "2026-01-02T00:00:00.000Z" },
            ],
          },
        });
      }
      return Promise.resolve({ data: { dados: {} } });
    });
    backendGet.mockResolvedValue({
      data: {
        dados: [
          { id: "p", nome: "Paula", nickname: null },
          { id: "q", nome: "Quenia", nickname: null },
          { id: "r", nome: "Rui", nickname: null },
          { id: "s", nome: "Sara", nickname: null },
          { id: "t", nome: "Tina", nickname: null },
        ],
      },
    });

    const resultado = await service.rankingLista(usuarioProfessor, auth, "t1", "lt1");

    expect(resultado.dados.map((e) => e.alunoId)).toEqual(["p", "q", "r", "t", "s"]);
  });
});

describe("RankingController", () => {
  const service = {
    rankingGeral: jest.fn(),
    rankingAmigos: jest.fn(),
    rankingTurma: jest.fn(),
    rankingLista: jest.fn(),
  };
  const controller = new RankingController(service as unknown as RankingService);
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  const next = jest.fn() as NextFunction;

  const baseReq = { usuario: usuarioAluno, headers: { authorization: auth } };

  test("geral responde 200 e repassa o limite parseado/limitado", async () => {
    service.rankingGeral.mockResolvedValue({ dados: [], usuarioAtual: null, totalParticipantes: 0 });

    await controller.geral({ ...baseReq, query: { limite: "500" } } as unknown as Request, response, next);

    expect(service.rankingGeral).toHaveBeenCalledWith(usuarioAluno, auth, 200);
    expect(response.status).toHaveBeenCalledWith(200);
  });

  test("geral usa limite indefinido quando o valor e invalido", async () => {
    service.rankingGeral.mockResolvedValue({ dados: [], usuarioAtual: null, totalParticipantes: 0 });

    await controller.geral({ ...baseReq, query: { limite: "abc" } } as unknown as Request, response, next);

    expect(service.rankingGeral).toHaveBeenCalledWith(usuarioAluno, auth, undefined);
  });

  test("geral sem parametro de limite passa undefined", async () => {
    service.rankingGeral.mockResolvedValue({ dados: [], usuarioAtual: null, totalParticipantes: 0 });

    await controller.geral({ ...baseReq, query: {} } as unknown as Request, response, next);

    expect(service.rankingGeral).toHaveBeenCalledWith(usuarioAluno, auth, undefined);
  });

  test("amigos responde 200", async () => {
    service.rankingAmigos.mockResolvedValue({ dados: [], usuarioAtual: null, totalParticipantes: 0 });

    await controller.amigos({ ...baseReq, query: {} } as unknown as Request, response, next);

    expect(service.rankingAmigos).toHaveBeenCalledWith(usuarioAluno, auth);
    expect(response.status).toHaveBeenCalledWith(200);
  });

  test("turma e lista repassam os parametros", async () => {
    service.rankingTurma.mockResolvedValue({ turmaId: "t1", totalAlunos: 0, dados: [] });
    service.rankingLista.mockResolvedValue({ turmaId: "t1", listaTurmaId: "l1", nomeLista: "L", totalQuestoes: 0, dados: [] });

    await controller.turma({ ...baseReq, params: { turmaId: "t1" } } as never, response, next);
    await controller.lista({ ...baseReq, params: { turmaId: "t1", listaId: "l1" } } as never, response, next);

    expect(service.rankingTurma).toHaveBeenCalledWith(usuarioAluno, auth, "t1");
    expect(service.rankingLista).toHaveBeenCalledWith(usuarioAluno, auth, "t1", "l1");
  });

  test.each([
    [{ headers: { authorization: auth } }, "Usuario nao autenticado."],
    [{ usuario: usuarioAluno, headers: {} }, "Token de acesso ausente."],
  ])("encaminha falhas de autenticacao", async (req, mensagem) => {
    await controller.geral({ ...req, query: {} } as unknown as Request, response, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ codigo: CodigoDeErro.NAO_AUTORIZADO, message: mensagem }),
    );
  });

  test("encaminha erro do service para o next", async () => {
    const erro = new Error("downstream");
    service.rankingAmigos.mockRejectedValue(erro);

    await controller.amigos({ ...baseReq, query: {} } as unknown as Request, response, next);

    expect(next).toHaveBeenCalledWith(erro);
  });
});

describe("rankingRouter", () => {
  test("expoe o roteador configurado", () => {
    expect(rankingRouter).toBeDefined();
  });
});
