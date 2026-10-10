export const normalizeSearch = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();

export function matchesProduct(product, query) {
  const haystack = normalizeSearch(
    [product.id, product.name, product.brand, product.type, product.style].join(
      " ",
    ),
  );
  return normalizeSearch(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}
