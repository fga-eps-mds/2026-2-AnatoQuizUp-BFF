import {
  buscarCenarioOsce,
  CENARIOS_OSCE,
  NOTAS_GLOBAIS,
  type CenarioOsce,
} from "@/shared/constants/cenarios-osce";
import {
  pontuarRubrica,
  type JulgamentoExaminador,
  type JulgamentoItem,
} from "@/shared/utils/pontuacao-osce";

const cenario = buscarCenarioOsce("dor-toracica") as CenarioOsce;

// Monta um julgamento com o mesmo nivel para todos os itens, sobrescrevendo os ids
// citados. A nota global vem separada, como vem da IA.
const julgar = (
  padrao: JulgamentoItem["nivel"],
  { notaGlobal = 2, ...excecoes }: Record<string, JulgamentoItem["nivel"] | number> = {},
): JulgamentoExaminador => ({
  itens: cenario.rubrica.map((item) => ({
    id: item.id,
    nivel: (excecoes[item.id] as JulgamentoItem["nivel"]) ?? padrao,
    justificativa: "",
  })),
  notaGlobal: notaGlobal as number,
  justificativaNotaGlobal: "",
});

describe("pontuarRubrica — checklist", () => {
  it("dá nota cheia quando todos os itens são competentes", () => {
    const resultado = pontuarRubrica(cenario, julgar("competente", { notaGlobal: 4 }));

    expect(resultado.pontuacao).toBe(resultado.pontuacaoMaxima);
    expect(resultado.percentual).toBe(100);
    expect(resultado.nivelChecklist).toBe("excelente");
    expect(resultado.aprovado).toBe(true);
  });

  it("zera quando nada foi realizado", () => {
    const resultado = pontuarRubrica(cenario, julgar("nao_realizado", { notaGlobal: 0 }));

    expect(resultado.pontuacao).toBe(0);
    expect(resultado.nivelChecklist).toBe("insuficiente");
    expect(resultado.aprovado).toBe(false);
  });

  it("vale metade do peso no nível parcial, e zero se o item não tem âncora parcial", () => {
    const { itens } = pontuarRubrica(cenario, julgar("parcial", { notaGlobal: 1 }));

    const comParcial = itens.find((item) => item.permiteParcial);
    const semParcial = itens.find((item) => !item.permiteParcial);

    expect(comParcial?.pontos).toBe((comParcial?.peso ?? 0) / 2);
    expect(semParcial?.pontos).toBe(0);
  });

  it("trata item não julgado pela IA como não realizado", () => {
    const resultado = pontuarRubrica(cenario, {
      itens: [],
      notaGlobal: 0,
      justificativaNotaGlobal: "",
    });

    expect(resultado.pontuacao).toBe(0);
    expect(resultado.itens).toHaveLength(cenario.rubrica.length);
    expect(resultado.itens[0].justificativa).toBe("Não avaliado pelo examinador.");
  });
});

describe("pontuarRubrica — item crítico", () => {
  const critico = cenario.rubrica.find((item) => item.critico)!;

  it("limita o checklist a 'limitrofe' e reprova quando um item crítico não é cumprido", () => {
    const resultado = pontuarRubrica(
      cenario,
      julgar("competente", { [critico.id]: "parcial", notaGlobal: 3 }),
    );

    expect(resultado.percentual).toBeGreaterThan(90);
    expect(resultado.nivelChecklist).toBe("limitrofe");
    expect(resultado.aprovado).toBe(false);
    expect(resultado.itensCriticosNaoCumpridos).toContain(critico.descricao);
  });

  it("não eleva a nota de quem já está abaixo do teto crítico", () => {
    const resultado = pontuarRubrica(cenario, julgar("nao_realizado", { notaGlobal: 0 }));

    expect(resultado.itensCriticosNaoCumpridos.length).toBeGreaterThan(0);
    expect(resultado.nivelChecklist).toBe("insuficiente");
  });
});

describe("pontuarRubrica — nota global e concordância", () => {
  it("traz o rótulo e a âncora da nota global atribuída", () => {
    const resultado = pontuarRubrica(cenario, julgar("competente", { notaGlobal: 3 }));

    expect(resultado.notaGlobal).toBe(3);
    expect(resultado.rotuloNotaGlobal).toBe(NOTAS_GLOBAIS[3].rotulo);
    expect(resultado.ancoraNotaGlobal).toBe(NOTAS_GLOBAIS[3].ancora);
  });

  it("limita nota global fora da escala em vez de propagar lixo da IA", () => {
    expect(pontuarRubrica(cenario, julgar("competente", { notaGlobal: 9 })).notaGlobal).toBe(4);
    expect(pontuarRubrica(cenario, julgar("competente", { notaGlobal: -3 })).notaGlobal).toBe(0);
  });

  it("não sinaliza divergência quando checklist e nota global concordam", () => {
    const resultado = pontuarRubrica(cenario, julgar("competente", { notaGlobal: 4 }));

    expect(resultado.divergente).toBe(false);
  });

  it("sinaliza divergência quando checklist e nota global se afastam 2 pontos", () => {
    // Checklist cheio (equivale a 4 na escala global) contra nota global 1.
    const resultado = pontuarRubrica(cenario, julgar("competente", { notaGlobal: 1 }));

    expect(resultado.divergente).toBe(true);
  });
});

describe("integridade das rubricas", () => {
  it.each(CENARIOS_OSCE.map((cenarioOsce) => [cenarioOsce.id, cenarioOsce] as const))(
    "%s tem ids únicos, item crítico e âncoras coerentes",
    (_id, cenarioOsce) => {
      const ids = cenarioOsce.rubrica.map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(cenarioOsce.rubrica.some((item) => item.critico)).toBe(true);

      for (const item of cenarioOsce.rubrica) {
        // Ancora de credito cheio e obrigatoria; a de credito parcial e o que
        // distingue item de tres ancoras de item de duas.
        expect(item.ancoras.competente.length).toBeGreaterThan(0);
        expect(item.ancoras.parcial ?? "não-vazio").not.toBe("");
      }
    },
  );
});
