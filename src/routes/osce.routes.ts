import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

import { env } from "@/config/env";
import { geminiClient } from "@/shared/clients/gemini.client";
import {
  buscarCenarioOsce,
  CENARIOS_OSCE,
  NIVEIS_DESEMPENHO,
  NOTAS_GLOBAIS,
  type CenarioOsce,
} from "@/shared/constants/cenarios-osce";
import { MENSAGENS } from "@/shared/constants/mensagens";
import { CodigoDeErro } from "@/shared/errors/codigos-de-erro";
import { ErroAplicacao } from "@/shared/errors/erro-aplicacao";
import { middlewareAutenticacao } from "@/shared/middlewares/autenticacao.middleware";
import { pontuarRubrica } from "@/shared/utils/pontuacao-osce";

// Uma troca do historico da simulacao: quem falou ("aluno" ou "paciente") e o texto.
const schemaTurno = z.object({
  autor: z.enum(["aluno", "paciente"]),
  texto: z.string().trim().min(1).max(1000),
});

const schemaMensagem = z.object({
  mensagem: z.string().trim().min(1).max(500),
  historico: z.array(schemaTurno).max(60).default([]),
});

const schemaFinalizar = z.object({
  historico: z.array(schemaTurno).max(60),
});

type RespostaGerarConteudo = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
};

// Thinking no nivel minimo: com o nivel alto a chamada levava 10-15s e as vezes
// estourava o REQUEST_TIMEOUT_MS (ou voltava vazia, gastando o budget de saida
// pensando). O gemini-3.5-flash-lite nao aceita `thinkingBudget: 0` (devolve 400
// INVALID_ARGUMENT); o minimo que ele expoe e `thinkingLevel: "low"`.
const GERACAO_THINKING_MINIMO = { thinkingConfig: { thinkingLevel: "low" } };

// A Gemini responde JSON por responseMimeType, mas um corpo malformado nao pode
// derrubar a rota: devolve null e o safeParse acima transforma em 502.
function parseJsonOuNulo(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

// Busca o cenario pelo :id da rota ou lanca 404 — repetido nas 3 rotas abaixo.
function obterCenarioOuFalhar(id: string | string[]): CenarioOsce {
  const cenario = buscarCenarioOsce(String(id));
  if (!cenario) {
    throw new ErroAplicacao({
      codigoStatus: 404,
      codigo: CodigoDeErro.NAO_ENCONTRADO,
      mensagem: MENSAGENS.cenarioOsceNaoEncontrado,
    });
  }
  return cenario;
}

// Instrucao de sistema para o "modo paciente": a IA interpreta o paciente do cenario,
// nunca sai do personagem e nunca verbaliza o diagnostico esperado por conta propria.
function montarInstrucaoPaciente(cenario: CenarioOsce): string {
  return (
    `Voce esta interpretando um paciente em uma simulacao OSCE (exame clinico estruturado) ` +
    `para treinar estudantes de medicina. Responda sempre em portugues do Brasil, em primeira ` +
    `pessoa, como o paciente descrito abaixo.\n\n` +
    `Perfil do paciente: ${cenario.perfilPaciente}\n` +
    `Queixa principal: ${cenario.queixaPrincipal}\n` +
    `Historia e achados reais (revele apenas o que for perguntado, nunca tudo de uma vez): ${cenario.roteiroOculto}\n\n` +
    `Regras: nunca saia do personagem de paciente; nunca diga o nome de um diagnostico medico ` +
    `(ex.: nao diga "${cenario.diagnosticoEsperado}"); nunca mencione que isto e uma simulacao; ` +
    `se o aluno perguntar algo que o paciente nao saberia responder tecnicamente, responda como ` +
    `uma pessoa leiga responderia.`
  );
}

// Instrucao de sistema para a avaliacao final: aqui a IA sai do personagem e vira
// examinador. Ela NAO calcula nota — so (a) classifica cada item do checklist contra
// as ancoras comportamentais do item e (b) atribui uma nota global holistica. Pesos,
// soma, corte e divergencia sao calculados em codigo (pontuarRubrica).
//
// As duas medidas sao pedidas de forma deliberadamente INDEPENDENTE, na ordem
// checklist -> nota global, como num OSCE real: se a nota global fosse derivada da
// soma do checklist, a concordancia entre as duas deixaria de ser informacao.
function montarInstrucaoAvaliacao(cenario: CenarioOsce): string {
  const rubrica = cenario.rubrica
    .map((item) => {
      const parcial = item.ancoras.parcial
        ? `\n  PARCIAL (metade do peso): ${item.ancoras.parcial}`
        : `\n  (Este item nao tem credito parcial: e competente ou nao realizado.)`;
      return (
        `- id "${item.id}" [${item.dominio}] ${item.descricao}\n` +
        `  COMPETENTE (peso cheio): ${item.ancoras.competente}${parcial}`
      );
    })
    .join("\n");

  const escalaGlobal = NOTAS_GLOBAIS.map(
    (nota) => `  ${nota.valor} = ${nota.rotulo}: ${nota.ancora}`,
  ).join("\n");

  return (
    `Voce e um examinador de OSCE avaliando a anamnese de um estudante de medicina. ` +
    `Responda em portugues do Brasil. Nao interprete mais o paciente — avalie a conversa.\n` +
    `Diagnostico esperado pelo caso: ${cenario.diagnosticoEsperado}.\n\n` +
    `PARTE 1 — checklist. Para CADA item abaixo, escolha o nivel usando as ancoras do ` +
    `proprio item como criterio (nao a sua impressao geral):\n${rubrica}\n\n` +
    `Niveis possiveis: "competente" (a ancora COMPETENTE foi cumprida), "parcial" ` +
    `(a ancora PARCIAL descreve o que aconteceu) e "nao_realizado" (nao ha evidencia ` +
    `do comportamento na conversa).\n\n` +
    `PARTE 2 — nota global. Independentemente da soma do checklist, julgue o desempenho ` +
    `como um todo nesta escala de confianca:\n${escalaGlobal}\n\n` +
    `Regras: julgue apenas pelo que esta escrito na transcricao — nunca presuma o que ` +
    `o aluno "provavelmente" quis dizer; na justificativa de cada item cite um trecho ` +
    `curto da fala do aluno que sustenta o nivel (ou diga que nao houve); devolva um ` +
    `objeto para cada id da rubrica, sem inventar ids novos; nao some pontos nem ` +
    `calcule percentuais — isso nao e seu trabalho. ` +
    `Em "comentarioFinal", escreva 2-3 frases didaticas sobre o que faltou investigar.`
  );
}

// Schema que a Gemini e obrigada a seguir na resposta (responseSchema nativo da API):
// um nivel + justificativa por item do checklist, a nota global e o comentario final.
function montarSchemaAvaliacao(cenario: CenarioOsce) {
  return {
    type: "OBJECT",
    properties: {
      itens: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            id: { type: "STRING", enum: cenario.rubrica.map((item) => item.id) },
            nivel: { type: "STRING", enum: [...NIVEIS_DESEMPENHO] },
            justificativa: { type: "STRING" },
          },
          required: ["id", "nivel", "justificativa"],
        },
      },
      // STRING + enum: na Gemini o `enum` do responseSchema so vale para STRING.
      // O z.coerce.number() do schema de validacao converte de volta para inteiro.
      notaGlobal: {
        type: "STRING",
        enum: NOTAS_GLOBAIS.map((nota) => String(nota.valor)),
      },
      justificativaNotaGlobal: { type: "STRING" },
      comentarioFinal: { type: "STRING" },
    },
    required: ["itens", "notaGlobal", "justificativaNotaGlobal", "comentarioFinal"],
  };
}

// Valida a resposta da IA antes de pontuar: id, nivel ou nota fora do esperado vira
// 502, nunca uma nota silenciosamente errada.
const schemaAvaliacaoIa = z.object({
  itens: z.array(
    z.object({
      id: z.string().min(1),
      nivel: z.enum(NIVEIS_DESEMPENHO),
      justificativa: z.string().trim().default(""),
    }),
  ),
  notaGlobal: z.coerce.number().int().min(0).max(NOTAS_GLOBAIS.length - 1),
  justificativaNotaGlobal: z.string().trim().default(""),
  comentarioFinal: z.string().trim().default(""),
});

// Converte o historico em "contents" da Gemini: aluno = user, paciente = model.
function historicoParaContents(historico: z.infer<typeof schemaTurno>[]) {
  return historico.map((turno) => ({
    role: turno.autor === "aluno" ? "user" : "model",
    parts: [{ text: turno.texto }],
  }));
}

const router = Router();

router.use(middlewareAutenticacao);

// Lista publica dos cenarios: so os campos que o aluno pode ver antes de escolher —
// nunca o roteiro oculto, o diagnostico ou o checklist de avaliacao.
router.get("/cenarios", (_request: Request, response: Response) => {
  const cenariosPublicos = CENARIOS_OSCE.map(({ id, titulo, especialidade, dificuldade }) => ({
    id,
    titulo,
    especialidade,
    dificuldade,
  }));
  return response.status(200).json({ cenarios: cenariosPublicos });
});

// Uma fala do aluno no papel de medico — a IA responde em personagem como o paciente.
router.post("/:id/mensagem", async (request: Request, response: Response, next: NextFunction) => {
  try {
    const cenario = obterCenarioOuFalhar(request.params.id);

    const corpo = schemaMensagem.safeParse(request.body);
    if (!corpo.success) {
      throw new ErroAplicacao({
        codigoStatus: 400,
        codigo: CodigoDeErro.REQUISICAO_INVALIDA,
        mensagem: MENSAGENS.mensagemOsceInvalida,
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
        system_instruction: { parts: [{ text: montarInstrucaoPaciente(cenario) }] },
        contents: [
          ...historicoParaContents(corpo.data.historico),
          { role: "user", parts: [{ text: corpo.data.mensagem }] },
        ],
        generationConfig: GERACAO_THINKING_MINIMO,
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

// Fim da simulacao: avalia o historico completo contra o checklist do cenario.
router.post("/:id/finalizar", async (request: Request, response: Response, next: NextFunction) => {
  try {
    const cenario = obterCenarioOuFalhar(request.params.id);

    const corpo = schemaFinalizar.safeParse(request.body);
    if (!corpo.success) {
      throw new ErroAplicacao({
        codigoStatus: 400,
        codigo: CodigoDeErro.REQUISICAO_INVALIDA,
        mensagem: MENSAGENS.historicoOsceInvalido,
      });
    }

    if (!geminiClient) {
      throw new ErroAplicacao({
        codigoStatus: 503,
        codigo: CodigoDeErro.IA_INDISPONIVEL,
        mensagem: MENSAGENS.iaIndisponivel,
      });
    }

    const transcricao = corpo.data.historico
      .map((turno) => `${turno.autor === "aluno" ? "Aluno" : "Paciente"}: ${turno.texto}`)
      .join("\n");

    const { data } = await geminiClient.post<RespostaGerarConteudo>(
      `/v1beta/models/${env.GEMINI_MODEL}:generateContent`,
      {
        system_instruction: { parts: [{ text: montarInstrucaoAvaliacao(cenario) }] },
        contents: [{ role: "user", parts: [{ text: transcricao || "(nenhuma pergunta feita)" }] }],
        generationConfig: {
          ...GERACAO_THINKING_MINIMO,
          responseMimeType: "application/json",
          responseSchema: montarSchemaAvaliacao(cenario),
        },
      },
    );

    const bruto = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!bruto) {
      throw new ErroAplicacao({
        codigoStatus: 502,
        codigo: CodigoDeErro.ERRO_DOWNSTREAM,
        mensagem: MENSAGENS.respostaIaIndisponivel,
      });
    }

    const avaliacaoIa = schemaAvaliacaoIa.safeParse(parseJsonOuNulo(bruto));
    if (!avaliacaoIa.success) {
      throw new ErroAplicacao({
        codigoStatus: 502,
        codigo: CodigoDeErro.ERRO_DOWNSTREAM,
        mensagem: MENSAGENS.avaliacaoOsceInvalida,
      });
    }

    // A nota sai daqui, nao da IA: ela so julgou os itens e deu a nota global.
    const resultado = pontuarRubrica(cenario, avaliacaoIa.data);

    return response.status(200).json({
      avaliacao: {
        cenarioId: cenario.id,
        titulo: cenario.titulo,
        diagnosticoEsperado: cenario.diagnosticoEsperado,
        comentarioFinal: avaliacaoIa.data.comentarioFinal,
        ...resultado,
      },
    });
  } catch (error) {
    return next(error);
  }
});

export { router as osceRouter };
