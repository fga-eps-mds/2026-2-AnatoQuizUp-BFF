import { AxiosError } from "axios";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { middlewareAutenticacao } from "@/shared/middlewares/autenticacao.middleware";
import { middlewareTratamentoErros } from "@/shared/middlewares/tratamento-erros.middleware";
import { CodigoDeErro } from "@/shared/errors/codigos-de-erro";
import { ErroAplicacao } from "@/shared/errors/erro-aplicacao";

const SEGREDO = process.env.JWT_SECRET_KEY ?? "test-secret";

function montarRequest(headers: Record<string, string> = {}) {
  return { headers } as unknown as Request;
}

function montarResponse() {
  const json = jest.fn().mockReturnThis();
  const status = jest.fn().mockReturnValue({ json });
  return { status, json } as unknown as Response;
}

describe("middlewareAutenticacao", () => {
  it("rejeita request sem header Authorization", () => {
    const next: NextFunction = jest.fn();
    middlewareAutenticacao(montarRequest(), montarResponse(), next);
    const erro = (next as jest.Mock).mock.calls[0][0];
    expect(erro).toBeInstanceOf(ErroAplicacao);
    expect(erro.codigo).toBe(CodigoDeErro.NAO_AUTORIZADO);
  });

  it("rejeita header sem prefixo Bearer", () => {
    const next: NextFunction = jest.fn();
    middlewareAutenticacao(
      montarRequest({ authorization: "Basic abc" }),
      montarResponse(),
      next,
    );
    expect((next as jest.Mock).mock.calls[0][0]).toBeInstanceOf(ErroAplicacao);
  });

  it("rejeita token invalido", () => {
    const next: NextFunction = jest.fn();
    middlewareAutenticacao(
      montarRequest({ authorization: "Bearer token-invalido" }),
      montarResponse(),
      next,
    );
    const erro = (next as jest.Mock).mock.calls[0][0];
    expect(erro).toBeInstanceOf(ErroAplicacao);
    expect(erro.codigoStatus).toBe(401);
  });

  it("aceita token valido e popula request.usuario", () => {
    const token = jwt.sign(
      { sub: "user-123", papel: "ALUNO", status: "ATIVO" },
      SEGREDO,
      { expiresIn: "5m" },
    );
    const request = montarRequest({ authorization: `Bearer ${token}` });
    const next: NextFunction = jest.fn();
    middlewareAutenticacao(request, montarResponse(), next);
    expect(next).toHaveBeenCalledWith();
    expect((request as Request).usuario).toEqual({
      id: "user-123",
      papel: "ALUNO",
      status: "ATIVO",
    });
  });

  it("usa 'id' e strings vazias quando o token nao traz sub/papel/status", () => {
    const token = jwt.sign({ id: "user-456" }, SEGREDO, { expiresIn: "5m" });
    const request = montarRequest({ authorization: `Bearer ${token}` });
    const next: NextFunction = jest.fn();
    middlewareAutenticacao(request, montarResponse(), next);
    expect(next).toHaveBeenCalledWith();
    expect((request as Request).usuario).toEqual({
      id: "user-456",
      papel: "",
      status: "",
    });
  });
});

describe("middlewareTratamentoErros", () => {
  it("traduz ErroAplicacao em resposta JSON", () => {
    const response = montarResponse();
    const erro = new ErroAplicacao({
      mensagem: "X",
      codigo: CodigoDeErro.PROIBIDO,
      codigoStatus: 403,
    });
    middlewareTratamentoErros(erro, montarRequest(), response, jest.fn());
    expect(response.status).toHaveBeenCalledWith(403);
  });

  it("traduz AxiosError de timeout em 504", () => {
    const response = montarResponse();
    const erro = new AxiosError("timeout");
    erro.code = "ECONNABORTED";
    middlewareTratamentoErros(erro, montarRequest(), response, jest.fn());
    expect(response.status).toHaveBeenCalledWith(504);
  });

  it("traduz AxiosError generico em 502", () => {
    const response = montarResponse();
    const erro = new AxiosError("falhou");
    erro.code = "ECONNREFUSED";
    middlewareTratamentoErros(erro, montarRequest(), response, jest.fn());
    expect(response.status).toHaveBeenCalledWith(502);
  });

  it("trata erros desconhecidos como 500", () => {
    const response = montarResponse();
    middlewareTratamentoErros(new Error("boom"), montarRequest(), response, jest.fn());
    expect(response.status).toHaveBeenCalledWith(500);
  });
});
