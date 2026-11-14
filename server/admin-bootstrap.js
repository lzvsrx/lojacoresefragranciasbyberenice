import bcrypt from "bcryptjs";

// Deployment-only recovery of the publicly known seed password. Existing
// non-default passwords can never be reset through this mechanism.
export async function protectDefaultAdmin(db, env = process.env) {
  const initialAdmin = await db
    .prepare("SELECT password FROM users WHERE username='admin'")
    .get();
  if (
    !initialAdmin ||
    !(await bcrypt.compare("admin123", initialAdmin.password))
  )
    return false;
  const replacement = env.ADMIN_BOOTSTRAP_PASSWORD_HASH;
  const cost = Number(replacement?.slice(4, 6));
  if (
    !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(replacement || "") ||
    cost < 12 ||
    cost > 16 ||
    (await bcrypt.compare("admin123", replacement))
  )
    throw new Error(
      "Troque a senha de exemplo do administrador antes de iniciar em produção",
    );
  const result = await db
    .prepare(
      "UPDATE users SET password=?, session_version=session_version+1 WHERE username='admin' AND password=?",
    )
    .run(replacement, initialAdmin.password);
  return result.changes === 1;
}
