import express from "express";
import type { NextFunction, Request, Response } from "express";
import request from "supertest";

jest.mock("@/shared/middlewares/autenticacao.middleware", () => ({
  middlewareAutenticacao: jest.fn((_req: Request, _res: Response, next: NextFunction) => {
    next();
  }),
}));

jest.mock("@/shared/middlewares/proxy.middleware", () => ({
  criarProxyHandler: jest.fn(() => (_req: Request, res: Response) => {
    res.status(200).json({ mensagem: "Passou pelo proxy de usuarios!" });
  }),
}));

jest.mock("@/shared/clients/backend.client", () => ({
  backendClient: { dummy: "mock-client" },
}));

import { usuariosRouter } from "@/routes/usuarios.routes";
import { middlewareAutenticacao } from "@/shared/middlewares/autenticacao.middleware";

describe("Usuarios Router (BFF)", () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();

    app = express();
    app.use("/api/v1/usuarios", usuariosRouter);
  });

  it("deve passar pelo middleware de autenticacao e chegar no proxy ao fazer um GET", async () => {
    const response = await request(app).get("/api/v1/usuarios/alunos?busca=joao");

    expect(middlewareAutenticacao).toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ mensagem: "Passou pelo proxy de usuarios!" });
  });

  it("deve barrar a requisicao se o middleware de autenticacao falhar", async () => {
    (middlewareAutenticacao as jest.Mock).mockImplementationOnce(
      (_req: Request, res: Response) => {
        res.status(401).json({ erro: "Nao autorizado" });
      },
    );

    const response = await request(app).get("/api/v1/usuarios/alunos");

    expect(middlewareAutenticacao).toHaveBeenCalled();
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ erro: "Nao autorizado" });
  });

  it("deve rotear sub-rotas e query strings para o proxy", async () => {
    const responseIds = await request(app).get("/api/v1/usuarios?ids=aluno-1,aluno-2");
    const responseAlunos = await request(app).get("/api/v1/usuarios/alunos?busca=maria");

    expect(responseIds.status).toBe(200);
    expect(responseAlunos.status).toBe(200);
  });

  //TESTES PARA A ROTA DO AVATAR 

  it("deve encaminhar a rota /meu-avatar para o proxy quando autenticado", async () => {
    const response = await request(app).get("/api/v1/usuarios/meu-avatar");

    expect(middlewareAutenticacao).toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ mensagem: "Passou pelo proxy de usuarios!" });
  });

  it("deve barrar a requisicao para /meu-avatar se o usuario nao estiver autenticado", async () => {
    (middlewareAutenticacao as jest.Mock).mockImplementationOnce(
      (_req: Request, res: Response) => {
        res.status(401).json({ erro: "Nao autorizado" });
      },
    );

    const response = await request(app).get("/api/v1/usuarios/meu-avatar");

    expect(middlewareAutenticacao).toHaveBeenCalled();
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ erro: "Nao autorizado" });
  });
});