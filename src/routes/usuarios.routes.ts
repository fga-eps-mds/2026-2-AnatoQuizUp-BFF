import { Router } from "express";

import { validarPosseItensAvatar } from "@/modules/avatar/posse-avatar";
import { backendClient } from "@/shared/clients/backend.client";
import { middlewareAutenticacao } from "@/shared/middlewares/autenticacao.middleware";
import { criarProxyHandler } from "@/shared/middlewares/proxy.middleware";

const router = Router();

// Rotas de usuarios: autenticadas e repassadas ao Usuario-Service (perfil, listagens etc.).
router.use(middlewareAutenticacao);
// Antes de salvar o avatar, confere no Quiz-Service se os itens da loja equipados
// foram comprados pelo aluno; so entao a requisicao segue para o proxy abaixo.
router.put("/meu-avatar", validarPosseItensAvatar);
router.all(/.*/, criarProxyHandler(backendClient));

export { router as usuariosRouter };
