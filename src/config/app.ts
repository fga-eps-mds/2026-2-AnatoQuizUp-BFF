// Montagem da aplicacao Express: registra middlewares globais, o health check, o
// roteador da API e, por ultimo, o 404 e o tratador central de erros.
import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";

import { criarOpcoesCors } from "@/config/cors";
import { env } from "@/config/env";
import { loggerHttp } from "@/config/logger";
import { apiRouter } from "@/routes";
import { MENSAGENS } from "@/shared/constants/mensagens";
import { CodigoDeErro } from "@/shared/errors/codigos-de-erro";
import { ErroAplicacao } from "@/shared/errors/erro-aplicacao";
import { middlewareTratamentoErros } from "@/shared/middlewares/tratamento-erros.middleware";

const aplicacao = express();
aplicacao.set("trust proxy", env.TRUST_PROXY_HOPS);

// Cadeia de middlewares globais, na ordem em que rodam a cada requisicao:
// log HTTP -> headers de seguranca (helmet) -> CORS -> parsing de JSON (limite 1mb).
aplicacao.use(loggerHttp);
aplicacao.use(helmet());
aplicacao.use(cors(criarOpcoesCors(env.CORS_ORIGINS)));
// Limita a API antes da autenticacao; o health check nao consome essa cota.
aplicacao.use("/api/v1", rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    erro: {
      codigo: "LIMITE_DE_REQUISICOES",
      mensagem: "Muitas requisicoes. Tente novamente em instantes.",
    },
  },
}));
aplicacao.use(express.json({ limit: "1mb" }));

// Endpoint de health check usado por monitoramento/infra para saber se o BFF esta no ar.
aplicacao.get("/health", (_request, response) => {
  return response.status(200).json({
    mensagem: MENSAGENS.bffEmExecucao,
    dados: {
      status: "ok",
      timestamp: new Date().toISOString(),
    },
  });
});

// Todas as rotas da API ficam sob o prefixo /api/v1.
aplicacao.use("/api/v1", apiRouter);

// Qualquer rota nao reconhecida ate aqui vira um 404 padronizado.
aplicacao.use((_request, _response, next) => {
  next(
    new ErroAplicacao({
      codigoStatus: 404,
      codigo: CodigoDeErro.NAO_ENCONTRADO,
      mensagem: MENSAGENS.rotaNaoEncontrada,
    }),
  );
});

// Tratador de erros sempre por ultimo, para capturar tudo o que veio antes.
aplicacao.use(middlewareTratamentoErros);

export { aplicacao };
