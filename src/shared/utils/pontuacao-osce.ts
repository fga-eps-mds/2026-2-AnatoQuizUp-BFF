// Pontuacao da estacao OSCE. A IA so JULGA (classifica cada item do checklist e
// atribui uma nota global); a aritmetica, o corte e os sinais de qualidade sao
// calculados aqui, em codigo — modelo de linguagem nao e confiavel para somar e a
// regra de aprovacao precisa ser auditavel.
//
// O desenho segue o padrao ouro de OSCE, que recolhe DUAS medidas independentes por
// estacao (Pell et al., AMEE Guide 49, 2010; Khan et al., AMEE Guide 81, 2013):
//   1. o checklist ponderado, que detalha o que foi feito;
//   2. a nota global (GRS), julgamento holistico de competencia.
// Nos OSCEs reais a GRS alimenta o borderline regression method (BRM) para derivar
// a nota de corte da estacao a partir da coorte inteira. Aqui nao ha coorte (n = 1 por
// simulacao) e nao ha persistencia, entao BRM e impossivel: o corte e criterial e
// provisorio, e a GRS entra como VERIFICACAO DE CONCORDANCIA com o checklist — o
// analogo, para um candidato so, do R² que o AMEE 49 usa para auditar a estacao.
// Ver docs/arquitetura/chatbot-osce.md (secao 5) para as referencias completas.
import {
  NOTA_GLOBAL_APROVACAO,
  NOTAS_GLOBAIS,
  type CenarioOsce,
  type ItemRubrica,
  type NivelDesempenho,
} from "@/shared/constants/cenarios-osce";

// Faixas do checklist, da maior para a menor. O `equivalenteGlobal` alinha cada faixa
// a um ponto da escala global (0-4), que e o que torna as duas medidas comparaveis.
const FAIXAS = [
  { minimo: 90, nivel: "excelente", rotulo: "Excelente", equivalenteGlobal: 4 },
  { minimo: 75, nivel: "bom", rotulo: "Bom", equivalenteGlobal: 3 },
  { minimo: 60, nivel: "suficiente", rotulo: "Suficiente", equivalenteGlobal: 2 },
  { minimo: 50, nivel: "limitrofe", rotulo: "Limítrofe", equivalenteGlobal: 1 },
  { minimo: 0, nivel: "insuficiente", rotulo: "Insuficiente", equivalenteGlobal: 0 },
] as const;

export type NivelChecklist = (typeof FAIXAS)[number]["nivel"];

// Corte criterial provisorio do checklist. NAO e derivado de borderline regression:
// ver a nota de limitacao no topo e a secao 5.6 da documentacao.
export const PERCENTUAL_APROVACAO = 60;

// Nota de checklist maxima de quem falhou em um item critico (o "borderline fail" de
// Amin et al. 2006, p. 60; o "red flag" dos OSCEs regulatorios).
const TETO_CRITICO: NivelChecklist = "limitrofe";

// Distancia entre checklist e nota global a partir da qual o resultado e sinalizado
// como inconsistente: 2 pontos na escala de 5 e a diferenca entre "passou" e "nao
// passou", grande demais para as duas medidas estarem medindo a mesma coisa.
const DIVERGENCIA_MAXIMA = 2;

export type JulgamentoItem = {
  id: string;
  nivel: NivelDesempenho;
  // Evidencia da conversa que justifica o nivel atribuido.
  justificativa: string;
};

// O que a IA devolve: o checklist item a item e a nota global, julgados separadamente.
export type JulgamentoExaminador = {
  itens: JulgamentoItem[];
  notaGlobal: number;
  justificativaNotaGlobal: string;
};

export type ItemPontuado = ItemRubrica & {
  // Derivado das ancoras: item sem ancora `parcial` nao tem meio-termo.
  permiteParcial: boolean;
  nivel: NivelDesempenho;
  justificativa: string;
  pontos: number;
  pontosMaximos: number;
};

export type ResultadoRubrica = {
  itens: ItemPontuado[];
  pontuacao: number;
  pontuacaoMaxima: number;
  percentual: number;
  nivelChecklist: NivelChecklist;
  rotuloChecklist: string;
  // Nota global da estacao, julgada pela IA sem olhar a soma do checklist.
  notaGlobal: number;
  rotuloNotaGlobal: string;
  ancoraNotaGlobal: string;
  justificativaNotaGlobal: string;
  aprovado: boolean;
  // Itens criticos nao cumpridos: o que puxou a nota para o teto, se foi o caso.
  itensCriticosNaoCumpridos: string[];
  // true quando checklist e nota global discordam a ponto de o resultado nao ser
  // confiavel — pede revisao humana em vez de fingir um veredito.
  divergente: boolean;
};

// Item sem ancora de credito parcial e a coluna "—" do checklist de Amin et al.:
// so 0 ou peso cheio.
const permiteParcial = (item: ItemRubrica) => item.ancoras.parcial !== undefined;

/**
 * Converte o nivel atribuido a um item em pontos.
 */
function pontosDoItem(item: ItemRubrica, nivel: NivelDesempenho): number {
  if (nivel === "competente") return item.peso;
  if (nivel === "parcial") return permiteParcial(item) ? item.peso / 2 : 0;
  return 0;
}

/**
 * Aplica a rubrica do cenario ao julgamento devolvido pela IA.
 *
 * Itens que a IA nao julgou contam como "nao_realizado", para que uma resposta
 * incompleta do modelo nunca infle a nota do aluno.
 *
 * @param cenario Cenario cuja rubrica define itens, pesos e itens criticos.
 * @param julgamento Checklist item a item e nota global devolvidos pela IA.
 * @returns Itens pontuados, totais, nota global, veredito e sinal de divergencia.
 */
export function pontuarRubrica(
  cenario: CenarioOsce,
  julgamento: JulgamentoExaminador,
): ResultadoRubrica {
  const porId = new Map(julgamento.itens.map((item) => [item.id, item]));

  const itens: ItemPontuado[] = cenario.rubrica.map((item) => {
    const julgado = porId.get(item.id);
    const nivel: NivelDesempenho = julgado?.nivel ?? "nao_realizado";
    return {
      ...item,
      permiteParcial: permiteParcial(item),
      nivel,
      justificativa: julgado?.justificativa ?? "Não avaliado pelo examinador.",
      pontos: pontosDoItem(item, nivel),
      pontosMaximos: item.peso,
    };
  });

  const pontuacao = itens.reduce((total, item) => total + item.pontos, 0);
  const pontuacaoMaxima = itens.reduce((total, item) => total + item.pontosMaximos, 0);
  const percentual =
    pontuacaoMaxima === 0 ? 0 : Math.round((pontuacao / pontuacaoMaxima) * 100);

  const itensCriticosNaoCumpridos = itens
    .filter((item) => item.critico && item.nivel !== "competente")
    .map((item) => item.descricao);

  const faixaPorPercentual =
    FAIXAS.find((faixa) => percentual >= faixa.minimo) ?? FAIXAS[FAIXAS.length - 1];
  const indiceTeto = FAIXAS.findIndex((faixa) => faixa.nivel === TETO_CRITICO);

  // Item critico falhado rebaixa ao teto, mas nunca eleva uma nota ja pior que ele.
  const faixa =
    itensCriticosNaoCumpridos.length > 0 && FAIXAS.indexOf(faixaPorPercentual) < indiceTeto
      ? FAIXAS[indiceTeto]
      : faixaPorPercentual;

  const notaGlobal = Math.min(
    Math.max(Math.round(julgamento.notaGlobal), 0),
    NOTAS_GLOBAIS.length - 1,
  );
  const descritorGlobal = NOTAS_GLOBAIS[notaGlobal];

  return {
    itens,
    pontuacao,
    pontuacaoMaxima,
    percentual,
    nivelChecklist: faixa.nivel,
    rotuloChecklist: faixa.rotulo,
    notaGlobal,
    rotuloNotaGlobal: descritorGlobal.rotulo,
    ancoraNotaGlobal: descritorGlobal.ancora,
    justificativaNotaGlobal: julgamento.justificativaNotaGlobal,
    // O veredito sai do checklist, nao da nota global: num juiz-LLM o checklist e a
    // medida auditavel (cada item traz a evidencia citada), enquanto a nota global e
    // uma impressao sem rastro. E o inverso do que vale para examinador humano, e e
    // deliberado — ver secao 5.5 da documentacao.
    aprovado: percentual >= PERCENTUAL_APROVACAO && itensCriticosNaoCumpridos.length === 0,
    itensCriticosNaoCumpridos,
    divergente: Math.abs(faixa.equivalenteGlobal - notaGlobal) >= DIVERGENCIA_MAXIMA,
  };
}

export { NOTA_GLOBAL_APROVACAO };
