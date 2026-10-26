# AnatoQuizUp BFF

**Backend-For-Frontend** do projeto **AnatoQuizUp**. É o **único endereço público** entre os serviços: o Frontend só fala com o BFF; o BFF roteia para o **Backend/Auth**, **Quiz-Service** ou **AI Service** conforme o caminho da URL.

É um **proxy 100% orquestração** — não tem regras de negócio, não tem persistência, não tem cache. Suas funções:

- Validar o JWT (assinatura/expiração) antes de repassar.
- Injetar `X-Internal-Token` (segredo compartilhado) e cabeçalhos auxiliares (`X-User-Id`, `X-User-Papel`, `X-User-Status`) nas chamadas downstream.
- Rotear por path: `/api/v1/autenticacao/*`, `/api/v1/admin/*`, `/api/v1/usuarios/*`, `/api/v1/exemplos/*` → Backend/Auth; `/api/v1/questoes/*`, `/api/v1/turmas/*` → Quiz-Service; `/api/v1/ia/*` → AI (placeholder enquanto AI estiver vazio).
- Padronizar respostas de erro vindas do downstream.

## Stack

- Node.js 24+
- TypeScript 5
- Express 5
- Axios (cliente HTTP downstream)
- Pino + pino-http (logs)
- Zod (validação de variáveis de ambiente)
- Helmet, CORS
- jsonwebtoken (validação local de access token)
- Jest + supertest (testes)

## Pré-requisitos

| Ferramenta | Versão | Como instalar |
|---|---|---|
| Node.js | ≥ 24.0.0 | https://nodejs.org/ ou `nvm install 24` |
| npm | que vem com o Node | — |
| Git | qualquer recente | https://git-scm.com/ |
| GNU Make | opcional, mas recomendado | Windows: `choco install make` ou `scoop install make`; Mac: `brew install make`; Linux: já vem |
| Backend/Auth rodando em `localhost:3333` | — | siga o README do `2026-1-AnatoQuizUp-Usuario-Service` antes de subir o BFF |
| Quiz-Service rodando em `localhost:3334` | — | necessário para fluxos de `/api/v1/questoes/*` |

## Setup local — passo a passo

### 1. Clonar e entrar no repo

```powershell
git clone https://github.com/fga-eps-mds/2026-1-AnatoQuizUp-BFF.git
cd 2026-1-AnatoQuizUp-BFF
```

### 2. Criar e preencher o `.env`

```powershell
Copy-Item .env.example .env
```

Abra o `.env` e preencha:

```dotenv
NODE_ENV=development
PORT=4000
LOG_LEVEL=info

BACKEND_URL=http://localhost:3333
QUIZ_SERVICE_URL=http://localhost:3334
AI_URL=

# !!! DEVE ser idêntico ao INTERNAL_TOKEN do Backend e do Quiz-Service !!!
INTERNAL_TOKEN=<mesmo-valor-que-está-nos-.env-dos-serviços>

# !!! DEVE ser idêntico ao JWT_SECRET_KEY do Backend !!!
JWT_SECRET_KEY=<mesmo-valor-que-está-no-.env-do-Backend>

CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
REQUEST_TIMEOUT_MS=15000
```

> ⚠️ **Erro mais comum:** divergência entre `INTERNAL_TOKEN` (ou `JWT_SECRET_KEY`) do BFF e do Backend. Sintomas:
> - **Token interno divergente** → Backend retorna 403 `PROIBIDO` "Token interno invalido."
> - **JWT_SECRET divergente** → BFF aceita o JWT (é o mesmo secret usado no login), mas se você fez login com um secret e troca o outro depois, o token vira inválido.

### 3. Instalar e rodar

```bash
npm ci
npm run dev    # sobe em http://localhost:4000
```

Verifique:

```bash
curl http://localhost:4000/health
# {"mensagem":"BFF do AnatoQuizUp em execucao.","dados":{"status":"ok","timestamp":"..."}}
```

## Atalhos com Make

```bash
make help        # lista comandos
make setup       # cp .env.example .env (se não existir) + npm ci
make dev         # tsx watch
make test        # jest
make test-ci     # jest --coverage --runInBand (gate 85%)
make lint        # eslint
make build       # tsc + tsc-alias
make clean       # apaga dist/ e coverage/
```

## Roteamento

| Prefixo público | Destino |
|---|---|
| `GET /health` | próprio BFF |
| `/api/v1/autenticacao/*` | Backend/Auth `/api/v1/autenticacao/*` |
| `/api/v1/admin/usuarios*` | Backend/Auth `/api/v1/admin/usuarios*` (autenticado) |
| `/api/v1/usuarios/*` | Backend/Auth `/api/v1/usuarios/*` (autenticado) |
| `/api/v1/exemplos/*` | Backend/Auth `/api/v1/exemplos/*` (autenticado) |
| `/api/v1/questoes/*` | Quiz-Service `/api/v1/questoes/*` (autenticado) |
| `/api/v1/quiz/*` | Quiz-Service `/api/v1/quiz/*` (autenticado) — rodadas, XP, nível e elo |
| `/api/v1/quiz/progressao/elo/historico` | Quiz-Service — rebaixamentos e recuperações do próprio aluno |
| `/api/v1/quiz/progressao/notificacoes*` | Quiz-Service — avisos de inatividade/elo do próprio aluno |
| `/api/v1/quiz/progressao/inatividade/verificar` | Quiz-Service — rotina de inatividade (**ADMINISTRADOR**) |
| `/api/v1/quiz/progressao/configuracao` | Quiz-Service — prazos da regra de inatividade (**ADMINISTRADOR**) |
| `/api/v1/turmas/*` | Quiz-Service `/api/v1/turmas/*` (autenticado) |
| `/api/v1/ia/*` | AI `/api/v1/*` — atualmente **503 `IA_INDISPONIVEL`** enquanto `AI_URL` estiver vazio |

### Rotas públicas de autenticação (sem JWT)

Em `/api/v1/autenticacao`: `/login`, `/atualizar-token`, `/cadastro`, `/recuperar-senha`, `/redefinir-senha`, `/alunos/nickname-disponivel`, `/alunos/email-disponivel`, `/alunos/nacionalidades`, `/alunos/opcoes-academicas/...`, `/alunos/localidades/...`.


Qualquer outro path de autenticação exige `Authorization: Bearer <accessToken>`.

## Headers injetados pelo BFF nas chamadas downstream

| Header | Quando | Origem |
|---|---|---|
| `X-Internal-Token` | sempre | `INTERNAL_TOKEN` do `.env` |
| `X-User-Id` | rotas autenticadas | claim `sub` do JWT |
| `X-User-Papel` | rotas autenticadas | claim `papel` do JWT |
| `X-User-Status` | rotas autenticadas | claim `status` do JWT |
| `Authorization` | sempre que recebido | preservado do request original |

> Os headers `X-User-*` são **informativos**. Backend/Auth e Quiz-Service validam o JWT e não usam esses headers como fonte de verdade para decisões críticas.

## Estrutura

```text
2026-1-AnatoQuizUp-BFF/
├── src/
│   ├── config/
│   │   ├── app.ts                   # monta Express + roteamento + middlewares globais
│   │   ├── cors.ts
│   │   ├── env.ts                   # schema Zod das vars
│   │   └── logger.ts                # Pino
│   ├── routes/
│   │   ├── admin.routes.ts          # exige JWT, repassa Backend
│   │   ├── auth.routes.ts           # rotas públicas + autenticadas, repassa Backend
│   │   ├── exemplos.routes.ts       # exige JWT, repassa Backend
│   │   ├── ia.routes.ts             # exige JWT, repassa AI (ou 503 placeholder)
│   │   ├── questoes.routes.ts       # exige JWT, repassa Quiz-Service
│   │   ├── turmas.routes.ts         # exige JWT, repassa Quiz-Service
│   │   ├── usuarios.routes.ts       # exige JWT, repassa Backend
│   │   └── index.ts                 # monta o apiRouter
│   ├── shared/
│   │   ├── clients/
│   │   │   ├── ai.client.ts         # Axios para AI (null se AI_URL vazio)
│   │   │   ├── backend.client.ts    # Axios para Backend/Auth
│   │   │   └── quiz.client.ts       # Axios para Quiz-Service
│   │   ├── constants/mensagens.ts
│   │   ├── errors/
│   │   ├── middlewares/
│   │   │   ├── autenticacao.middleware.ts   # valida JWT no BFF
│   │   │   ├── proxy.middleware.ts          # repassa request para o downstream
│   │   │   └── tratamento-erros.middleware.ts
│   │   ├── types/
│   │   └── utils/headers.ts         # filtra headers reservados antes de repassar
│   └── server.ts                    # listener + graceful shutdown
├── tests/
├── .env.example
├── Dockerfile
├── jest.config.cjs
└── tsconfig.json
```

## Variáveis de ambiente

| Variável | Obrigatória | Padrão dev | Descrição |
|---|---|---|---|
| `NODE_ENV` | não | `development` | `development` \| `test` \| `production` |
| `PORT` | não | `4000` | Porta de escuta |
| `LOG_LEVEL` | não | `info` | Nível Pino |
| `BACKEND_URL` | sim | `http://localhost:3333` | URL base do Backend/Auth (em prod, `http://${{Backend.RAILWAY_PRIVATE_DOMAIN}}:3333`) |
| `QUIZ_SERVICE_URL` | sim | `http://localhost:3334` | URL base do Quiz-Service (em prod, domínio privado do Railway) |
| `AI_URL` | não | `""` | URL base do AI; vazio enquanto AI estiver placeholder |
| `INTERNAL_TOKEN` | sim | — | Segredo compartilhado com Backend/Auth, Quiz-Service e AI |
| `JWT_SECRET_KEY` | sim | — | Mesmo segredo do Backend (validação local de access token) |
| `CORS_ORIGINS` | sim | — | Lista CSV de origens autorizadas |
| `REQUEST_TIMEOUT_MS` | não | `15000` | Timeout das chamadas downstream |

## Troubleshooting

| Sintoma | Causa | Solução |
|---|---|---|
| `503 IA_INDISPONIVEL` ao chamar `/api/v1/ia/*` | `AI_URL` vazio | Esperado enquanto o AI estiver placeholder. Para testar com AI fake, configure `AI_URL` apontando para um mock |
| `502 ERRO_DOWNSTREAM` em todas as chamadas | Backend não está rodando ou `BACKEND_URL` errado | Suba o Backend em `localhost:3333` e confirme a variável |
| `403 Token interno invalido` (visto nos logs do Backend) | `INTERNAL_TOKEN` no BFF ≠ no Backend | Garanta os mesmos valores nos dois `.env` |
| `401 Token de acesso invalido ou expirado` | JWT expirado, malformado, ou `JWT_SECRET_KEY` divergente do que assinou o token | Faça login de novo para gerar tokens novos |
| Coverage gate falha localmente | Você adicionou código sem testes | Rode `make test-ci` e veja o relatório `coverage/lcov-report/index.html` |

## Como contribuir

- Branches: Git Flow (`feature/<id>-descricao` a partir de `develop`).
- Commits: Conventional Commits.
- Cobertura mínima: **85%**.
- Lint, build e testes verdes antes do PR.

## Documentação

- [Publicação do BFF em homologação](docs/deploy-homologacao.md)
- [Doc geral do projeto](https://fga-eps-mds.github.io/2026-1-AnatoQuizUp-Doc/)
- [Guia de arquitetura para devs](https://github.com/fga-eps-mds/2026-1-AnatoQuizUp-Doc/blob/main/docs/arquitetura/guia-arquitetura-bff.md)
- [PRD da migração para BFF](https://github.com/fga-eps-mds/2026-1-AnatoQuizUp-Doc/blob/main/docs/arquitetura/prd-migracao-bff.md)

