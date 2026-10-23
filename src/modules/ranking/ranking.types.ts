// Tipos do modulo de ranking: contratos do usuario autenticado, das respostas
// dos servicos internos (Usuario e Quiz) e do formato final devolvido pelo BFF.

// Identidade do usuario ja resolvida pelo middleware de autenticacao.
export type UsuarioRequisicao = {
  id: string;
  papel: string;
  status: string;
};

// Envelope padrao de sucesso da API; "dados" carrega o payload util.
export type RespostaApiSucesso<T> = {
  mensagem?: string;
  dados: T;
};

// ---- Dados vindos do Usuario-Service ----

// "visivel" indica se o aluno aceita aparecer para outros (privacidade do ranking).
export type ResumoAmigo = {
  id: string;
  nome: string;
  nickname: string | null;
  curso: string | null;
  semestre: string | null;
  visivel?: boolean;
};

// Cosmetico equipado (avatar, moldura etc.) exibido junto da linha do ranking.
export type ItemCosmetico = {
  id: string;
  codigo: string;
  nome: string;
  descricao: string | null;
  tipo: string;
  valor: string | null;
  imagemUrl: string | null;
  previewImagemUrl: string | null;
};

// "statusAmizade" distingue convites pendentes de amizades ATIVAS.
export type ResumoAmizade = {
  id: string;
  statusAmizade: string;
  amigo: ResumoAmigo;
};

// Lista paginada de amizades; metadados.totalPages guia a varredura por paginas.
export type RespostaAmizades = {
  dados: ResumoAmizade[];
  metadados: { totalPages: number };
};

// Aluno elegivel ao ranking geral (ja filtrado por visibilidade no Usuario-Service).
export type AlunoVisivel = {
  id: string;
  nome: string;
  nickname: string | null;
  curso: string | null;
  semestre: string | null;
};

// Versao enxuta usada so para resolver nome/nickname a partir do id.
export type ResumoUsuario = {
  id: string;
  nome: string;
  nickname: string | null;
};

export type UsuarioPublico = {
  id: string;
  nome: string;
  papel: string;
};

// ---- Dados vindos do Quiz-Service ----

// Pontuacao agregada por usuario. xpTotal e o criterio principal do ranking de
// alunos; acertos, respondidas e ultimaAtividade servem de desempate. xpTotal e
// nivel sao opcionais para tolerar um Quiz-Service ainda sem a progressao por XP.
export type PontuacaoUsuario = {
  usuarioId: string;
  xpTotal?: number;
  nivel?: number;
  elo?: string;
  totalAcertos: number;
  totalRespondidas: number;
  ultimaAtividade: string | null;
};

// Desempenho por aluno na turma, ja calculado pelo Quiz (so falta resolver nomes).
export type DesempenhoIndividualQuiz = {
  alunos: Array<{
    alunoId: string;
    totalRespondidas: number;
    totalAcertos: number;
    taxaAcerto: number;
    ultimaAtividade: string | null;
  }>;
};

// Situacao do aluno em relacao a uma lista (entregou, em andamento ou nem comecou).
export type StatusListaAluno = 'SUBMETIDA' | 'EM_ANDAMENTO' | 'NAO_RESPONDEU';

// Desempenho dos alunos em uma lista especifica, vindo do dashboard do Quiz.
export type DesempenhoListaQuiz = {
  listaTurmaId: string;
  nomeLista: string;
  totalQuestoes: number;
  desempenhoAlunos: Array<{
    alunoId: string;
    status: StatusListaAluno;
    totalAcertos: number;
    taxaAcerto: number;
    submissaoEm: string | null;
    mensagem: string;
  }>;
};

// ---- Respostas do BFF (ranking) ----

// Linha final do ranking geral/amigos, ja com posicao calculada e flag do "Voce".
export type EntradaRanking = {
  posicao: number;
  usuarioId: string;
  nome: string;
  nickname: string | null;
  curso: string | null;
  semestre: string | null;
  xpTotal: number;
  nivel: number;
  elo: string;
  totalAcertos: number;
  totalRespondidas: number;
  taxaAcerto: number;
  ehUsuarioAtual: boolean;
  cosmeticos: ItemCosmetico[];
};

// Resposta dos rankings de aluno: o top N + a linha do proprio usuario a parte.
export type RankingAlunoResposta = {
  dados: EntradaRanking[];
  usuarioAtual: EntradaRanking | null;
  totalParticipantes: number;
};

// Linha do ranking de turma (nao tem flag de "Voce", e visao do professor).
export type EntradaRankingTurma = {
  posicao: number;
  alunoId: string;
  nome: string;
  nickname: string | null;
  totalAcertos: number;
  totalRespondidas: number;
  taxaAcerto: number;
  cosmeticos: ItemCosmetico[];
};

export type RankingTurmaResposta = {
  turmaId: string;
  totalAlunos: number;
  dados: EntradaRankingTurma[];
};

// Linha do ranking de uma lista: inclui status e horario de submissao do aluno.
export type EntradaRankingLista = {
  posicao: number;
  alunoId: string;
  nome: string;
  nickname: string | null;
  status: StatusListaAluno;
  totalAcertos: number;
  taxaAcerto: number;
  submissaoEm: string | null;
  cosmeticos: ItemCosmetico[];
};

// Resposta do ranking de lista: cabecalho da lista + as linhas dos alunos.
export type RankingListaResposta = {
  turmaId: string;
  listaTurmaId: string;
  nomeLista: string;
  totalQuestoes: number;
  dados: EntradaRankingLista[];
};
