// Captures real UI in an isolated demo database; never opens store.db.
import { mkdtempSync, mkdirSync, existsSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { buildCaptureGuide } from "./build-capture-guide.mjs";
import { commerceDefaults, POLICY_VERSION } from "../server/commerce.js";
import { storeToday } from "../src/expiration.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output = path.join(root, "docs/capturas");
mkdirSync(output, { recursive: true });
const folder = mkdtempSync(path.join(tmpdir(), "corese-capturas-"));
process.env.DATABASE_PATH = path.join(folder, "store.db");
process.env.NODE_ENV = "test";
delete process.env.VERCEL;
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
const source = new Database(path.join(root, "server/data/store.db"), {
  readonly: true,
});
const setup = new Database(process.env.DATABASE_PATH);
for (const row of source
  .prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
  )
  .all())
  setup.exec(row.sql);
const photos = source
  .prepare("SELECT image FROM products WHERE length(image)>0 LIMIT 6")
  .all();
source.close();
const password = randomUUID() + "Aa1";
setup
  .prepare(
    "INSERT INTO users(username,password,role,name,email) VALUES(?,?,?,?,?)",
  )
  .run(
    "admin",
    bcrypt.hashSync(password, 4),
    "admin",
    "Administrador Demonstração",
    "equipe@example.test",
  );
setup.close();
const { default: app, database: db } = await import("../server/index.js");
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const fallback = path.join(
  tmpdir(),
  "corese-browser-check/node_modules/playwright/index.mjs",
);
let playwright;
try {
  playwright = await import("playwright");
} catch {
  const modulePath = process.env.PLAYWRIGHT_MODULE || fallback;
  if (!existsSync(modulePath))
    throw Error(
      "Instale Playwright em uma pasta temporária e informe PLAYWRIGHT_MODULE (caminho de index.mjs).",
    );
  playwright = await import(pathToFileURL(modulePath));
}
const browser = await playwright.chromium.launch({
  channel: "msedge",
  headless: true,
});
const captures = [],
  errors = [];
const page = await browser.newPage({
  viewport: { width: 1440, height: 1080 },
  deviceScaleFactor: 1,
});
page.setDefaultTimeout(15000);
page.on("pageerror", (error) => errors.push(error.message));
page.on("dialog", (dialog) => dialog.dismiss());
let adminToken,
  clientToken,
  staffToken,
  customer,
  products = [],
  pendingOrder,
  paidOrder;
const request = async (url, method = "GET", body, token = adminToken) => {
  const response = await fetch(origin + "/api" + url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok)
    throw Error(
      `${method} ${url}: ${response.status} ${await response.text()}`,
    );
  return response.json();
};
let navigation = 0;
const goto = async (route) => {
  await page.goto(origin + "/?captura=" + ++navigation + "#" + route);
  await page.waitForTimeout(400);
};
const nav = async (title) => {
  await page
    .locator(".sidebar")
    .getByRole("button", { name: title, exact: true })
    .click();
  await page.waitForTimeout(350);
};
const closeModal = async () => {
  await page.locator(".modal-title button").click();
};
const mark = {
  nav: [".store-header", "Navegação da loja"],
  footer: [".store-footer", "Contato e políticas"],
  side: [".sidebar", "Menu administrativo"],
  form: ["form", "Formulário e ações"],
  modal: [".modal", "Formulário aberto"],
  main: [".commerce-page", "Conteúdo desta área"],
};
async function capture(
  slug,
  title,
  area,
  route,
  parts,
  { fullPage = true, section } = {},
) {
  const number = String(captures.length + 1).padStart(2, "0"),
    filename = `${number}-${slug}.png`;
  const originalViewport = page.viewportSize();
  const modal = page.locator(".modal");
  if ((await modal.count()) && (await modal.isVisible())) {
    const contentHeight = await modal.evaluate((el) => el.scrollHeight);
    await page.setViewportSize({
      ...originalViewport,
      height: Math.max(
        originalViewport.height,
        Math.ceil((contentHeight + 200) / 0.92),
      ),
    });
  }
  await page.evaluate(() =>
    document.querySelectorAll("[data-capture]").forEach((e) => e.remove()),
  );
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images).map((i) =>
        i.complete
          ? Promise.resolve()
          : new Promise((r) => {
              i.onload = r;
              i.onerror = r;
              setTimeout(r, 1500);
            }),
      ),
    );
  });
  await page.evaluate(() => {
    document
      .querySelectorAll('img[loading="lazy"]')
      .forEach((i) => (i.loading = "eager"));
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(250);
  if (section) await page.locator(section).first().scrollIntoViewIfNeeded();
  const legend = [];
  for (const [selector, label] of parts) {
    const el = page.locator(selector).first();
    if ((await el.count()) && (await el.isVisible())) {
      legend.push({ selector, label, number: legend.length + 1 });
    }
  }
  await page.evaluate(
    ({ number, title, area, legend, section }) => {
      const style = document.createElement("style");
      style.dataset.capture = "true";
      style.textContent = `[data-capture]{box-sizing:border-box;font-family:Arial,sans-serif!important} .capture-heading{position:relative;z-index:2147483646;background:#2f241d;color:white;padding:15px 24px;font-size:13px;line-height:1.6} .capture-heading b{font-size:21px;display:block}.capture-heading small{color:#f1cfa7}.capture-outline{position:absolute;border:2px solid #b96413;border-radius:6px;pointer-events:none;z-index:2147483645}.capture-outline span{position:absolute;left:2px;top:2px;background:#ad5307;color:white;border:2px solid white;border-radius:50%;width:24px;height:24px;text-align:center;font:700 13px/20px Arial!important}@media(max-width:500px){.capture-heading{padding:12px;font-size:10px}.capture-heading b{font-size:17px}}`;
      document.head.append(style);
      const header = document.createElement("div");
      header.dataset.capture = "true";
      header.className = "capture-heading";
      const b = document.createElement("b");
      b.textContent = `${number} · ${title}`;
      header.append(b);
      const small = document.createElement("small");
      small.textContent = `${area} · Dados fictícios de demonstração · Marcações apenas nesta captura`;
      header.append(small);
      const line = document.createElement("div");
      line.textContent = legend
        .map((p) => `${p.number}. ${p.label}`)
        .join("   |   ");
      header.append(line);
      document.body.prepend(header);
      for (const item of legend) {
        const el = document.querySelector(item.selector);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const box = document.createElement("div");
        box.dataset.capture = "true";
        box.className = "capture-outline";
        Object.assign(box.style, {
          left: Math.max(0, rect.left + scrollX) + "px",
          top: rect.top + scrollY + "px",
          width:
            Math.min(rect.width, innerWidth - Math.max(0, rect.left)) + "px",
          height: rect.height + "px",
        });
        const badge = document.createElement("span");
        badge.textContent = item.number;
        box.append(badge);
        document.body.append(box);
      }
      if (!section) window.scrollTo(0, 0);
    },
    { number, title, area, legend, section },
  );
  // Section captures retain their own title in the guide and focus the relevant panel.
  if (section) {
    await page
      .locator(section)
      .first()
      .screenshot({ path: path.join(output, filename) });
  } else await page.screenshot({ path: path.join(output, filename), fullPage });
  await page.evaluate(() =>
    document.querySelectorAll("[data-capture]").forEach((e) => e.remove()),
  );
  captures.push({
    number,
    title,
    area,
    route,
    file: filename,
    viewport: page.viewportSize(),
    parts: legend.map(({ number, label }) => ({ number, label })),
    focus: section || null,
  });
  if (page.viewportSize().height !== originalViewport.height)
    await page.setViewportSize(originalViewport);
  console.log(`${number} ${title}`);
}
try {
  adminToken = (
    await request("/login", "POST", { username: "admin", password }, null)
  ).token;
  const registered = await request(
    "/customer/register",
    "POST",
    {
      name: "Marina Demonstração",
      username: "cliente.demo",
      email: "cliente@example.test",
      password,
    },
    null,
  );
  clientToken = registered.token;
  customer = registered.user;
  await request("/users", "POST", {
    name: "Equipe Demonstração",
    username: "equipe.demo",
    role: "funcionario",
    password,
    email: "funcionario@example.test",
  });
  staffToken = (
    await request(
      "/login",
      "POST",
      { username: "equipe.demo", password, portal: "admin" },
      null,
    )
  ).token;
  const today = storeToday(),
    plus = (days) =>
      new Date(new Date(today + "T12:00:00Z").getTime() + days * 86400000)
        .toISOString()
        .slice(0, 10);
  const list = [
    ["Perfume Floral 100 ml", 129.9, 15, plus(365), "Perfumaria"],
    ["Hidratante Corporal 200 ml", 49.9, 4, plus(15), "Cuidados"],
    ["Batom Rosa 4 g", 32.9, 12, plus(365), "Maquiagem"],
    ["Sabonete Líquido 250 ml", 29.9, 0, plus(365), "Cuidados"],
    ["Creme Facial 50 g — lote vencido", 69.9, 3, plus(-15), "Cuidados"],
    ["Loção Corporal 200 ml — retirada", 45.9, 2, plus(-30), "Cuidados"],
  ];
  for (let i = 0; i < list.length; i++) {
    const [name, price, quantity, expiration_date, type] = list[i];
    const p = await request("/products", "POST", {
      name,
      price,
      quantity,
      expiration_date,
      type,
      brand: "Coleção Demonstração",
      style: "Seleção ilustrativa",
    });
    products.push({ id: p.id, name, price, quantity });
    if (photos[i])
      await db
        .prepare("UPDATE products SET image=? WHERE id=?")
        .run(photos[i].image, p.id);
    await request(`/product-details/${p.id}`, "PUT", {
      description:
        "Produto ilustrativo para apresentar as telas do projeto. Não constitui uma oferta real.",
      composition:
        "Informação fictícia de demonstração. Consulte os ingredientes no rótulo do produto real.",
      precautions:
        "Uso externo. Siga as instruções do fabricante. Dados usados apenas nesta demonstração.",
      volume: name.match(/\d+ (?:ml|g)/)?.[0] || "1 unidade",
      manufacturer: "Fabricante ilustrativo",
      anvisa_reference: "Conferência aplicável ao produto real",
    });
  }
  await request("/expiration-losses", "POST", {
    product_ids: [products[5].id],
  });
  await request("/shop", "PUT", {
    ...commerceDefaults,
    legal_name: "Fornecedor fictício para demonstração",
    document: "11222333000181",
    email: "loja@example.test",
    hours: "Segunda a sexta, 9h às 18h (demonstração)",
    checkout_enabled: true,
    delivery_enabled: true,
    delivery_region: "Varginha — região ilustrativa",
    cep_start: "37000000",
    cep_end: "37999999",
    delivery_fee_cents: 1000,
  });
  const methods = await request("/shop/payment-methods"),
    cash = methods.find((m) => m.name === "Dinheiro").id;
  await request("/sales", "POST", {
    product_id: products[0].id,
    customer_id: customer.id,
    quantity: 1,
    payment_method_id: cash,
    amount_received: 150,
  });
  const createOrder = () =>
    request(
      "/customer/orders",
      "POST",
      {
        idempotency_key: randomUUID(),
        items: [{ id: products[0].id, quantity: 1 }],
        payment_method_id: cash,
        fulfillment: { type: "pickup" },
        expected_total_cents: 12990,
        policy_version: POLICY_VERSION,
        accepted: true,
      },
      clientToken,
    );
  pendingOrder = await createOrder();
  paidOrder = await createOrder();
  await request(`/online-orders/${paidOrder.id}/status`, "POST", {
    status: "Pago",
    reference: "DEMO-CAIXA",
    confirmed: true,
  });
  await request(`/online-orders/${paidOrder.id}/status`, "POST", {
    status: "Em separação",
    note: "Equipe preparando os produtos (demonstração).",
  });
  const ticket = await request(
    "/customer/requests",
    "POST",
    {
      kind: "Atendimento",
      order_id: pendingOrder.id,
      message:
        "Gostaria de confirmar o horário de retirada do meu pedido de demonstração.",
    },
    clientToken,
  );
  await request(`/service-requests/${ticket.id}`, "PUT", {
    status: "Respondido",
    response:
      "Olá, Marina! Nesta demonstração, a retirada pode ser combinada com a equipe após a confirmação do pagamento.",
  });
  await request(
    "/customer/requests",
    "POST",
    {
      kind: "Privacidade",
      message:
        "Gostaria de informações sobre os dados mantidos no meu cadastro de demonstração.",
    },
    clientToken,
  );

  await goto("/loja");
  await page.locator(".store-product-grid article").first().waitFor();
  await capture(
    "loja-principal",
    "Página principal da loja",
    "Público",
    "#/loja",
    [
      mark.nav,
      [".store-hero", "Apresentação e acessos"],
      [".store-products", "Catálogo, busca e filtros"],
      mark.footer,
    ],
  );
  await page
    .getByPlaceholder("Busque por produto, marca, categoria ou estilo")
    .fill("Floral");
  await page.waitForTimeout(700);
  await capture(
    "pesquisa-produtos",
    "Pesquisa e filtros de produtos",
    "Público",
    "#/loja",
    [[".store-products", "Pesquisa, filtros e resultados"], mark.nav],
  );
  await goto(`/produto/${products[0].id}`);
  await page.locator("dl").waitFor();
  await capture(
    "detalhes-produto",
    "Detalhes do produto",
    "Público",
    `#/produto/${products[0].id}`,
    [
      mark.nav,
      ["dl", "Descrição, composição e cuidados"],
      [".commerce-page > button", "Adicionar à sacola"],
    ],
  );
  await goto("/cliente/entrar");
  await capture(
    "login-cliente",
    "Login do cliente",
    "Cliente",
    "#/cliente/entrar",
    [
      mark.nav,
      [".customer-access-story", "Apresentação da área do cliente"],
      [".customer-access-form", "Usuário, senha e ajuda"],
    ],
  );
  await goto("/cliente/cadastrar");
  await capture(
    "cadastro-cliente",
    "Cadastro público de cliente",
    "Cliente",
    "#/cliente/cadastrar",
    [
      [".customer-access-form", "Dados de cadastro e senha"],
      [".store-fineprint", "Aviso de privacidade"],
    ],
  );
  await goto("/cliente");
  await capture(
    "conta-sem-login",
    "Área do cliente sem sessão",
    "Cliente",
    "#/cliente",
    [[".store-account", "Pedido de autenticação"], mark.nav],
  );
  await goto("/sacola");
  await capture("sacola-vazia", "Sacola vazia", "Cliente", "#/sacola", [
    [".store-empty", "Estado vazio e retorno ao catálogo"],
    mark.nav,
  ]);
  await goto("/atendimento");
  await capture(
    "atendimento-sem-login",
    "Atendimento sem login",
    "Público",
    "#/atendimento",
    [mark.main, mark.footer],
  );
  for (const [type, title] of [
    ["compra", "Identificação e condições de compra"],
    ["entrega", "Entrega e pagamento"],
    ["devolucoes", "Trocas, devoluções e arrependimento"],
    ["privacidade", "Privacidade e direitos do cliente"],
  ]) {
    await goto(`/politicas/${type}`);
    await page.locator(".commerce-card").first().waitFor();
    await capture(
      `politica-${type}`,
      title,
      "Políticas públicas",
      `#/politicas/${type}`,
      [
        mark.nav,
        [".commerce-page > nav", "Navegação entre políticas"],
        [".commerce-card", "Identificação do fornecedor"],
        [".commerce-page > .button", "Canal de solicitação"],
      ],
    );
  }
  await page.evaluate(
    ({ token, cart }) => {
      localStorage.setItem("customerToken", token);
      localStorage.setItem("customerCart", JSON.stringify(cart));
    },
    {
      token: clientToken,
      cart: [
        { ...products[0], quantity: 1 },
        { ...products[2], quantity: 2 },
      ],
    },
  );
  await goto("/cliente");
  await page.locator(".store-account-details").waitFor();
  await capture(
    "minha-conta",
    "Minha conta de cliente",
    "Cliente autenticado",
    "#/cliente",
    [
      [".store-account-details", "Cadastro do cliente"],
      [".store-account-actions", "Pedidos, sacola, dados e saída"],
      mark.nav,
    ],
  );
  await goto("/sacola");
  await page
    .getByRole("button", { name: "Conferir valores e disponibilidade" })
    .click();
  await page.locator(".store-confirmed").waitFor();
  await capture(
    "sacola-preenchida",
    "Sacola com produtos e conferência",
    "Cliente autenticado",
    "#/sacola",
    [
      [".store-cart-item", "Produtos, quantidades e remoção"],
      [".store-cart-summary", "Resumo e finalização"],
      mark.nav,
    ],
  );
  await goto("/checkout");
  await page
    .getByLabel("Forma de pagamento", { exact: true })
    .selectOption(String(cash));
  await capture(
    "checkout-retirada",
    "Checkout — retirada e pagamento",
    "Cliente autenticado",
    "#/checkout",
    [
      [".commerce-grid > div:first-child", "Cliente, retirada e pagamento"],
      [".commerce-grid > div:last-child", "Resumo e total"],
    ],
  );
  await page
    .getByLabel("Recebimento", { exact: true })
    .selectOption("delivery");
  for (const [key, value] of [
    ["CEP", "37010-100"],
    ["Rua", "Rua de Demonstração"],
    ["Número", "100"],
    ["Bairro", "Centro"],
    ["Cidade", "Varginha"],
    ["UF", "MG"],
  ])
    await page.getByLabel(key, { exact: true }).fill(value);
  await capture(
    "checkout-entrega",
    "Checkout — endereço e frete",
    "Cliente autenticado",
    "#/checkout",
    [
      [".commerce-grid > div:first-child", "Endereço e região atendida"],
      [".commerce-grid > div:last-child", "Produtos, frete e total"],
    ],
  );
  await page.getByRole("button", { name: "Revisar e continuar" }).click();
  await capture(
    "checkout-confirmacao",
    "Checkout — revisão e aceite",
    "Cliente autenticado",
    "#/checkout",
    [
      [".commerce-grid > div:last-child", "Total, condições e confirmação"],
      [".commerce-check", "Aceite das condições"],
    ],
  );
  await goto("/pedidos");
  await page.locator(".commerce-order-link").first().waitFor();
  await capture(
    "meus-pedidos",
    "Lista de pedidos do cliente",
    "Cliente autenticado",
    "#/pedidos",
    [
      [".commerce-actions", "Atualizar consulta"],
      [".commerce-order-link", "Número, data, situação e total"],
      mark.nav,
    ],
  );
  for (const [o, slug, title] of [
    [pendingOrder, "pedido-pendente", "Pedido aguardando pagamento"],
    [paidOrder, "pedido-em-separacao", "Pedido pago em separação"],
  ]) {
    await goto(`/pedidos/${o.id}`);
    await page.getByRole("heading", { name: "Acompanhamento" }).waitFor();
    await capture(slug, title, "Cliente autenticado", `#/pedidos/${o.id}`, [
      [".commerce-actions", "Voltar, imprimir e atualizar"],
      [
        ".commerce-grid > div:first-child",
        "Produtos, total, entrega e fornecedor",
      ],
      [".commerce-grid > div:last-child", "Histórico e atendimento"],
    ]);
  }
  await goto("/atendimento");
  await page.getByRole("heading", { name: "Nova solicitação" }).waitFor();
  await capture(
    "atendimento-cliente",
    "Atendimento, cadastro e protocolos",
    "Cliente autenticado",
    "#/atendimento",
    [
      [".commerce-grid > form:first-child", "Abrir solicitação"],
      [".commerce-grid > form:last-child", "Corrigir cadastro e baixar dados"],
      ["#customer-password-form", "Trocar senha"],
      ["article.commerce-card", "Protocolo e resposta"],
    ],
  );
  await capture(
    "alterar-senha",
    "Alteração de senha do cliente",
    "Cliente autenticado",
    "#/atendimento",
    [["#customer-password-form", "Senha atual, nova senha e confirmação"]],
    { section: "#customer-password-form" },
  );
  await goto("/admin");
  await page.locator(".login-card").waitFor();
  await capture(
    "login-administrativo",
    "Login administrativo e acessos da loja",
    "Equipe",
    "#/admin",
    [
      [".login-card form", "Login da equipe"],
      [".login-customer-links", "Página principal e acessos de cliente"],
      [".login-art", "Identidade e contatos"],
    ],
  );
  await goto("/admin/cadastros");
  await capture(
    "acesso-cadastro-equipe",
    "Acesso protegido ao cadastro da equipe",
    "Equipe",
    "#/admin/cadastros",
    [
      [".login-card", "Orientação e autenticação administrativa"],
      [".login-customer-links", "Acessos públicos"],
    ],
  );
  await page.evaluate(
    (token) => localStorage.setItem("token", token),
    adminToken,
  );
  await goto("/admin");
  await page.locator(".stats").first().waitFor();
  await capture(
    "painel-administrativo",
    "Painel — vendas, estoque e perdas",
    "Administrador",
    "#/admin",
    [
      mark.side,
      [".stats", "Indicadores e perdas por vencimento"],
      [".chart", "Evolução das vendas"],
      [".low-list", "Atenção ao estoque"],
    ],
  );
  await nav("Produtos & estoque");
  await page.locator(".row-actions").first().waitFor();
  await capture(
    "produtos-estoque",
    "Produtos e estoque",
    "Administrador",
    "Menu: Produtos & estoque",
    [
      mark.side,
      [".actions", "PDF, CSV e novo produto"],
      [".expiration-alerts", "Alertas de validade"],
      [".row-actions", "Vender, estoque, editar e excluir"],
    ],
  );
  await page.locator(".expiration-alerts").evaluate((e) => (e.open = true));
  await page
    .locator(".stock-history")
    .first()
    .evaluate((e) => (e.open = true));
  await capture(
    "validade-perdas",
    "Alertas e perdas por vencimento",
    "Administrador",
    "Menu: Produtos & estoque",
    [
      [".expiration-alerts", "Vencidos e próximos do vencimento"],
      [".stock-history", "Histórico de retiradas e valores perdidos"],
    ],
  );
  await page
    .locator(".stock-history")
    .last()
    .evaluate((e) => (e.open = true));
  await capture(
    "movimentacoes-estoque",
    "Histórico de movimentações de estoque",
    "Administrador",
    "Menu: Produtos & estoque",
    [[".stock-history:last-child", "Entradas, saídas, vendas e reservas"]],
    { section: ".stock-history:last-child" },
  );
  await page.getByRole("button", { name: "Novo produto", exact: true }).click();
  await capture(
    "novo-produto",
    "Cadastro de novo produto",
    "Administrador",
    "Produtos > Novo produto",
    [mark.modal, [".modal .form-actions", "Cancelar ou salvar"]],
    { fullPage: false },
  );
  await closeModal();
  const row = page
    .locator("tbody tr")
    .filter({ has: page.getByRole("button", { name: "Vender", exact: true }) })
    .filter({ hasText: "Perfume Floral 100 ml" });
  await row.getByRole("button", { name: "Editar", exact: true }).click();
  await capture(
    "editar-produto",
    "Edição do produto",
    "Administrador",
    "Produtos > Editar",
    [mark.modal],
    { fullPage: false },
  );
  await closeModal();
  await row.getByRole("button", { name: "Estoque", exact: true }).click();
  await capture(
    "movimentar-estoque",
    "Entrada, saída e ajuste de estoque",
    "Administrador",
    "Produtos > Estoque",
    [
      [".stock-product-summary", "Produto e saldo atual"],
      [".modal form", "Operação, quantidade e motivo"],
    ],
    { fullPage: false },
  );
  await closeModal();
  await row.getByRole("button", { name: "Vender", exact: true }).click();
  await page.locator(".payment-details").waitFor();
  await capture(
    "vender-produto",
    "Venda direta a partir do produto",
    "Administrador",
    "Produtos > Vender",
    [
      mark.modal,
      [".payment-details", "Pagamento e instruções"],
      [".order-summary", "Total e troco"],
    ],
    { fullPage: false },
  );
  await closeModal();
  await nav("Clientes & equipe");
  await page
    .getByRole("heading", { name: "Administração de clientes" })
    .waitFor();
  await capture(
    "clientes",
    "Administração de clientes",
    "Administrador",
    "Menu: Clientes & equipe > Clientes",
    [
      [".admin-summary", "Clientes, equipe e aniversários"],
      [".page-tabs", "Pedidos, clientes e equipe"],
      [".table-wrap", "Cadastros e ações"],
    ],
  );
  await page
    .getByRole("button", { name: "Novo cadastro", exact: true })
    .click();
  await capture(
    "novo-cadastro-cliente",
    "Novo cadastro — cliente",
    "Administrador",
    "Clientes & equipe > Novo cadastro",
    [mark.modal, [".permission-preview", "Permissões do perfil cliente"]],
    { fullPage: false },
  );
  await page.locator(".modal select").first().selectOption("funcionario");
  await capture(
    "novo-cadastro-funcionario",
    "Novo cadastro — funcionário",
    "Administrador",
    "Clientes & equipe > Novo cadastro > Funcionário",
    [mark.modal, [".permission-preview", "Permissões do funcionário"]],
    { fullPage: false },
  );
  await page.locator(".modal select").first().selectOption("admin");
  await capture(
    "novo-cadastro-administrador",
    "Novo cadastro — administrador",
    "Administrador",
    "Clientes & equipe > Novo cadastro > Administrador",
    [mark.modal, [".permission-preview", "Permissões do administrador"]],
    { fullPage: false },
  );
  await closeModal();
  await page
    .getByRole("button", { name: "Editar", exact: true })
    .first()
    .click();
  await capture(
    "editar-cliente",
    "Edição de cadastro e preferências",
    "Administrador",
    "Clientes & equipe > Editar",
    [
      mark.modal,
      [".profile-upload", "Foto de perfil"],
      [".permission-preview", "Permissões de acesso"],
    ],
    { fullPage: false },
  );
  await closeModal();
  await page
    .locator(".page-tabs")
    .getByRole("button", { name: "Equipe", exact: true })
    .click();
  await capture(
    "equipe",
    "Lista da equipe administrativa",
    "Administrador",
    "Clientes & equipe > Equipe",
    [
      [".page-tabs", "Áreas de gestão"],
      [".table-wrap", "Administradores e funcionários"],
      mark.side,
    ],
  );
  await page
    .getByRole("button", { name: "Pedidos e vendas", exact: true })
    .click();
  await page.locator(".order-form").waitFor();
  await page.locator(".fiscal-fields").evaluate((e) => (e.open = true));
  await capture(
    "vendas-registro-fiscal",
    "Registro de vendas, pagamento e referência fiscal",
    "Administrador",
    "Clientes & equipe > Pedidos e vendas",
    [
      [".order-form", "Produto, cliente e pagamento"],
      [".fiscal-fields", "Referência fiscal opcional"],
      [".sale-list", "Histórico de vendas"],
    ],
  );
  await nav("Formas de pagamento");
  await page.locator(".payment-methods").waitFor();
  await capture(
    "formas-pagamento",
    "Configuração das formas de pagamento",
    "Administrador",
    "Menu: Formas de pagamento",
    [
      mark.side,
      [".payment-methods", "Métodos, disponibilidade e parcelas"],
      [".payment-method-help", "Orientação de recebimento"],
    ],
  );
  await nav("Loja online");
  await page
    .getByRole("heading", { name: "Configuração da loja online" })
    .waitFor();
  await page
    .getByLabel("Produto", { exact: true })
    .selectOption(String(products[0].id));
  await page.waitForTimeout(300);
  await capture(
    "configuracao-loja",
    "Identificação, entrega e habilitação da loja",
    "Administrador",
    "Menu: Loja online",
    [
      mark.side,
      [".commerce-settings", "Fornecedor, contato, prazos e frete"],
      [".commerce-page > form:nth-of-type(2)", "Informações dos produtos"],
    ],
  );
  await capture(
    "informacoes-produto",
    "Descrição, composição, cuidados e regularização",
    "Administrador",
    "Loja online > Informações dos produtos",
    [[".commerce-page > form:nth-of-type(2)", "Dados públicos do produto"]],
    { section: ".commerce-page > form:nth-of-type(2)" },
  );
  await nav("Pedidos online");
  await page.locator(".commerce-order-link").first().waitFor();
  await capture(
    "pedidos-online-admin",
    "Lista de pedidos online da loja",
    "Administrador",
    "#/admin/pedidos",
    [
      mark.side,
      [".commerce-actions", "Atualizar e liberar reservas expiradas"],
      [".commerce-order-link", "Pedido, situação e valor"],
    ],
  );
  await page.locator(".commerce-order-link").first().click();
  await page.getByRole("heading", { name: "Atualizar pedido" }).waitFor();
  await capture(
    "pedido-online-admin",
    "Gestão do pedido online",
    "Administrador",
    `#/admin/pedidos/${paidOrder.id}`,
    [
      [".commerce-grid > div:first-child", "Compra, entrega e fornecedor"],
      [
        ".commerce-grid > div:last-child",
        "Histórico e atualização da situação",
      ],
    ],
  );
  await nav("Atendimento");
  await page.locator("article.commerce-card").first().waitFor();
  await capture(
    "atendimento-admin",
    "Gestão de atendimento e privacidade",
    "Administrador",
    "Menu: Atendimento",
    [
      mark.side,
      ["article.commerce-card", "Protocolo, cliente, assunto e prazo"],
      ["article.commerce-card form", "Resposta ao cliente"],
    ],
  );
  await page.evaluate(
    (token) => localStorage.setItem("token", token),
    staffToken,
  );
  await goto("/admin");
  await page.locator(".stats").first().waitFor();
  await capture(
    "painel-funcionario",
    "Painel com perfil de funcionário",
    "Funcionário",
    "#/admin",
    [mark.side, [".stats", "Indicadores disponíveis à equipe"]],
  );
  await nav("Produtos & estoque");
  await capture(
    "produtos-funcionario",
    "Produtos com permissões de funcionário",
    "Funcionário",
    "Menu: Produtos & estoque",
    [mark.side, [".row-actions", "Ações permitidas sem exclusão"]],
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await goto("/loja");
  await page.locator(".store-product-grid article").first().waitFor();
  await capture(
    "mobile-loja",
    "Loja no celular",
    "Celular — 390 px",
    "#/loja",
    [
      mark.nav,
      [".store-hero", "Apresentação e acessos"],
      [".store-products", "Catálogo responsivo"],
    ],
  );
  await goto("/checkout");
  await page
    .getByLabel("Forma de pagamento", { exact: true })
    .selectOption(String(cash));
  await capture(
    "mobile-checkout",
    "Checkout no celular",
    "Celular — 390 px",
    "#/checkout",
    [
      [".commerce-grid > div:first-child", "Recebimento e pagamento"],
      [".commerce-grid > div:last-child", "Resumo e confirmação"],
    ],
  );
  await goto(`/pedidos/${pendingOrder.id}`);
  await page.getByRole("heading", { name: "Acompanhamento" }).waitFor();
  await capture(
    "mobile-pedido",
    "Pedido do cliente no celular",
    "Celular — 390 px",
    `#/pedidos/${pendingOrder.id}`,
    [mark.main],
  );
  await goto("/atendimento");
  await page.getByRole("heading", { name: "Nova solicitação" }).waitFor();
  await capture(
    "mobile-atendimento",
    "Atendimento no celular",
    "Celular — 390 px",
    "#/atendimento",
    [
      [".commerce-grid", "Solicitação e cadastro"],
      ["#customer-password-form", "Troca de senha"],
    ],
  );
  await page.evaluate(
    (token) => localStorage.setItem("token", token),
    adminToken,
  );
  await goto("/admin");
  await page.locator(".stats").first().waitFor();
  await capture(
    "mobile-painel",
    "Administração no celular",
    "Celular — 390 px",
    "#/admin",
    [mark.side, [".stats", "Indicadores responsivos"]],
  );
  if (errors.length) throw Error("Erros de interface: " + errors.join("; "));
  const report = await fetch(origin + "/api/export/products.pdf", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!report.ok) throw Error("Falha ao gerar relatório demonstrativo");
  writeFileSync(
    path.join(output, "relatorio-produtos-demonstracao.pdf"),
    Buffer.from(await report.arrayBuffer()),
  );
  writeFileSync(
    path.join(output, "manifesto.json"),
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        data: "Dados exclusivamente fictícios; banco operacional não utilizado",
        captures,
      },
      null,
      2,
    ),
  );
  const escape = (value) =>
    String(value).replace(
      /[&<>\"]/g,
      (char) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char],
    );
  writeFileSync(
    path.join(output, "index.html"),
    `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mapa visual — Cores & Fragrâncias</title><style>body{font:16px/1.6 system-ui;background:#f6f1eb;color:#392c23;margin:0}header,main{max-width:1320px;margin:auto;padding:28px}h1{margin-bottom:4px}nav{display:flex;gap:14px;flex-wrap:wrap}a{color:#87532b}input{padding:12px;border:1px solid #cfbca8;border-radius:8px;width:min(90%,420px);font:inherit;margin:20px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}article{background:white;border:1px solid #decdbb;border-radius:12px;overflow:hidden}article img{width:100%;height:240px;object-fit:cover;object-position:top}article div{padding:18px}article h2{font-size:18px;margin:0}article p{font-size:13px}article ul{padding-left:20px;font-size:13px}.tag{color:#806246}footer{padding:30px;text-align:center}code{overflow-wrap:anywhere}</style><header><h1>Mapa visual do projeto</h1><p>${captures.length} telas identificadas · Loja, cliente, administração e celular</p><p>Capturas reais da interface, geradas com dados fictícios em banco isolado. Os números e contornos são identificações sobrepostas às fotos; não alteram o site.</p><nav><a href="guia-das-telas.pdf">Abrir guia completo em PDF</a><a href="relatorio-produtos-demonstracao.pdf">Exemplo de relatório de produtos</a><a href="manifesto.json">Índice técnico das capturas</a></nav><label>Encontrar uma tela<br><input id="search" placeholder="Ex.: estoque, cadastro, cliente, celular…" type="search"></label></header><main class="grid">${captures
      .map(
        (c) =>
          `<article data-search="${escape(
            (c.title + " " + c.area)
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, ""),
          )}"><a href="${c.file}" target="_blank"><img loading="lazy" src="${c.file}" alt="${escape(c.number + " — " + c.title)}"></a><div><span class="tag">${escape(c.area)}</span><h2>${c.number} · ${escape(c.title)}</h2><p><code>${escape(c.route)}</code></p><ul>${c.parts.map((p) => `<li>${p.number}. ${escape(p.label)}</li>`).join("")}</ul><a href="${c.file}" target="_blank">Abrir foto em tamanho original</a></div></article>`,
      )
      .join(
        "",
      )}</main><footer>Cores & Fragrâncias by Berenice · Documentação visual · Dados de demonstração</footer><script>document.querySelector('#search').addEventListener('input',e=>{const q=e.target.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');document.querySelectorAll('article').forEach(a=>a.hidden=!a.dataset.search.includes(q));});</script></html>`,
  );
  await buildCaptureGuide(output, captures);
  writeFileSync(
    path.join(output, "README.md"),
    `# Capturas identificadas do projeto\n\nForam geradas ${captures.length} capturas de telas e estados funcionais, incluindo versões para celular.\n\n- Abra [a galeria](index.html) para pesquisar e ampliar as fotos.\n- Abra [o guia em PDF](guia-das-telas.pdf) para consultar todas as telas.\n- [Relatório de produtos demonstrativo](relatorio-produtos-demonstracao.pdf).\n- [Manifesto](manifesto.json): nomes, áreas, caminhos e partes identificadas.\n\nOs dados são fictícios e as fotos de produtos vieram exclusivamente da base pública do projeto. O banco operacional não foi aberto ou alterado. As marcações numeradas foram adicionadas somente durante a captura.\n\n## Gerar novamente\n\nExecute o build primeiro. O script exige Microsoft Edge e Playwright disponível como módulo ou pelo caminho absoluto na variável PLAYWRIGHT_MODULE. Não é necessário instalar um navegador adicional ao usar o canal msedge.\n\n\`\`\`powershell\nnpm.cmd run build\n$env:PLAYWRIGHT_MODULE = 'CAMINHO/para/playwright/index.mjs'\nnode scripts/capture-screens.mjs\n\`\`\`\n\nA geração inicia um servidor em porta temporária e cria/remove somente seu próprio banco temporário. Reexecutar substitui os arquivos de documentação de mesmo nome.\n`,
  );
  console.log(
    `CONCLUÍDO: ${captures.length} capturas + galeria + guia PDF em ${output}`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  db.close();
  await rm(folder, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
