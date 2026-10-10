// Validate before committing state so an unexpected API response cannot crash
// the products screen during rendering.
export function parseProductData(products, movements, losses) {
  if (
    !Array.isArray(products) ||
    products.some((item) => !item || typeof item !== "object") ||
    !Array.isArray(movements) ||
    movements.some((item) => !item || typeof item !== "object") ||
    !losses ||
    !Array.isArray(losses.items) ||
    losses.items.some((item) => !item || typeof item !== "object") ||
    !Number.isFinite(Number(losses.total_cents))
  ) {
    throw new Error(
      "Não foi possível carregar os produtos e o histórico. Tente novamente.",
    );
  }
  return { products, movements, losses };
}
