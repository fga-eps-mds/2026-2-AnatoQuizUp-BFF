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
  falhaServicoDownstream: "Falha ao consultar o servico downstream.",
} as const;
