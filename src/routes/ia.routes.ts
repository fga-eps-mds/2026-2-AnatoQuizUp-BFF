import { Router, type NextFunction, type Request, type Response } from "express";

import { env } from "@/config/env";
import { aiClient } from "@/shared/clients/ai.client";
import { quizClient } from "@/shared/clients/quiz.client";
import { MENSAGENS } from "@/shared/constants/mensagens";
import { CodigoDeErro } from "@/shared/errors/codigos-de-erro";
import { ErroAplicacao } from "@/shared/errors/erro-aplicacao";
import { middlewareAutenticacao } from "@/shared/middlewares/autenticacao.middleware";
import { criarProxyHandler } from "@/shared/middlewares/proxy.middleware";

// Formato minimo do dashboard do aluno (Quiz-Service) que a dica precisa ler.
type DesempenhoTemaAlunoDto = {
  nome: string;
  taxaAcerto: number;
  status: "Tranquilo" | "Atenção" | "Crítico";
};
type DashboardAlunoDto = {
  totalRespondidas: number;
  porTema: DesempenhoTemaAlunoDto[];
};

/**
 * Monta a dica de estudo a partir do tema de pior desempenho do aluno.
 *
 * Sem nenhum tema "Atencao"/"Critico", nao ha reforco a sugerir.
 */
function montarDica(porTema: DesempenhoTemaAlunoDto[]): string {
  const piorTema = [...porTema]
    .filter((tema) => tema.status !== "Tranquilo")
    .sort((a, b) => a.taxaAcerto - b.taxaAcerto)[0];

  if (!piorTema) {
    return "Seu desempenho esta tranquilo em todos os temas respondidos. Continue praticando!";
  }

  return `Voce tem acertado ${piorTema.taxaAcerto}% das questoes de "${piorTema.nome}". Vale revisar esse tema.`;
}

const router = Router();

router.use(middlewareAutenticacao);

// Dica de estudo baseada em regra sobre o desempenho do proprio aluno por tema
// (sem LLM) — nao depende de AI_URL/aiClient estarem configurados.
router.get("/dica", async (request: Request, response: Response, next: NextFunction) => {
  try {
    const usuario = request.usuario;
    const authorization = request.headers.authorization;
    if (!usuario?.id || !authorization) {
      throw new ErroAplicacao({
        codigoStatus: 401,
        codigo: CodigoDeErro.NAO_AUTORIZADO,
        mensagem: MENSAGENS.tokenAcessoAusente,
      });
    }

    const { data } = await quizClient.get<DashboardAlunoDto>("/api/v1/dashboardAluno", {
      headers: {
        Authorization: authorization,
        "x-internal-token": env.INTERNAL_TOKEN,
        "x-user-id": usuario.id,
        "x-user-papel": usuario.papel,
        "x-user-status": usuario.status,
      },
    });

    if (data.totalRespondidas === 0) {
      throw new ErroAplicacao({
        codigoStatus: 404,
        codigo: CodigoDeErro.HISTORICO_INSUFICIENTE,
        mensagem: MENSAGENS.alunoSemHistorico,
      });
    }

    return response.status(200).json({ dica: montarDica(data.porTema) });
  } catch (error) {
    return next(error);
  }
});

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
