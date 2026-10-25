# Publicação do BFF em homologação

O workflow **CD - Homologação BFF** publica o BFF no Railway depois que a
**CI - BFF** aprova um push na `main`. Pull requests e a branch `develop` não
publicam na homologação.

O BFF continua sendo o único ponto público da aplicação: o Web chama o BFF, e
ele encaminha as solicitações para o Usuario-Service e o Quiz-Service pela rede
privada do Railway.

## Preparar o acesso uma única vez

Uma pessoa com acesso ao projeto Railway deve:

1. Confirmar o projeto, ambiente e serviço BFF existentes em homologação e
   registrar o deploy atual para eventual retorno.
2. Configurar o health check do serviço no Railway com o caminho `/health`.
   O endpoint responde HTTP 200 quando a aplicação está pronta.
3. Conferir de onde vêm as publicações atuais. Se houver deploy automático da
   integração Git do Railway, desativá-lo antes de ativar o CD do GitHub,
   preservando serviço, variáveis e histórico de deploys.
4. Criar um **Project Token** do Railway restrito ao ambiente de homologação e
   cadastrá-lo em **Settings → Secrets and variables → Actions → Repository
   secrets**:

   | Secret          | Conteúdo                                              |
   | --------------- | ----------------------------------------------------- |
   | `RAILWAY_TOKEN` | Project Token autorizado para publicar na homologação |

5. Em **Settings → Secrets and variables → Actions → Variables**, cadastrar os
   identificadores não sensíveis do destino:

   | Variável                 | Conteúdo                                 |
   | ------------------------ | ---------------------------------------- |
   | `RAILWAY_PROJECT_ID`     | Identificador do projeto Railway         |
   | `RAILWAY_ENVIRONMENT_ID` | Identificador do ambiente de homologação |
   | `RAILWAY_SERVICE_ID`     | Identificador do serviço BFF             |

As variáveis de execução do BFF, incluindo `BACKEND_URL`, `QUIZ_SERVICE_URL`,
`JWT_SECRET_KEY`, `INTERNAL_TOKEN` e `CORS_ORIGINS`, permanecem no serviço
existente no Railway. Não registrar valores de tokens, chaves, URLs de banco ou
senhas em código, logs, issues ou pull requests.

## O que acontece após o merge

1. A CI executa lint, build, testes, cobertura e Sonar.
2. Se aprovada, o CD confirma que o SHA ainda é o commit atual da `main` e que
   há uma CI de push aprovada para esse SHA.
3. O CD instala dependências, gera o artefato `dist/server.js` e confirma sua
   presença antes de enviar o código.
4. A CLI oficial do Railway publica no projeto, ambiente e serviço configurados.
5. O workflow aguarda o Railway informar o estado saudável do deploy e falha se
   a publicação falhar, encerrar inesperadamente ou exceder o prazo.

## Repetir, validar e retornar

Para repetir a publicação do commit atual, use **Actions → CD - Homologação BFF
→ Run workflow**, selecionando `main`. A publicação só ocorre se existir uma CI
de push aprovada para esse mesmo commit.

Depois da primeira publicação, valide pelo ambiente integrado:

- conferir CI e CD aprovados em Actions;
- registrar o SHA e o identificador do deploy Railway;
- conferir `GET /health` no endereço público do BFF;
- abrir a homologação em janela anônima e executar login e uma operação que
  alcance Usuario-Service e Quiz-Service;
- confirmar que o Web continua recebendo respostas pelo BFF.

Se houver regressão, interrompa novas publicações no GitHub antes de restaurar
o deploy estável no Railway. Registre o SHA afetado e a evidência do retorno;
corrija por PR e reteste antes de reativar o fluxo. O workflow não executa
rollback automático.

## Referências

- [Issue #105](https://github.com/fga-eps-mds/2026-2-AnatoQuizUp-Doc/issues/105)
- [Ambiente de homologação](https://fga-eps-mds.github.io/2026-2-AnatoQuizUp-Doc/operacao/ambiente-homologacao/)
- [CLI do Railway](https://docs.railway.com/cli/deploying)
- [Health checks do Railway](https://docs.railway.com/deployments/healthchecks)
