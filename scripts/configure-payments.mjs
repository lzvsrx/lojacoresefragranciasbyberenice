import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { parseEnv } from "node:util";
import {
  mercadoPagoConfig,
  mercadoPagoRequest,
} from "../server/mercado-pago.js";

const args = process.argv.slice(2);
const file = ".env";
const baseArgument = args
  .find((arg) => arg.startsWith("--base-url="))
  ?.slice(11);
const defaultBase =
  baseArgument || "https://lojacoresefragranciasbyberenice.vercel.app";
const url = new URL(defaultBase);
if (
  url.protocol !== "https:" ||
  url.pathname !== "/" ||
  url.username ||
  url.password ||
  url.search ||
  url.hash
)
  throw new Error("Use somente uma origem HTTPS válida");
let local = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
if (args.includes("--init")) {
  const defaults = {
    PUBLIC_BASE_URL: url.origin,
    JWT_SECRET: randomBytes(48).toString("hex"),
    CRON_SECRET: randomBytes(32).toString("hex"),
    MERCADO_PAGO_PUBLIC_KEY: "",
    MERCADO_PAGO_ACCESS_TOKEN: "",
    MERCADO_PAGO_WEBHOOK_SECRET: "",
    MERCADO_PAGO_SANDBOX: "true",
    MERCADO_PAGO_AUTO_REFUND_FRAUD: "true",
    MERCADO_PAGO_STATEMENT_DESCRIPTOR: "CORESBERENICE",
    MERCADO_PAGO_INTEGRATOR_ID: "",
    MERCADO_PAGO_CATEGORY_ID: "others",
  };
  const additions = Object.entries(defaults).filter(
    ([key]) => local[key] === undefined,
  );
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (additions.length)
    writeFileSync(
      file,
      current +
        (current.endsWith("\n") || !current ? "" : "\n") +
        "\n# Configuração privada de pagamentos; nunca publicar este arquivo.\n" +
        additions.map(([key, value]) => `${key}=${value}`).join("\n") +
        "\n",
      { mode: 0o600 },
    );
  local = parseEnv(readFileSync(file, "utf8"));
  console.log(
    "Arquivo .env preparado. Valores existentes foram preservados; os segredos gerados não são exibidos.",
  );
}
const env = { ...local, ...process.env };
const config = mercadoPagoConfig(env);
const checks = [
  ["PUBLIC_BASE_URL HTTPS", Boolean(config.base)],
  [
    "JWT_SECRET forte",
    Boolean(
      env.JWT_SECRET &&
      Buffer.byteLength(env.JWT_SECRET) >= 48 &&
      new Set(env.JWT_SECRET).size >= 16 &&
      !/substitua|change.?me|example/i.test(env.JWT_SECRET),
    ),
  ],
  [
    "CRON_SECRET",
    Boolean(env.CRON_SECRET && Buffer.byteLength(env.CRON_SECRET) >= 32),
  ],
  ["MERCADO_PAGO_PUBLIC_KEY", Boolean(config.publicKey)],
  ["MERCADO_PAGO_ACCESS_TOKEN", Boolean(config.token)],
  ["MERCADO_PAGO_WEBHOOK_SECRET", Boolean(config.secret)],
];
if (args.includes("--production"))
  checks.push(
    [
      "Turso persistente autenticado",
      Boolean(
        env.TURSO_DATABASE_URL &&
        !env.TURSO_DATABASE_URL.startsWith("file:") &&
        env.TURSO_AUTH_TOKEN,
      ),
    ],
    ["Modo produtivo", !config.sandbox],
  );
for (const [name, ok] of checks)
  console.log(`${ok ? "OK" : "PENDENTE"} ${name}`);
if (config.base)
  console.log(`Webhook: ${config.base}/api/mercado-pago/webhook`);
console.log(`Ambiente: ${config.sandbox ? "TESTE" : "PRODUÇÃO"}`);
if (args.includes("--verify")) {
  if (!config.configured)
    console.log(
      "Verificação da conta pendente: preencha as credenciais privadas no .env ou no ambiente.",
    );
  else {
    try {
      const account = await mercadoPagoRequest("/users/me", { config });
      console.log(
        `Conta consultada com sucesso. Região: ${account.site_id || "não informada"}; conta de teste: ${Boolean(account.tags?.includes("test_user"))}.`,
      );
      if (account.site_id !== "MLB") process.exitCode = 1;
    } catch {
      console.log(
        "Não foi possível verificar a conta. Revise as credenciais e a conectividade; nenhum segredo foi exibido.",
      );
      process.exitCode = 1;
    }
  }
}
if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
