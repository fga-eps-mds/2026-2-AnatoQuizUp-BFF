// Valida, antes de repassar ao Usuario-Service, que o aluno so equipa no avatar os
// itens da loja que ele comprou. O Usuario-Service guarda a aparencia mas nao conhece
// o inventario; quem sabe o que o aluno possui e o Quiz-Service. Por isso a checagem
// fica no BFF, que conversa com os dois.
import type { NextFunction, Request, Response } from "express";

import { env } from "@/config/env";
import { quizClient } from "@/shared/clients/quiz.client";
import { CodigoDeErro } from "@/shared/errors/codigos-de-erro";
import { ErroAplicacao } from "@/shared/errors/erro-aplicacao";

// Campo da aparencia -> tipo do item no catalogo da loja.
const TIPO_POR_CAMPO = {
  cabelo: "CABELO",
  acessorio: "ACESSORIO",
  luva: "LUVA",
  calcado: "CALCADO",
} as const;

type CampoAvatar = keyof typeof TIPO_POR_CAMPO;

type ItemCatalogo = { codigo: string; tipo: string; adquirido: boolean };

type RespostaCatalogo = {
  dados: ItemCatalogo[];
  metadados: { totalPages: number };
};

// Limite maximo aceito pelo catalogo do Quiz-Service por pagina.
const LIMITE_PAGINA_CATALOGO = 100;

/**
 * Busca o catalogo inteiro do ponto de vista do aluno (cada item vem com
 * `adquirido`), percorrendo todas as paginas.
 */
async function buscarCatalogoDoAluno(request: Request): Promise<ItemCatalogo[]> {
  const usuario = request.usuario;
  const headers: Record<string, string> = {
    "x-internal-token": env.INTERNAL_TOKEN,
  };
  if (request.headers.authorization) headers.Authorization = request.headers.authorization;
  if (usuario) {
    headers["x-user-id"] = usuario.id;
    headers["x-user-papel"] = usuario.papel;
    headers["x-user-status"] = usuario.status;
  }

  const itens: ItemCatalogo[] = [];
  let pagina = 1;
  let totalPaginas = 1;
  do {
    const { data } = await quizClient.get<RespostaCatalogo>("/api/v1/loja/catalogo", {
      params: { page: pagina, limit: LIMITE_PAGINA_CATALOGO },
      headers,
    });
    itens.push(...data.dados);
    totalPaginas = data.metadados.totalPages;
    pagina += 1;
  } while (pagina <= totalPaginas);

  return itens;
}

/**
 * Devolve os campos da aparencia que apontam para um item do catalogo que o aluno
 * nao comprou. Valores que nao sao itens do catalogo (os itens base liberados de
 * graca, como "loiro" ou "luva-boxe") nao sao bloqueados aqui; a validacao do
 * formato continua sendo do Usuario-Service.
 */
export function encontrarItensNaoAdquiridos(
  aparencia: Partial<Record<CampoAvatar, unknown>>,
  catalogo: ItemCatalogo[],
): { campo: CampoAvatar; codigo: string }[] {
  const naoAdquiridos: { campo: CampoAvatar; codigo: string }[] = [];

  for (const campo of Object.keys(TIPO_POR_CAMPO) as CampoAvatar[]) {
    const codigo = aparencia[campo];
    if (typeof codigo !== "string") continue;

    const item = catalogo.find((i) => i.tipo === TIPO_POR_CAMPO[campo] && i.codigo === codigo);
    if (item && !item.adquirido) naoAdquiridos.push({ campo, codigo });
  }

  return naoAdquiridos;
}

/**
 * Middleware de `PUT /usuarios/meu-avatar`: recusa com 403 a aparencia que usa item
 * da loja ainda nao comprado. Se o Quiz-Service nao responder, a aparencia tambem nao
 * e salva (502), para nao deixar passar um item sem a checagem de posse.
 */
export async function validarPosseItensAvatar(
  request: Request,
  _response: Response,
  next: NextFunction,
): Promise<void> {
  const corpo: unknown = request.body;
  if (!corpo || typeof corpo !== "object") {
    next();
    return;
  }

  const aparencia = corpo as Partial<Record<CampoAvatar, unknown>>;
  const temItemDaLoja = (Object.keys(TIPO_POR_CAMPO) as CampoAvatar[]).some(
    (campo) => typeof aparencia[campo] === "string",
  );
  if (!temItemDaLoja) {
    next();
    return;
  }

  let catalogo: ItemCatalogo[];
  try {
    catalogo = await buscarCatalogoDoAluno(request);
  } catch {
    next(
      new ErroAplicacao({
        codigoStatus: 502,
        codigo: CodigoDeErro.ERRO_DOWNSTREAM,
        mensagem: "Nao foi possivel verificar os itens do avatar. Tente novamente.",
      }),
    );
    return;
  }

  const naoAdquiridos = encontrarItensNaoAdquiridos(aparencia, catalogo);
  if (naoAdquiridos.length > 0) {
    next(
      new ErroAplicacao({
        codigoStatus: 403,
        codigo: CodigoDeErro.PROIBIDO,
        mensagem: "O avatar usa itens que ainda nao foram comprados na loja.",
        detalhes: { itensNaoAdquiridos: naoAdquiridos },
      }),
    );
    return;
  }

  next();
}
