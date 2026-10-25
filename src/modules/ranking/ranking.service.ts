// Service de ranking do BFF. Centraliza a orquestracao entre Usuario-Service
// (identidade/privacidade) e Quiz-Service (pontuacao/gamificacao) para os quatro
// tipos de ranking: geral, amigos, turma e lista.
import { env } from "@/config/env";
import { backendClient } from "@/shared/clients/backend.client";
import { quizClient } from "@/shared/clients/quiz.client";

import type {
  AlunoVisivel,
  DesempenhoIndividualQuiz,
  DesempenhoListaQuiz,
  EntradaRanking,
  EntradaRankingLista,
  EntradaRankingTurma,
  ItemCosmetico,
  PontuacaoUsuario,
  RankingAlunoResposta,
  RankingListaResposta,
  RankingTurmaResposta,
  RespostaAmizades,
  RespostaApiSucesso,
  ResumoAmigo,
  ResumoUsuario,
  UsuarioPublico,
  UsuarioRequisicao,
} from "./ranking.types";

// Teto de amigos buscados ao montar o ranking "entre amigos".
const LIMITE_AMIGOS = 100;
// Quantidade padrao de colocados retornados no ranking geral.
const LIMITE_PADRAO_GERAL = 100;
// Papeis que podem ver todos os alunos, inclusive os de perfil privado.
const PAPEIS_GESTAO = ["PROFESSOR", "ADMIN", "ADMINISTRADOR"];

type RespostaMapaCosmeticos = {
  dados: Record<string, ItemCosmetico[]>;
};

// Entrada antes de ranquear: carrega ultimaAtividade (usada so no desempate) e
// ainda nao tem "posicao", que e atribuida depois da ordenacao.
type EntradaInterna = Omit<EntradaRanking, "posicao"> & {
  ultimaAtividade: string | null;
};

/**
 * Calcula a taxa de acerto em porcentagem inteira.
 *
 * Protege contra divisao por zero: quando o aluno ainda nao respondeu nada,
 * retorna 0 em vez de gerar NaN.
 *
 * @param acertos Quantidade de questoes acertadas.
 * @param respondidas Quantidade total de questoes respondidas.
 * @returns Percentual de acerto arredondado (0 a 100).
 */
function calcularTaxa(acertos: number, respondidas: number): number {
  return respondidas > 0 ? Math.round((acertos / respondidas) * 100) : 0;
}

/**
 * Comparador que implementa a regra de ordenacao do ranking de alunos.
 *
 * Os criterios sao aplicados em cascata, parando no primeiro que diferenciar:
 * 1. mais XP acumulado primeiro (US de progressao por XP);
 * 2. em caso de empate, mais acertos;
 * 3. depois, quem respondeu menos (foi mais eficiente);
 * 4. persistindo o empate, quem pontuou primeiro (atividade mais antiga);
 * 5. por fim, ordem alfabetica pelo nome.
 *
 * Quem nunca teve atividade recebe +Infinito no tempo, indo para o fim do criterio 3.
 *
 * @param a Primeira entrada comparada.
 * @param b Segunda entrada comparada.
 * @returns Negativo se "a" vem antes, positivo se vem depois, 0 se equivalentes.
 */
function compararEntradas(a: EntradaInterna, b: EntradaInterna): number {
  // Criterio 1: mais XP acumulado primeiro.
  if (b.xpTotal !== a.xpTotal) {
    return b.xpTotal - a.xpTotal;
  }
  // Criterio 2: entre iguais em XP, mais acertos primeiro.
  if (b.totalAcertos !== a.totalAcertos) {
    return b.totalAcertos - a.totalAcertos;
  }
  // Criterio 3: entre iguais em acertos, quem respondeu menos foi mais eficiente.
  if (a.totalRespondidas !== b.totalRespondidas) {
    return a.totalRespondidas - b.totalRespondidas;
  }
  // Criterio 4: desempata por quem teve atividade mais antiga (pontuou primeiro).
  const tempoA = a.ultimaAtividade ? Date.parse(a.ultimaAtividade) : Number.POSITIVE_INFINITY;
  const tempoB = b.ultimaAtividade ? Date.parse(b.ultimaAtividade) : Number.POSITIVE_INFINITY;
  if (tempoA !== tempoB) {
    return tempoA - tempoB;
  }
  // Criterio 5: ultimo desempate estavel, por ordem alfabetica.
  return a.nome.localeCompare(b.nome);
}

/**
 * Ordena as entradas pelas regras da US e atribui a posicao final de cada uma.
 *
 * Trabalha sobre uma copia do array (spread) para nao alterar a lista original,
 * e converte o indice ordenado em posicao humana (1, 2, 3...).
 *
 * @param internas Entradas ainda sem posicao definida.
 * @returns Entradas ordenadas, cada uma com sua posicao no ranking.
 */
function ordenarEAtribuirPosicoes(internas: EntradaInterna[]): EntradaRanking[] {
  return [...internas].sort(compararEntradas).map((entrada, indice) => ({
    posicao: indice + 1,
    usuarioId: entrada.usuarioId,
    nome: entrada.nome,
    nickname: entrada.nickname,
    curso: entrada.curso,
    semestre: entrada.semestre,
    xpTotal: entrada.xpTotal,
    nivel: entrada.nivel,
    elo: entrada.elo,
    totalAcertos: entrada.totalAcertos,
    totalRespondidas: entrada.totalRespondidas,
    taxaAcerto: entrada.taxaAcerto,
    ehUsuarioAtual: entrada.ehUsuarioAtual,
    cosmeticos: entrada.cosmeticos,
  }));
}

/**
 * Servico de ranking do BFF.
 *
 * Orquestra dados de dois servicos independentes (Usuario-Service e Quiz-Service)
 * para montar os varios rankings da plataforma: geral, entre amigos, por turma e
 * por lista. Nao tem persistencia propria; apenas consulta, cruza e ordena.
 */
export class RankingService {
  /**
   * Monta os cabecalhos comuns a toda chamada para os servicos internos.
   *
   * Repassa o token do usuario (Authorization), a identidade ja resolvida
   * (x-user-*) e o token interno exigido pelos servicos privados.
   *
   * @param usuario Usuario autenticado da requisicao.
   * @param authorization Header Authorization original a ser repassado.
   * @returns Mapa de cabecalhos pronto para uso nas chamadas HTTP.
   */
  private montarHeaders(
    usuario: UsuarioRequisicao,
    authorization: string,
  ): Record<string, string> {
    return {
      Authorization: authorization,
      "x-internal-token": env.INTERNAL_TOKEN,
      "x-user-id": usuario.id,
      "x-user-papel": usuario.papel,
      "x-user-status": usuario.status,
    };
  }

  /**
   * Indica se o papel informado tem visao de gestao (professor ou admin).
   *
   * Usado para liberar a visualizacao de alunos com perfil privado.
   *
   * @param papel Papel do usuario autenticado.
   * @returns true se for professor/admin; false caso contrario.
   */
  private ehGestao(papel: string): boolean {
    return PAPEIS_GESTAO.includes(papel);
  }

  /**
   * Busca as pontuacoes (acertos/respondidas) no Quiz-Service.
   *
   * Sem usuarioIds, traz a base inteira; com a lista, restringe aos usuarios
   * informados. O resultado vira um Map por usuarioId para permitir o cruzamento
   * em O(1) com os dados de nome/privacidade vindos do Usuario-Service.
   *
   * @param headers Cabecalhos das chamadas internas.
   * @param usuarioIds Lista opcional de ids a filtrar.
   * @returns Map de pontuacao indexado por usuarioId.
   */
  private async buscarPontuacoes(
    headers: Record<string, string>,
    usuarioIds?: string[],
  ): Promise<Map<string, PontuacaoUsuario>> {
    // Monta o filtro de ids como query (lista separada por virgula) ou omite para todos.
    const params =
      usuarioIds && usuarioIds.length > 0 ? { usuarioIds: usuarioIds.join(",") } : undefined;

    const { data } = await quizClient.get<RespostaApiSucesso<PontuacaoUsuario[]>>(
      "/api/v1/ranking/pontuacoes",
      { params, headers },
    );

    // Indexa por usuarioId para o cruzamento rapido com os dados de identidade.
    return new Map(data.dados.map((pontuacao) => [pontuacao.usuarioId, pontuacao]));
  }

  /**
   * Busca os cosmeticos equipados (avatar, moldura etc.) de cada aluno no Quiz.
   *
   * Os cosmeticos sao puramente decorativos no ranking, entao a falha aqui e
   * tolerada: em caso de erro, retorna um Map vazio sem derrubar o ranking inteiro.
   *
   * @param usuarioIds Ids dos usuarios cujos cosmeticos serao buscados.
   * @param headers Cabecalhos das chamadas internas.
   * @returns Map de cosmeticos por usuarioId (vazio quando nao houver dados).
   */
  private async buscarCosmeticos(
    usuarioIds: string[],
    headers: Record<string, string>,
  ): Promise<Map<string, ItemCosmetico[]>> {
    // Sem usuarios nao ha o que consultar; evita uma chamada desnecessaria.
    if (usuarioIds.length === 0) {
      return new Map();
    }

    try {
      const { data } = await quizClient.get<RespostaMapaCosmeticos>(
        "/api/v1/inventario/usuarios/equipados",
        { params: { usuarioIds: usuarioIds.join(",") }, headers },
      );

      return new Map(Object.entries(data.dados));
    } catch {
      // Cosmeticos sao apenas decorativos no ranking; um erro aqui nao deve
      // derrubar o ranking inteiro.
      return new Map();
    }
  }

  /**
   * Funde dados de identidade (Usuario) e pontuacao (Quiz) numa unica entrada.
   *
   * Quem nunca respondeu nada nao tem pontuacao correspondente: nesse caso os
   * totais sao zerados. Tambem marca se a entrada e do proprio usuario logado.
   *
   * @param base Dados de identidade do aluno (id, nome, nickname, curso, semestre).
   * @param pontuacao Pontuacao do aluno, ou undefined se nunca pontuou.
   * @param usuarioAtualId Id do usuario logado, para marcar a propria linha.
   * @param cosmeticos Cosmeticos equipados a exibir na linha.
   * @returns Entrada interna pronta para ser ordenada.
   */
  private montarInterna(
    base: {
      id: string;
      nome: string;
      nickname: string | null;
      curso: string | null;
      semestre: string | null;
    },
    pontuacao: PontuacaoUsuario | undefined,
    usuarioAtualId: string,
    cosmeticos: ItemCosmetico[],
  ): EntradaInterna {
    // Sem pontuacao (aluno que nunca respondeu) os totais caem para zero.
    const totalAcertos = pontuacao?.totalAcertos ?? 0;
    const totalRespondidas = pontuacao?.totalRespondidas ?? 0;

    // Combina identidade, totais, taxa calculada e cosmeticos numa entrada unica.
    return {
      usuarioId: base.id,
      nome: base.nome,
      nickname: base.nickname,
      curso: base.curso,
      semestre: base.semestre,
      // Sem XP (nunca concluiu uma rodada de quiz) o aluno fica no nivel 1, elo Curioso, com 0 XP.
      xpTotal: pontuacao?.xpTotal ?? 0,
      nivel: pontuacao?.nivel ?? 1,
      elo: pontuacao?.elo ?? "Curioso",
      totalAcertos,
      totalRespondidas,
      taxaAcerto: calcularTaxa(totalAcertos, totalRespondidas),
      // Marca a propria linha para o front conseguir destacar o "Voce".
      ehUsuarioAtual: base.id === usuarioAtualId,
      cosmeticos,
      ultimaAtividade: pontuacao?.ultimaAtividade ?? null,
    };
  }

  /**
   * Busca o proprio nome do aluno no Usuario-Service.
   *
   * Garante que o usuario logado apareca no ranking de amigos mesmo quando ele
   * nao consta na lista de amizades retornada.
   *
   * @param usuarioId Id do usuario logado.
   * @param headers Cabecalhos das chamadas internas.
   * @returns Nome do usuario (nickname fica nulo neste fluxo).
   */
  private async buscarResumoProprio(
    usuarioId: string,
    headers: Record<string, string>,
  ): Promise<{ nome: string; nickname: string | null }> {
    const { data } = await backendClient.get<RespostaApiSucesso<UsuarioPublico>>(
      `/api/v1/usuarios/${usuarioId}`,
      { headers },
    );
    return { nome: data.dados.nome, nickname: null };
  }

  /**
   * Resolve nome/nickname de varios alunos de uma vez no Usuario-Service.
   *
   * Usado nos rankings de turma e de lista, onde o Quiz devolve apenas ids.
   * O resultado e indexado por id para casar com os dados de desempenho.
   *
   * @param ids Ids dos alunos a resolver.
   * @param headers Cabecalhos das chamadas internas.
   * @returns Map de resumo (nome/nickname) por id.
   */
  private async buscarNomesPorIds(
    ids: string[],
    headers: Record<string, string>,
  ): Promise<Map<string, ResumoUsuario>> {
    if (ids.length === 0) {
      return new Map();
    }

    // Busca em lote pelos ids (query separada por virgula) numa unica chamada.
    const { data } = await backendClient.get<RespostaApiSucesso<ResumoUsuario[]>>(
      "/api/v1/usuarios",
      { params: { ids: ids.join(",") }, headers },
    );

    // Indexa por id para casar rapidamente com os dados de desempenho.
    return new Map(data.dados.map((usuario) => [usuario.id, usuario]));
  }

  /**
   * Monta o ranking geral de alunos.
   *
   * Junta a lista de alunos visiveis (Usuario-Service) com as pontuacoes
   * (Quiz-Service), ordena pelas regras da US e devolve o top N. A linha do
   * proprio usuario vai destacada a parte, para o front mostra-la mesmo quando
   * ele fica fora do top N. Professor/Admin tambem enxergam alunos privados.
   *
   * @param usuario Usuario autenticado que pede o ranking.
   * @param authorization Header Authorization a repassar aos servicos.
   * @param limite Quantidade maxima de colocados retornados.
   * @returns Top N do ranking, a linha do usuario e o total de participantes.
   */
  async rankingGeral(
    usuario: UsuarioRequisicao,
    authorization: string,
    limite = LIMITE_PADRAO_GERAL,
  ): Promise<RankingAlunoResposta> {
    const headers = this.montarHeaders(usuario, authorization);

    // Professor/Admin enxergam todos os alunos (inclusive os de perfil privado);
    // alunos so enxergam quem esta com o perfil visivel.
    const incluirPrivados = this.ehGestao(usuario.papel);
    const paramsVisiveis = incluirPrivados ? { incluirPrivados: "true" } : undefined;

    // Alunos e pontuacoes vem de servicos diferentes e independentes: busca em paralelo.
    const [visiveis, pontuacoes] = await Promise.all([
      backendClient.get<RespostaApiSucesso<AlunoVisivel[]>>("/api/v1/usuarios/visiveis", {
        params: paramsVisiveis,
        headers,
      }),
      this.buscarPontuacoes(headers),
    ]);

    const alunos = visiveis.data.dados;
    // Cosmeticos dependem da lista de alunos ja resolvida, por isso vem depois.
    const cosmeticos = await this.buscarCosmeticos(
      alunos.map((aluno) => aluno.id),
      headers,
    );

    // Cruza cada aluno com sua pontuacao e cosmeticos (vazios quando nao houver).
    const internas = alunos.map((aluno) =>
      this.montarInterna(
        aluno,
        pontuacoes.get(aluno.id),
        usuario.id,
        cosmeticos.get(aluno.id) ?? [],
      ),
    );

    const ordenadas = ordenarEAtribuirPosicoes(internas);
    // O proprio usuario vai separado para o front mostra-lo mesmo fora do top N.
    const usuarioAtual = ordenadas.find((entrada) => entrada.ehUsuarioAtual) ?? null;

    // Recorta o top N para a lista principal, mas devolve o total real de participantes.
    return {
      dados: ordenadas.slice(0, limite),
      usuarioAtual,
      totalParticipantes: ordenadas.length,
    };
  }

  /**
   * Monta o ranking entre os amigos do usuario.
   *
   * Considera apenas amizades ATIVAS e respeita a privacidade: amigos com perfil
   * privado nao entram. O proprio usuario e sempre incluido na lista. Pontuacoes,
   * resumo proprio e cosmeticos sao buscados em paralelo.
   *
   * @param usuario Usuario autenticado que pede o ranking.
   * @param authorization Header Authorization a repassar aos servicos.
   * @returns Ranking dos amigos, a linha do usuario e o total de participantes.
   */
  async rankingAmigos(
    usuario: UsuarioRequisicao,
    authorization: string,
  ): Promise<RankingAlunoResposta> {
    const headers = this.montarHeaders(usuario, authorization);

    const { data: amizades } = await backendClient.get<RespostaAmizades>("/api/v1/amizade", {
      params: { limit: LIMITE_AMIGOS },
      headers,
    });

    // Amigos com perfil privado nao entram no ranking (aluno -> aluno).
    const amigos: ResumoAmigo[] = amizades.dados
      .filter((amizade) => amizade.statusAmizade === "ATIVO")
      .map((amizade) => amizade.amigo)
      .filter((amigo) => amigo.visivel !== false);

    // Inclui o proprio usuario na consulta para ele aparecer no ranking de amigos.
    const ids = [usuario.id, ...amigos.map((amigo) => amigo.id)];

    const [resumoProprio, pontuacoes, cosmeticos] = await Promise.all([
      this.buscarResumoProprio(usuario.id, headers),
      this.buscarPontuacoes(headers, ids),
      this.buscarCosmeticos(ids, headers),
    ]);

    // Monta as entradas: primeiro a do proprio usuario, depois a de cada amigo.
    const internas: EntradaInterna[] = [
      this.montarInterna(
        {
          id: usuario.id,
          nome: resumoProprio.nome,
          nickname: resumoProprio.nickname,
          curso: null,
          semestre: null,
        },
        pontuacoes.get(usuario.id),
        usuario.id,
        cosmeticos.get(usuario.id) ?? [],
      ),
      ...amigos.map((amigo) =>
        this.montarInterna(
          amigo,
          pontuacoes.get(amigo.id),
          usuario.id,
          cosmeticos.get(amigo.id) ?? [],
        ),
      ),
    ];

    const ordenadas = ordenarEAtribuirPosicoes(internas);
    // Localiza a linha do proprio usuario para destaca-la na resposta.
    const usuarioAtual = ordenadas.find((entrada) => entrada.ehUsuarioAtual) ?? null;

    // No ranking de amigos a lista costuma ser curta, entao devolve todas as entradas.
    return {
      dados: ordenadas,
      usuarioAtual,
      totalParticipantes: ordenadas.length,
    };
  }

  /**
   * Monta o ranking dos alunos de uma turma.
   *
   * O Quiz-Service ja calcula o desempenho individual da turma; aqui apenas
   * resolvemos nome/nickname e cosmeticos dos ids e reordenamos pelas regras da US.
   *
   * @param usuario Usuario autenticado (tipicamente professor/admin).
   * @param authorization Header Authorization a repassar aos servicos.
   * @param turmaId Id da turma cujo ranking sera montado.
   * @returns Ranking da turma com total de alunos e linhas ordenadas.
   */
  async rankingTurma(
    usuario: UsuarioRequisicao,
    authorization: string,
    turmaId: string,
  ): Promise<RankingTurmaResposta> {
    const headers = this.montarHeaders(usuario, authorization);

    const { data } = await quizClient.get<DesempenhoIndividualQuiz>(
      `/api/v1/turmasDashboard/${turmaId}/individual`,
      { headers },
    );

    // O dashboard do Quiz devolve so ids; precisamos resolver nome/nickname a parte.
    const alunoIds = data.alunos.map((aluno) => aluno.alunoId);
    const [nomes, cosmeticos] = await Promise.all([
      this.buscarNomesPorIds(alunoIds, headers),
      this.buscarCosmeticos(alunoIds, headers),
    ]);

    const internas = data.alunos.map((aluno) => ({
      alunoId: aluno.alunoId,
      // Fallback "Aluno" caso o nome nao seja resolvido (id sem cadastro correspondente).
      nome: nomes.get(aluno.alunoId)?.nome ?? "Aluno",
      nickname: nomes.get(aluno.alunoId)?.nickname ?? null,
      totalAcertos: aluno.totalAcertos,
      totalRespondidas: aluno.totalRespondidas,
      taxaAcerto: aluno.taxaAcerto,
      ultimaAtividade: aluno.ultimaAtividade ?? null,
      cosmeticos: cosmeticos.get(aluno.alunoId) ?? [],
    }));

    // Mesma regra do ranking geral: acertos desc, depois menos respondidas, depois nome.
    internas.sort((a, b) => {
      if (b.totalAcertos !== a.totalAcertos) {
        return b.totalAcertos - a.totalAcertos;
      }
      if (a.totalRespondidas !== b.totalRespondidas) {
        return a.totalRespondidas - b.totalRespondidas;
      }
      return a.nome.localeCompare(b.nome);
    });

    // Ja ordenado: converte o indice em posicao final (1, 2, 3...) de cada aluno.
    const dados: EntradaRankingTurma[] = internas.map((entrada, indice) => ({
      posicao: indice + 1,
      alunoId: entrada.alunoId,
      nome: entrada.nome,
      nickname: entrada.nickname,
      totalAcertos: entrada.totalAcertos,
      totalRespondidas: entrada.totalRespondidas,
      taxaAcerto: entrada.taxaAcerto,
      cosmeticos: entrada.cosmeticos,
    }));

    return {
      turmaId,
      totalAlunos: data.alunos.length,
      dados,
    };
  }

  /**
   * Monta o ranking dos alunos em uma lista especifica de uma turma.
   *
   * Diferente dos demais rankings, o desempate aqui leva em conta tambem a taxa
   * de acerto e o horario de submissao da lista (quem entregou antes leva vantagem).
   *
   * @param usuario Usuario autenticado (tipicamente professor/admin).
   * @param authorization Header Authorization a repassar aos servicos.
   * @param turmaId Id da turma a que a lista pertence.
   * @param listaId Id da lista cujo ranking sera montado.
   * @returns Ranking da lista com cabecalho da lista e linhas ordenadas.
   */
  async rankingLista(
    usuario: UsuarioRequisicao,
    authorization: string,
    turmaId: string,
    listaId: string,
  ): Promise<RankingListaResposta> {
    const headers = this.montarHeaders(usuario, authorization);

    const { data } = await quizClient.get<DesempenhoListaQuiz>(
      `/api/v1/turmasDashboard/${turmaId}/listas/${listaId}`,
      { headers },
    );

    // Resolve nomes e cosmeticos dos ids retornados pelo desempenho da lista.
    const alunoIds = data.desempenhoAlunos.map((aluno) => aluno.alunoId);
    const [nomes, cosmeticos] = await Promise.all([
      this.buscarNomesPorIds(alunoIds, headers),
      this.buscarCosmeticos(alunoIds, headers),
    ]);

    // Mantem os campos de desempenho do Quiz e agrega nome/nickname/cosmeticos.
    const internas = data.desempenhoAlunos.map((aluno) => ({
      ...aluno,
      nome: nomes.get(aluno.alunoId)?.nome ?? "Aluno",
      nickname: nomes.get(aluno.alunoId)?.nickname ?? null,
      cosmeticos: cosmeticos.get(aluno.alunoId) ?? [],
    }));

    // Desempate da lista: mais acertos, melhor taxa, quem submeteu antes e enfim nome.
    // Sem submissao (nao entregou) vai para o fim via +Infinity.
    internas.sort((a, b) => {
      if (b.totalAcertos !== a.totalAcertos) {
        return b.totalAcertos - a.totalAcertos;
      }
      if (b.taxaAcerto !== a.taxaAcerto) {
        return b.taxaAcerto - a.taxaAcerto;
      }
      const tempoA = a.submissaoEm ? Date.parse(a.submissaoEm) : Number.POSITIVE_INFINITY;
      const tempoB = b.submissaoEm ? Date.parse(b.submissaoEm) : Number.POSITIVE_INFINITY;
      if (tempoA !== tempoB) {
        return tempoA - tempoB;
      }
      return a.nome.localeCompare(b.nome);
    });

    // Converte a ordem final em posicoes numeradas e seleciona os campos da resposta.
    const dados: EntradaRankingLista[] = internas.map((entrada, indice) => ({
      posicao: indice + 1,
      alunoId: entrada.alunoId,
      nome: entrada.nome,
      nickname: entrada.nickname,
      status: entrada.status,
      totalAcertos: entrada.totalAcertos,
      taxaAcerto: entrada.taxaAcerto,
      submissaoEm: entrada.submissaoEm,
      cosmeticos: entrada.cosmeticos,
    }));

    return {
      turmaId,
      listaTurmaId: data.listaTurmaId,
      nomeLista: data.nomeLista,
      totalQuestoes: data.totalQuestoes,
      dados,
    };
  }
}
