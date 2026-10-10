import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  LogOut,
  MapPin,
  MessageCircle,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Trash2,
  UserRound,
} from "lucide-react";
import { expirationStatus, storeToday } from "./expiration.js";
import "./storefront.css";

const money = (value) =>
  (Number(value) || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const contact = (message) =>
  `https://wa.me/553598213049?text=${encodeURIComponent(message)}`;
const initialFilters = {
  q: "",
  category: "",
  brand: "",
  sort: "newest",
  stock: "available",
  min: "",
  max: "",
  page: 1,
};
const emptyCatalog = {
  items: [],
  categories: [],
  brands: [],
  total: 0,
  page: 1,
  pages: 1,
};
const readCart = () => {
  try {
    const stored = JSON.parse(localStorage.getItem("customerCart") || "[]");
    if (!Array.isArray(stored)) return [];
    const seen = new Set();
    return stored
      .filter((p) => {
        if (
          !p ||
          !Number.isSafeInteger(p.id) ||
          p.id < 1 ||
          seen.has(p.id) ||
          !Number.isSafeInteger(p.quantity) ||
          p.quantity < 1 ||
          p.quantity > 999 ||
          typeof p.name !== "string" ||
          !Number.isFinite(p.price) ||
          p.price < 0
        )
          return false;
        seen.add(p.id);
        return true;
      })
      .slice(0, 40);
  } catch {
    return [];
  }
};

function CustomerAccess({ api, register, onLogin, writable }) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    username: "",
    password: "",
    confirmation: "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const change = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    if (register && form.password !== form.confirmation) {
      setError("As senhas precisam ser iguais.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const { confirmation, ...body } = form;
      const result = await api(
        register ? "/customer/register" : "/customer/login",
        { method: "POST", body, session: "public" },
      );
      localStorage.setItem("customerToken", result.token);
      onLogin(result.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };
  const returnQuery = location.hash.includes("voltar=sacola")
    ? "?voltar=sacola"
    : "";
  return (
    <section className="customer-access">
      <div className="customer-access-story">
        <span className="store-eyebrow">SEU MOMENTO DE BELEZA</span>
        <h1>
          Uma conta.
          <br />
          Muitos favoritos.
        </h1>
        <p>
          Encontre produtos, monte sua sacola e converse com a loja para
          combinar seu pedido.
        </p>
        <ul>
          <li>
            <Check size={17} /> Catálogo aberto para explorar
          </li>
          <li>
            <Check size={17} /> Sacola para organizar sua escolha
          </li>
          <li>
            <Check size={17} /> Atendimento próximo pelo WhatsApp
          </li>
        </ul>
      </div>
      <div className="customer-access-form">
        <span className="store-eyebrow">ÁREA DO CLIENTE</span>
        <h2>{register ? "Crie sua conta" : "Que bom ter você aqui"}</h2>
        <p>
          {register
            ? "Seus dados ajudam a identificar seu cadastro e o atendimento."
            : "Entre com seu usuário de cliente para continuar."}
        </p>
        <form onSubmit={submit}>
          {register && (
            <>
              <label>
                Nome completo
                <input
                  required
                  minLength={3}
                  maxLength={120}
                  autoComplete="name"
                  value={form.name}
                  onChange={(e) => change("name", e.target.value)}
                />
              </label>
              <label>
                E-mail
                <input
                  required
                  type="email"
                  maxLength={150}
                  autoComplete="email"
                  value={form.email}
                  onChange={(e) => change("email", e.target.value)}
                />
              </label>
              <label>
                Telefone <small>(opcional)</small>
                <input
                  type="tel"
                  maxLength={25}
                  autoComplete="tel"
                  value={form.phone}
                  onChange={(e) => change("phone", e.target.value)}
                />
              </label>
            </>
          )}
          <label>
            Usuário
            <input
              required
              minLength={3}
              maxLength={40}
              pattern="[a-zA-Z0-9._\-]{3,40}"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={form.username}
              onChange={(e) => change("username", e.target.value)}
            />
            <small>
              Letras sem acentos, números, ponto, hífen ou sublinhado.
            </small>
          </label>
          <label>
            Senha
            <input
              required
              type="password"
              minLength={register ? 8 : undefined}
              maxLength={72}
              autoComplete={register ? "new-password" : "current-password"}
              value={form.password}
              onChange={(e) => change("password", e.target.value)}
            />
            {register && (
              <small>
                De 8 a 72 caracteres, com maiúscula, minúscula e número.
              </small>
            )}
          </label>
          {register && (
            <label>
              Confirme a senha
              <input
                required
                type="password"
                minLength={8}
                maxLength={72}
                autoComplete="new-password"
                value={form.confirmation}
                onChange={(e) => change("confirmation", e.target.value)}
              />
            </label>
          )}
          {error && (
            <p className="store-error" role="alert">
              {error}
            </p>
          )}
          {register && writable === false && (
            <p className="store-error">
              O cadastro está temporariamente indisponível. Fale com a loja pelo
              WhatsApp.
            </p>
          )}
          <button
            className="primary"
            disabled={saving || (register && writable === false)}
          >
            {saving
              ? "Aguarde…"
              : register
                ? "Criar minha conta"
                : "Entrar na minha conta"}
            <ArrowRight size={17} />
          </button>
        </form>
        <p>
          {register ? "Já tem uma conta?" : "Primeira vez por aqui?"}{" "}
          <a
            href={`#/cliente/${register ? "entrar" : "cadastrar"}${returnQuery}`}
          >
            {register ? "Entrar" : "Criar conta"}
          </a>
        </p>
        {!register && (
          <a
            className="customer-help"
            href={contact(
              "Olá! Preciso de ajuda para acessar minha conta de cliente.",
            )}
            target="_blank"
            rel="noreferrer"
          >
            Precisa de ajuda para acessar? Fale com a loja.
          </a>
        )}
        <small className="customer-access-note">
          Este acesso é exclusivo para clientes. A equipe tem uma entrada
          separada.
        </small>
      </div>
    </section>
  );
}

export default function Storefront({ api, route }) {
  const [user, setUser] = useState(null);
  const [checkingUser, setCheckingUser] = useState(
    !!localStorage.getItem("customerToken"),
  );
  const [writable, setWritable] = useState(null);
  const [filters, setFilters] = useState(initialFilters);
  const [catalog, setCatalog] = useState(emptyCatalog);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [cart, setCart] = useState(readCart);
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const quoteVersion = useRef(0);
  const isCart = route.startsWith("/sacola");
  const isRegister = route.startsWith("/cliente/cadastrar");
  const isAccess = isRegister || route.startsWith("/cliente/entrar");
  const isAccount = route === "/cliente";
  const showingCatalog = !isCart && !isAccess && !isAccount;
  useEffect(() => {
    let active = true;
    const expired = () => {
      setUser(null);
      setCheckingUser(false);
      setNotice(
        "Sua sessão de cliente expirou. Entre novamente para continuar.",
      );
    };
    window.addEventListener("customer-auth-expired", expired);
    if (localStorage.getItem("customerToken"))
      api("/me", { session: "customer" })
        .then((current) => {
          if (current.role !== "cliente") {
            localStorage.removeItem("customerToken");
            throw new Error("Use uma conta de cliente");
          }
          if (active) setUser(current);
        })
        .catch((e) => {
          if (e.status === 401 || e.status === 403)
            localStorage.removeItem("customerToken");
          if (active) {
            setUser(null);
            setNotice(e.message);
          }
        })
        .finally(() => {
          if (active) setCheckingUser(false);
        });
    api("/storage-status", { session: "public" })
      .then((status) => {
        if (active) setWritable(status.writable);
      })
      .catch(() => {});
    return () => {
      active = false;
      window.removeEventListener("customer-auth-expired", expired);
    };
  }, [api]);
  useEffect(() => {
    if (!showingCatalog) return;
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams(
        Object.entries(filters).filter(([, value]) => value !== ""),
      );
      api(`/catalog?${params}`, {
        session: "public",
        signal: controller.signal,
      })
        .then((result) => {
          setCatalog(result);
          setError("");
        })
        .catch((e) => {
          if (e.name !== "AbortError") setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [api, filters, refresh, showingCatalog]);
  useEffect(() => {
    const update = () => {
      if (document.visibilityState === "visible")
        setRefresh((value) => value + 1);
    };
    const timer = setInterval(update, 60000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("customerCart", JSON.stringify(cart));
    } catch {}
    setQuote(null);
    quoteVersion.current++;
  }, [cart]);
  useEffect(() => {
    setQuote(null);
    setQuoteError("");
    quoteVersion.current++;
  }, [user?.id]);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [route]);
  const updateFilter = (key, value) =>
    setFilters((current) => ({ ...current, [key]: value, page: 1 }));
  const count = cart.reduce((sum, p) => sum + p.quantity, 0);
  const estimatedCents = cart.reduce(
    (sum, p) => sum + Math.round(p.price * 100) * p.quantity,
    0,
  );
  const add = (product) => {
    const existing = cart.find((p) => p.id === product.id);
    if ((existing?.quantity || 0) >= Math.min(product.quantity, 999)) {
      setNotice("Você já adicionou a quantidade disponível desse produto.");
      return;
    }
    if (!existing && cart.length >= 40) {
      setNotice("Sua sacola pode ter até 40 produtos diferentes.");
      return;
    }
    setCart((current) =>
      existing
        ? current.map((p) =>
            p.id === product.id ? { ...p, quantity: p.quantity + 1 } : p,
          )
        : [
            ...current,
            {
              id: product.id,
              name: product.name,
              price: product.price,
              image_url: product.image_url,
              quantity: 1,
            },
          ],
    );
    setNotice(`${product.name} adicionado à sacola.`);
  };
  const login = (current) => {
    setUser(current);
    setNotice("");
    location.hash = route.includes("voltar=sacola") ? "/sacola" : "/cliente";
  };
  const logout = () => {
    localStorage.removeItem("customerToken");
    setUser(null);
    setQuote(null);
    location.hash = "/loja";
  };
  const prepare = async () => {
    if (!user) {
      location.hash = "/cliente/entrar?voltar=sacola";
      return;
    }
    if (quoting) return;
    setQuoting(true);
    setQuoteError("");
    setQuote(null);
    const version = ++quoteVersion.current;
    try {
      const result = await api(
        `/catalog/quote?items=${encodeURIComponent(JSON.stringify(cart.map(({ id, quantity }) => ({ id, quantity }))))}`,
        { session: "customer" },
      );
      if (version === quoteVersion.current) setQuote(result);
    } catch (e) {
      setQuoteError(e.message);
    } finally {
      setQuoting(false);
    }
  };
  const message = useMemo(
    () =>
      quote
        ? `Olá! Sou ${user?.name || "cliente"} (@${user?.username || ""}) e gostaria de combinar este pedido:\n${quote.items.map((p) => `${p.quantity}x ${p.name} (#${p.id}) — ${money(p.total_cents / 100)}`).join("\n")}\nProdutos: ${money(quote.total_cents / 100)}.\nPor favor, confirme disponibilidade, pagamento e entrega ou retirada. Frete a combinar.`
        : "",
    [quote, user],
  );
  const heroProduct = catalog.items.find((p) => p.image_url);
  return (
    <div className="storefront">
      <div className="store-topline">
        Beleza e cuidado, com atendimento próximo.{" "}
        <a
          href={contact("Olá! Gostaria de falar com a loja.")}
          target="_blank"
          rel="noreferrer"
        >
          Fale com a Berenice <MessageCircle size={13} />
        </a>
      </div>
      <header className="store-header">
        <a href="#/loja" className="store-brand">
          <img
            src="/assets/logo1.jpeg"
            alt="Cores & Fragrâncias by Berenice"
            width="52"
            height="52"
          />
          <span>
            Cores & Fragrâncias<small>by Berenice</small>
          </span>
        </a>
        <nav aria-label="Navegação da loja">
          <a href="#/loja">Explorar produtos</a>
          <a href={user ? "#/cliente" : "#/cliente/entrar"}>
            <UserRound size={18} />
            <span>{user ? user.name.split(" ")[0] : "Entrar"}</span>
          </a>
          {!user && (
            <a href="#/cliente/cadastrar" className="store-register-link">
              Criar conta
            </a>
          )}
          <a
            href="#/sacola"
            className="store-bag"
            aria-label={`Sacola com ${count} unidades`}
          >
            <ShoppingBag size={19} /> Sacola <b>{count}</b>
          </a>
        </nav>
      </header>
      <main className="store-main">
        {notice && (
          <div className="store-notice" role="status">
            <span>{notice}</span>
            <button aria-label="Fechar aviso" onClick={() => setNotice("")}>
              ×
            </button>
          </div>
        )}
        {writable === false && (
          <p className="store-notice">
            O catálogo está disponível. Novos cadastros estão temporariamente
            indisponíveis; fale com a loja para atendimento.
          </p>
        )}
        {isAccess ? (
          checkingUser ? (
            <p role="status">Verificando seu acesso…</p>
          ) : user ? (
            <section className="store-account">
              <h1>Você já está na sua conta, {user.name.split(" ")[0]}.</h1>
              <a className="button primary" href="#/loja">
                Explorar produtos
              </a>
              <button onClick={logout}>Sair da conta</button>
            </section>
          ) : (
            <CustomerAccess
              key={isRegister ? "register" : "login"}
              api={api}
              register={isRegister}
              onLogin={login}
              writable={writable}
            />
          )
        ) : isAccount ? (
          <section className="store-account">
            <span className="store-eyebrow">MINHA CONTA</span>
            {checkingUser ? (
              <p>Carregando sua conta…</p>
            ) : user ? (
              <>
                <h1>Olá, {user.name.split(" ")[0]}.</h1>
                <p>Seu espaço para escolher e conversar com a loja.</p>
                <div className="store-account-details">
                  <b>{user.name}</b>
                  <span>@{user.username}</span>
                  <span>{user.email}</span>
                  {user.phone && <span>{user.phone}</span>}
                </div>
                <div className="store-account-actions">
                  <a className="button primary" href="#/loja">
                    Encontrar meus favoritos
                  </a>
                  <a className="button" href="#/sacola">
                    Ver sacola ({count})
                  </a>
                  <button onClick={logout}>
                    <LogOut size={16} /> Sair da conta
                  </button>
                </div>
                <p className="store-fineprint">
                  Seu pedido é combinado pelo WhatsApp. O envio da mensagem não
                  confirma pagamento nem reserva o estoque.
                </p>
              </>
            ) : (
              <>
                <h1>Entre para continuar.</h1>
                <a className="button primary" href="#/cliente/entrar">
                  Entrar como cliente
                </a>
              </>
            )}
          </section>
        ) : isCart ? (
          <section className="store-cart">
            <span className="store-eyebrow">SUAS ESCOLHAS</span>
            <h1>Minha sacola</h1>
            <p>
              Revise os produtos e confirme os valores antes de conversar com a
              loja.
            </p>
            {cart.length ? (
              <div className="store-cart-layout">
                <div>
                  {cart.map((p) => {
                    const currentQuote = quote?.items.find(
                      (item) => item.id === p.id,
                    );
                    return (
                      <article className="store-cart-item" key={p.id}>
                        {p.image_url && (
                          <img
                            src={p.image_url}
                            alt=""
                            width="80"
                            height="80"
                            loading="lazy"
                          />
                        )}
                        <div>
                          <h3>{p.name}</h3>
                          <span>
                            {money(
                              currentQuote
                                ? currentQuote.unit_price_cents / 100
                                : p.price,
                            )}{" "}
                            / un.
                          </span>
                          <label>
                            Quantidade
                            <input
                              type="number"
                              min="1"
                              max="999"
                              value={p.quantity}
                              onChange={(e) => {
                                const quantity = Number(e.target.value);
                                if (
                                  Number.isInteger(quantity) &&
                                  quantity >= 1 &&
                                  quantity <= 999
                                )
                                  setCart((current) =>
                                    current.map((item) =>
                                      item.id === p.id
                                        ? { ...item, quantity }
                                        : item,
                                    ),
                                  );
                              }}
                            />
                          </label>
                        </div>
                        <button
                          aria-label={`Remover ${p.name}`}
                          onClick={() =>
                            setCart((current) =>
                              current.filter((item) => item.id !== p.id),
                            )
                          }
                        >
                          <Trash2 size={17} />
                        </button>
                      </article>
                    );
                  })}
                </div>
                <aside className="store-cart-summary">
                  <h2>Resumo da sacola</h2>
                  <span>{count} unidades</span>
                  <div className="store-cart-total">
                    <span>Produtos</span>
                    <b>{money((quote?.total_cents ?? estimatedCents) / 100)}</b>
                  </div>
                  <p>
                    Frete e condições de pagamento a combinar. O total acima não
                    inclui entrega.
                  </p>
                  {quoteError && (
                    <p className="store-error" role="alert">
                      {quoteError}
                    </p>
                  )}
                  {quote ? (
                    <>
                      <p className="store-confirmed">
                        <Check size={17} /> Valores e estoque consultados agora.
                      </p>
                      <a
                        className="whatsapp-button"
                        href={contact(message)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <MessageCircle size={17} /> Enviar pedido pelo WhatsApp
                      </a>
                      <button onClick={prepare} disabled={quoting}>
                        Conferir novamente
                      </button>
                    </>
                  ) : (
                    <button
                      className="primary"
                      disabled={quoting || checkingUser}
                      onClick={prepare}
                    >
                      {quoting
                        ? "Conferindo…"
                        : user
                          ? "Conferir valores e disponibilidade"
                          : "Entrar para continuar"}
                    </button>
                  )}
                  <small>
                    A sacola não reserva estoque. A loja confirma o pedido, o
                    recebimento e a entrega no atendimento.
                  </small>
                </aside>
              </div>
            ) : (
              <div className="store-empty">
                <ShoppingBag size={36} />
                <h2>Sua sacola está esperando seus favoritos.</h2>
                <a className="button primary" href="#/loja">
                  Explorar o catálogo
                </a>
              </div>
            )}
          </section>
        ) : (
          <>
            <section className="store-hero">
              <div>
                <span className="store-eyebrow">CORES, FRAGRÂNCIAS & VOCÊ</span>
                <h1>
                  Um novo favorito
                  <br />
                  para cada momento.
                </h1>
                <p>
                  Fragrâncias, maquiagem e cuidados escolhidos com carinho.
                  Encontre o que combina com você.
                </p>
                <button
                  className="primary"
                  onClick={() =>
                    document
                      .getElementById("store-products")
                      ?.scrollIntoView({ behavior: "smooth" })
                  }
                >
                  Explorar a coleção <ArrowRight size={18} />
                </button>
                <div
                  className="store-customer-access"
                  aria-label="Acesso do cliente"
                >
                  <small>Cliente · compre e acompanhe sua conta</small>
                  {user ? (
                    <a className="button" href="#/cliente">
                      <UserRound size={17} /> Minha conta
                    </a>
                  ) : (
                    <>
                      <a className="button primary" href="#/cliente/entrar">
                        <UserRound size={17} /> Entrar como cliente
                      </a>
                      <a className="button" href="#/cliente/cadastrar">
                        Cadastrar cliente <ArrowRight size={17} />
                      </a>
                    </>
                  )}
                </div>
                <div
                  className="store-customer-access"
                  aria-label="Acesso administrativo"
                >
                  <small>Equipe administrativa · gestão da loja</small>
                  <a className="button primary" href="#/admin">
                    <UserRound size={17} /> Login administrativo
                  </a>
                  <a className="button" href="#/admin/cadastros">
                    Cadastro da equipe <ArrowRight size={17} />
                  </a>
                  <p className="store-access-note">
                    O cadastro da equipe é feito por um administrador após
                    entrar no sistema.
                  </p>
                </div>
              </div>
              <div className="store-hero-image">
                {heroProduct ? (
                  <img
                    src={heroProduct.image_url}
                    alt={heroProduct.name}
                    width="360"
                    height="360"
                    fetchPriority="high"
                  />
                ) : (
                  <img
                    src="/assets/logo1.jpeg"
                    alt="Cores & Fragrâncias by Berenice"
                    width="360"
                    height="360"
                  />
                )}
                <span>Escolhas que encantam.</span>
              </div>
            </section>
            <div className="store-benefits">
              <span>
                <MessageCircle size={17} /> Atendimento pelo WhatsApp
              </span>
              <span>
                <MapPin size={17} /> Varginha · MG
              </span>
              <span>
                <ShoppingBag size={17} /> Entrega ou retirada a combinar
              </span>
            </div>
            <section id="store-products" className="store-products">
              <div className="store-section-title">
                <div>
                  <span className="store-eyebrow">ENCONTRE O SEU</span>
                  <h2>Explore nossos produtos</h2>
                </div>
                <span>
                  {loading
                    ? "Buscando…"
                    : `${catalog.total} produtos encontrados`}
                </span>
              </div>
              <div className="store-search">
                <Search size={21} />
                <input
                  aria-label="Buscar produtos"
                  placeholder="Busque por produto, marca, categoria ou estilo"
                  maxLength={160}
                  value={filters.q}
                  onChange={(e) => updateFilter("q", e.target.value)}
                />
                {filters.q && (
                  <button
                    aria-label="Limpar busca"
                    onClick={() => updateFilter("q", "")}
                  >
                    ×
                  </button>
                )}
              </div>
              <div className="store-filters">
                <label>
                  Categoria
                  <select
                    value={filters.category}
                    onChange={(e) => updateFilter("category", e.target.value)}
                  >
                    <option value="">Todas as categorias</option>
                    {catalog.categories.map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Marca
                  <select
                    value={filters.brand}
                    onChange={(e) => updateFilter("brand", e.target.value)}
                  >
                    <option value="">Todas as marcas</option>
                    {catalog.brands.map((brand) => (
                      <option key={brand}>{brand}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Ordenar por
                  <select
                    value={filters.sort}
                    onChange={(e) => updateFilter("sort", e.target.value)}
                  >
                    <option value="newest">Novidades</option>
                    <option value="price-asc">Menor preço</option>
                    <option value="price-desc">Maior preço</option>
                    <option value="name">Nome: A a Z</option>
                  </select>
                </label>
                <details className="store-price-filters">
                  <summary>
                    <SlidersHorizontal size={15} /> Mais filtros
                  </summary>
                  <div>
                    <label>
                      Preço mínimo
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={filters.min}
                        onChange={(e) => updateFilter("min", e.target.value)}
                      />
                    </label>
                    <label>
                      Preço máximo
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={filters.max}
                        onChange={(e) => updateFilter("max", e.target.value)}
                      />
                    </label>
                    <label className="store-check">
                      <input
                        type="checkbox"
                        checked={filters.stock === "all"}
                        onChange={(e) =>
                          updateFilter(
                            "stock",
                            e.target.checked ? "all" : "available",
                          )
                        }
                      />{" "}
                      Mostrar também esgotados
                    </label>
                  </div>
                </details>
                <button onClick={() => setFilters(initialFilters)}>
                  Limpar filtros
                </button>
              </div>
              {error && (
                <div className="store-error" role="alert">
                  {error}{" "}
                  <button onClick={() => setRefresh((value) => value + 1)}>
                    Tentar novamente
                  </button>
                </div>
              )}
              <div className="store-product-grid" aria-busy={loading}>
                {!error &&
                  catalog.items.map((p) => {
                    const expiry = expirationStatus(
                      p.expiration_date,
                      storeToday(),
                    );
                    return (
                      <article key={p.id}>
                        <div className="store-product-image">
                          {p.image_url ? (
                            <img
                              src={p.image_url}
                              alt={p.name}
                              width="260"
                              height="260"
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            <ShoppingBag size={46} />
                          )}
                          {!p.quantity && <span>Esgotado</span>}
                        </div>
                        <div className="store-product-info">
                          <small>
                            {[p.brand, p.type].filter(Boolean).join(" · ") ||
                              "Seleção da loja"}
                          </small>
                          <h3>{p.name}</h3>
                          <p>{p.style || "Escolhido para o seu cuidado."}</p>
                          {expiry?.status === "soon" && (
                            <span className="store-expiry">
                              Validade:{" "}
                              {p.expiration_date.split("-").reverse().join("/")}
                            </span>
                          )}
                          <strong>{money(p.price)}</strong>
                          <button
                            className="primary"
                            disabled={!p.quantity || loading}
                            onClick={() => add(p)}
                          >
                            <ShoppingBag size={16} />{" "}
                            {p.quantity ? "Adicionar à sacola" : "Indisponível"}
                          </button>
                        </div>
                      </article>
                    );
                  })}
              </div>
              {!loading && !error && !catalog.items.length && (
                <div className="store-empty">
                  <Search size={34} />
                  <h3>Nenhum produto com esses filtros.</h3>
                  <p>Tente outro nome, marca ou faixa de preço.</p>
                  <button onClick={() => setFilters(initialFilters)}>
                    Ver todos os produtos
                  </button>
                </div>
              )}
              {loading && !catalog.items.length && (
                <p role="status" className="store-loading">
                  Preparando a seleção para você…
                </p>
              )}
              {!error && catalog.pages > 1 && (
                <nav
                  className="store-pagination"
                  aria-label="Páginas do catálogo"
                >
                  <button
                    disabled={loading || catalog.page <= 1}
                    onClick={() =>
                      setFilters((current) => ({
                        ...current,
                        page: catalog.page - 1,
                      }))
                    }
                  >
                    Anterior
                  </button>
                  <span>
                    Página {catalog.page} de {catalog.pages}
                  </span>
                  <button
                    disabled={loading || catalog.page >= catalog.pages}
                    onClick={() =>
                      setFilters((current) => ({
                        ...current,
                        page: catalog.page + 1,
                      }))
                    }
                  >
                    Próxima
                  </button>
                </nav>
              )}
            </section>
            <section className="store-help">
              <div>
                <span className="store-eyebrow">UM TOQUE PESSOAL</span>
                <h2>Na dúvida sobre o que escolher?</h2>
                <p>
                  Converse com a loja para encontrar um produto que combine com
                  você.
                </p>
              </div>
              <a
                className="button"
                href={contact(
                  "Olá! Gostaria de ajuda para escolher meus produtos.",
                )}
                target="_blank"
                rel="noreferrer"
              >
                <MessageCircle size={18} /> Quero uma ajuda
              </a>
            </section>
          </>
        )}
      </main>
      <footer className="store-footer">
        <div>
          <b>Cores & Fragrâncias by Berenice</b>
          <p>Praça Pres. João Pessoa, 66 · Centro · Varginha, MG</p>
          <a
            href={contact("Olá! Gostaria de atendimento.")}
            target="_blank"
            rel="noreferrer"
          >
            WhatsApp: (35) 9821-3049
          </a>
        </div>
        <div>
          <a href="#/loja">Catálogo</a>
          <a href="#/cliente/entrar">Área do cliente</a>
          <a href="#/admin">Acesso da equipe</a>
          <small>Pagamento e entrega confirmados no atendimento.</small>
        </div>
      </footer>
    </div>
  );
}
