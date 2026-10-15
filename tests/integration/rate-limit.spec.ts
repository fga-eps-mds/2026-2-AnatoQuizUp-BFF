import request from "supertest";

jest.mock("@/config/env", () => {
  const actual = jest.requireActual("@/config/env");
  return {
    env: {
      ...actual.env,
      RATE_LIMIT_MAX: 2,
      RATE_LIMIT_WINDOW_MS: 60000,
      TRUST_PROXY_HOPS: 0,
    },
  };
});

import { aplicacao } from "@/config/app";

describe("limite de requisicoes da API", () => {
  it("preserva autenticacao, bloqueia excesso e nao aceita IP forjado", async () => {
    const path = "/api/v1/autenticacao/usuario-atual";
    await request(aplicacao).get(path).expect(401);
    await request(aplicacao).get(path).expect(401);

    const blocked = await request(aplicacao).get(path).expect(429);
    expect(blocked.body.erro.codigo).toBe("LIMITE_DE_REQUISICOES");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);

    await request(aplicacao)
      .get(path)
      .set("X-Forwarded-For", "203.0.113.42")
      .expect(429);

    // A cota e compartilhada entre rotas da API, sem limitar o health check.
    await request(aplicacao).get("/api/v1/questoes").expect(429);
    await request(aplicacao).get("/health").expect(200);
    await request(aplicacao).get("/health").expect(200);
  });
});
