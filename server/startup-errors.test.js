import test from "node:test";
import assert from "node:assert/strict";
import { startupErrorCode } from "./startup-errors.js";

test("startup diagnostics identify configuration failures without exposing values", () => {
  assert.equal(startupErrorCode(new Error("PUBLIC_BASE_URL HTTPS é obrigatória em produção")), "CONFIG_PUBLIC_BASE_URL_REQUIRED");
  assert.equal(startupErrorCode(new Error("JWT_SECRET deve ser aleatória: private-value")), "CONFIG_JWT_SECRET_WEAK");
  assert.equal(startupErrorCode(new Error("Troque a senha de exemplo do administrador antes de iniciar em produção")), "CONFIG_DEFAULT_ADMIN_PASSWORD");
  for (const error of [null, {}, new Error("database connection failed: private-value")])
    assert.equal(startupErrorCode(error), "STARTUP_ERROR");
});
