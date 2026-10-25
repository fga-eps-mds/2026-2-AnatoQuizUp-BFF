import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

import { env } from "@/config/env";
import { geminiClient } from "@/shared/clients/gemini.client";
import { quizClient } from "@/shared/clients/quiz.client";
import { MENSAGENS } from "@/shared/constants/mensagens";
import { CodigoDeErro } from "@/shared/errors/codigos-de-erro";
import { ErroAplicacao } from "@/shared/errors/erro-aplicacao";
import { middlewareAutenticacao } from "@/shared/middlewares/autenticacao.middleware";

// Corpo aceito por POST /ia/perguntar: a pergunta livre do aluno, mais o contexto
// opcional da questao ativa (nunca dados de identificacao do aluno).
const schemaPerguntaAjuda = z.object({
  pergunta: z.string().trim().min(1).max(500),
  tema: z.string().optional(),
  dificuldade: z.string().optional(),
  enunciado: z.string().optional(),
});

type RespostaGerarConteudo = {
  candidates?: {
    content?: { parts?: { text?: string }[] };
  }[];
};

/**
 * Monta a instrucao de sistema enviada a Gemini: fixa o idioma/foco e proibe
 * revelar a alternativa correta da questao ativa, mesmo que o aluno pergunte.
 */
function montarInstrucaoSistema(): string {
  return (
    "Voce e um assistente de estudos de anatomia de um app de quiz para alunos de " +
    "graduacao. Responda sempre em portugues do Brasil, de forma curta e didatica. " +
    "Nunca revele qual e a alternativa correta de uma questao de multipla escolha " +
    "mencionada no contexto, mesmo se o aluno pedir diretamente — de pistas e explicacoes " +
    "conceituais, nao a resposta."
  );
}

/**
 * Monta o texto enviado como mensagem do usuario: a pergunta do aluno mais o
 * contexto opcional da questao ativa (tema/dificuldade/enunciado).
 */
function montarMensagemUsuario(corpo: z.infer<typeof schemaPerguntaAjuda>): string {
  const contexto = [
    corpo.tema ? `Tema: ${corpo.tema}` : null,
    corpo.dificuldade ? `Dificuldade: ${corpo.dificuldade}` : null,
    corpo.enunciado ? `Questao em andamento: ${corpo.enunciado}` : null,
  ].filter(Boolean);

  if (contexto.length === 0) {
    return corpo.pergunta;
  }

  return `Contexto:\n${contexto.join("\n")}\n\nPergunta do aluno: ${corpo.pergunta}`;
}

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

// Pergunta livre do aluno sobre o conteudo, respondida pela Gemini API.
router.post("/perguntar", async (request: Request, response: Response, next: NextFunction) => {
  try {
    const corpo = schemaPerguntaAjuda.safeParse(request.body);
    if (!corpo.success) {
      throw new ErroAplicacao({
        codigoStatus: 400,
        codigo: CodigoDeErro.REQUISICAO_INVALIDA,
        mensagem: MENSAGENS.perguntaInvalida,
      });
    }

    if (!geminiClient) {
      throw new ErroAplicacao({
        codigoStatus: 503,
        codigo: CodigoDeErro.IA_INDISPONIVEL,
        mensagem: MENSAGENS.iaIndisponivel,
      });
    }

    const { data } = await geminiClient.post<RespostaGerarConteudo>(
      `/v1beta/models/${env.GEMINI_MODEL}:generateContent`,
      {
        system_instruction: { parts: [{ text: montarInstrucaoSistema() }] },
        contents: [{ role: "user", parts: [{ text: montarMensagemUsuario(corpo.data) }] }],
      },
    );

    const resposta = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!resposta) {
      throw new ErroAplicacao({
        codigoStatus: 502,
        codigo: CodigoDeErro.ERRO_DOWNSTREAM,
        mensagem: MENSAGENS.respostaIaIndisponivel,
      });
    }

    return response.status(200).json({ resposta });
  } catch (error) {
    return next(error);
  }
});

// Qualquer outra rota sob /ia que nao exista: sem a Gemini configurada, reporta a IA
// como indisponivel; com ela configurada, e so uma rota inexistente (404 padrao).
router.all(/.*/, (_request, _response, next) => {
  if (!geminiClient) {
    return next(
      new ErroAplicacao({
        codigoStatus: 503,
        codigo: CodigoDeErro.IA_INDISPONIVEL,
        mensagem: MENSAGENS.iaIndisponivel,
      }),
    );
  }
  return next();
});

export { router as iaRouter };
