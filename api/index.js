let application;
export default async function handler(req, res) {
  try {
    application ||= import("../server/index.js");
    const { default: app } = await application;
    return app(req, res);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "application.start_failed",
        code: typeof error.code === "string" ? error.code : "STARTUP_ERROR",
      }),
    );
    res.status(503).json({
      error:
        "A loja está temporariamente indisponível. Tente novamente em instantes.",
    });
  }
}
