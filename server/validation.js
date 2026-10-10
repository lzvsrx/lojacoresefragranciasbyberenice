export function inputError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

export function text(value, max = 150) {
  return String(value ?? "")
    .trim()
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .slice(0, max);
}

export function dateValue(value) {
  if (value == null || value === "") return null;
  const raw = String(value).trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : raw;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso))
    throw inputError("Data inválida. Use AAAA-MM-DD ou DD/MM/AAAA");
  const date = new Date(`${iso}T12:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== iso
  )
    throw inputError("Data inválida");
  return iso;
}

export function numberValue(
  value,
  label,
  { integer = false, min = 0, max = 1e9 } = {},
) {
  if (
    value == null ||
    typeof value === "boolean" ||
    !["number", "string"].includes(typeof value) ||
    String(value).trim() === ""
  )
    throw inputError(`${label} inválido(a)`);
  const number = Number(value);
  if (
    !Number.isFinite(number) ||
    number < min ||
    number > max ||
    (integer && !Number.isSafeInteger(number))
  )
    throw inputError(`${label} inválido(a)`);
  return number;
}

export function productInput(body = {}) {
  const name = text(body.name, 200);
  if (!name) throw inputError("Informe o nome do produto");
  return {
    name,
    brand: text(body.brand, 100),
    style: text(body.style, 100),
    type: text(body.type, 100),
    price: numberValue(body.price, "Preço"),
    quantity: numberValue(body.quantity, "Quantidade", { integer: true }),
    expiration_date: dateValue(body.expiration_date),
  };
}
