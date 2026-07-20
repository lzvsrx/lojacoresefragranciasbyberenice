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

const API = "/api";
const money = (v) =>
  Number(v || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const date = (v) => {
  if (!v) return "—";
  const value = String(v);
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
  const token = localStorage.getItem("token");
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  if (!(opts.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    if (opts.body && typeof opts.body !== "string")
      opts.body = JSON.stringify(opts.body);
  }
  let r;
  try {
    r = await fetch(API + path, {
      ...opts,
      headers: { ...headers, ...opts.headers },
    });
  } catch {
    throw new Error(
      "Servidor indisponível. Verifique a conexão e tente novamente.",
    );
  }
  if (r.status === 401 && path != "/login") {
    localStorage.removeItem("token");
    window.dispatchEvent(new Event("auth-expired"));
  }
  if (!r.ok) {
    let e;
    try {
      e = await r.json();
    } catch {}
    throw new Error(e?.error || "Não foi possível concluir");
  }
  return r.headers.get("content-type")?.includes("json") ? r.json() : r.blob();
};

function Login({ onLogin }) {
  const [form, setForm] = useState({ username: "admin", password: "admin123" }),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const x = await api("/login", { method: "POST", body: form });
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
        <form onSubmit={submit}>
          <label>
            Usuário
            <input
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="primary">
            <LogIn size={17} /> {loading ? "Entrando…" : "Entrar no sistema"}
          </button>
        </form>
        <small>Acesso inicial: admin / admin123</small>
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
      ? ["dashboard", "products", "users", "payments"]
      : user.role === "funcionario"
        ? ["dashboard", "products", "users"]
        : ["catalog"];
  const labels = {
    dashboard: "Visão geral",
    products: "Produtos & estoque",
    users: "Clientes & equipe",
    payments: "Formas de pagamento",
    catalog: "Catálogo",
  };
  const [page, setPage] = useState(allowed[0]);
  const logout = () => {
    localStorage.clear();
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
          {allowed.map((x) =>
            (() => {
              const NavIcon = icons[x] || LayoutDashboard;
              return (
                <button
                  key={x}
                  className={page === x ? "active" : ""}
                  onClick={() => setPage(x)}
                >
                  <NavIcon size={19} />
                  {labels[x]}
                </button>
              );
            })(),
          )}
        </nav>
        <div className="profile">
          {user.has_image ? (
            <img src={`${API}/users/${user.id}/image`} />
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
        {page === "dashboard" && <Dashboard />}
        {page === "products" && (
          <Products canDelete={user.role === "admin"} />
        )}{" "}
        {page === "users" && <Users canManage={user.role === "admin"} />}{" "}
        {page === "payments" && <PaymentSettings />}{" "}
        {page === "catalog" && <Catalog user={user} />}
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
          <input hidden type="file" accept="image/*" onChange={upload} />
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
  const [d, setD] = useState(null);
  useEffect(() => {
    api("/dashboard").then(setD);
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
          detail="Histórico completo"
        />
        <Stat
          label="Faturamento"
          value={money(d.revenue)}
          detail="Receita acumulada"
          tone="rose"
        />
      </div>
      {d.birthdays.length > 0 && (
        <div className="birthday">
          🎂 Hoje é aniversário de {d.birthdays.map((x) => x.name).join(", ")}.
          Uma ótima oportunidade para entrar em contato!
        </div>
      )}
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
    setSaving(true);
    try {
      const f = new FormData();
      Object.entries(v).forEach(
        ([k, x]) => k !== "image_url" && x != null && f.append(k, x),
      );
      if (file) f.append("image", file);
      await api(product ? `/products/${product.id}` : "/products", {
        method: product ? "PUT" : "POST",
        body: f,
      });
      onSaved();
    } catch (e) {
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
            accept="image/*"
            onChange={(e) => setFile(e.target.files[0])}
          />
        </label>
        <div className="form-actions wide">
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary">
            <Save size={16} /> {saving ? "Salvando…" : "Salvar produto"}
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
  const [products, setProducts] = useState([]),
    [q, setQ] = useState(""),
    [edit, setEdit] = useState(undefined),
    [show, setShow] = useState(false);
  const load = () => api("/products").then(setProducts);
  useEffect(load, []);
  const filtered = products.filter((x) =>
    [x.name, x.brand, x.type, x.style, x.id].some((v) =>
      String(v || "")
        .toLowerCase()
        .includes(q.toLowerCase()),
    ),
  );
  const del = async (p) => {
    if (!confirm(`Excluir ${p.name}?`)) return;
    try {
      await api(`/products/${p.id}`, { method: "DELETE" });
      load();
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
      load();
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
                      <img src={p.image_url} />
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
                <td>{date(p.expiration_date)}</td>
                <td className="row-actions">
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
      {show && (
        <ProductForm
          product={edit}
          onClose={() => setShow(false)}
          onSaved={() => {
            setShow(false);
            load();
          }}
        />
      )}
    </Card>
  );
}
function Sales() {
  const [products, setProducts] = useState([]),
    [sales, setSales] = useState([]),
    [selected, setSelected] = useState(),
    [qty, setQty] = useState(1),
    [q, setQ] = useState("");
  const load = () =>
    Promise.all([api("/products"), api("/sales")]).then(([p, s]) => {
      setProducts(p);
      setSales(s);
      if (!selected) setSelected(p.find((x) => x.quantity > 0)?.id);
    });
  useEffect(load, []);
  const p = products.find((x) => x.id === +selected);
  const sell = async () => {
    try {
      const x = await api("/sales", {
        method: "POST",
        body: { product_id: selected, quantity: qty },
      });
      alert(`Venda concluída! Total: ${money(x.total)}`);
      setQty(1);
      load();
    } catch (e) {
      alert(e.message);
    }
  };
  const filtered = products.filter(
    (x) =>
      x.quantity > 0 &&
      [x.name, x.brand, x.id].some((v) =>
        String(v || "")
          .toLowerCase()
          .includes(q.toLowerCase()),
      ),
  );
  return (
    <div className="sales-grid">
      <Card
        title="Ponto de venda"
        subtitle="Selecione o produto e confirme a saída"
      >
        <input
          className="search"
          placeholder="Buscar produto…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="select-products">
          {filtered.slice(0, 30).map((x) => (
            <button
              key={x.id}
              className={+selected === x.id ? "selected" : ""}
              onClick={() => setSelected(x.id)}
            >
              {x.image_url ? <img src={x.image_url} /> : <span>◇</span>}
              <div>
                <b>{x.name}</b>
                <small>
                  {x.quantity} em estoque · {money(x.price)}
                </small>
              </div>
            </button>
          ))}
        </div>
        {p && (
          <div className="checkout">
            <div>
              <span>Total da venda</span>
              <strong>{money(p.price * qty)}</strong>
            </div>
            <label>
              Quantidade
              <input
                type="number"
                min="1"
                max={p.quantity}
                value={qty}
                onChange={(e) =>
                  setQty(Math.max(1, Math.min(p.quantity, +e.target.value)))
                }
              />
            </label>
            <button className="primary" onClick={sell}>
              Confirmar venda
            </button>
          </div>
        )}
      </Card>
      <Card title="Vendas recentes" subtitle={`${sales.length} registros`}>
        <div className="sale-list">
          {sales.slice(0, 15).map((s) => (
            <div key={s.id}>
              <span>
                <b>{s.product_name || "Produto removido"}</b>
                <small>
                  {date(s.sale_date)} · {s.user_name || "Sistema"} ·{" "}
                  {s.quantity} un.
                </small>
              </span>
              <strong>{money(s.total_value)}</strong>
            </div>
          ))}
        </div>
      </Card>
    </div>
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
function CustomerOrders({ users }) {
  const [products, setProducts] = useState([]),
    [sales, setSales] = useState([]),
    [methods, setMethods] = useState([]),
    [productId, setProductId] = useState(""),
    [customerId, setCustomerId] = useState(""),
    [quantity, setQuantity] = useState(1),
    [methodId, setMethodId] = useState(""),
    [reference, setReference] = useState(""),
    [installments, setInstallments] = useState(1),
    [received, setReceived] = useState(""),
    [status, setStatus] = useState("Concluído"),
    [fiscalDocument, setFiscalDocument] = useState(""),
    [fiscalKey, setFiscalKey] = useState("");
  const load = () =>
    Promise.all([
      api("/products"),
      api("/sales"),
      api("/payment-methods"),
    ]).then(([p, s, m]) => {
      setProducts(p.filter((x) => x.quantity > 0));
      setSales(s);
      setMethods(m.filter((x) => x.active));
      if (!productId && p.length)
        setProductId(String(p.find((x) => x.quantity > 0)?.id || ""));
      if (!methodId && m.some((x) => x.active))
        setMethodId(String(m.find((x) => x.active).id));
    });
  useEffect(load, []);
  const product = products.find((x) => x.id === +productId),
    client = users.find((x) => x.id === +customerId),
    method = methods.find((x) => x.id === +methodId),
    total = (product?.price || 0) * quantity,
    change =
      method?.code === "01" && received ? Math.max(0, +received - total) : 0;
  const submit = async (e) => {
    e.preventDefault();
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
      setQuantity(1);
      setReference("");
      setReceived("");
      setFiscalDocument("");
      setFiscalKey("");
      load();
    } catch (e) {
      alert(e.message);
    }
  };
  const clients = users.filter((x) => x.role === "cliente"),
    message = product
      ? `Olá${client?.name ? ` ${client.name}` : ""}! Seu pedido na Cores & Fragrâncias by Berenice: ${quantity}x ${product.name}, total ${money(total)}, pagamento por ${method?.name || "a combinar"}. Retirada em ${STORE_ADDRESS}.`
      : "";
  return (
    <div className="orders-layout">
      <Card
        title="Novo pedido e venda"
        subtitle="Pagamento identificado e estoque transacional"
      >
        <form className="order-form" onSubmit={submit}>
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
            </label>
          </div>
          {method && (
            <div className="payment-details">
              {method.requires_reference === 1 && (
                <label>
                  TxID, EndToEndId, NSU ou autorização
                  <input
                    required
                    maxLength="100"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="Somente o código da transação"
                  />
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
            <button className="primary" disabled={!productId || !methodId}>
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
      <Card title="Pedidos e vendas" subtitle={`${sales.length} registros`}>
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
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
function PaymentSettings() {
  const [methods, setMethods] = useState([]);
  const load = () => api("/payment-methods").then(setMethods);
  useEffect(load, []);
  const change = (id, key, value) =>
    setMethods(methods.map((x) => (x.id === id ? { ...x, [key]: value } : x)));
  const save = async (method) => {
    try {
      await api(`/payment-methods/${method.id}`, {
        method: "PUT",
        body: method,
      });
      alert("Forma de pagamento atualizada");
      load();
    } catch (e) {
      alert(e.message);
    }
  };
  return (
    <Card
      title="Configuração das formas de pagamento"
      subtitle="Códigos tPag nacionais usados na NF-e/NFC-e"
    >
      <div className="legal-note">
        <b>Controle financeiro, não emissor fiscal.</b>
        <p>
          A emissão de NFC-e exige credenciamento da empresa, certificado
          ICP-Brasil, CSC e autorização da SEF/MG. Não cadastre número completo
          de cartão, senha ou CVV.
        </p>
      </div>
      <div className="payment-methods">
        {methods.map((method) => (
          <article key={method.id}>
            <div className="payment-code">{method.code}</div>
            <div className="payment-config">
              <label>
                Nome
                <input
                  value={method.name}
                  onChange={(e) => change(method.id, "name", e.target.value)}
                />
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
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={!!method.active}
                  onChange={(e) =>
                    change(method.id, "active", e.target.checked)
                  }
                />{" "}
                Ativa
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={!!method.requires_reference}
                  onChange={(e) =>
                    change(method.id, "requires_reference", e.target.checked)
                  }
                />{" "}
                Exigir referência
              </label>
              <label className="wide">
                Instruções
                <input
                  maxLength="500"
                  value={method.instructions || ""}
                  onChange={(e) =>
                    change(method.id, "instructions", e.target.value)
                  }
                />
              </label>
            </div>
            <button onClick={() => save(method)}>
              <Save size={16} /> Salvar
            </button>
          </article>
        ))}
      </div>
    </Card>
  );
}
function Users({ canManage }) {
  const [users, setUsers] = useState([]),
    [edit, setEdit] = useState(),
    [show, setShow] = useState(false),
    [tab, setTab] = useState("clients"),
    [query, setQuery] = useState("");
  const load = () => api("/users").then(setUsers);
  useEffect(load, []);
  const del = async (u) => {
    if (confirm(`Excluir permanentemente ${u.name}?`))
      try {
        await api(`/users/${u.id}`, { method: "DELETE" });
        load();
      } catch (e) {
        alert(e.message);
      }
  };
  const today = new Date(),
    birthdays = users.filter(
      (x) =>
        x.role === "cliente" &&
        x.birth_date?.slice(5, 7) ===
          String(today.getMonth() + 1).padStart(2, "0"),
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
        <CustomerOrders users={users} />
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
                          <img
                            className="round"
                            src={`${API}/users/${u.id}/image`}
                          />
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
            load();
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
            <img src={`${API}/users/${user.id}/image`} />
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
              PNG ou JPEG, até 10 MB. A imagem será salva no banco de dados.
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
            pattern="[A-Za-z0-9._-]+"
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
          <span className="show-password">
            <input
              type="checkbox"
              checked={showPassword}
              onChange={(e) => setShowPassword(e.target.checked)}
            />{" "}
            Mostrar senhas
          </span>
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
            max={new Date().toISOString().slice(0, 10)}
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
function Catalog() {
  const [products, setProducts] = useState([]),
    [q, setQ] = useState(""),
    [type, setType] = useState("Todos");
  useEffect(() => {
    api("/products").then(setProducts);
  }, []);
  const types = [
    "Todos",
    ...new Set(products.map((x) => x.type).filter(Boolean)),
  ];
  const list = products.filter(
    (x) =>
      (type === "Todos" || x.type === type) &&
      [x.name, x.brand, x.style].some((v) =>
        String(v || "")
          .toLowerCase()
          .includes(q.toLowerCase()),
      ),
  );
  return (
    <>
      <div className="catalog-hero">
        <span>BELEZA QUE ENCANTA</span>
        <h1>Encontre o seu próximo favorito.</h1>
        <p>Explore fragrâncias, maquiagem e cuidados escolhidos para você.</p>
        <div className="catalog-contact">
          WhatsApp {STORE_PHONE} · {STORE_ADDRESS}
        </div>
      </div>
      <div className="catalog-tools">
        <input
          className="search"
          placeholder="O que você procura?"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div>
          {types.slice(0, 8).map((x) => (
            <button
              className={type === x ? "active" : ""}
              onClick={() => setType(x)}
              key={x}
            >
              {x}
            </button>
          ))}
        </div>
      </div>
      <div className="catalog-grid">
        {list.map((p) => (
          <article key={p.id}>
            {p.image_url ? (
              <img src={p.image_url} />
            ) : (
              <div className="product-empty">◇</div>
            )}
            <small>
              {p.brand} · {p.type}
            </small>
            <h3>{p.name}</h3>
            <p>{p.style}</p>
            <footer>
              <b>{money(p.price)}</b>
              <span className={p.quantity ? "" : "sold"}>
                {p.quantity ? `${p.quantity} em estoque` : "Esgotado"}
              </span>
            </footer>
            {p.quantity > 0 && (
              <a
                className="whatsapp-button"
                href={whatsappUrl(
                  `Olá! Tenho interesse no produto ${p.name}, no valor de ${money(p.price)}. Vi que há ${p.quantity} unidade(s) em estoque.`,
                )}
                target="_blank"
                rel="noreferrer"
              >
                <MessageCircle size={16} /> Pedir pelo WhatsApp
              </a>
            )}
          </article>
        ))}
      </div>
      {!list.length && <Empty />}
    </>
  );
}
function App() {
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
        .then(setUser)
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
            onClick={() => {
              localStorage.removeItem("token");
              location.href = "/";
            }}
          >
            <LogIn size={16} /> Voltar ao login
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
