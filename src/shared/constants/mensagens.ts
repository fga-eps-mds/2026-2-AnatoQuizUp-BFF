// Mensagens fixas reutilizadas nas respostas do BFF, centralizadas para manter o
// texto consistente e facilitar ajustes em um unico lugar.
export const MENSAGENS = {
  bffEmExecucao: "BFF do AnatoQuizUp em execucao.",
  erroInterno: "Ocorreu um erro interno inesperado.",
  rotaNaoEncontrada: "A rota solicitada nao foi encontrada.",
  origemCorsNaoPermitida: "Origem nao permitida pelo CORS.",
  tokenAcessoAusente: "Token de acesso ausente.",
  tokenAcessoInvalido: "Token de acesso invalido ou expirado.",
  iaIndisponivel: "Servico de IA ainda nao foi habilitado nesta release.",
  alunoSemHistorico: "Aluno ainda nao tem historico suficiente para gerar uma dica.",
  perguntaInvalida: "Pergunta invalida: informe um texto de 1 a 500 caracteres.",
  respostaIaIndisponivel: "Nao foi possivel obter uma resposta da IA agora. Tente novamente.",
  falhaServicoDownstream: "Falha ao consultar o servico downstream.",
  cenarioOsceNaoEncontrado: "Cenario de simulacao OSCE nao encontrado.",
  mensagemOsceInvalida: "Mensagem invalida: informe um texto de 1 a 500 caracteres.",
  historicoOsceInvalido: "Historico invalido: cada item precisa de autor (aluno/paciente) e texto.",
} as const;
