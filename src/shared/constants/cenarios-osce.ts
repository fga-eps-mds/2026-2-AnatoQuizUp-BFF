// Cenarios fixos da simulacao OSCE (Objective Structured Clinical Examination).
// Cada cenario e o "roteiro" que a Gemini usa para interpretar o paciente — o aluno
// nunca ve este arquivo, so os campos publicos devolvidos por GET /ia/osce/cenarios.
// Autoria de cenario por professor fica fora do escopo (YAGNI): lista fixa ate haver
// demanda real por cenarios customizados.
export type CenarioOsce = {
  id: string;
  titulo: string;
  especialidade: string;
  dificuldade: "Fácil" | "Médio" | "Difícil";
  // Perfil interpretado pela IA: idade, sexo, jeito de falar — nunca exposto ao aluno.
  perfilPaciente: string;
  queixaPrincipal: string;
  // Historia, exame fisico e achados que o aluno so descobre perguntando — nunca exposto.
  roteiroOculto: string;
  diagnosticoEsperado: string;
  // Checklist usado so na avaliacao final (POST /ia/osce/:id/finalizar).
  criteriosAvaliacao: string[];
};

export const CENARIOS_OSCE: CenarioOsce[] = [
  {
    id: "dor-toracica",
    titulo: "Dor torácica no pronto-socorro",
    especialidade: "Cardiologia",
    dificuldade: "Médio",
    perfilPaciente:
      "Homem, 58 anos, caminhoneiro, ansioso, fala de forma direta e as vezes impaciente.",
    queixaPrincipal: "Dor no peito ha 2 horas.",
    roteiroOculto:
      "Dor em aperto, retroesternal, irradia para o braço esquerdo, iniciou em repouso, " +
      "piora com esforço, acompanhada de sudorese e nausea. Historico de hipertensao mal " +
      "controlada e tabagismo (1 maco/dia ha 20 anos). Nega dor a palpacao do torax. Sinais " +
      "vitais se perguntados: PA 160/95, FC 98, afebril.",
    diagnosticoEsperado: "Síndrome coronariana aguda (angina/infarto)",
    criteriosAvaliacao: [
      "Caracterizou a dor (localizacao, irradiacao, tipo, duracao, fatores de piora/melhora)",
      "Perguntou sobre sintomas associados (sudorese, nausea, dispneia)",
      "Levantou fatores de risco cardiovascular (tabagismo, hipertensao, historico familiar)",
      "Considerou sindrome coronariana aguda no raciocinio",
      "Nao revelou o diagnostico ao paciente antes de concluir a anamnese",
    ],
  },
  {
    id: "cefaleia-subita",
    titulo: "Cefaleia súbita e intensa",
    especialidade: "Neurologia",
    dificuldade: "Difícil",
    perfilPaciente:
      "Mulher, 34 anos, professora, fala rapido por causa da dor, fica irritada se repetirem a pergunta.",
    queixaPrincipal: "Dor de cabeça muito forte, começou de repente.",
    roteiroOculto:
      "Pior dor de cabeça da vida, inicio abrupto durante esforco fisico, descreve como " +
      "'explosao'. Associada a rigidez de nuca e fotofobia. Nega trauma. Nega febre. Historico " +
      "de enxaqueca previa, mas descreve essa crise como diferente de todas as anteriores.",
    diagnosticoEsperado: "Hemorragia subaracnoidea (suspeita)",
    criteriosAvaliacao: [
      "Identificou o padrao de inicio subito ('thunderclap headache')",
      "Perguntou se e diferente de dores de cabeca anteriores",
      "Investigou sinais de irritacao meningea (rigidez de nuca, fotofobia)",
      "Nao tranquilizou o paciente dizendo que e 'só enxaqueca' antes de investigar",
      "Considerou hemorragia subaracnoidea como diagnostico diferencial grave",
    ],
  },
  {
    id: "dor-abdominal",
    titulo: "Dor abdominal em fossa ilíaca direita",
    especialidade: "Gastroenterologia / Cirurgia",
    dificuldade: "Fácil",
    perfilPaciente: "Adolescente, 16 anos, estudante, responde curto e fica constrangido com perguntas sobre apetite/evacuacao.",
    queixaPrincipal: "Dor na barriga desde ontem.",
    roteiroOculto:
      "Dor comecou perto do umbigo e migrou para o lado direito inferior do abdome. Piora " +
      "ao andar ou tossir. Associada a nausea e perda de apetite. Febre baixa (37.8C). Sem " +
      "diarreia. Dor a palpacao em ponto de McBurney se perguntado sobre exame fisico.",
    diagnosticoEsperado: "Apendicite aguda",
    criteriosAvaliacao: [
      "Perguntou sobre a migracao da dor (periumbilical para fossa iliaca direita)",
      "Perguntou sobre fatores de piora (deambulacao, tosse)",
      "Investigou sintomas associados (febre, nausea, apetite)",
      "Considerou apendicite aguda no raciocinio clinico",
    ],
  },
];

export const buscarCenarioOsce = (id: string): CenarioOsce | undefined =>
  CENARIOS_OSCE.find((cenario) => cenario.id === id);
