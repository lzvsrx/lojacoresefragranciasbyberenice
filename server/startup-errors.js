// Only fixed diagnostic identifiers leave the process, never exception messages.
export function startupErrorCode(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  const known = [
    [/^PUBLIC_BASE_URL HTTPS/, "CONFIG_PUBLIC_BASE_URL_REQUIRED"],
    [/^Origem pública inválida|^As origens devem/, "CONFIG_ORIGIN_INVALID"],
    [/^TRUST_PROXY_HOPS/, "CONFIG_PROXY_INVALID"],
    [/^JWT_SECRET deve/, "CONFIG_JWT_SECRET_WEAK"],
    [/^JWT_SECRET é obrigatória/, "CONFIG_JWT_SECRET_REQUIRED"],
    [/^Produção na Vercel exige banco/, "CONFIG_DATABASE_REQUIRED"],
    [/^Configure TURSO_AUTH_TOKEN/, "CONFIG_DATABASE_TOKEN_REQUIRED"],
    [/^Banco local ausente/, "CONFIG_LOCAL_DATABASE_MISSING"],
    [/^Troque a senha de exemplo/, "CONFIG_DEFAULT_ADMIN_PASSWORD"],
  ];
  return known.find(([pattern]) => pattern.test(message))?.[1] || "STARTUP_ERROR";
}
