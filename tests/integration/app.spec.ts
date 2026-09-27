import jwt from "jsonwebtoken";
import request from "supertest";

jest.mock("@/shared/clients/backend.client", () => ({
  backendClient: { request: jest.fn() },
}));

jest.mock("@/shared/clients/quiz.client", () => ({
  quizClient: { request: jest.fn() },
}));

jest.mock("@/shared/clients/ai.client", () => ({
  aiClient: null,
}));

import { aplicacao } from "@/config/app";
import { backendClient } from "@/shared/clients/backend.client";
import { quizClient } from "@/shared/clients/quiz.client";

const SEGREDO = process.env.JWT_SECRET_KEY ?? "test-secret";

const tokenValido = () =>
  jwt.sign({ sub: "u1", papel: "ALUNO", status: "ATIVO" }, SEGREDO, { expiresIn: "5m" });

const backendMock = backendClient as unknown as { request: jest.Mock };
const quizMock = quizClient as unknown as { request: jest.Mock };

beforeEach(() => {
  backendMock.request.mockReset();
  quizMock.request.mockReset();
});

describe("GET /health", () => {
  it("retorna 200 com status ok", async () => {
    const resposta = await request(aplicacao).get("/health");
    expect(resposta.status).toBe(200);
    expect(resposta.body.dados.status).toBe("ok");
  });
});

describe("rota desconhecida", () => {
  it("retorna 404 padronizado", async () => {
    const resposta = await request(aplicacao).get("/nao-existe");
    expect(resposta.status).toBe(404);
    expect(resposta.body.erro.codigo).toBe("NAO_ENCONTRADO");
  });
});

describe("/api/v1/autenticacao - rotas publicas (sem JWT)", () => {
  it("repassa POST /login para o Backend", async () => {
    backendMock.request.mockResolvedValue({
      status: 200,
      data: { mensagem: "ok", dados: { accessToken: "x" } },
      headers: { "content-type": "application/json" },
    });

    const resposta = await request(aplicacao)
      .post("/api/v1/autenticacao/login")
      .send({ email: "a@b.com", senha: "x" });

    expect(resposta.status).toBe(200);
    expect(backendMock.request).toHaveBeenCalledTimes(1);
    const args = backendMock.request.mock.calls[0][0];
    expect(args.method).toBe("POST");
    expect(args.url).toBe("/api/v1/autenticacao/login");
    expect(args.headers["x-internal-token"]).toBeDefined();
  });

  it("repassa GET /alunos/localidades/estados sem JWT", async () => {
    backendMock.request.mockResolvedValue({
      status: 200,
      data: { mensagem: "ok", dados: [] },
      headers: {},
    });
    const resposta = await request(aplicacao).get(
      "/api/v1/autenticacao/alunos/localidades/estados",
    );
    expect(resposta.status).toBe(200);
  });

  it("repassa POST /recuperar-senha sem JWT", async () => {
    backendMock.request.mockResolvedValue({
      status: 200,
      data: { mensagem: "ok", dados: null },
      headers: {},
    });

    const resposta = await request(aplicacao)
      .post("/api/v1/autenticacao/recuperar-senha")
      .send({ email: "a@b.com" });

    expect(resposta.status).toBe(200);
    expect(backendMock.request.mock.calls[0][0].url).toBe(
      "/api/v1/autenticacao/recuperar-senha",
    );
  });
});

describe("/api/v1/autenticacao - sessoes", () => {
  it("repassa POST /login sem JWT", async () => {
    backendMock.request.mockResolvedValue({
      status: 200,
      data: { mensagem: "ok", dados: { accessToken: "x" } },
      headers: {},
    });

    const resposta = await request(aplicacao)
      .post("/api/v1/autenticacao/login")
      .send({ email: "a@b.com", senha: "x" });

    expect(resposta.status).toBe(200);
    const args = backendMock.request.mock.calls[0][0];
    expect(args.url).toBe("/api/v1/autenticacao/login");
    expect(args.headers["x-internal-token"]).toBeDefined();
  });

  it("repassa POST /atualizar-token sem JWT", async () => {
    backendMock.request.mockResolvedValue({
      status: 200,
      data: { mensagem: "ok", dados: { accessToken: "x", refreshToken: "y" } },
      headers: {},
    });

    const resposta = await request(aplicacao)
      .post("/api/v1/autenticacao/atualizar-token")
      .send({ refreshToken: "refresh-token" });

    expect(resposta.status).toBe(200);
    expect(backendMock.request.mock.calls[0][0].url).toBe(
      "/api/v1/autenticacao/atualizar-token",
    );
  });
});

describe("/api/v1/autenticacao - rotas autenticadas", () => {
  it("rejeita /usuario-atual sem token", async () => {
    const resposta = await request(aplicacao).get("/api/v1/autenticacao/usuario-atual");
    expect(resposta.status).toBe(401);
    expect(backendMock.request).not.toHaveBeenCalled();
  });

  it("repassa /usuario-atual com token valido injetando X-User-*", async () => {
    backendMock.request.mockResolvedValue({
      status: 200,
      data: { mensagem: "ok", dados: { id: "u1" } },
      headers: {},
    });

    const resposta = await request(aplicacao)
      .get("/api/v1/autenticacao/usuario-atual")
      .set("Authorization", `Bearer ${tokenValido()}`);

    expect(resposta.status).toBe(200);
    const args = backendMock.request.mock.calls[0][0];
    expect(args.headers["x-user-id"]).toBe("u1");
    expect(args.headers["x-user-papel"]).toBe("ALUNO");
    expect(args.headers["x-user-status"]).toBe("ATIVO");
  });
});

describe("/api/v1/admin", () => {
  it("rejeita sem token", async () => {
    const resposta = await request(aplicacao).get("/api/v1/admin/usuarios");
    expect(resposta.status).toBe(401);
  });

  it("repassa com token", async () => {
    backendMock.request.mockResolvedValue({
      status: 200,
      data: { mensagem: "ok", dados: [] },
      headers: {},
    });
    const resposta = await request(aplicacao)
      .get("/api/v1/admin/usuarios")
      .set("Authorization", `Bearer ${tokenValido()}`);
    expect(resposta.status).toBe(200);
  });
});

describe("/api/v1/usuarios", () => {
  it("rejeita sem token", async () => {
    const resposta = await request(aplicacao).get("/api/v1/usuarios/alunos");

    expect(resposta.status).toBe(401);
    expect(backendMock.request).not.toHaveBeenCalled();
  });

  it("repassa chamadas autenticadas para o Backend", async () => {
    backendMock.request.mockResolvedValue({
      status: 200,
      data: { mensagem: "ok", dados: [] },
      headers: {},
    });

    const resposta = await request(aplicacao)
      .get("/api/v1/usuarios/alunos?busca=joao")
      .set("Authorization", `Bearer ${tokenValido()}`);

    expect(resposta.status).toBe(200);
    expect(quizMock.request).not.toHaveBeenCalled();
    const args = backendMock.request.mock.calls[0][0];
    expect(args.method).toBe("GET");
    expect(args.url).toBe("/api/v1/usuarios/alunos?busca=joao");
    expect(args.headers["x-internal-token"]).toBeDefined();
    expect(args.headers["x-user-id"]).toBe("u1");
  });
});

describe("/api/v1/exemplos", () => {
  it("repassa POST autenticado", async () => {
    backendMock.request.mockResolvedValue({
      status: 201,
      data: { mensagem: "criado", dados: { id: "e1" } },
      headers: {},
    });
    const resposta = await request(aplicacao)
      .post("/api/v1/exemplos")
      .set("Authorization", `Bearer ${tokenValido()}`)
      .send({ nome: "x" });
    expect(resposta.status).toBe(201);
  });
});

describe("/api/v1/turmas", () => {
  it("rejeita sem token", async () => {
    const resposta = await request(aplicacao).get("/api/v1/turmas");

    expect(resposta.status).toBe(401);
    expect(quizMock.request).not.toHaveBeenCalled();
    expect(backendMock.request).not.toHaveBeenCalled();
  });

  it("repassa GET /turmas de aluno para o Quiz-Service injetando X-User-Papel=ALUNO", async () => {
    quizMock.request.mockResolvedValue({
      status: 200,
      data: { mensagem: "ok", dados: [] },
      headers: {},
    });

    const resposta = await request(aplicacao)
      .get("/api/v1/turmas")
      .set("Authorization", `Bearer ${tokenValido()}`);

    expect(resposta.status).toBe(200);
    expect(backendMock.request).not.toHaveBeenCalled();
    const args = quizMock.request.mock.calls[0][0];
    expect(args.method).toBe("GET");
    expect(args.url).toBe("/api/v1/turmas");
    expect(args.headers["x-internal-token"]).toBeDefined();
    expect(args.headers["x-user-id"]).toBe("u1");
    expect(args.headers["x-user-papel"]).toBe("ALUNO");
  });

  it("repassa GET /turmas/:id para o Quiz-Service", async () => {
    quizMock.request.mockResolvedValue({
      status: 200,
      data: { mensagem: "ok", dados: { id: "turma-1" } },
      headers: {},
    });

    const resposta = await request(aplicacao)
      .get("/api/v1/turmas/turma-1")
      .set("Authorization", `Bearer ${tokenValido()}`);

    expect(resposta.status).toBe(200);
    const args = quizMock.request.mock.calls[0][0];
    expect(args.url).toBe("/api/v1/turmas/turma-1");
    expect(args.headers["x-user-papel"]).toBe("ALUNO");
  });
});

describe("/api/v1/usuarios/:id (busca publica)", () => {
  it("repassa GET /usuarios/:id de aluno para o Backend injetando X-User-Papel=ALUNO", async () => {
    backendMock.request.mockResolvedValue({
      status: 200,
      data: { mensagem: "ok", dados: { id: "prof-1", nome: "Maria", papel: "PROFESSOR" } },
      headers: {},
    });

    const resposta = await request(aplicacao)
      .get("/api/v1/usuarios/prof-1")
      .set("Authorization", `Bearer ${tokenValido()}`);

    expect(resposta.status).toBe(200);
    expect(quizMock.request).not.toHaveBeenCalled();
    const args = backendMock.request.mock.calls[0][0];
    expect(args.method).toBe("GET");
    expect(args.url).toBe("/api/v1/usuarios/prof-1");
    expect(args.headers["x-internal-token"]).toBeDefined();
    expect(args.headers["x-user-id"]).toBe("u1");
    expect(args.headers["x-user-papel"]).toBe("ALUNO");
  });
});

describe("/api/v1/questoes", () => {
  it("rejeita sem token", async () => {
    const resposta = await request(aplicacao).get("/api/v1/questoes");

    expect(resposta.status).toBe(401);
    expect(backendMock.request).not.toHaveBeenCalled();
    expect(quizMock.request).not.toHaveBeenCalled();
  });

  it("repassa chamadas autenticadas para o Quiz-Service", async () => {
    quizMock.request.mockResolvedValue({
      status: 200,
      data: { dados: [], metadados: { page: 1, limit: 10, total: 0, totalPages: 0 } },
      headers: {},
    });

    const resposta = await request(aplicacao)
      .get("/api/v1/questoes")
      .set("Authorization", `Bearer ${tokenValido()}`);

    expect(resposta.status).toBe(200);
    expect(backendMock.request).not.toHaveBeenCalled();
    const args = quizMock.request.mock.calls[0][0];
    expect(args.method).toBe("GET");
    expect(args.url).toBe("/api/v1/questoes");
    expect(args.headers["x-internal-token"]).toBeDefined();
    expect(args.headers["x-user-id"]).toBe("u1");
  });
});

describe("/api/v1/loja - identidade e contrato do proxy", () => {
  it("rejeita consulta sem JWT e nao chama o Quiz Service", async () => {
    const resposta = await request(aplicacao).get("/api/v1/loja/meu-historico-usos");

    expect(resposta.status).toBe(401);
    expect(quizMock.request).not.toHaveBeenCalled();
  });

  it("repassa metodo e query e substitui identidade forjada pela identidade do JWT", async () => {
    quizMock.request.mockResolvedValue({
      status: 200,
      data: { dados: [{ id: "uso-u1" }], metadados: { page: 1, limit: 10, total: 1, totalPages: 1 } },
      headers: { "content-type": "application/json" },
    });

    const resposta = await request(aplicacao)
      .get("/api/v1/loja/meu-historico-usos?page=1&usuarioId=u2")
      .set("Authorization", `Bearer ${tokenValido()}`)
      .set("X-User-Id", "u2")
      .set("X-Internal-Token", "forjado");

    expect(resposta.status).toBe(200);
    expect(resposta.body.dados).toEqual([{ id: "uso-u1" }]);
    const args = quizMock.request.mock.calls[0][0];
    expect(args.method).toBe("GET");
    expect(args.url).toBe("/api/v1/loja/meu-historico-usos?page=1&usuarioId=u2");
    expect(args.headers.authorization).toMatch(/^Bearer /);
    expect(args.headers["x-user-id"]).toBe("u1");
    expect(args.headers["x-internal-token"]).toBeDefined();
    expect(args.headers["x-internal-token"]).not.toBe("forjado");
  });

  it("preserva status e corpo de erro do Quiz Service em uma chamada existente", async () => {
    const erro = { erro: { codigo: "REQUISICAO_INVALIDA", mensagem: "Item indisponivel." } };
    quizMock.request.mockResolvedValue({ status: 422, data: erro, headers: {} });

    const resposta = await request(aplicacao)
      .post("/api/v1/loja/usar")
      .set("Authorization", `Bearer ${tokenValido()}`)
      .send({ itemLojaId: "item-1" });

    expect(resposta.status).toBe(422);
    expect(resposta.body).toEqual(erro);
    expect(quizMock.request.mock.calls[0][0]).toMatchObject({
      method: "POST",
      url: "/api/v1/loja/usar",
      data: { itemLojaId: "item-1" },
    });
  });
});

describe("/api/v1/ia - placeholder", () => {
  it("retorna 503 IA_INDISPONIVEL", async () => {
    const resposta = await request(aplicacao)
      .get("/api/v1/ia/qualquer-coisa")
      .set("Authorization", `Bearer ${tokenValido()}`);
    expect(resposta.status).toBe(503);
    expect(resposta.body.erro.codigo).toBe("IA_INDISPONIVEL");
  });
});

describe("erro do downstream", () => {
  it("retorna 502 quando backend rejeita conexao", async () => {
    const erro = new Error("connect ECONNREFUSED") as Error & { code?: string; isAxiosError?: boolean };
    erro.code = "ECONNREFUSED";
    erro.isAxiosError = true;
    Object.setPrototypeOf(erro, (await import("axios")).AxiosError.prototype);
    backendMock.request.mockRejectedValue(erro);

    const resposta = await request(aplicacao)
      .post("/api/v1/autenticacao/login")
      .send({ email: "a@b.com" });
    expect(resposta.status).toBe(502);
  });
});
