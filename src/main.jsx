import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Camera,
  CreditCard,
  Download,
  FileText,
  LayoutDashboard,
  LogIn,
  LogOut,
  MapPin,
  MessageCircle,
  Package,
  Pencil,
  Plus,
  ReceiptText,
  Save,
  Send,
  ShoppingBag,
  ShoppingCart,
  Trash2,
  Upload,
  UserCog,
  UserPlus,
  UsersRound,
} from "lucide-react";
import "./styles.css";
import { expirationStatus, storeToday } from "./expiration.js";
import { paymentGuidance } from "./payment-guidance.js";
import { matchesProduct } from "./search.js";
import { parseProductData } from "./product-data.js";
import { CommerceSettings, OrderArea, ServiceArea } from "./commerce.jsx";
const Storefront = React.lazy(() => import("./storefront.jsx"));

function useStoreToday() {
  const [today, setToday] = useState(() => storeToday());
  useEffect(() => {
    const update = () => setToday(storeToday());
    const timer = setInterval(update, 60000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return today;
}

function ExpirationBadge({ value, today }) {
  const expiry = expirationStatus(value, today);
  if (!expiry || expiry.status === "valid") return null;
  return (
    <span className={`pill ${expiry.tone} expiration-badge`}>
      {expiry.label}
      {expiry.days === 0
        ? " · vence hoje"
        : expiry.days > 0
          ? ` · ${expiry.days} dia(s)`
          : ""}
    </span>
  );
}

function ExpirationAlerts({ products, today }) {
  const alerts = products.filter((product) => {
    const expiry = expirationStatus(product.expiration_date, today);
    return product.quantity > 0 && expiry && expiry.status !== "valid";
  });
  if (!alerts.length) return null;
  const expired = alerts.filter(
    (product) =>
      expirationStatus(product.expiration_date, today).status === "expired",
  ).length;
  return (
    <details className="expiration-alerts">
      <summary>
        Alerta de validade: {expired} vencido(s) e {alerts.length - expired}{" "}
        quase vencendo
      </summary>
      <p>
        Produtos em estoque. “Quase vencendo” indica validade nos próximos 30
        dias, incluindo hoje.
      </p>
      <ul>
        {alerts.map((product) => (
          <li key={product.id}>
            <span>
              <b>{product.name}</b> · {product.quantity} un. ·{" "}
              {date(product.expiration_date)}
            </span>
            <ExpirationBadge value={product.expiration_date} today={today} />
          </li>
        ))}
      </ul>
    </details>
  );
}

const API = "/api";
const reportLoadError = (error) =>
  window.dispatchEvent(
    new CustomEvent("load-error", { detail: error.message }),
  );
const money = (v) =>
  Number(v || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const date = (v) => {
  if (!v) return "—";
  const raw = String(v);
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  const value = br ? `${br[3]}-${br[2]}-${br[1]}` : raw;
  const parsed = new Date(value.includes("T") ? value : value + "T12:00:00");
  return Number.isNaN(parsed.getTime())
    ? "—"
    : parsed.toLocaleDateString("pt-BR");
};
const STORE_PHONE = "+55 35 9821-3049";
const STORE_WHATSAPP = "553598213049";
const STORE_ADDRESS =
  "Praça Pres. João Pessoa, 66 - Centro, Varginha - MG, 37014-200";
const whatsappUrl = (message) =>
  `https://wa.me/${STORE_WHATSAPP}?text=${encodeURIComponent(message)}`;
const api = async (path, opts = {}) => {
  if (opts.body instanceof FormData) {
    for (const value of opts.body.values())
      if (value instanceof File && value.size > 4 * 1024 * 1024)
        throw new Error("Arquivo excede o limite de 4 MB");
  }
  const session = opts.session || "admin";
  const tokenKey = session === "customer" ? "customerToken" : "token";
  const token = session === "public" ? null : localStorage.getItem(tokenKey);
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  if (!(opts.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    if (opts.body && typeof opts.body !== "string")
      opts.body = JSON.stringify(opts.body);
  }
  let r;
  try {
    const { session: _session, ...requestOptions } = opts;
    r = await fetch(API + path, {
      ...requestOptions,
      headers: { ...headers, ...opts.headers },
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error(
      "Servidor indisponível. Verifique a conexão e tente novamente.",
    );
  }
  if (
    r.status === 401 &&
    !["/login", "/customer/login"].includes(path) &&
    session !== "public"
  ) {
    localStorage.removeItem(tokenKey);
    window.dispatchEvent(
      new Event(
        session === "customer" ? "customer-auth-expired" : "auth-expired",
      ),
    );
  }
  if (!r.ok) {
    let e;
    try {
      e = await r.json();
    } catch {}
    throw Object.assign(new Error(e?.error || "Não foi possível concluir"), {
      status: r.status,
    });
  }
  return r.headers.get("content-type")?.includes("json") ? r.json() : r.blob();
};

function UserImage({ user, className }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let url;
    const controller = new AbortController();
    api(`/users/${user.id}/image`, { signal: controller.signal })
      .then((blob) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => {});
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [user]);
  return src ? (
    <img className={className} src={src} alt={`Foto de ${user.name}`} />
  ) : (
    <div className="avatar">{user.name?.[0]}</div>
  );
}
function Login({ onLogin }) {
  const [form, setForm] = useState({ username: "", password: "" }),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const x = await api("/login", {
        method: "POST",
        body: { ...form, portal: "admin" },
      });
      localStorage.setItem("token", x.token);
      onLogin(x.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <main className="login">
      <section className="login-card">
        <img src="/assets/logo1.jpeg" />
        <p className="eyebrow">GESTÃO & BELEZA</p>
        <h1>Cores & Fragrâncias</h1>
        <p className="muted">
          Entre para cuidar das vendas e do estoque da loja.
        </p>
        {location.hash.startsWith("#/admin/cadastros") && (
          <p className="muted">
            Entre com uma conta de administrador para cadastrar integrantes da
            equipe.
          </p>
        )}
        <form onSubmit={submit}>
          <label>
            Usuário
            <input
              required
              autoComplete="username"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              required
              autoComplete="current-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="primary" disabled={loading}>
            <LogIn size={17} /> {loading ? "Entrando…" : "Entrar no sistema"}
          </button>
        </form>
        <small>Use o acesso fornecido pelo administrador da loja.</small>
        <nav
          className="login-customer-links"
          aria-label="Loja e acesso de clientes"
        >
          <p>Quer comprar? Acesse o espaço do cliente.</p>
          <a className="button primary" href="#/loja">
            <ShoppingBag size={17} /> Página principal da loja
          </a>
          <div>
            <a className="button" href="#/cliente/entrar">
              <LogIn size={17} /> Login do cliente
            </a>
            <a className="button" href="#/cliente/cadastrar">
              <UsersRound size={17} /> Cadastro de cliente
            </a>
          </div>
        </nav>
      </section>
      <aside className="login-art">
        <div>
          <span>CORES & FRAGRÂNCIAS</span>
          <strong>by Berenice</strong>
          <p>
            Produtos, clientes e resultados reunidos em uma experiência simples.
          </p>
          <div className="store-contact">
            <a
              href={whatsappUrl(
                "Olá! Gostaria de falar com a Cores & Fragrâncias by Berenice.",
              )}
              target="_blank"
              rel="noreferrer"
            >
              <MessageCircle size={17} /> WhatsApp {STORE_PHONE}
            </a>
            <a
              href="https://www.google.com/maps/search/?api=1&query=Praça+Pres.+João+Pessoa,+66,+Varginha,+MG"
              target="_blank"
              rel="noreferrer"
            >
              <MapPin size={17} /> {STORE_ADDRESS}
            </a>
          </div>
        </div>
      </aside>
    </main>
  );
}

const icons = {
  dashboard: LayoutDashboard,
  products: Package,
  users: UsersRound,
  payments: CreditCard,
  catalog: ShoppingBag,
};
const ROLE_PERMISSIONS = {
  admin: {
    title: "Administrador",
    text: "Acesso total: dashboard, estoque, clientes, equipe, cadastros, pagamentos, relatórios e vendas.",
  },
  funcionario: {
    title: "Funcionário",
    text: "Pode consultar dashboard, produtos, clientes e equipe, além de registrar pedidos e vendas. Não altera usuários, pagamentos nem exclui produtos.",
  },
  cliente: {
    title: "Cliente",
    text: "Acessa somente o catálogo de produtos e os canais de atendimento da loja.",
  },
};
function Shell({ user, setUser }) {
  const allowed =
    user.role === "admin"
      ? [
          "dashboard",
          "products",
          "orders",
          "service",
          "users",
          "payments",
          "shop",
        ]
      : ["dashboard", "products", "orders", "service", "users"];
  const labels = {
    dashboard: "Visão geral",
    products: "Produtos & estoque",
    users: "Clientes & equipe",
    payments: "Formas de pagamento",
    catalog: "Catálogo",
    orders: "Pedidos online",
    service: "Atendimento",
    shop: "Loja online",
  };
  const [page, setPage] = useState(
    location.hash.startsWith("#/admin/cadastros")
      ? "users"
      : location.hash.startsWith("#/admin/pedidos")
        ? "orders"
        : allowed[0],
  );
  const [adminRoute, setAdminRoute] = useState(location.hash.slice(1));
  useEffect(() => {
    const update = () => {
      setAdminRoute(location.hash.slice(1));
      if (location.hash.startsWith("#/admin/pedidos")) setPage("orders");
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const report = (event) => setLoadError(event.detail);
    window.addEventListener("load-error", report);
    return () => window.removeEventListener("load-error", report);
  }, []);
  useEffect(() => setLoadError(""), [page]);
  const logout = () => {
    localStorage.removeItem("token");
    setUser(null);
  };
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img src="/assets/logo1.jpeg" />
          <div>
            <b>Cores &</b>
            <span>Fragrâncias</span>
          </div>
        </div>
        <nav>
          {allowed.map((item) => {
            const NavIcon = icons[item] ?? LayoutDashboard;
            return (
              <button
                key={item}
                className={page === item ? "active" : ""}
                onClick={() => {
                  setPage(item);
                  if (item === "orders") location.hash = "/admin/pedidos";
                }}
              >
                {React.createElement(NavIcon, { size: 19 })}
                {labels[item]}
              </button>
            );
          })}
          <button
            onClick={() => {
              location.hash = "/loja";
            }}
          >
            <ShoppingBag size={19} /> Ver loja
          </button>
        </nav>
        <div className="profile">
          {user.has_image ? (
            <UserImage user={user} />
          ) : (
            <div className="avatar">{user.name?.[0]}</div>
          )}
          <div>
            <b>{user.name}</b>
            <span>{user.role}</span>
          </div>
          <button title="Sair" onClick={logout}>
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <section className="content">
        <Header page={labels[page]} user={user} setUser={setUser} />
        {loadError && (
          <div className="load-error" role="alert">
            {loadError}{" "}
            <button
              onClick={() => {
                setLoadError("");
                setRevision((value) => value + 1);
              }}
            >
              Tentar novamente
            </button>
          </div>
        )}
        <React.Fragment key={`${page}-${revision}`}>
          {page === "dashboard" && <Dashboard />}
          {page === "products" && (
            <Products canDelete={user.role === "admin"} />
          )}{" "}
          {page === "users" && <Users canManage={user.role === "admin"} />}{" "}
          {page === "payments" && <PaymentSettings />}{" "}
          {page === "shop" && <CommerceSettings api={api} />}
          {page === "orders" && (
            <OrderArea
              key={adminRoute}
              api={api}
              user={user}
              admin
              route={adminRoute}
            />
          )}
          {page === "service" && <ServiceArea api={api} user={user} admin />}
        </React.Fragment>
      </section>
    </div>
  );
}
function Header({ page, user, setUser }) {
  const upload = async (e) => {
    if (!e.target.files[0]) return;
    const f = new FormData();
    f.append("image", e.target.files[0]);
    try {
      setUser(await api("/me/image", { method: "PUT", body: f }));
    } catch (e) {
      alert(e.message);
    }
  };
  return (
    <header>
      <div>
        <p className="eyebrow">CORES & FRAGRÂNCIAS BY BERENICE</p>
        <h2>{page}</h2>
      </div>
      <div className="header-actions">
        <label className="icon-btn" title="Trocar foto">
          <Camera size={18} />
          <input
            hidden
            type="file"
            accept="image/png,image/jpeg"
            onChange={upload}
          />
        </label>
        <div>
          <b>Olá, {user.name?.split(" ")[0]}</b>
          <span>
            {new Date().toLocaleDateString("pt-BR", {
              weekday: "long",
              day: "2-digit",
              month: "long",
            })}
          </span>
        </div>
      </div>
    </header>
  );
}
function Stat({ label, value, detail, tone }) {
  return (
    <article className={`stat ${tone || ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}
function SalesChart({ data = [] }) {
  if (!data.length) return <Empty text="Nenhuma venda registrada" />;
  const width = 820,
    height = 320,
    left = 62,
    right = 18,
    top = 18,
    bottom = 42,
    plotWidth = width - left - right,
    plotHeight = height - top - bottom,
    maximum = Math.max(...data.map((item) => Number(item.value) || 0), 1),
    step = Math.max(100, Math.ceil(maximum / 4 / 100) * 100),
    ceiling = step * 4,
    x = (index) =>
      left +
      (data.length === 1
        ? plotWidth / 2
        : (index * plotWidth) / (data.length - 1)),
    y = (value) =>
      top + plotHeight - ((Number(value) || 0) / ceiling) * plotHeight,
    points = data.map((item, index) => [x(index), y(item.value)]),
    line = points.map(([px, py]) => `${px},${py}`).join(" "),
    area = `${left},${top + plotHeight} ${line} ${left + plotWidth},${top + plotHeight}`,
    labelEvery = Math.max(1, Math.ceil(data.length / 7));
  return (
    <svg
      className="sales-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Evolução das vendas por dia"
    >
      <defs>
        <linearGradient id="sales-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor="#99623d" stopOpacity="0.32" />
          <stop offset="95%" stopColor="#99623d" stopOpacity="0.03" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3, 4].map((index) => {
        const value = step * (4 - index),
          py = top + (plotHeight * index) / 4;
        return (
          <g key={value}>
            <line
              x1={left}
              y1={py}
              x2={left + plotWidth}
              y2={py}
              className="chart-grid-line"
            />
            <text
              x={left - 9}
              y={py + 5}
              textAnchor="end"
              className="chart-axis-label"
            >
              R${value}
            </text>
          </g>
        );
      })}
      <polygon points={area} fill="url(#sales-gradient)" />
      <polyline points={line} className="chart-sales-line" />
      {points.map(([px, py], index) => (
        <g key={`${data[index].date}-${index}`}>
          <circle cx={px} cy={py} r="4" className="chart-sales-point">
            <title>{`${date(data[index].date)}: ${money(data[index].value)}`}</title>
          </circle>
          {(index % labelEvery === 0 || index === data.length - 1) && (
            <text
              x={px}
              y={height - 13}
              textAnchor="middle"
              className="chart-axis-label"
            >
              {String(data[index].date).slice(5)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
function Dashboard() {
  const today = useStoreToday();
  const [d, setD] = useState(null);
  useEffect(() => {
    api("/dashboard")
      .then((dashboard) => setD(dashboard))
      .catch(reportLoadError);
  }, []);
  if (!d) return <Loading />;
  return (
    <>
      <div className="stats">
        <Stat
          label="Produtos cadastrados"
          value={d.products}
          detail={`${d.stock} unidades disponíveis`}
        />
        <Stat
          label="Valor em estoque"
          value={money(d.stock_value)}
          detail="Preço atual de venda"
          tone="gold"
        />
        <Stat
          label="Vendas registradas"
          value={d.sales_count}
          detail={`${d.sold_quantity} unidades vendidas · sem cancelamentos`}
        />
        <Stat
          label="Faturamento"
          value={money(d.revenue)}
          detail="Receita acumulada"
          tone="rose"
        />
      </div>
      <div className="stats expiration-stats">
        <Stat
          label="Perdas por vencimento"
          value={money(d.expirationLosses.total_cents / 100)}
          detail="Acumulado das retiradas · preço de venda na baixa"
          tone="rose"
        />
        <Stat
          label="Unidades retiradas por vencimento"
          value={d.expirationLosses.quantity}
          detail={`${d.expirationLosses.products} produtos diferentes · histórico completo`}
          tone="rose"
        />
      </div>
      {d.birthdays.length > 0 && (
        <div className="birthday">
          🎂 Hoje é aniversário de {d.birthdays.map((x) => x.name).join(", ")}.
          Uma ótima oportunidade para entrar em contato!
        </div>
      )}
      <ExpirationAlerts products={d.expirationProducts || []} today={today} />
      <div className="dashboard-grid">
        <Card title="Evolução das vendas" subtitle="Receita por dia">
          <div className="chart">
            <SalesChart data={d.chart} />
          </div>
        </Card>
        <Card
          title="Atenção ao estoque"
          subtitle="Produtos com 5 unidades ou menos"
        >
          <div className="low-list">
            {d.low.length ? (
              d.low.map((x) => (
                <div key={x.id}>
                  <span>
                    <i className={x.quantity === 0 ? "danger" : ""}></i>
                    {x.name}
                  </span>
                  <b>{x.quantity} un.</b>
                </div>
              ))
            ) : (
              <Empty text="Estoque saudável" />
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
function Card({ title, subtitle, children, action }) {
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function Loading() {
  return <div className="loading">Carregando…</div>;
}
function Empty({ text = "Nenhum registro encontrado" }) {
  return (
    <div className="empty">
      ◇<p>{text}</p>
    </div>
  );
}
const blankProduct = {
  name: "",
  brand: "",
  style: "",
  type: "",
  price: "",
  quantity: "",
  expiration_date: "",
};
function ProductForm({ product, onClose, onSaved }) {
  const [v, setV] = useState(product || blankProduct),
    [file, setFile] = useState(),
    [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const f = new FormData();
      Object.entries(v).forEach(
        ([k, x]) => k !== "image_url" && x != null && f.append(k, x),
      );
      if (file) f.append("image", file);
      if (product) f.append("original_quantity", product.quantity);
      await api(product ? `/products/${product.id}` : "/products", {
        method: product ? "PUT" : "POST",
        body: f,
      });
      onSaved();
    } catch (e) {
      if (e.status === 409) onClose();
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      title={product ? "Editar produto" : "Novo produto"}
      onClose={onClose}
    >
      <form onSubmit={submit} className="form-grid">
        <label className="wide">
          Nome do produto
          <input
            required
            value={v.name}
            onChange={(e) => setV({ ...v, name: e.target.value })}
          />
        </label>
        <label>
          Marca
          <input
            value={v.brand || ""}
            onChange={(e) => setV({ ...v, brand: e.target.value })}
          />
        </label>
        <label>
          Tipo
          <input
            value={v.type || ""}
            onChange={(e) => setV({ ...v, type: e.target.value })}
          />
        </label>
        <label>
          Estilo
          <input
            value={v.style || ""}
            onChange={(e) => setV({ ...v, style: e.target.value })}
          />
        </label>
        <label>
          Preço (R$)
          <input
            required
            min="0"
            step=".01"
            type="number"
            value={v.price}
            onChange={(e) => setV({ ...v, price: e.target.value })}
          />
        </label>
        <label>
          Quantidade
          <input
            required
            min="0"
            type="number"
            value={v.quantity}
            onChange={(e) => setV({ ...v, quantity: e.target.value })}
          />
        </label>
        <label>
          Validade
          <input
            type="date"
            value={v.expiration_date || ""}
            onChange={(e) => setV({ ...v, expiration_date: e.target.value })}
          />
        </label>
        <label className="wide file">
          Imagem do produto
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => setFile(e.target.files[0])}
          />
        </label>
        <div className="form-actions wide">
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" disabled={saving}>
            <Save size={16} /> {saving ? "Salvando…" : "Salvar produto"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function StockForm({ product, onClose, onSaved }) {
  const [movementType, setMovementType] = useState("ENTRADA"),
    [quantity, setQuantity] = useState(1),
    [reason, setReason] = useState("Reposição de estoque"),
    [saving, setSaving] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await api("/stock-movements", {
        method: "POST",
        body: {
          product_id: product.id,
          movement_type: movementType,
          quantity,
          reason,
        },
      });
      onSaved();
    } catch (error) {
      alert(error.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title="Movimentar estoque" onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <div className="wide stock-product-summary">
          <b>{product.name}</b>
          <span>Estoque atual: {product.quantity} unidades</span>
        </div>
        <label>
          Operação
          <select
            value={movementType}
            onChange={(event) => {
              const value = event.target.value;
              setMovementType(value);
              setReason(
                value === "ENTRADA"
                  ? "Reposição de estoque"
                  : "Saída manual de estoque",
              );
            }}
          >
            <option value="ENTRADA">Entrada</option>
            <option value="SAIDA">Saída</option>
            <option value="AJUSTE">Ajuste positivo</option>
          </select>
        </label>
        <label>
          Quantidade
          <input
            required
            type="number"
            min="1"
            max={movementType === "SAIDA" ? product.quantity : undefined}
            value={quantity}
            onChange={(event) => setQuantity(Number(event.target.value))}
          />
        </label>
        <label className="wide">
          Motivo
          <input
            required
            minLength="3"
            maxLength="200"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <div className="form-actions wide">
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" disabled={saving}>
            <Save size={16} /> {saving ? "Salvando…" : "Confirmar movimentação"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Modal({ title, onClose, children }) {
  return (
    <div
      className="modal-back"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal">
        <div className="modal-title">
          <h3>{title}</h3>
          <button onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Products({ canDelete }) {
  const today = useStoreToday();
  const [saleProduct, setSaleProduct] = useState(null);
  const [losses, setLosses] = useState({ items: [], total_cents: 0 });
  const [removingExpired, setRemovingExpired] = useState(false);
  const [products, setProducts] = useState([]),
    [movements, setMovements] = useState([]),
    [q, setQ] = useState(""),
    [edit, setEdit] = useState(undefined),
    [show, setShow] = useState(false),
    [stockProduct, setStockProduct] = useState(null);
  const load = () =>
    Promise.all([
      api("/products"),
      api("/stock-movements"),
      api("/expiration-losses"),
    ]).then(([items, history, lossHistory]) => {
      const data = parseProductData(items, history, lossHistory);
      setProducts(data.products);
      setMovements(data.movements);
      setLosses(data.losses);
    });
  useEffect(() => {
    void load().catch(reportLoadError);
  }, []);
  const filtered = useMemo(
    () => products.filter((x) => matchesProduct(x, q)),
    [products, q],
  );
  const expired = products.filter(
    (p) =>
      p.quantity > 0 &&
      expirationStatus(p.expiration_date, today)?.status === "expired",
  );
  const removeExpired = async (items) => {
    if (removingExpired || !items.length) return;
    const total = items.reduce(
      (sum, p) => sum + Math.round(p.price * 100) * p.quantity,
      0,
    );
    if (
      !confirm(
        `Retirar todo o estoque de ${items.length} produto(s) vencido(s)? Perda estimada pelo preço de venda: ${money(total / 100)}. A baixa ficará registrada no histórico.`,
      )
    )
      return;
    setRemovingExpired(true);
    try {
      await api("/expiration-losses", {
        method: "POST",
        body: JSON.stringify({ product_ids: items.map((p) => p.id) }),
      });
      await load();
    } catch (e) {
      alert(e.message);
      void load().catch(reportLoadError);
    } finally {
      setRemovingExpired(false);
    }
  };
  const del = async (p) => {
    if (!confirm(`Excluir ${p.name}?`)) return;
    try {
      await api(`/products/${p.id}`, { method: "DELETE" });
      void load().catch(reportLoadError);
    } catch (e) {
      alert(e.message);
    }
  };
  const download = async (format) => {
    try {
      const b = await api(`/export/products.${format}`),
        a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = `produtos.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
      alert(e.message);
    }
  };
  const importCsv = async (e) => {
    if (!e.target.files[0]) return;
    const f = new FormData();
    f.append("file", e.target.files[0]);
    try {
      const x = await api("/import/products", { method: "POST", body: f });
      alert(`${x.count} produtos importados`);
      void load().catch(reportLoadError);
    } catch (e) {
      alert(e.message);
    } finally {
      e.target.value = "";
    }
  };
  return (
    <Card
      title="Produtos"
      subtitle={`${filtered.length} itens encontrados`}
      action={
        <div className="actions">
          <button onClick={() => download("pdf")}>
            <FileText size={16} /> Baixar PDF
          </button>
          <button onClick={() => download("csv")}>
            <Download size={16} /> Exportar CSV
          </button>
          <label className="button">
            <Upload size={16} /> Importar CSV
            <input
              hidden
              type="file"
              accept=".csv,text/csv"
              onChange={importCsv}
            />
          </label>
          <button
            className="primary"
            onClick={() => {
              setEdit(null);
              setShow(true);
            }}
          >
            <Plus size={17} /> Novo produto
          </button>
        </div>
      }
    >
      <ExpirationAlerts products={products} today={today} />
      <div className="toolbar">
        <button
          className="delete"
          disabled={removingExpired || !expired.length}
          onClick={() => removeExpired(expired)}
        >
          {removingExpired
            ? "Retirando…"
            : `Retirar vencidos do estoque (${expired.length})`}
        </button>
      </div>
      <details className="stock-history">
        <summary>
          Perdas por vencimento: {money(losses.total_cents / 100)} (
          {losses.items.length} retiradas)
        </summary>
        <p>
          Valores estimados pelo preço de venda no momento da retirada; não
          representam o custo de compra. Os cadastros dos produtos são
          preservados.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Retirada</th>
                <th>Produto</th>
                <th>Validade</th>
                <th>Quantidade</th>
                <th>Preço unitário</th>
                <th>Valor perdido</th>
                <th>Responsável</th>
              </tr>
            </thead>
            <tbody>
              {losses.items.map((item) => (
                <tr key={item.id}>
                  <td>{date(item.created_at)}</td>
                  <td>
                    {item.product_name}
                    <small className="block">#{item.product_id}</small>
                  </td>
                  <td>{date(item.expiration_date)}</td>
                  <td>{item.quantity} un.</td>
                  <td>{money(item.unit_price_cents / 100)}</td>
                  <td>{money(item.total_cents / 100)}</td>
                  <td>{item.user_name || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!losses.items.length && <Empty />}
        </div>
      </details>
      <div className="toolbar">
        <input
          className="search"
          placeholder="Buscar por nome, marca, tipo ou código…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Produto</th>
              <th>Categoria</th>
              <th>Preço</th>
              <th>Estoque</th>
              <th>Vendido</th>
              <th>Validade</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id}>
                <td>
                  <div className="product-cell">
                    {p.image_url ? (
                      <img
                        src={p.image_url}
                        alt={p.name}
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <div className="placeholder">◇</div>
                    )}
                    <span>
                      <b>{p.name}</b>
                      <small>
                        #{p.id} · {p.brand || "Sem marca"}
                      </small>
                    </span>
                  </div>
                </td>
                <td>
                  {p.type || "—"}
                  <small className="block">{p.style}</small>
                </td>
                <td>
                  <b>{money(p.price)}</b>
                </td>
                <td>
                  <span
                    className={`pill ${p.quantity === 0 ? "red" : p.quantity <= 5 ? "yellow" : "green"}`}
                  >
                    {p.quantity} un.
                  </span>
                </td>
                <td>
                  <b>{p.sold_quantity} un.</b>
                  <small className="block">{money(p.sold_value)}</small>
                </td>
                <td>
                  {date(p.expiration_date)}
                  <ExpirationBadge value={p.expiration_date} today={today} />
                </td>
                <td className="row-actions">
                  <button
                    className="primary"
                    disabled={
                      p.quantity <= 0 ||
                      expirationStatus(p.expiration_date, today)?.status === "expired"
                    }
                    onClick={() => setSaleProduct(p)}
                  >
                    <ShoppingCart size={15} /> Vender
                  </button>
                  {p.quantity > 0 &&
                    expirationStatus(p.expiration_date, today)?.status ===
                      "expired" && (
                      <button
                        className="delete"
                        disabled={removingExpired}
                        onClick={() => removeExpired([p])}
                      >
                        Retirar vencido
                      </button>
                    )}
                  <button onClick={() => setStockProduct(p)}>
                    <Plus size={15} /> Estoque
                  </button>
                  <button
                    onClick={() => {
                      setEdit(p);
                      setShow(true);
                    }}
                  >
                    <Pencil size={15} /> Editar
                  </button>
                  {canDelete && (
                    <button className="delete" onClick={() => del(p)}>
                      <Trash2 size={15} /> Excluir
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && <Empty />}
      </div>
      <details className="stock-history">
        <summary>Histórico de movimentações ({movements.length})</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Produto</th>
                <th>Tipo</th>
                <th>Quantidade</th>
                <th>Saldo</th>
                <th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {movements.slice(0, 50).map((movement) => (
                <tr key={movement.id}>
                  <td>{date(movement.created_at)}</td>
                  <td>{movement.product_name}</td>
                  <td>
                    <span className="pill">{movement.movement_type}</span>
                  </td>
                  <td
                    className={movement.quantity < 0 ? "negative" : "positive"}
                  >
                    {movement.quantity > 0 ? "+" : ""}
                    {movement.quantity}
                  </td>
                  <td>
                    {movement.previous_quantity} → {movement.new_quantity}
                  </td>
                  <td>
                    {movement.reason}
                    <small className="block">
                      {movement.user_name || "Sistema"}
                    </small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!movements.length && (
            <Empty text="Nenhuma movimentação registrada" />
          )}
        </div>
      </details>
      {show && (
        <ProductForm
          product={edit}
          onClose={() => {
            setShow(false);
            void load().catch(reportLoadError);
          }}
          onSaved={() => {
            setShow(false);
            if (!edit) setQ("");
            void load().catch(reportLoadError);
          }}
        />
      )}
      {saleProduct && (
        <ProductSale
          product={saleProduct}
          onClose={() => setSaleProduct(null)}
          onSaved={async () => {
            setSaleProduct(null);
            await load().catch(reportLoadError);
          }}
        />
      )}
      {stockProduct && (
        <StockForm
          product={stockProduct}
          onClose={() => setStockProduct(null)}
          onSaved={() => {
            setStockProduct(null);
            void load().catch(reportLoadError);
          }}
        />
      )}
    </Card>
  );
}
const blankUser = {
  username: "",
  password: "",
  role: "cliente",
  name: "",
  birth_date: "",
  email: "",
  phone: "",
  cpf: "",
  preferred_type: "",
  preferred_brand: "",
  preferred_style: "",
};
function ProductSale({ product, onClose, onSaved }) {
  const [users, setUsers] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api("/users").then(setUsers).catch(reportLoadError);
  }, []);
  return (
    <Modal
      title={`Vender: ${product.name}`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {users ? (
        <CustomerOrders
          users={users}
          initialProductId={product.id}
          onSaved={onSaved}
          onBusyChange={setBusy}
        />
      ) : (
        <Loading />
      )}
    </Modal>
  );
}
function CustomerOrders({
  users,
  canManage,
  initialProductId,
  onSaved,
  onBusyChange,
}) {
  const [products, setProducts] = useState([]),
    [sales, setSales] = useState([]),
    [methods, setMethods] = useState([]),
    [productId, setProductId] = useState(
      initialProductId ? String(initialProductId) : "",
    ),
    [customerId, setCustomerId] = useState(""),
    [quantity, setQuantity] = useState(1),
    [methodId, setMethodId] = useState(""),
    [reference, setReference] = useState(""),
    [installments, setInstallments] = useState(1),
    [received, setReceived] = useState(""),
    [status, setStatus] = useState("Concluído"),
    [fiscalDocument, setFiscalDocument] = useState(""),
    [fiscalKey, setFiscalKey] = useState(""),
    [saving, setSaving] = useState(false);
  const load = () =>
    Promise.all([
      api("/products"),
      api("/sales"),
      api("/payment-methods"),
    ]).then(([p, s, m]) => {
      setProducts(
        p.filter(
          (x) =>
            x.quantity > 0 && (!initialProductId || x.id === initialProductId),
        ),
      );
      setSales(s);
      setMethods(m.filter((x) => x.active));
      setProductId((current) =>
        p.some((x) => String(x.id) === current && x.quantity > 0)
          ? current
          : initialProductId
            ? ""
            : String(p.find((x) => x.quantity > 0)?.id || ""),
      );
      setMethodId((current) =>
        m.some((x) => String(x.id) === current && x.active)
          ? current
          : String(m.find((x) => x.active)?.id || ""),
      );
    });
  useEffect(() => {
    void load().catch(reportLoadError);
  }, []);
  const exportSales = async () => {
    try {
      const blob = await api("/export/sales.csv"),
        anchor = document.createElement("a");
      anchor.href = URL.createObjectURL(blob);
      anchor.download = "vendas.csv";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
    } catch (error) {
      alert(error.message);
    }
  };
  const cancelSale = async (sale) => {
    const reason = prompt(
      `Motivo do cancelamento de ${sale.order_number || `venda #${sale.id}`}:`,
    );
    if (!reason) return;
    if (!confirm("Confirmar cancelamento e devolver o item ao estoque?"))
      return;
    try {
      await api(`/sales/${sale.id}/cancel`, {
        method: "POST",
        body: { reason },
      });
      void load().catch(reportLoadError);
    } catch (error) {
      alert(error.message);
    }
  };
  const product = products.find((x) => x.id === +productId),
    client = users.find((x) => x.id === +customerId),
    method = methods.find((x) => x.id === +methodId),
    total = (product?.price || 0) * quantity,
    change =
      method?.code === "01" && received ? Math.max(0, +received - total) : 0;
  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    onBusyChange?.(true);
    try {
      const result = await api("/sales", {
        method: "POST",
        body: {
          product_id: productId,
          customer_id: customerId || null,
          quantity,
          payment_method_id: methodId,
          transaction_reference: reference,
          installments,
          amount_received: received,
          order_status: status,
          fiscal_document: fiscalDocument,
          fiscal_key: fiscalKey,
        },
      });
      alert(
        `Pedido ${result.order_number} registrado. Total: ${money(result.total)}${result.change ? ` · Troco: ${money(result.change)}` : ""}`,
      );
      if (onSaved) {
        await onSaved();
        return;
      }
      setQuantity(1);
      setReference("");
      setReceived("");
      setFiscalDocument("");
      setFiscalKey("");
      setInstallments(1);
      void load().catch(reportLoadError);
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
      onBusyChange?.(false);
    }
  };
  const clients = users.filter((x) => x.role === "cliente"),
    message = product
      ? `Olá${client?.name ? ` ${client.name}` : ""}! Seu pedido na Cores & Fragrâncias by Berenice: ${quantity}x ${product.name}, total ${money(total)}, pagamento por ${method?.name || "a combinar"}. Retirada em ${STORE_ADDRESS}.`
      : "";
  return (
    <div className={initialProductId ? "product-sale" : "orders-layout"}>
      <Card
        title="Novo pedido e venda"
        subtitle="Pagamento identificado e estoque transacional"
      >
        <form className="order-form" onSubmit={submit}>
          {initialProductId && !product && (
            <p role="status">
              Carregando disponibilidade. Se o produto estiver sem estoque,
              feche a venda e atualize a lista.
            </p>
          )}
          <label>
            Cliente
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">Consumidor não identificado</option>
              {clients.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Produto
            <select
              required
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              <option value="">Selecione</option>
              {products.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} — {x.quantity} un. — {money(x.price)}
                </option>
              ))}
            </select>
          </label>
          <div className="order-row">
            <label>
              Quantidade
              <input
                type="number"
                min="1"
                max={product?.quantity || 1}
                value={quantity}
                onChange={(e) => setQuantity(+e.target.value)}
              />
            </label>
            <label>
              Forma de pagamento
              <select
                required
                value={methodId}
                onChange={(e) => {
                  setMethodId(e.target.value);
                  setInstallments(1);
                  setReference("");
                  setReceived("");
                }}
              >
                <option value="">Selecione</option>
                {methods.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.code} — {x.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Situação
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option>Concluído</option>
                <option>Pago</option>
                <option>Pendente</option>
                <option>Em separação</option>
              </select>
              <small>
                Use Pendente enquanto aguarda o recebimento. Marque Pago ou
                Concluído após conferir no banco ou na operadora.
              </small>
            </label>
          </div>
          {method && (
            <div className="payment-details">
              {method.requires_reference === 1 && (
                <label>
                  Código da transação
                  <input
                    required
                    maxLength="100"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="Identificação do pagamento"
                  />
                  <small>{paymentGuidance(method.code).reference}</small>
                  <small>Nunca informe número completo do cartão ou CVV.</small>
                </label>
              )}
              {method.max_installments > 1 && (
                <label>
                  Parcelas
                  <select
                    value={installments}
                    onChange={(e) => setInstallments(+e.target.value)}
                  >
                    {Array.from({ length: method.max_installments }, (_, i) => (
                      <option key={i + 1} value={i + 1}>
                        {i + 1}x
                      </option>
                    ))}
                  </select>
                  <small>
                    {installments}x de {money(total / installments)}. Total:{" "}
                    {money(total)}. Sem cálculo automático de juros.
                  </small>
                </label>
              )}
              {method.code === "01" && (
                <label>
                  Valor recebido
                  <input
                    required
                    type="number"
                    min={total}
                    step="0.01"
                    value={received}
                    onChange={(e) => setReceived(e.target.value)}
                  />
                  <small>Troco calculado: {money(change)}</small>
                </label>
              )}
              <p>{method.instructions}</p>
            </div>
          )}
          <details className="fiscal-fields">
            <summary>Referência fiscal (opcional)</summary>
            <div>
              <label>
                Documento
                <select
                  value={fiscalDocument}
                  onChange={(e) => setFiscalDocument(e.target.value)}
                >
                  <option value="">Não informado</option>
                  <option>NFC-e modelo 65</option>
                  <option>NF-e modelo 55</option>
                </select>
              </label>
              <label>
                Chave de acesso autorizada pela SEF
                <input
                  maxLength="60"
                  value={fiscalKey}
                  onChange={(e) => setFiscalKey(e.target.value)}
                  placeholder="Somente após emissão autorizada"
                />
              </label>
            </div>
            <small>
              Este campo registra uma nota já autorizada. Ele não emite
              documento fiscal.
            </small>
          </details>
          <div className="order-total">
            <span>Total do pedido</span>
            <strong>{money(total)}</strong>
          </div>
          <div className="order-actions">
            <button
              className="primary"
              disabled={saving || !product || !method}
            >
              <ShoppingCart size={17} /> Registrar pedido e venda
            </button>
            {product && (
              <a
                className="whatsapp-button"
                href={whatsappUrl(message)}
                target="_blank"
                rel="noreferrer"
              >
                <Send size={16} /> Enviar pelo WhatsApp
              </a>
            )}
          </div>
        </form>
      </Card>
      {!initialProductId && (
        <Card
          title="Pedidos e vendas"
          subtitle={`${sales.length} registros`}
          action={
            <button onClick={exportSales}>
              <Download size={16} /> Exportar vendas
            </button>
          }
        >
          <div className="sale-list orders-list">
            {sales.slice(0, 20).map((s) => (
              <div key={s.id}>
                <span>
                  <b>
                    {s.order_number || `Venda #${s.id}`} ·{" "}
                    {s.product_name || "Produto"}
                  </b>
                  <small>
                    {s.customer_name || "Consumidor não identificado"} ·{" "}
                    {s.quantity} un.
                  </small>
                  <small>
                    {s.payment_code ? `${s.payment_code} — ` : ""}
                    {s.payment_method || "Forma não informada"}
                    {s.installments > 1 ? ` · ${s.installments}x` : ""} ·{" "}
                    {s.order_status || "Concluído"} · {date(s.sale_date)}
                  </small>
                  {s.transaction_reference && (
                    <small>Referência: {s.transaction_reference}</small>
                  )}
                </span>
                <strong>{money(s.total_value)}</strong>
                {canManage && s.order_status !== "Cancelado" && (
                  <button className="delete" onClick={() => cancelSale(s)}>
                    <Trash2 size={15} /> Cancelar
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
function PaymentSettings() {
  const [methods, setMethods] = useState([]);
  const [savingId, setSavingId] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [dirtyIds, setDirtyIds] = useState([]);
  const load = () => api("/payment-methods").then((items) => setMethods(items));
  useEffect(() => {
    void load().catch(reportLoadError);
  }, []);
  const change = (id, key, value) => {
    setDirtyIds((current) =>
      current.includes(id) ? current : [...current, id],
    );
    setMethods((current) =>
      current.map((x) => (x.id === id ? { ...x, [key]: value } : x)),
    );
  };
  const save = async (method) => {
    if (savingId !== null) return;
    setSavingId(method.id);
    setFeedback(null);
    try {
      await api(`/payment-methods/${method.id}`, {
        method: "PUT",
        body: method,
      });
      setFeedback({
        message: `${method.name}: configuração salva.`,
        error: false,
      });
      setDirtyIds((current) => current.filter((id) => id !== method.id));
    } catch (e) {
      setFeedback({ message: e.message, error: true });
    } finally {
      setSavingId(null);
    }
  };
  return (
    <div className="payments-page">
      <Card
        title="Configuração das formas de pagamento"
        subtitle="Escolha como sua loja recebe e o que a equipe deve conferir em cada venda."
      >
        <div className="payments-intro">
          <CreditCard size={28} />
          <div>
            <b>Recebimentos organizados, do pedido à entrega</b>
            <p>
              Ativar uma forma permite selecioná-la nas vendas. A cobrança e a
              confirmação são feitas no seu banco, maquininha ou provedor: este
              sistema registra o pagamento, sem cobrar automaticamente.
            </p>
          </div>
        </div>
        <div className="payment-overview">
          <span>
            <b>{methods.filter((m) => m.active).length}</b> formas ativas
          </span>
          <span>1. Configure</span>
          <span>2. Confira o recebimento</span>
          <span>3. Registre a venda</span>
        </div>
        {feedback && (
          <div
            className={`payment-feedback ${feedback.error ? "error" : "success"}`}
            role={feedback.error ? "alert" : "status"}
          >
            {feedback.message}
          </div>
        )}
        <div className="payment-methods">
          {methods.map((method) => {
            const guide = paymentGuidance(method.code);
            return (
              <article key={method.id}>
                <div className="payment-method-heading">
                  <div>
                    <h4>{guide.title}</h4>
                    <p>{guide.description}</p>
                  </div>
                  <span className={`pill ${method.active ? "green" : ""}`}>
                    {dirtyIds.includes(method.id)
                      ? "Alterações não salvas"
                      : method.active
                        ? "Ativa nas vendas"
                        : "Desativada"}
                  </span>
                </div>
                <div className="payment-method-help">
                  <p>
                    <b>Como conferir:</b> {guide.steps}
                  </p>
                  <p>
                    <b>Referência:</b> {guide.reference}
                  </p>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save(method);
                  }}
                >
                  <fieldset
                    disabled={savingId !== null}
                    className="payment-config"
                  >
                    <label>
                      Nome exibido na venda
                      <input
                        required
                        minLength={2}
                        maxLength={80}
                        value={method.name}
                        onChange={(e) =>
                          change(method.id, "name", e.target.value)
                        }
                      />
                      <small>
                        Exemplo: Pix da loja ou Crédito na maquininha.
                      </small>
                    </label>
                    <label>
                      Máximo de parcelas
                      <input
                        type="number"
                        min="1"
                        max="24"
                        value={method.max_installments}
                        onChange={(e) =>
                          change(method.id, "max_installments", +e.target.value)
                        }
                      />
                      <small>
                        1 = à vista. Use as condições do seu provedor; o sistema
                        não calcula juros.
                      </small>
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={!!method.active}
                        onChange={(e) =>
                          change(method.id, "active", e.target.checked)
                        }
                      />{" "}
                      Disponível para vender
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={!!method.requires_reference}
                        onChange={(e) =>
                          change(
                            method.id,
                            "requires_reference",
                            e.target.checked,
                          )
                        }
                      />{" "}
                      Exigir código da transação
                    </label>
                    <label className="wide">
                      Orientação de pagamento
                      <textarea
                        rows={3}
                        maxLength="500"
                        value={method.instructions || ""}
                        onChange={(e) =>
                          change(method.id, "instructions", e.target.value)
                        }
                      />
                      <small>
                        Aparece no formulário de venda. Informe como pagar e
                        quando o pedido será liberado. Não informe senha, token
                        bancário, número de cartão ou CVV.
                      </small>
                    </label>
                  </fieldset>
                  <div className="payment-method-footer">
                    <button
                      type="button"
                      disabled={savingId !== null}
                      onClick={() =>
                        change(method.id, "instructions", guide.instructions)
                      }
                    >
                      Usar orientação sugerida
                    </button>
                    <button className="primary" disabled={savingId !== null}>
                      <Save size={16} />{" "}
                      {savingId === method.id
                        ? "Salvando…"
                        : "Salvar configuração"}
                    </button>
                  </div>
                </form>
              </article>
            );
          })}
        </div>
      </Card>
      <Card
        title="Prepare sua loja para vender online"
        subtitle="Um guia para organizar a operação antes de divulgar o site."
      >
        <div className="payment-selling-guide">
          <article>
            <h4>Identificação e atendimento</h4>
            <p>
              Exiba nome empresarial, CPF/CNPJ aplicável, endereço e canais de
              contato. Informe características dos produtos, disponibilidade e
              restrições.
            </p>
          </article>
          <article>
            <h4>Preço, entrega e parcelamento</h4>
            <p>
              Mostre o total, frete, eventuais encargos, condições de pagamento
              e prazo de entrega antes da confirmação. Combine retirada ou
              entrega com o cliente; o sistema atual não calcula frete nem
              juros.
            </p>
          </article>
          <article>
            <h4>Confirmação do pagamento</h4>
            <p>
              Use um banco ou provedor contratado. Confira o crédito ou a
              aprovação antes de marcar como Pago ou Concluído. Para cobrança
              automática no site, ainda é necessária uma integração com um
              provedor.
            </p>
          </article>
          <article>
            <h4>Trocas, devoluções e privacidade</h4>
            <p>
              Disponibilize canais para cancelamento e arrependimento, com
              orientação sobre o prazo legal de 7 dias nas compras fora do
              estabelecimento. Informe o uso dos dados pessoais e prepare o
              atendimento a devoluções e reembolsos.
            </p>
          </article>
        </div>
        <p className="payment-guide-note">
          A emissão fiscal deve ser configurada com sua contabilidade e um
          serviço emissor adequado. O campo fiscal da venda registra uma nota já
          emitida; ele não emite a nota. Este guia não certifica a conformidade
          da loja.
        </p>
        <div className="payment-source-links">
          <a
            href="https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm"
            target="_blank"
            rel="noreferrer"
          >
            Regras do comércio eletrônico
          </a>
          <a
            href="https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm"
            target="_blank"
            rel="noreferrer"
          >
            Código de Defesa do Consumidor
          </a>
          <a
            href="https://www.bcb.gov.br/meubc/faqs/s/golpes"
            target="_blank"
            rel="noreferrer"
          >
            Cuidados com comprovantes Pix
          </a>
        </div>
      </Card>
    </div>
  );
}
function Users({ canManage }) {
  const [users, setUsers] = useState([]),
    [edit, setEdit] = useState(),
    [show, setShow] = useState(false),
    [tab, setTab] = useState(
      location.hash.startsWith("#/admin/cadastros") ? "team" : "clients",
    ),
    [query, setQuery] = useState("");
  const load = () => api("/users").then((items) => setUsers(items));
  useEffect(() => {
    void load().catch(reportLoadError);
  }, []);
  const del = async (u) => {
    if (confirm(`Excluir permanentemente ${u.name}?`))
      try {
        await api(`/users/${u.id}`, { method: "DELETE" });
        void load().catch(reportLoadError);
      } catch (e) {
        alert(e.message);
      }
  };
  const today = useStoreToday(),
    birthdays = users.filter(
      (x) =>
        x.role === "cliente" && x.birth_date?.slice(5, 7) === today.slice(5, 7),
    ),
    visible = users.filter(
      (x) =>
        (tab === "clients" ? x.role === "cliente" : x.role !== "cliente") &&
        [x.name, x.username, x.email, x.phone, x.cpf].some((v) =>
          String(v || "")
            .toLowerCase()
            .includes(query.toLowerCase()),
        ),
    );
  return (
    <>
      <div className="admin-summary">
        <article>
          <span>Clientes</span>
          <strong>{users.filter((x) => x.role === "cliente").length}</strong>
        </article>
        <article>
          <span>Equipe</span>
          <strong>{users.filter((x) => x.role !== "cliente").length}</strong>
        </article>
        <article>
          <span>Aniversariantes do mês</span>
          <strong>{birthdays.length}</strong>
        </article>
      </div>
      {birthdays.length > 0 && (
        <div className="birthday">
          🎂 Aniversariantes deste mês:{" "}
          {birthdays.map((x) => `${x.name} (${date(x.birth_date)})`).join(", ")}
        </div>
      )}
      <div className="page-tabs">
        <button
          className={tab === "orders" ? "active" : ""}
          onClick={() => setTab("orders")}
        >
          <ReceiptText size={16} /> Pedidos e vendas
        </button>
        <button
          className={tab === "clients" ? "active" : ""}
          onClick={() => setTab("clients")}
        >
          <UsersRound size={16} /> Clientes
        </button>
        <button
          className={tab === "team" ? "active" : ""}
          onClick={() => setTab("team")}
        >
          <UserCog size={16} /> Equipe
        </button>
      </div>
      {tab === "orders" ? (
        <CustomerOrders users={users} canManage={canManage} />
      ) : (
        <Card
          title={
            tab === "clients"
              ? "Administração de clientes"
              : "Administração da equipe"
          }
          subtitle={`${visible.length} registros encontrados`}
          action={
            canManage && (
              <button
                className="primary"
                onClick={() => {
                  setEdit(null);
                  setShow(true);
                }}
              >
                <UserPlus size={17} /> Novo cadastro
              </button>
            )
          }
        >
          <div className="toolbar">
            <input
              className="search"
              placeholder="Buscar por nome, usuário, CPF, telefone ou e-mail…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Pessoa</th>
                  <th>Contato</th>
                  <th>Nascimento / CPF</th>
                  <th>Preferências</th>
                  {canManage && <th>Ações</th>}
                </tr>
              </thead>
              <tbody>
                {visible.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="product-cell">
                        {u.has_image ? (
                          <UserImage user={u} className="round" />
                        ) : (
                          <div className="avatar">{u.name?.[0]}</div>
                        )}
                        <span>
                          <b>{u.name}</b>
                          <small>
                            @{u.username} · {u.role}
                          </small>
                        </span>
                      </div>
                    </td>
                    <td>
                      {u.email || "—"}
                      <small className="block">
                        {u.phone || "Sem telefone"}
                      </small>
                    </td>
                    <td>
                      {date(u.birth_date)}
                      <small className="block">
                        {u.cpf || "CPF não informado"}
                      </small>
                    </td>
                    <td>
                      {u.preferred_type || "—"}
                      <small className="block">
                        {u.preferred_brand || ""} {u.preferred_style || ""}
                      </small>
                    </td>
                    {canManage && (
                      <td className="row-actions">
                        <button
                          onClick={() => {
                            setEdit(u);
                            setShow(true);
                          }}
                        >
                          <Pencil size={15} /> Editar
                        </button>
                        <button className="delete" onClick={() => del(u)}>
                          <Trash2 size={15} /> Excluir
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!visible.length && <Empty />}
          </div>
        </Card>
      )}
      {show && (
        <UserForm
          user={edit}
          onClose={() => setShow(false)}
          onSaved={() => {
            setShow(false);
            void load().catch(reportLoadError);
          }}
        />
      )}
    </>
  );
}
function UserForm({ user, onClose, onSaved }) {
  const [v, setV] = useState(
      user ? { ...blankUser, ...user, password: "" } : blankUser,
    ),
    [confirmPassword, setConfirmPassword] = useState(""),
    [showPassword, setShowPassword] = useState(false),
    [saving, setSaving] = useState(false),
    [profileImage, setProfileImage] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (v.password !== confirmPassword) return alert("As senhas não coincidem");
    if (
      v.password &&
      !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,72}$/.test(v.password)
    )
      return alert(
        "Use uma senha de 8 a 72 caracteres, com maiúscula, minúscula e número",
      );
    setSaving(true);
    try {
      const result = await api(user ? `/users/${user.id}` : "/users", {
          method: user ? "PUT" : "POST",
          body: v,
        }),
        targetId = user?.id || result.id;
      if (profileImage) {
        const imageData = new FormData();
        imageData.append("image", profileImage);
        await api(`/users/${targetId}/image`, {
          method: "PUT",
          body: imageData,
        });
      }
      onSaved();
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };
  const change = (key, value) => setV({ ...v, [key]: value });
  return (
    <Modal title={user ? "Editar cadastro" : "Novo cadastro"} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <div className="profile-upload wide">
          {user?.has_image ? (
            <UserImage user={user} />
          ) : (
            <div className="avatar">{v.name?.[0] || "?"}</div>
          )}
          <label>
            Foto de perfil
            <input
              type="file"
              accept="image/png,image/jpeg"
              onChange={(e) => setProfileImage(e.target.files[0] || null)}
            />
            <small>
              PNG ou JPEG, até 4 MB. A imagem será salva no banco de dados.
            </small>
          </label>
        </div>
        <div className="form-section wide">
          <b>Dados de acesso</b>
          <small>Campos obrigatórios e protegidos</small>
        </div>
        <label>
          Nome completo
          <input
            required
            minLength="3"
            maxLength="120"
            autoComplete="name"
            value={v.name}
            onChange={(e) => change("name", e.target.value)}
          />
        </label>
        <label>
          Nome de usuário
          <input
            required
            minLength="3"
            maxLength="40"
            pattern="[A-Za-z0-9._\-]+"
            autoComplete="username"
            value={v.username}
            onChange={(e) => change("username", e.target.value)}
          />
        </label>
        <label>
          Senha {user && "(vazia para manter)"}
          <input
            required={!user}
            minLength={v.password ? 8 : undefined}
            maxLength="72"
            autoComplete="new-password"
            type={showPassword ? "text" : "password"}
            value={v.password}
            onChange={(e) => change("password", e.target.value)}
          />
          <small>8+ caracteres, maiúscula, minúscula e número</small>
        </label>
        <label>
          Confirmar senha
          <input
            required={!!v.password}
            autoComplete="new-password"
            type={showPassword ? "text" : "password"}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </label>
        <label className="show-password wide">
          <input
            type="checkbox"
            checked={showPassword}
            onChange={(e) => setShowPassword(e.target.checked)}
          />{" "}
          Mostrar senhas
        </label>
        <label>
          Perfil de acesso
          <select
            value={v.role}
            onChange={(e) => change("role", e.target.value)}
          >
            <option value="cliente">Cliente</option>
            <option value="funcionario">Funcionário</option>
            <option value="admin">Administrador</option>
          </select>
        </label>
        <div className={`permission-preview wide ${v.role}`}>
          <b>{ROLE_PERMISSIONS[v.role].title}</b>
          <p>{ROLE_PERMISSIONS[v.role].text}</p>
        </div>
        <div className="form-section wide">
          <b>Informações pessoais e contato</b>
          <small>Dados usados no atendimento da loja</small>
        </div>
        <label>
          Nascimento
          <input
            type="date"
            min="1920-01-01"
            max={storeToday()}
            value={v.birth_date || ""}
            onChange={(e) => change("birth_date", e.target.value)}
          />
        </label>
        <label>
          CPF
          <input
            maxLength="18"
            inputMode="numeric"
            value={v.cpf || ""}
            onChange={(e) => change("cpf", e.target.value)}
          />
        </label>
        <label>
          E-mail
          <input
            type="email"
            maxLength="150"
            autoComplete="email"
            value={v.email || ""}
            onChange={(e) => change("email", e.target.value)}
          />
        </label>
        <label>
          Telefone
          <input
            maxLength="25"
            autoComplete="tel"
            value={v.phone || ""}
            onChange={(e) => change("phone", e.target.value)}
          />
        </label>
        <div className="form-section wide">
          <b>Preferências do cliente</b>
          <small>Separe múltiplas opções por vírgula</small>
        </div>
        <label>
          Tipos favoritos
          <input
            maxLength="300"
            value={v.preferred_type || ""}
            onChange={(e) => change("preferred_type", e.target.value)}
          />
        </label>
        <label>
          Marcas favoritas
          <input
            maxLength="300"
            value={v.preferred_brand || ""}
            onChange={(e) => change("preferred_brand", e.target.value)}
          />
        </label>
        <label className="wide">
          Estilos favoritos
          <input
            maxLength="300"
            value={v.preferred_style || ""}
            onChange={(e) => change("preferred_style", e.target.value)}
          />
        </label>
        <div className="form-actions wide">
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" disabled={saving}>
            <Save size={16} />{" "}
            {saving ? "Salvando com segurança…" : "Salvar cadastro"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function AdminApp() {
  const [user, setUser] = useState(null),
    [loading, setLoading] = useState(!!localStorage.getItem("token"));
  useEffect(() => {
    const expired = () => {
      setUser(null);
      setLoading(false);
    };
    window.addEventListener("auth-expired", expired);
    const token = localStorage.getItem("token");
    if (token)
      api("/me")
        .then((currentUser) => {
          if (!["admin", "funcionario"].includes(currentUser.role))
            throw new Error("Use a área do cliente");
          setUser(currentUser);
        })
        .catch(() => {
          localStorage.removeItem("token");
          setUser(null);
        })
        .finally(() => setLoading(false));
    else setLoading(false);
    return () => window.removeEventListener("auth-expired", expired);
  }, []);
  return loading ? (
    <Loading />
  ) : user ? (
    <Shell user={user} setUser={setUser} />
  ) : (
    <Login onLogin={setUser} />
  );
}
function App() {
  const [route, setRoute] = useState(() => location.hash.slice(1) || "/loja");
  useEffect(() => {
    const update = () => setRoute(location.hash.slice(1) || "/loja");
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return route.startsWith("/admin") ? (
    <AdminApp />
  ) : (
    <React.Suspense fallback={<Loading />}>
      <Storefront api={api} route={route} />
    </React.Suspense>
  );
}
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("Erro da interface", error, info);
  }
  render() {
    if (this.state.error)
      return (
        <main className="fatal-error">
          <img src="/assets/logo1.jpeg" />
          <h1>Não foi possível abrir esta tela</h1>
          <p>{this.state.error.message || "Ocorreu um erro inesperado."}</p>
          <button
            className="primary"
            onClick={() => window.location.reload()}
          >
            Tentar novamente
          </button>
        </main>
      );
    return this.props.children;
  }
}
const rootElement = document.getElementById("root");
if (rootElement)
  createRoot(rootElement).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
