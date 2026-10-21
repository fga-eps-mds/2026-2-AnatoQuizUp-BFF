// Codigos de erro estaveis expostos ao cliente. Sao parte do contrato da API:
// o front pode chavear comportamento por eles, entao nao devem mudar a toa.
export const CodigoDeErro = {
  REQUISICAO_INVALIDA: "REQUISICAO_INVALIDA",
  NAO_AUTORIZADO: "NAO_AUTORIZADO",
  PROIBIDO: "PROIBIDO",
  NAO_ENCONTRADO: "NAO_ENCONTRADO",
  ERRO_INTERNO: "ERRO_INTERNO",
  ERRO_DOWNSTREAM: "ERRO_DOWNSTREAM",
  TIMEOUT_DOWNSTREAM: "TIMEOUT_DOWNSTREAM",
  IA_INDISPONIVEL: "IA_INDISPONIVEL",
} as const;

// Tipo derivado: aceita exatamente um dos valores acima, evitando strings soltas.
export type ValorCodigoDeErro = (typeof CodigoDeErro)[keyof typeof CodigoDeErro];
