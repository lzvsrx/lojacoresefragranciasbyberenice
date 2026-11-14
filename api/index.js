import { startupErrorCode } from "../server/startup-errors.js";

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
        code: typeof error.code === "string" ? error.code : startupErrorCode(error),
      }),
    );
    res.status(503).json({
      error:
        "A loja está temporariamente indisponível. Tente novamente em instantes.",
    });
  }
}
