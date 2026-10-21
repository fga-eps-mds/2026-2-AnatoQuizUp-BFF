import { Router } from "express";

import { aiClient } from "@/shared/clients/ai.client";
import { MENSAGENS } from "@/shared/constants/mensagens";
import { CodigoDeErro } from "@/shared/errors/codigos-de-erro";
import { ErroAplicacao } from "@/shared/errors/erro-aplicacao";
import { middlewareAutenticacao } from "@/shared/middlewares/autenticacao.middleware";
import { criarProxyHandler } from "@/shared/middlewares/proxy.middleware";

const router = Router();

router.use(middlewareAutenticacao);

router.all(/.*/, (request, response, next) => {
  // O servico de IA ainda nao foi habilitado nesta release: sem client configurado,
  // qualquer chamada responde 503 em vez de quebrar.
  if (!aiClient) {
    return next(
      new ErroAplicacao({
        codigoStatus: 503,
        codigo: CodigoDeErro.IA_INDISPONIVEL,
        mensagem: MENSAGENS.iaIndisponivel,
      }),
    );
  }
  // Quando habilitado, faz proxy removendo o prefixo /ia da URL (o servico de IA
  // espera as rotas sob /api/v1 direto, sem o segmento de roteamento do BFF).
  return criarProxyHandler(aiClient, {
    montarUrl: (requisicao) => requisicao.originalUrl.replace(/^\/api\/v1\/ia(?=\/|$)/, "/api/v1"),
  })(request, response, next);
});

export { router as iaRouter };
