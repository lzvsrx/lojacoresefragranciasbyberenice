let application;
export default async function handler(req, res) {
  try {
    application ||= import("../server/index.js");
    const { default: app } = await application;
    return app(req, res);
  } catch (error) {
    console.error("Falha ao iniciar a aplicação:", error.message);
    res
      .status(503)
      .json({
        error:
          "A loja está temporariamente indisponível. Confira a conexão do banco e JWT_SECRET na hospedagem.",
      });
  }
}
