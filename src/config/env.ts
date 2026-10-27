// Fonte unica de configuracao do BFF: le o ambiente, valida com Zod e exporta um
// objeto "env" tipado e seguro para o resto da aplicacao consumir.
import dotenv from "dotenv";
import { z } from "zod";

// Carrega o .env e valida todas as variaveis de ambiente com Zod na subida do app:
// se algo obrigatorio faltar, o processo nao inicia (falha cedo, com erro claro).
dotenv.config();

const ambienteAtual = process.env.NODE_ENV ?? "development";
const ambienteTeste = ambienteAtual === "test";

/**
 * Cria um validador de variavel obrigatoria (presente e nao vazia).
 *
 * @param nome Nome da variavel, usado na mensagem de erro.
 * @returns Schema Zod que exige uma string nao vazia.
 */
const obrigatoria = (nome: string) => z.string().min(1, `${nome} is required.`);

/**
 * Cria um validador obrigatorio com fallback apenas em ambiente de teste.
 *
 * Em testes, aplica um valor padrao para nao exigir um .env completo; fora de
 * teste, mantem a variavel como obrigatoria.
 *
 * @param nome Nome da variavel, usado na mensagem de erro.
 * @param padrao Valor padrao aplicado somente em ambiente de teste.
 * @returns Schema Zod adequado ao ambiente atual.
 */
const obrigatoriaComDefaultDeTeste = (nome: string, padrao: string) =>
  ambienteTeste ? z.string().min(1).default(padrao) : obrigatoria(nome);

// Schema de todas as variaveis de ambiente do BFF, com defaults e validacao de tipo.
const envSchema = z.object({
  // Ambiente de execucao; controla defaults de teste e nivel de log.
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Porta HTTP do BFF (coercao de string para numero positivo).
  PORT: z.coerce.number().int().positive().default(4000),
  // Verbosidade do logger, do mais critico (fatal) ao desligado (silent).
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  // Enderecos dos servicos internos para onde o BFF faz proxy.
  BACKEND_URL: obrigatoriaComDefaultDeTeste("BACKEND_URL", "http://localhost:3333"),
  QUIZ_SERVICE_URL: obrigatoriaComDefaultDeTeste("QUIZ_SERVICE_URL", "http://localhost:3334"),
  // Chave da Gemini API; vazia desliga as rotas de IA generativa (perguntas livres).
  GEMINI_API_KEY: z.string().default(""),
  // Modelo da Gemini usado para responder perguntas livres do chat de ajuda.
  GEMINI_MODEL: z.string().min(1).default("gemini-3.5-flash-lite"),
  // Segredos compartilhados: precisam bater com os dos servicos, senao da 401/403.
  INTERNAL_TOKEN: obrigatoriaComDefaultDeTeste("INTERNAL_TOKEN", "test-internal-token"),
  JWT_SECRET_KEY: obrigatoriaComDefaultDeTeste("JWT_SECRET_KEY", "test-secret"),
  // Lista de origens liberadas no CORS, informada separada por virgula no .env.
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((origem) => origem.trim())
        .filter(Boolean),
    ),
  // Timeout das chamadas aos servicos internos (ms).
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  // Protecao da API: limite por IP e janela em milissegundos.
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(1200),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().max(86400000).default(60000),
  // Habilitar apenas quando a quantidade de proxies da hospedagem for conhecida.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
});

const parsedEnv = envSchema.safeParse(process.env);

// Configuracao invalida derruba o boot na hora, com a lista de campos problematicos.
if (!parsedEnv.success) {
  throw new Error(
    `Invalid environment variables: ${JSON.stringify(z.flattenError(parsedEnv.error).fieldErrors)}`,
  );
}

export const env = parsedEnv.data;
