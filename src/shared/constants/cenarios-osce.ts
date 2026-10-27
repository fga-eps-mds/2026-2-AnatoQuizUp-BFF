// Cenarios fixos da simulacao OSCE (Objective Structured Clinical Examination).
// Cada cenario e o "roteiro" que a Gemini usa para interpretar o paciente — o aluno
// nunca ve este arquivo, so os campos publicos devolvidos por GET /ia/osce/cenarios.
// Autoria de cenario por professor fica fora do escopo (YAGNI): lista fixa ate haver
// demanda real por cenarios customizados.
//
// A rubrica segue o "rating checklist" do capitulo 14 de Amin, Chong & Khoo (2006,
// p. 63) e as praticas da escola de Leeds, que publicou os guias AMEE 49 e 81 e o
// estudo de ponderacao de itens (Homer et al., Med Teach 2020). Dessa literatura vem:
//
//  - itens agrupados por dominio, com peso maior nos itens centrais da estacao;
//  - itens com ancoras de 3 niveis para comportamentos compostos e de 2 niveis para
//    os mais simples ("three point anchors ... a third group of simpler items are
//    scored with two-point anchors" — Homer et al. 2020);
//  - ancoras COMPORTAMENTAIS por nivel de credito, nao so a descricao do item: o
//    examinador recebe material que define o que vale credito cheio e o que vale
//    credito parcial (ex.: "+-5% para credito cheio, +-10% para parcial");
//  - item critico ("will not score better than 'borderline fail'" — Amin et al. p. 60),
//    o equivalente do "red flag" de seguranca usado em OSCEs regulatorios.
//
// Ver docs/arquitetura/chatbot-osce.md (secao 5) no repositorio Doc para as
// referencias completas e o que cada uma sustenta.

// Dominios do checklist, na mesma ordem em que aparecem no feedback.
export const DOMINIOS_RUBRICA = [
  "Comunicação e rapport",
  "Identificação do problema",
  "Raciocínio clínico",
  "Encerramento",
] as const;

export type DominioRubrica = (typeof DOMINIOS_RUBRICA)[number];

// Os tres niveis da coluna de pontuacao do livro.
export const NIVEIS_DESEMPENHO = ["competente", "parcial", "nao_realizado"] as const;

export type NivelDesempenho = (typeof NIVEIS_DESEMPENHO)[number];

export type ItemRubrica = {
  id: string;
  dominio: DominioRubrica;
  // O que se espera do aluno, na voz do examinador.
  descricao: string;
  // Ancoras comportamentais por nivel de credito. Sao elas, nao a `descricao`, que
  // dizem onde fica a linha entre credito cheio e credito parcial — e e isso que o
  // examinador (aqui, a IA) recebe para classificar. Sem `parcial`, o item tem duas
  // ancoras (a coluna "—" do livro): so 0 ou peso cheio.
  ancoras: { competente: string; parcial?: string };
  // Pontos do nivel "competente"; "parcial" vale metade, "nao_realizado" vale 0.
  // A evidencia sobre ponderacao e modesta (Homer et al. 2020: muda a decisao de ~3%
  // dos candidatos no geral e ~30% dos limitrofes), entao 1/2 por julgamento de
  // especialista basta — nao ha ganho em esquema de pesos mais complexo.
  peso: 1 | 2;
  // Item critico: falhar nele limita a nota global a "limitrofe", por melhor que
  // seja o resto do desempenho.
  critico?: boolean;
};

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
  // Rubrica usada so na avaliacao final (POST /ia/osce/:id/finalizar).
  rubrica: ItemRubrica[];
};

// Escala de nota global (GRS) da estacao, recolhida de forma INDEPENDENTE do
// checklist. O padrao ouro em OSCE coleta as duas medidas por estacao: o checklist
// detalha o que foi feito, a nota global captura a competencia percebida (mais
// sensivel a nivel de treinamento e a habilidades "moles" que o checklist nao pega).
// A escala de 5 pontos e a de Leeds (Pell et al., AMEE Guide 49, 2010: "0 = clear
// fail, 1 = borderline, 2 = clear pass, 3 = very good pass, 4 = excellent pass").
// As ancoras foram reescritas em termos de CONFIANCA/supervisao, nao de adjetivos
// abstratos: escalas alinhadas ao construto ("entrustment", Crossley et al.) sao
// mais confiaveis do que escalas de "ruim/bom/otimo".
export const NOTAS_GLOBAIS = [
  {
    valor: 0,
    rotulo: "Reprovação clara",
    ancora:
      "Conduta insegura ou tao incompleta que eu nao deixaria este aluno conduzir a anamnese sozinho.",
  },
  {
    valor: 1,
    rotulo: "Limítrofe",
    ancora:
      "Hesitante ou incompleto em pontos importantes; precisaria de supervisao direta o tempo todo.",
  },
  {
    valor: 2,
    rotulo: "Aprovação",
    ancora:
      "Anamnese segura e suficiente para o caso; eu deixaria conduzir com supervisao a distancia.",
  },
  {
    valor: 3,
    rotulo: "Boa aprovação",
    ancora:
      "Conduziu bem, com linha de raciocinio clara; supervisao apenas para confirmar a conduta.",
  },
  {
    valor: 4,
    rotulo: "Aprovação excelente",
    ancora:
      "Conduziu como se esperaria de um interno competente; eu confiaria no relato sem refazer a anamnese.",
  },
] as const;

// Nota global minima que representa aprovacao na estacao ("clear pass").
export const NOTA_GLOBAL_APROVACAO = 2;

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
    rubrica: [
      {
        id: "apresentacao",
        dominio: "Comunicação e rapport",
        descricao: "Apresenta-se e cumprimenta o paciente antes de iniciar a anamnese",
        ancoras: {
          competente:
            "Na primeira fala, diz quem é (médico/estudante) e cumprimenta o paciente.",
          parcial:
            "Cumprimenta, mas não se identifica — ou só se identifica depois de já ter feito perguntas clínicas.",
        },
        peso: 1,
      },
      {
        id: "linguagem",
        dominio: "Comunicação e rapport",
        descricao: "Usa linguagem acessível e acolhe a ansiedade do paciente",
        ancoras: {
          competente:
            "Pergunta sem jargão técnico e, em algum momento, nomeia o desconforto ou o medo do paciente.",
          parcial:
            "Usa linguagem acessível, mas em nenhum momento reconhece o estado emocional do paciente.",
        },
        peso: 1,
      },
      {
        id: "caracteriza-dor",
        dominio: "Identificação do problema",
        descricao: "Caracteriza a dor: localização, tipo e intensidade",
        ancoras: {
          competente:
            "Obtém localização E qualidade da dor (aperto, queimação, pontada) — as duas informações.",
          parcial:
            "Pergunta só onde dói, ou só como é a dor, sem completar a caracterização.",
        },
        peso: 2,
        critico: true,
      },
      {
        id: "irradiacao",
        dominio: "Identificação do problema",
        descricao: "Investiga irradiação da dor",
        ancoras: {
          competente:
            "Pergunta explicitamente se a dor vai para outro lugar (braço, mandíbula, costas, pescoço).",
        },
        peso: 1,
      },
      {
        id: "inicio-esforco",
        dominio: "Identificação do problema",
        descricao: "Investiga início, duração e relação com esforço ou repouso",
        ancoras: {
          competente:
            "Pergunta quando a dor começou E o que o paciente fazia no momento (ou se piora ao esforço).",
        },
        peso: 1,
      },
      {
        id: "sintomas-associados",
        dominio: "Identificação do problema",
        descricao: "Pergunta sobre sintomas associados (sudorese, náusea, dispneia)",
        ancoras: {
          competente:
            "Pergunta sobre pelo menos dois de: sudorese, náusea/vômito, dispneia.",
          parcial:
            "Pergunta sobre apenas um deles, ou faz só uma pergunta genérica de sintomas, sem nomear nenhum.",
        },
        peso: 2,
      },
      {
        id: "fatores-risco",
        dominio: "Identificação do problema",
        descricao: "Levanta fatores de risco cardiovascular",
        ancoras: {
          competente:
            "Pergunta sobre pelo menos dois de: tabagismo, hipertensão, diabetes, dislipidemia, história familiar.",
          parcial:
            "Pergunta sobre apenas um fator de risco.",
        },
        peso: 2,
      },
      {
        id: "sinais-vitais",
        dominio: "Identificação do problema",
        descricao: "Solicita sinais vitais ou exame físico direcionado",
        ancoras: {
          competente:
            "Pede pressão arterial, frequência cardíaca, ou exame físico do tórax (ausculta/palpação).",
        },
        peso: 1,
      },
      {
        id: "hipotese-sca",
        dominio: "Raciocínio clínico",
        descricao: "Considera síndrome coronariana aguda como hipótese principal",
        ancoras: {
          competente:
            "Verbaliza a suspeita de causa cardíaca/isquêmica, ou a sequência de perguntas é claramente dirigida a confirmá-la (dor + irradiação + sintomas associados + fatores de risco).",
          parcial:
            "Investiga sintomas cardíacos de forma dispersa, sem que a linha de raciocínio fique explícita.",
        },
        peso: 2,
        critico: true,
      },
      {
        id: "diferenciais",
        dominio: "Raciocínio clínico",
        descricao: "Levanta ao menos um diagnóstico diferencial relevante",
        ancoras: {
          competente:
            "Investiga ativamente ao menos um diferencial: dor musculoesquelética (dor à palpação/movimento), dissecção de aorta, TEP ou causa gastroesofágica.",
        },
        peso: 1,
      },
      {
        id: "nao-antecipa-diagnostico",
        dominio: "Encerramento",
        descricao: "Não afirma o diagnóstico ao paciente antes de concluir a anamnese",
        ancoras: {
          competente:
            "Em nenhum momento afirma ao paciente que ele está infartando antes de ter caracterizado a dor e os fatores de risco.",
        },
        peso: 1,
      },
      {
        id: "fecha-conduta",
        dominio: "Encerramento",
        descricao: "Resume o quadro e explica o próximo passo ao paciente",
        ancoras: {
          competente:
            "Resume ao paciente o que entendeu E diz o próximo passo concreto (ECG, exames de sangue, permanecer no PS).",
          parcial:
            "Diz que vai pedir exames sem resumir o quadro, ou resume sem dizer o que será feito.",
        },
        peso: 2,
      },
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
    rubrica: [
      {
        id: "apresentacao",
        dominio: "Comunicação e rapport",
        descricao: "Apresenta-se e reconhece a intensidade da dor da paciente",
        ancoras: {
          competente:
            "Identifica-se E reconhece a intensidade da dor antes de encadear perguntas.",
          parcial:
            "Identifica-se, mas ignora o sofrimento e vai direto ao interrogatório.",
        },
        peso: 1,
      },
      {
        id: "ritmo",
        dominio: "Comunicação e rapport",
        descricao: "Adapta o ritmo: perguntas objetivas, sem repetir o que já foi respondido",
        ancoras: {
          competente:
            "Mantém as perguntas curtas e não repete nada que a paciente já respondeu.",
          parcial:
            "Faz perguntas longas ou repete uma pergunta já respondida uma vez.",
        },
        peso: 1,
      },
      {
        id: "inicio-subito",
        dominio: "Identificação do problema",
        descricao: "Identifica o padrão de início súbito (thunderclap headache)",
        ancoras: {
          competente:
            "Pergunta em quanto tempo a dor chegou ao máximo, ou pede que ela descreva exatamente como começou, e obtém o caráter abrupto.",
          parcial:
            "Pergunta apenas o horário em que começou, sem explorar a velocidade de instalação.",
        },
        peso: 2,
        critico: true,
      },
      {
        id: "comparacao-previas",
        dominio: "Identificação do problema",
        descricao: "Compara com cefaleias anteriores da paciente",
        ancoras: {
          competente:
            "Pergunta se esta dor é diferente das anteriores, ou se é a pior da vida.",
          parcial:
            "Pergunta se ela já teve dor de cabeça antes, sem comparar com a crise atual.",
        },
        peso: 2,
      },
      {
        id: "irritacao-meningea",
        dominio: "Identificação do problema",
        descricao: "Investiga sinais de irritação meníngea",
        ancoras: {
          competente:
            "Pergunta sobre pelo menos dois de: rigidez ou dor na nuca, fotofobia, vômitos.",
          parcial:
            "Pergunta sobre apenas um deles.",
        },
        peso: 2,
      },
      {
        id: "desencadeante",
        dominio: "Identificação do problema",
        descricao: "Investiga o que a paciente fazia quando a dor começou",
        ancoras: {
          competente:
            "Pergunta o que a paciente fazia quando a dor começou (esforço físico, tosse, atividade).",
        },
        peso: 1,
      },
      {
        id: "red-flags",
        dominio: "Identificação do problema",
        descricao: "Afasta trauma, febre e déficit neurológico",
        ancoras: {
          competente:
            "Afasta trauma e febre, e pergunta sobre déficit neurológico (força, fala, visão).",
        },
        peso: 1,
      },
      {
        id: "hipotese-hsa",
        dominio: "Raciocínio clínico",
        descricao: "Considera hemorragia subaracnoidea como diferencial grave",
        ancoras: {
          competente:
            "Verbaliza suspeita de hemorragia subaracnoidea ou sangramento intracraniano, ou a linha de perguntas (início súbito + pior da vida + meningismo) converge claramente para ela.",
          parcial:
            "Reconhece que é uma cefaleia grave e atípica, mas não chega à hipótese hemorrágica.",
        },
        peso: 2,
        critico: true,
      },
      {
        id: "investigacao-urgente",
        dominio: "Raciocínio clínico",
        descricao: "Indica necessidade de investigação urgente",
        ancoras: {
          competente:
            "Indica tomografia de crânio (e punção lombar se a TC for normal) com caráter de urgência.",
          parcial:
            "Diz que vai pedir exames ou encaminhar, sem nomear a TC nem transmitir a urgência.",
        },
        peso: 2,
      },
      {
        id: "nao-banaliza",
        dominio: "Encerramento",
        descricao: "Não tranquiliza a paciente dizendo que é 'só enxaqueca'",
        ancoras: {
          competente:
            "Em nenhum momento diz à paciente que é enxaqueca, estresse ou nada grave antes de ter investigado os sinais de alarme.",
        },
        peso: 2,
      },
      {
        id: "fecha-conduta",
        dominio: "Encerramento",
        descricao: "Explica a conduta e a urgência à paciente",
        ancoras: {
          competente:
            "Explica o que será feito agora E por que não pode esperar.",
          parcial:
            "Explica a conduta sem transmitir a urgência, ou transmite a urgência sem dizer o que será feito.",
        },
        peso: 1,
      },
    ],
  },
  {
    id: "dor-abdominal",
    titulo: "Dor abdominal em fossa ilíaca direita",
    especialidade: "Gastroenterologia / Cirurgia",
    dificuldade: "Fácil",
    perfilPaciente:
      "Adolescente, 16 anos, estudante, responde curto e fica constrangido com perguntas sobre apetite/evacuacao.",
    queixaPrincipal: "Dor na barriga desde ontem.",
    roteiroOculto:
      "Dor comecou perto do umbigo e migrou para o lado direito inferior do abdome. Piora " +
      "ao andar ou tossir. Associada a nausea e perda de apetite. Febre baixa (37.8C). Sem " +
      "diarreia. Dor a palpacao em ponto de McBurney se perguntado sobre exame fisico.",
    diagnosticoEsperado: "Apendicite aguda",
    rubrica: [
      {
        id: "apresentacao",
        dominio: "Comunicação e rapport",
        descricao: "Apresenta-se e explica o que vai fazer ao adolescente",
        ancoras: {
          competente:
            "Identifica-se E explica ao adolescente o que vai fazer antes de começar a perguntar.",
          parcial:
            "Identifica-se, mas não enquadra a conversa.",
        },
        peso: 1,
      },
      {
        id: "tato",
        dominio: "Comunicação e rapport",
        descricao: "Conduz perguntas constrangedoras com tato",
        ancoras: {
          competente:
            "Ao abordar evacuação, apetite ou náusea, justifica a pergunta ou usa linguagem neutra, sem constranger.",
          parcial:
            "Faz as perguntas de forma abrupta, mas sem julgamento ou ironia.",
        },
        peso: 1,
      },
      {
        id: "migracao",
        dominio: "Identificação do problema",
        descricao: "Investiga a migração da dor (periumbilical para fossa ilíaca direita)",
        ancoras: {
          competente:
            "Pergunta se a dor começou em outro lugar da barriga ou se mudou de lugar, e obtém o trajeto periumbilical para a fossa ilíaca direita.",
          parcial:
            "Pergunta onde dói agora, sem investigar se a dor mudou de lugar.",
        },
        peso: 2,
        critico: true,
      },
      {
        id: "fatores-piora",
        dominio: "Identificação do problema",
        descricao: "Investiga fatores de piora (deambulação, tosse, movimento)",
        ancoras: {
          competente:
            "Pergunta se a dor piora ao andar, tossir ou se mexer.",
        },
        peso: 1,
      },
      {
        id: "sintomas-associados",
        dominio: "Identificação do problema",
        descricao: "Pergunta sobre febre, náusea e perda de apetite",
        ancoras: {
          competente:
            "Pergunta sobre pelo menos dois de: febre, náusea/vômito, perda de apetite.",
          parcial:
            "Pergunta sobre apenas um deles.",
        },
        peso: 2,
      },
      {
        id: "habito-intestinal",
        dominio: "Identificação do problema",
        descricao: "Investiga hábito intestinal e urinário",
        ancoras: {
          competente:
            "Pergunta sobre diarreia/constipação ou sintomas urinários.",
        },
        peso: 1,
      },
      {
        id: "exame-fisico",
        dominio: "Identificação do problema",
        descricao: "Solicita exame físico do abdome",
        ancoras: {
          competente:
            "Pede palpação do abdome, descompressão brusca dolorosa ou ponto de McBurney.",
        },
        peso: 1,
      },
      {
        id: "hipotese-apendicite",
        dominio: "Raciocínio clínico",
        descricao: "Considera apendicite aguda no raciocínio clínico",
        ancoras: {
          competente:
            "Verbaliza a suspeita de apendicite, ou a sequência (migração + piora ao movimento + febre/anorexia) converge claramente para ela.",
          parcial:
            "Reconhece um quadro abdominal agudo que precisa de avaliação, sem chegar à apendicite.",
        },
        peso: 2,
        critico: true,
      },
      {
        id: "diferenciais",
        dominio: "Raciocínio clínico",
        descricao: "Levanta ao menos um diagnóstico diferencial",
        ancoras: {
          competente:
            "Investiga ao menos um diferencial: gastroenterite, adenite mesentérica, infecção urinária ou causa testicular.",
        },
        peso: 1,
      },
      {
        id: "fecha-conduta",
        dominio: "Encerramento",
        descricao: "Orienta avaliação cirúrgica e próximos passos",
        ancoras: {
          competente:
            "Explica que precisa de avaliação cirúrgica e exames E orienta jejum ou sinais de retorno.",
          parcial:
            "Diz que precisa de exames, sem orientar conduta nem retorno.",
        },
        peso: 1,
      },
    ],
  },
];

export const buscarCenarioOsce = (id: string): CenarioOsce | undefined =>
  CENARIOS_OSCE.find((cenario) => cenario.id === id);
