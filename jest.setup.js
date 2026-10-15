process.env.NODE_ENV ||= "test";
process.env.PORT ||= "4000";
process.env.LOG_LEVEL ||= "silent";
process.env.BACKEND_URL ||= "http://localhost:3333";
process.env.AI_URL ||= "";
process.env.INTERNAL_TOKEN ||= "test-internal-token";
process.env.JWT_SECRET_KEY ||= "test-secret";
// A suíte usa uma origem fixa, independente do ambiente que executa o Jest.
process.env.CORS_ORIGINS = "http://localhost:5173";
process.env.REQUEST_TIMEOUT_MS ||= "15000";
