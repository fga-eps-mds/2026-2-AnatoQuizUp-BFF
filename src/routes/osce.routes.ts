import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

import { env } from "@/config/env";
import { geminiClient } from "@/shared/clients/gemini.client";
import { buscarCenarioOsce, CENARIOS_OSCE, type CenarioOsce } from "@/shared/constants/cenarios-osce";
import { MENSAGENS } from "@/shared/constants/mensagens";
import { CodigoDeErro } from "@/shared/errors/codigos-de-erro";
import { ErroAplicacao } from "@/shared/errors/erro-aplicacao";
import { middlewareAutenticacao } from "@/shared/middlewares/autenticacao.middleware";

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
// examinador, julgando a conversa inteira contra o checklist do cenario.
function montarInstrucaoAvaliacao(cenario: CenarioOsce): string {
  return (
    `Voce e um examinador de OSCE avaliando a anamnese de um estudante de medicina. ` +
    `Responda em portugues do Brasil. Nao interprete mais o paciente — avalie a conversa. ` +
    `Diagnostico esperado pelo caso: ${cenario.diagnosticoEsperado}.\n` +
    `Checklist de criterios a verificar:\n${cenario.criteriosAvaliacao.map((c) => `- ${c}`).join("\n")}\n\n` +
    `Devolva um feedback curto e didatico: para cada criterio do checklist diga se o aluno ` +
    `cumpriu ou nao (com base nas perguntas que ele fez na conversa), e termine com 1-2 frases ` +
    `de orientacao sobre o que faltou investigar.`
  );
}

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
      },
    );

    const feedback = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!feedback) {
      throw new ErroAplicacao({
        codigoStatus: 502,
        codigo: CodigoDeErro.ERRO_DOWNSTREAM,
        mensagem: MENSAGENS.respostaIaIndisponivel,
      });
    }

    return response.status(200).json({ feedback });
  } catch (error) {
    return next(error);
  }
});

export { router as osceRouter };
