import jwt from "jsonwebtoken";
import request from "supertest";

jest.mock("@/shared/clients/backend.client", () => ({
  backendClient: { request: jest.fn() },
}));

jest.mock("@/shared/clients/quiz.client", () => ({
  quizClient: { request: jest.fn() },
}));

jest.mock("@/shared/clients/gemini.client", () => ({
  geminiClient: { post: jest.fn() },
}));

import { aplicacao } from "@/config/app";
import { geminiClient } from "@/shared/clients/gemini.client";
import { CENARIOS_OSCE } from "@/shared/constants/cenarios-osce";

const SEGREDO = process.env.JWT_SECRET_KEY ?? "test-secret";

const tokenValido = () =>
  jwt.sign({ sub: "u1", papel: "ALUNO", status: "ATIVO" }, SEGREDO, { expiresIn: "5m" });

const geminiMock = geminiClient as unknown as { post: jest.Mock };

const CENARIO = CENARIOS_OSCE[0];

// Resposta da IA no formato que o schemaAvaliacaoIa espera: um nivel por item da
// rubrica do cenario, mais a nota global julgada separadamente.
const julgamento = (nivelPorItem: (id: string) => string, notaGlobal: number) => ({
  itens: CENARIO.rubrica.map((item) => ({
    id: item.id,
    nivel: nivelPorItem(item.id),
    justificativa: "evidencia da conversa",
  })),
  notaGlobal,
  justificativaNotaGlobal: "conduziu bem",
  comentarioFinal: "faltou investigar fatores de risco",
});

const respostaGemini = (texto: string) => ({
  data: { candidates: [{ content: { parts: [{ text: texto }] } }] },
});

beforeEach(() => {
  geminiMock.post.mockReset();
});

describe("GET /api/v1/ia/osce/cenarios", () => {
  it("retorna 401 sem token de acesso", async () => {
    const resposta = await request(aplicacao).get("/api/v1/ia/osce/cenarios");

    expect(resposta.status).toBe(401);
  });

  it("devolve so os campos publicos do cenario, nunca o roteiro nem a rubrica", async () => {
    const resposta = await request(aplicacao)
      .get("/api/v1/ia/osce/cenarios")
      .set("Authorization", `Bearer ${tokenValido()}`);

    expect(resposta.status).toBe(200);
    expect(resposta.body.cenarios).toHaveLength(CENARIOS_OSCE.length);
    expect(Object.keys(resposta.body.cenarios[0]).sort()).toEqual([
      "dificuldade",
      "especialidade",
      "id",
      "titulo",
    ]);
    expect(JSON.stringify(resposta.body)).not.toContain(CENARIO.diagnosticoEsperado);
  });
});

describe("POST /api/v1/ia/osce/:id/mensagem", () => {
  it("retorna 404 quando o cenario nao existe", async () => {
    const resposta = await request(aplicacao)
      .post("/api/v1/ia/osce/cenario-que-nao-existe/mensagem")
      .set("Authorization", `Bearer ${tokenValido()}`)
      .send({ mensagem: "Ola", historico: [] });

    expect(resposta.status).toBe(404);
    expect(geminiMock.post).not.toHaveBeenCalled();
  });

  it("retorna 400 quando a mensagem do aluno vem vazia", async () => {
    const resposta = await request(aplicacao)
      .post(`/api/v1/ia/osce/${CENARIO.id}/mensagem`)
      .set("Authorization", `Bearer ${tokenValido()}`)
      .send({ mensagem: "   ", historico: [] });

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro.codigo).toBe("REQUISICAO_INVALIDA");
    expect(geminiMock.post).not.toHaveBeenCalled();
  });

  it("devolve a fala do paciente e manda o roteiro oculto na instrucao de sistema", async () => {
    geminiMock.post.mockResolvedValue(respostaGemini("A dor comecou ha duas horas."));

    const resposta = await request(aplicacao)
      .post(`/api/v1/ia/osce/${CENARIO.id}/mensagem`)
      .set("Authorization", `Bearer ${tokenValido()}`)
      .send({
        mensagem: "Desde quando o senhor sente essa dor?",
        historico: [
          { autor: "aluno", texto: "Bom dia, sou o medico de plantao." },
          { autor: "paciente", texto: "Bom dia, doutor." },
        ],
      });

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({ resposta: "A dor comecou ha duas horas." });

    const [, corpoEnviado] = geminiMock.post.mock.calls[0];
    expect(corpoEnviado.system_instruction.parts[0].text).toContain(CENARIO.roteiroOculto);
    // Historico do aluno vira turno "user" e o do paciente vira "model", com a nova
    // mensagem do aluno sempre como ultimo turno.
    expect(corpoEnviado.contents.map((turno: { role: string }) => turno.role)).toEqual([
      "user",
      "model",
      "user",
    ]);
    expect(corpoEnviado.contents.at(-1).parts[0].text).toBe(
      "Desde quando o senhor sente essa dor?",
    );
  });

  it("retorna 502 quando a Gemini responde sem nenhum candidato", async () => {
    geminiMock.post.mockResolvedValue({ data: { candidates: [] } });

    const resposta = await request(aplicacao)
      .post(`/api/v1/ia/osce/${CENARIO.id}/mensagem`)
      .set("Authorization", `Bearer ${tokenValido()}`)
      .send({ mensagem: "Onde dói?", historico: [] });

    expect(resposta.status).toBe(502);
    expect(resposta.body.erro.codigo).toBe("ERRO_DOWNSTREAM");
  });
});

describe("POST /api/v1/ia/osce/:id/finalizar", () => {
  it("retorna 404 quando o cenario nao existe", async () => {
    const resposta = await request(aplicacao)
      .post("/api/v1/ia/osce/cenario-que-nao-existe/finalizar")
      .set("Authorization", `Bearer ${tokenValido()}`)
      .send({ historico: [] });

    expect(resposta.status).toBe(404);
  });

  it("retorna 400 quando o historico nao vem no formato esperado", async () => {
    const resposta = await request(aplicacao)
      .post(`/api/v1/ia/osce/${CENARIO.id}/finalizar`)
      .set("Authorization", `Bearer ${tokenValido()}`)
      .send({ historico: [{ autor: "enfermeiro", texto: "oi" }] });

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro.codigo).toBe("REQUISICAO_INVALIDA");
    expect(geminiMock.post).not.toHaveBeenCalled();
  });

  it("pontua a rubrica em codigo e aprova quando todos os itens sao competentes", async () => {
    geminiMock.post.mockResolvedValue(
      respostaGemini(JSON.stringify(julgamento(() => "competente", 4))),
    );

    const resposta = await request(aplicacao)
      .post(`/api/v1/ia/osce/${CENARIO.id}/finalizar`)
      .set("Authorization", `Bearer ${tokenValido()}`)
      .send({ historico: [{ autor: "aluno", texto: "Onde dói?" }] });

    expect(resposta.status).toBe(200);
    const { avaliacao } = resposta.body;
    expect(avaliacao.cenarioId).toBe(CENARIO.id);
    expect(avaliacao.diagnosticoEsperado).toBe(CENARIO.diagnosticoEsperado);
    expect(avaliacao.comentarioFinal).toBe("faltou investigar fatores de risco");
    expect(avaliacao.percentual).toBe(100);
    expect(avaliacao.nivelChecklist).toBe("excelente");
    expect(avaliacao.aprovado).toBe(true);
    expect(avaliacao.itensCriticosNaoCumpridos).toEqual([]);
    expect(avaliacao.divergente).toBe(false);
    expect(avaliacao.itens).toHaveLength(CENARIO.rubrica.length);

    // A avaliacao pede JSON e manda o schema junto, senao o modelo responde prosa.
    const [, corpoEnviado] = geminiMock.post.mock.calls[0];
    expect(corpoEnviado.generationConfig.responseMimeType).toBe("application/json");
    expect(corpoEnviado.generationConfig.responseSchema).toBeDefined();
  });

  it("reprova e rebaixa ao teto quando um item critico nao foi cumprido", async () => {
    const critico = CENARIO.rubrica.find((item) => item.critico);
    geminiMock.post.mockResolvedValue(
      respostaGemini(
        JSON.stringify(
          julgamento((id) => (id === critico?.id ? "nao_realizado" : "competente"), 4),
        ),
      ),
    );

    const resposta = await request(aplicacao)
      .post(`/api/v1/ia/osce/${CENARIO.id}/finalizar`)
      .set("Authorization", `Bearer ${tokenValido()}`)
      .send({ historico: [{ autor: "aluno", texto: "Onde dói?" }] });

    expect(resposta.status).toBe(200);
    expect(resposta.body.avaliacao.aprovado).toBe(false);
    expect(resposta.body.avaliacao.nivelChecklist).toBe("limitrofe");
    expect(resposta.body.avaliacao.itensCriticosNaoCumpridos).toContain(critico?.descricao);
  });

  it("retorna 502 quando a Gemini devolve um corpo que nao e JSON", async () => {
    geminiMock.post.mockResolvedValue(respostaGemini("Claro! Aqui vai a avaliacao:"));

    const resposta = await request(aplicacao)
      .post(`/api/v1/ia/osce/${CENARIO.id}/finalizar`)
      .set("Authorization", `Bearer ${tokenValido()}`)
      .send({ historico: [] });

    expect(resposta.status).toBe(502);
    expect(resposta.body.erro.codigo).toBe("ERRO_DOWNSTREAM");
  });

  it("retorna 502 quando a nota global da IA esta fora da escala", async () => {
    geminiMock.post.mockResolvedValue(
      respostaGemini(JSON.stringify(julgamento(() => "competente", 9))),
    );

    const resposta = await request(aplicacao)
      .post(`/api/v1/ia/osce/${CENARIO.id}/finalizar`)
      .set("Authorization", `Bearer ${tokenValido()}`)
      .send({ historico: [] });

    expect(resposta.status).toBe(502);
    expect(resposta.body.erro.codigo).toBe("ERRO_DOWNSTREAM");
  });

  it("retorna 502 quando a Gemini responde sem nenhum candidato", async () => {
    geminiMock.post.mockResolvedValue({ data: {} });

    const resposta = await request(aplicacao)
      .post(`/api/v1/ia/osce/${CENARIO.id}/finalizar`)
      .set("Authorization", `Bearer ${tokenValido()}`)
      .send({ historico: [] });

    expect(resposta.status).toBe(502);
  });
});
