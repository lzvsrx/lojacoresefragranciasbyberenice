import React, { useEffect, useState } from "react";
import "./commerce.css";
const money = (cents) =>
  (Number(cents || 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const date = (value) =>
  new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
const labels = {
  description: "Descrição e características",
  composition: "Composição / ingredientes",
  precautions: "Modo de uso, cuidados e riscos",
  volume: "Conteúdo / volume / unidade",
  manufacturer: "Fabricante / origem",
  anvisa_reference: "Referência de regularização Anvisa (quando aplicável)",
};
function useRemote(api, path, session = "public") {
  const [state, setState] = useState({ data: null, error: "" }),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setState({ data: null, error: "" });
    api(path, { session })
      .then((data) => {
        if (active) setState({ data, error: "" });
      })
      .catch((e) => {
        if (active) setState({ data: null, error: e.message });
      });
    return () => {
      active = false;
    };
  }, [api, path, session, revision]);
  return { ...state, reload: () => setRevision((r) => r + 1) };
}
function ErrorText({ message }) {
  return message ? (
    <p role="alert" className="commerce-error">
      {message}
    </p>
  ) : null;
}
export function ShopIdentity({ api }) {
  const s = useRemote(api, "/shop");
  return s.data ? (
    <div>
      <p>
        {s.data.legal_name || "Identificação legal em configuração"}
        {s.data.document && ` · CPF/CNPJ ${s.data.document}`}
      </p>
      {s.data.email && <a href={`mailto:${s.data.email}`}>{s.data.email}</a>}
      <p>{s.data.hours}</p>
    </div>
  ) : null;
}
function Loader({ state }) {
  return state.error ? (
    <>
      <ErrorText message={state.error} />
      <button onClick={state.reload}>Tentar novamente</button>
    </>
  ) : (
    <p role="status">Carregando…</p>
  );
}
export function ShopPolicies({ api, route }) {
  const s = useRemote(api, "/shop");
  if (!s.data) return <Loader state={s} />;
  const shop = s.data,
    type = route.split("/")[2] || "compra";
  return (
    <section className="commerce-page">
      <span className="store-eyebrow">INFORMAÇÕES DA LOJA</span>
      <h1>
        {{
          compra: "Condições de compra",
          entrega: "Entrega e pagamento",
          devolucoes: "Trocas, devoluções e arrependimento",
          privacidade: "Privacidade e seus dados",
        }[type] || "Informações da loja"}
      </h1>
      <nav className="commerce-actions">
        <a href="#/politicas/compra">Compra</a>
        <a href="#/politicas/entrega">Entrega</a>
        <a href="#/politicas/devolucoes">Devoluções</a>
        <a href="#/politicas/privacidade">Privacidade</a>
      </nav>
      <div className="commerce-card">
        <h2>Quem vende</h2>
        <p>{shop.trade_name}</p>
        <p>
          {shop.legal_name || "Identificação legal em configuração"}
          {shop.document && ` · CPF/CNPJ: ${shop.document}`}
        </p>
        <p>{shop.address}</p>
        <p>
          {shop.email && <a href={`mailto:${shop.email}`}>{shop.email}</a>} ·
          WhatsApp +{shop.phone}
        </p>
        <p>Atendimento: {shop.hours || "Consulte a loja"}.</p>
      </div>
      {type === "compra" && (
        <>
          <h2>Antes de concluir</h2>
          <p>
            Os preços estão em reais. O checkout mostra os produtos, as
            quantidades, o frete e o valor total antes da confirmação. Você pode
            corrigir a sacola e o endereço antes de finalizar. Não cobramos
            taxas adicionais neste checkout.
          </p>
          <p>
            Ao finalizar, o pedido recebe um número e uma reserva de 24 horas. A
            compra não é paga automaticamente. A equipe orienta o pagamento e
            confere o recebimento; não envie dados completos de cartão nem CVV.
            Uma reserva sem pagamento pode expirar. Caso já tenha pago, procure
            imediatamente o atendimento para conciliação ou restituição.
          </p>
          <p>
            As condições, os produtos e o total ficam registrados em Meus
            pedidos, onde você pode consultar e imprimir sua confirmação.
            Nenhuma condição limita os direitos previstos no Código de Defesa do
            Consumidor.
          </p>
          <p>
            O resumo do pedido não substitui nota fiscal. A loja deve
            disponibilizar o documento fiscal adequado à operação.
          </p>
        </>
      )}
      {type === "entrega" && (
        <>
          <h2>Retirada na loja</h2>
          <p>
            Sem frete, no endereço informado acima. Prazo de preparação: até{" "}
            {shop.pickup_days} dias úteis após a confirmação do pagamento.
            Aguarde o status “Pronto para retirada”.
          </p>
          <h2>Entrega</h2>
          {shop.delivery_enabled ? (
            <p>
              Região: {shop.delivery_region}. CEPs de {shop.cep_start} a{" "}
              {shop.cep_end}. Frete fixo de {money(shop.delivery_fee_cents)}.
              Prazo: até {shop.delivery_days} dias úteis após a confirmação do
              pagamento. O endereço e o frete são conferidos antes de finalizar.
            </p>
          ) : (
            <p>
              A entrega pelo checkout ainda não está disponível. A retirada é a
              opção disponível; fale com a loja sobre outras possibilidades
              antes de contratar.
            </p>
          )}
          <h2>Pagamento</h2>
          <p>
            As formas habilitadas aparecem no checkout. O pagamento é orientado
            e conferido pela equipe. Este site não coleta dados de cartão, gera
            cobranças ou confirma transferências automaticamente. O total do
            checkout é à vista, sem parcelamento automático. Não pague uma conta
            ou chave diferente da confirmada no canal oficial da loja.
          </p>
          <p>
            Acompanhe envio, retirada e entrega em Meus pedidos. Em caso de
            atraso, endereço incorreto ou problemas no recebimento, abra uma
            solicitação.
          </p>
        </>
      )}
      {type === "devolucoes" && (
        <>
          <h2>Arrependimento de compra online</h2>
          <p>
            Nas compras feitas fora do estabelecimento, você pode exercer o
            direito de arrependimento em até 7 dias a contar da assinatura ou do
            recebimento do produto, conforme o art. 49 do CDC. A solicitação não
            depende de justificativa e não gera ônus para o consumidor. Os
            valores pagos, inclusive o frete da compra, devem ser restituídos,
            nos termos da lei.
          </p>
          <p>
            Abra uma solicitação com o assunto “Arrependimento”. O protocolo e a
            data do recebimento aparecem imediatamente na tela. A loja orientará
            a logística de devolução e o reembolso. Não exigimos embalagem
            lacrada como condição geral para exercer esse direito.
          </p>
          <h2>Defeito, divergência ou avaria</h2>
          <p>
            Informe o problema no atendimento. Os direitos e prazos legais de
            garantia permanecem preservados; essa solicitação não se confunde
            com a troca por preferência. Guarde o produto e os documentos para
            facilitar a análise. Não continue usando um cosmético que cause
            reação adversa.
          </p>
          <p>
            Pedidos ainda aguardando pagamento podem ser cancelados diretamente
            em Meus pedidos. Para pedidos pagos, solicite atendimento; o
            registro de solicitação não significa que o estorno bancário já
            ocorreu.
          </p>
        </>
      )}
      {type === "privacidade" && (
        <>
          <h2>Para que usamos seus dados</h2>
          <p>
            Nome, usuário, e-mail e telefone identificam sua conta e permitem
            atendimento. O endereço é solicitado somente para entrega. Dados de
            pedidos e pagamentos são usados para executar a compra, cumprir
            obrigações legais e exercer direitos. A senha é armazenada por hash,
            sem disponibilização à equipe.
          </p>
          <p>
            O responsável pelo tratamento é o fornecedor identificado acima.
            Prestadores de hospedagem e banco processam os dados necessários à
            operação. Se você optar pelo WhatsApp, a mensagem será tratada
            também por esse serviço. A loja deve informar no atendimento os
            prestadores efetivamente contratados e eventuais transferências
            internacionais.
          </p>
          <h2>Armazenamento e segurança</h2>
          <p>
            Este projeto usa armazenamento no navegador para a sessão e a
            sacola. Não inclui publicidade comportamental ou analytics de
            terceiros. Fontes são carregadas do Google Fonts, que recebe os
            dados técnicos dessa conexão. Sair da conta remove sua sessão;
            “Limpar sacola” remove os itens deste navegador.
          </p>
          <p>
            Os dados são mantidos enquanto necessários ao atendimento, contrato
            e obrigações legais. A equipe deve avaliar os prazos e eliminar ou
            anonimizar o que não precisar conservar, inclusive em backups.
            Pedidos de exclusão não apagam automaticamente documentos que devam
            ser preservados por lei.
          </p>
          <h2>Seus direitos</h2>
          <p>
            Você pode acessar e corrigir seu cadastro, baixar seus dados e
            solicitar informações, correção, anonimização, bloqueio, eliminação
            e demais direitos aplicáveis pelo atendimento. A resposta depende da
            verificação de identidade e das hipóteses legais de conservação. Não
            há autorização automática para marketing ao se cadastrar ou comprar.
          </p>
        </>
      )}
      <a className="button primary" href="#/atendimento">
        Abrir atendimento
      </a>
      <p className="commerce-muted">
        Versão das condições: {shop.policy_version}.
      </p>
      <p className="commerce-muted">
        Referências:{" "}
        <a
          href="https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm"
          target="_blank"
          rel="noreferrer"
        >
          Decreto 7.962/2013
        </a>{" "}
        ·{" "}
        <a
          href="https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm"
          target="_blank"
          rel="noreferrer"
        >
          CDC
        </a>{" "}
        ·{" "}
        <a
          href="https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm"
          target="_blank"
          rel="noreferrer"
        >
          LGPD
        </a>
      </p>
    </section>
  );
}
export function ProductDetails({ api, id, onAdd }) {
  const s = useRemote(api, `/catalog/${id}/details`);
  if (!s.data) return <Loader state={s} />;
  const p = s.data;
  return (
    <section className="commerce-page">
      <a href="#/loja">← Voltar ao catálogo</a>
      <h1>{p.name}</h1>
      <p>
        {p.brand} · {p.type} · {p.style}
      </p>
      <strong>{money(Math.round(p.price * 100))}</strong>
      <p>
        {p.quantity > 0 ? `${p.quantity} unidades disponíveis` : "Esgotado"}
      </p>
      {p.expiration_date && (
        <p>Validade: {p.expiration_date.split("-").reverse().join("/")}</p>
      )}
      <dl className="commerce-card">
        {Object.entries(labels).map(([key, label]) => (
          <React.Fragment key={key}>
            <dt>{label}</dt>
            <dd>
              {p[key] ||
                "Informação ainda não cadastrada pela loja. Consulte antes de comprar."}
            </dd>
          </React.Fragment>
        ))}
      </dl>
      <button
        className="primary"
        disabled={p.quantity < 1}
        onClick={() => onAdd(p)}
      >
        Adicionar à sacola
      </button>
    </section>
  );
}
export function Checkout({ api, user, cart, onComplete }) {
  const [loaded, setLoaded] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState(false),
    [accepted, setAccepted] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState({
    type: "pickup",
    cep: "",
    street: "",
    number: "",
    district: "",
    city: "",
    state: "",
    complement: "",
    payment_method_id: "",
  });
  useEffect(() => {
    let active = true;
    if (user && cart.length)
      Promise.all([
        api("/shop", { session: "public" }),
        api("/shop/payment-methods", { session: "public" }),
        api(
          `/catalog/quote?items=${encodeURIComponent(JSON.stringify(cart.map(({ id, quantity }) => ({ id, quantity }))))}`,
          { session: "customer" },
        ),
      ])
        .then(([shop, methods, quote]) => {
          if (active) setLoaded({ shop, methods, quote });
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [api, user, cart]);
  const change = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    setReview(false);
    setAccepted(false);
    setKey(crypto.randomUUID());
  };
  if (!user)
    return (
      <section className="commerce-page">
        <h1>Entre para finalizar</h1>
        <a className="button primary" href="#/cliente/entrar?voltar=sacola">
          Login do cliente
        </a>
      </section>
    );
  if (!cart.length)
    return (
      <section className="commerce-page">
        <h1>Sua sacola está vazia</h1>
        <a href="#/loja">Ver produtos</a>
      </section>
    );
  if (!loaded)
    return (
      <section className="commerce-page">
        <ErrorText message={error} />
        {!error && <p>Conferindo sua sacola…</p>}
        <a href="#/sacola">Voltar à sacola</a>
      </section>
    );
  const { shop, methods, quote } = loaded,
    shipping = form.type === "delivery" ? shop.delivery_fee_cents : 0,
    total = quote.total_cents + shipping;
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!review) {
      setReview(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const order = await api("/customer/orders", {
        method: "POST",
        session: "customer",
        body: {
          items: cart.map(({ id, quantity }) => ({ id, quantity })),
          fulfillment: form,
          payment_method_id: Number(form.payment_method_id),
          expected_total_cents: total,
          policy_version: shop.policy_version,
          accepted,
          idempotency_key: key,
        },
      });
      onComplete(order);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="commerce-page">
      <span className="store-eyebrow">
        {review ? "2 · CONFIRMAÇÃO" : "1 · ENTREGA E PAGAMENTO"}
      </span>
      <h1>Finalizar pedido</h1>
      <a href="#/sacola">← Corrigir produtos e quantidades</a>
      {!shop.checkout_enabled || !shop.ready ? (
        <p role="alert" className="commerce-error">
          A loja ainda está configurando a finalização de compras. Você pode
          consultar os produtos e falar com o atendimento.
        </p>
      ) : null}
      <form onSubmit={submit} className="commerce-grid">
        <div className="commerce-card">
          <h2>Quem vai receber</h2>
          <p>
            {user.name} · {user.email}
          </p>
          <a href="#/atendimento">Corrigir meu cadastro</a>
          <label>
            Recebimento
            <select
              aria-label="Recebimento"
              value={form.type}
              onChange={(e) => change("type", e.target.value)}
            >
              <option value="pickup">Retirar na loja · sem frete</option>
              {shop.delivery_enabled && (
                <option value="delivery">
                  Entrega · {money(shop.delivery_fee_cents)}
                </option>
              )}
            </select>
          </label>
          {form.type === "pickup" ? (
            <p>
              {shop.address}. Até {shop.pickup_days} dias úteis após pagamento
              confirmado.
            </p>
          ) : (
            <>
              <p>
                {shop.delivery_region}. Até {shop.delivery_days} dias úteis após
                pagamento confirmado.
              </p>
              {[
                ["cep", "CEP"],
                ["street", "Rua"],
                ["number", "Número"],
                ["district", "Bairro"],
                ["city", "Cidade"],
                ["state", "UF"],
                ["complement", "Complemento"],
              ].map(([k, label]) => (
                <label key={k}>
                  {label}
                  <input
                    required={k !== "complement"}
                    maxLength={k === "state" ? 2 : 200}
                    autoComplete={
                      {
                        cep: "postal-code",
                        street: "address-line1",
                        city: "address-level2",
                        state: "address-level1",
                      }[k]
                    }
                    value={form[k]}
                    onChange={(e) => change(k, e.target.value)}
                  />
                </label>
              ))}
            </>
          )}
          <label>
            Forma de pagamento
            <select
              aria-label="Forma de pagamento"
              required
              value={form.payment_method_id}
              onChange={(e) => change("payment_method_id", e.target.value)}
            >
              <option value="">Selecione</option>
              {methods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <p>
            {
              methods.find((m) => m.id === Number(form.payment_method_id))
                ?.instructions
            }
          </p>
          <p>
            Pagamento à vista, conferido manualmente pela loja. A reserva dura
            24 horas. Você não será cobrado por este site.
          </p>
        </div>
        <div className="commerce-card">
          <h2>Revise seu pedido</h2>
          {quote.items.map((i) => (
            <p key={i.id}>
              {i.quantity} × {i.name}
              <br />
              {money(i.unit_price_cents)} por unidade · {money(i.total_cents)}
            </p>
          ))}
          <hr />
          <p>Produtos: {money(quote.total_cents)}</p>
          <p>Frete: {money(shipping)}</p>
          <h2>Total: {money(total)}</h2>
          <p>
            {shop.legal_name} · CPF/CNPJ {shop.document}
            <br />
            {shop.email}
          </p>
          {review && (
            <>
              <p>
                Confira os dados ao lado. Você pode alterá-los antes de
                confirmar.
              </p>
              <label className="commerce-check">
                <input
                  type="checkbox"
                  required
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                />
                Li e aceito as condições de compra, entrega e devolução. Recebi
                o aviso de privacidade.
              </label>
              <p>
                <a href="#/politicas/compra" target="_blank" rel="noreferrer">
                  Condições de compra
                </a>{" "}
                ·{" "}
                <a
                  href="#/politicas/devolucoes"
                  target="_blank"
                  rel="noreferrer"
                >
                  Devoluções
                </a>{" "}
                ·{" "}
                <a
                  href="#/politicas/privacidade"
                  target="_blank"
                  rel="noreferrer"
                >
                  Privacidade
                </a>
              </p>
            </>
          )}
          <ErrorText message={error} />
          <button
            className="primary"
            disabled={busy || !shop.ready || !shop.checkout_enabled}
          >
            {busy
              ? "Registrando…"
              : review
                ? "Confirmar pedido com obrigação de pagamento"
                : "Revisar e continuar"}
          </button>
        </div>
      </form>
    </section>
  );
}
export function OrderArea({ api, user, route, admin = false }) {
  const prefix = admin ? "/online-orders" : "/customer/orders",
    session = admin ? "admin" : "customer",
    id = route.split("/").filter(Boolean).at(-1),
    detail = /^\d+$/.test(id);
  const s = useRemote(api, detail ? `${prefix}/${id}` : prefix, session),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [action, setAction] = useState(""),
    [form, setForm] = useState({
      reference: "",
      note: "",
      tracking: "",
      fiscal_key: "",
      confirmed: false,
    });
  if (!admin && !user)
    return (
      <section className="commerce-page">
        <h1>Meus pedidos</h1>
        <a href="#/cliente/entrar">Entre para consultar</a>
      </section>
    );
  if (!s.data) return <Loader state={s} />;
  const mutate = async (path, body) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(path, { method: "POST", session, body });
      s.reload();
      setAction("");
      setForm({
        reference: "",
        note: "",
        tracking: "",
        fiscal_key: "",
        confirmed: false,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const link = admin ? "#/admin/pedidos/" : "#/pedidos/";
  if (!detail)
    return (
      <section className="commerce-page">
        <h1>{admin ? "Pedidos online" : "Meus pedidos"}</h1>
        <p>Consulte a situação, o total e a confirmação de cada compra.</p>
        <div className="commerce-actions">
          <button onClick={s.reload}>Atualizar</button>
          {admin && (
            <button
              disabled={busy}
              onClick={() => mutate("/orders/expire", {})}
            >
              Liberar reservas expiradas
            </button>
          )}
        </div>
        <ErrorText message={error} />
        {!s.data.length && <p>Nenhum pedido registrado.</p>}
        {s.data.map((o) => (
          <a
            className="commerce-card commerce-order-link"
            href={link + o.id}
            key={o.id}
          >
            <b>{o.number}</b>
            <span>
              {date(o.created_at)} · {o.status}
            </span>
            <strong>{money(o.total_cents)}</strong>
          </a>
        ))}
      </section>
    );
  const o = s.data,
    transitions = {
      "Aguardando pagamento": ["Pago", "Cancelado"],
      Pago: ["Em separação", "Reembolso solicitado"],
      "Em separação": [
        o.fulfillment.type === "pickup" ? "Pronto para retirada" : "Enviado",
        "Reembolso solicitado",
      ],
      Enviado: ["Entregue", "Reembolso solicitado"],
      "Pronto para retirada": ["Entregue", "Reembolso solicitado"],
      Entregue: ["Reembolso solicitado"],
      "Reembolso solicitado": ["Reembolsado"],
    };
  return (
    <section className="commerce-page">
      <div className="commerce-actions">
        <a href={admin ? "#/admin/pedidos" : "#/pedidos"}>← Todos os pedidos</a>
        <button onClick={() => window.print()}>Imprimir confirmação</button>
        <button onClick={s.reload}>Atualizar</button>
      </div>
      <h1>Pedido {o.number}</h1>
      <p>
        {date(o.created_at)} · <b>{o.status}</b>
      </p>
      <div className="commerce-grid">
        <div className="commerce-card">
          <h2>Produtos</h2>
          {o.items.map((i) => (
            <p key={i.id}>
              {i.quantity} × {i.name}
              <br />
              {money(i.unit_price_cents)} por unidade · {money(i.total_cents)}
            </p>
          ))}
          <p>
            Produtos: {money(o.subtotal_cents)} · Frete:{" "}
            {money(o.shipping_cents)}
          </p>
          <h2>Total: {money(o.total_cents)}</h2>
          <h3>Recebimento</h3>
          <p>
            {o.fulfillment.type === "pickup"
              ? `Retirada: ${o.fulfillment.address}`
              : `${o.fulfillment.street}, ${o.fulfillment.number} ${o.fulfillment.complement} · ${o.fulfillment.district} · ${o.fulfillment.city}/${o.fulfillment.state} · CEP ${o.fulfillment.cep}`}
          </p>
          <p>
            Até {o.fulfillment.days} dias úteis após confirmação do pagamento.
          </p>
          <p>
            {o.customer.name} · {o.customer.email} · {o.customer.phone}
          </p>
          <p>
            Forma: {o.payment.name}. {o.payment.instructions}
          </p>
          {o.status === "Aguardando pagamento" && (
            <p>
              Reserva até {date(o.expires_at)}. Aguarde a orientação da loja e
              informe se já pagou antes de cancelar.
            </p>
          )}
          {o.tracking && <p>Rastreio / entrega: {o.tracking}</p>}
          {o.fiscal_key && <p>Chave fiscal: {o.fiscal_key}</p>}
          <h3>Fornecedor</h3>
          <p>
            {o.seller.legal_name} · {o.seller.document}
            <br />
            {o.seller.address}
            <br />
            {o.seller.email}
          </p>
          <p>
            Condições aceitas: {o.policy_version} ·{" "}
            <a href="#/politicas/compra">Consultar condições</a>
          </p>
        </div>
        <div className="commerce-card">
          <h2>Acompanhamento</h2>
          {o.events.map((e, index) => (
            <p key={index}>
              <small>{date(e.created_at)}</small>
              <br />
              <b>{e.status}</b>
              <br />
              {e.note}
            </p>
          ))}
          <ErrorText message={error} />
          {!admin && (
            <>
              <a className="button" href={`#/atendimento?pedido=${o.id}`}>
                Solicitar atendimento ou devolução
              </a>
              <a
                className="button"
                href={`https://wa.me/${o.seller.phone}?text=${encodeURIComponent(`Olá! Gostaria de atendimento sobre meu pedido ${o.number}.`)}`}
                target="_blank"
                rel="noreferrer"
              >
                Falar com a loja sobre o pagamento
              </a>
              {o.status === "Aguardando pagamento" && (
                <button
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        "Cancelar esta reserva? Se você já pagou, solicite atendimento para reembolso.",
                      )
                    )
                      void mutate(`${prefix}/${o.id}/cancel`, {});
                  }}
                >
                  Cancelar reserva
                </button>
              )}
            </>
          )}
          {admin && transitions[o.status]?.length > 0 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void mutate(`${prefix}/${o.id}/status`, {
                  ...form,
                  status: action,
                });
              }}
            >
              <h3>Atualizar pedido</h3>
              <label>
                Situação
                <select
                  aria-label="Situação"
                  required
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                >
                  <option value="">Selecione</option>
                  {transitions[o.status].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Referência do pagamento / reembolso
                <input
                  value={form.reference}
                  maxLength={100}
                  onChange={(e) =>
                    setForm({ ...form, reference: e.target.value })
                  }
                />
              </label>
              <label>
                Rastreio / previsão de entrega
                <input
                  maxLength={300}
                  value={form.tracking}
                  onChange={(e) =>
                    setForm({ ...form, tracking: e.target.value })
                  }
                />
              </label>
              <label>
                Chave de nota fiscal já emitida
                <input
                  maxLength={44}
                  value={form.fiscal_key}
                  onChange={(e) =>
                    setForm({ ...form, fiscal_key: e.target.value })
                  }
                />
              </label>
              <label>
                Observação ao cliente
                <textarea
                  maxLength={1000}
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
              </label>
              {["Pago", "Reembolsado"].includes(action) && (
                <label className="commerce-check">
                  <input
                    type="checkbox"
                    required
                    checked={form.confirmed}
                    onChange={(e) =>
                      setForm({ ...form, confirmed: e.target.checked })
                    }
                  />
                  Conferi a operação no banco. Este registro não movimenta
                  dinheiro.
                </label>
              )}
              <p>
                Reembolso não repõe produtos automaticamente: inspecione os
                itens antes de movimentar o estoque.
              </p>
              <button className="primary" disabled={busy}>
                Salvar situação
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
export function ServiceArea({
  api,
  user,
  admin = false,
  onProfileChanged,
  onPasswordChanged,
}) {
  const s = useRemote(
      api,
      admin ? "/service-requests" : "/customer/requests",
      admin ? "admin" : "customer",
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [success, setSuccess] = useState(""),
    [responses, setResponses] = useState({});
  const [form, setForm] = useState({
    kind: "Atendimento",
    message: "",
    order_id:
      new URLSearchParams(location.hash.split("?")[1]).get("pedido") || "",
  });
  const [profile, setProfile] = useState({
    name: user?.name || "",
    email: user?.email || "",
    phone: user?.phone || "",
  });
  const [password, setPassword] = useState({
    current_password: "",
    password: "",
    confirmation: "",
  });
  const act = async (path, body, method = "POST") => {
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await api(path, {
        method,
        body,
        session: admin ? "admin" : "customer",
      });
      if (path === "/customer/profile") onProfileChanged?.(result);
      if (path === "/customer/password") {
        onPasswordChanged?.();
        return;
      }
      setSuccess(
        result.protocol
          ? `Solicitação recebida. Seu protocolo: ${result.protocol}`
          : "Alteração salva.",
      );
      s.reload();
      if (result.protocol) setForm({ ...form, message: "" });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (!admin && !user)
    return (
      <section className="commerce-page">
        <h1>Atendimento</h1>
        <p>
          Entre para registrar e acompanhar protocolos. Você também pode usar o
          e-mail e o WhatsApp informados nas políticas da loja, inclusive sem
          conta.
        </p>
        <a className="button primary" href="#/cliente/entrar">
          Entrar
        </a>
        <a className="button" href="#/politicas/compra">
          Canais de contato
        </a>
      </section>
    );
  const download = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await api("/customer/data", { session: "customer" });
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "meus-dados.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="commerce-page">
      <h1>
        {admin ? "Atendimento e privacidade" : "Atendimento e meus dados"}
      </h1>
      <ErrorText message={error} />
      {success && (
        <p role="status" className="commerce-success">
          {success}
        </p>
      )}
      {!admin && (
        <div className="commerce-grid">
          <form
            className="commerce-card"
            onSubmit={(e) => {
              e.preventDefault();
              void act("/customer/requests", form);
            }}
          >
            <h2>Nova solicitação</h2>
            <p>
              Receba um protocolo imediato e acompanhe a resposta aqui. O
              atendimento deve se manifestar em até cinco dias; pedidos de
              privacidade também seguem os prazos específicos aplicáveis.
            </p>
            <label>
              Assunto
              <select
                aria-label="Assunto"
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value })}
              >
                {[
                  "Atendimento",
                  "Arrependimento",
                  "Troca ou defeito",
                  "Cancelamento",
                  "Privacidade",
                  "Correção de dados",
                  "Exclusão de dados",
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Número interno do pedido (opcional)
              <input
                type="number"
                min="1"
                value={form.order_id}
                onChange={(e) => setForm({ ...form, order_id: e.target.value })}
              />
            </label>
            <label>
              Mensagem
              <textarea
                required
                minLength={10}
                maxLength={4000}
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
              />
            </label>
            <p>
              Para arrependimento, basta comunicar sua decisão; não é necessário
              justificar. Não envie senhas, dados de cartão ou documentos
              sensíveis.
            </p>
            <button className="primary" disabled={busy}>
              Registrar solicitação
            </button>
          </form>
          <form
            className="commerce-card"
            onSubmit={(e) => {
              e.preventDefault();
              void act("/customer/profile", profile, "PUT");
            }}
          >
            <h2>Corrigir meu cadastro</h2>
            {[
              ["name", "Nome completo"],
              ["email", "E-mail"],
              ["phone", "Telefone"],
            ].map(([k, label]) => (
              <label key={k}>
                {label}
                <input
                  required={k !== "phone"}
                  type={k === "email" ? "email" : "text"}
                  maxLength={k === "phone" ? 25 : 120}
                  value={profile[k]}
                  onChange={(e) =>
                    setProfile({ ...profile, [k]: e.target.value })
                  }
                />
              </label>
            ))}
            <button disabled={busy}>Salvar cadastro</button>
            <button type="button" disabled={busy} onClick={download}>
              Baixar meus dados
            </button>
            <p>
              Pedidos de eliminação são avaliados pela loja, respeitando
              obrigações de conservação.{" "}
              <a href="#/politicas/privacidade">Política de privacidade</a>.
            </p>
          </form>
        </div>
      )}
      <div className="commerce-actions">
        <h2>Protocolos</h2>
        {!admin && (
          <button
            onClick={() =>
              document
                .getElementById("customer-password-form")
                ?.scrollIntoView({ behavior: "smooth" })
            }
          >
            Alterar minha senha
          </button>
        )}
        <button onClick={s.reload}>Atualizar</button>
      </div>
      {!s.data ? (
        <Loader state={s} />
      ) : s.data.length ? (
        s.data.map((r) => (
          <article className="commerce-card" key={r.id}>
            <b>{r.protocol}</b>
            <p>
              {r.kind} · {r.status} · {date(r.created_at)}
            </p>
            {admin && (
              <p>
                {r.customer_name} · {r.email}
              </p>
            )}
            <p>
              Pedido: {r.order_id || "Não informado"} · Manifestação até{" "}
              {date(r.due_at)}
              {admin && !r.response && new Date(r.due_at) < new Date()
                ? " · PRAZO ULTRAPASSADO"
                : ""}
            </p>
            <p className="commerce-message">{r.message}</p>
            {r.response && (
              <p className="commerce-message">
                <b>Resposta da loja:</b> {r.response}
              </p>
            )}
            {JSON.parse(r.response_history || "[]").length > 1 && (
              <details>
                <summary>Histórico de respostas</summary>
                {JSON.parse(r.response_history).map((h, index) => (
                  <p className="commerce-message" key={index}>
                    {date(h.created_at)} · {h.status}
                    <br />
                    {h.response}
                  </p>
                ))}
              </details>
            )}
            {admin && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(
                    `/service-requests/${r.id}`,
                    {
                      response: responses[r.id] || r.response,
                      status: "Respondido",
                    },
                    "PUT",
                  );
                }}
              >
                <label>
                  Resposta
                  <textarea
                    required
                    minLength={5}
                    maxLength={4000}
                    value={responses[r.id] ?? r.response}
                    onChange={(e) =>
                      setResponses({ ...responses, [r.id]: e.target.value })
                    }
                  />
                </label>
                <button disabled={busy}>
                  Enviar resposta ao portal do cliente
                </button>
              </form>
            )}
          </article>
        ))
      ) : (
        <p>Nenhuma solicitação registrada.</p>
      )}
      {!admin && (
        <form
          id="customer-password-form"
          className="commerce-card"
          onSubmit={(e) => {
            e.preventDefault();
            if (password.password !== password.confirmation) {
              setError("As novas senhas precisam ser iguais.");
              return;
            }
            void act("/customer/password", password, "PUT");
          }}
        >
          <h2>Alterar minha senha</h2>
          {[
            ["current_password", "Senha atual"],
            ["password", "Nova senha"],
            ["confirmation", "Confirme a nova senha"],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                required
                type="password"
                autoComplete={
                  key === "current_password"
                    ? "current-password"
                    : "new-password"
                }
                minLength={key === "current_password" ? 1 : 8}
                maxLength={72}
                value={password[key]}
                onChange={(e) =>
                  setPassword({ ...password, [key]: e.target.value })
                }
              />
            </label>
          ))}
          <p>
            Use maiúscula, minúscula e número. A alteração encerra suas sessões
            de cliente; entre novamente.
          </p>
          <button disabled={busy}>Alterar senha</button>
        </form>
      )}
    </section>
  );
}
export function CommerceSettings({ api }) {
  const s = useRemote(api, "/shop", "admin"),
    [form, setForm] = useState(null),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [busy, setBusy] = useState(false);
  const [products, setProducts] = useState([]),
    [productId, setProductId] = useState(""),
    [details, setDetails] = useState({});
  const [detailsReady, setDetailsReady] = useState(false);
  useEffect(() => {
    if (s.data) setForm(s.data);
  }, [s.data]);
  useEffect(() => {
    api("/products")
      .then(setProducts)
      .catch((e) => setError(e.message));
  }, [api]);
  useEffect(() => {
    let active = true;
    setDetails({});
    setDetailsReady(false);
    if (productId)
      api(`/product-details/${productId}`)
        .then((d) => {
          if (active) {
            setDetails(d);
            setDetailsReady(true);
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [api, productId]);
  const save = async (path, body) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await api(path, { method: "PUT", body });
      setSuccess("Configuração salva.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (!form) return <Loader state={s} />;
  return (
    <section className="commerce-page">
      <h1>Configuração da loja online</h1>
      <p>
        Preencha informações verdadeiras e revise as políticas antes de
        habilitar vendas. A configuração não substitui regularização
        empresarial, fiscal e sanitária.
      </p>
      <ErrorText message={error} />
      {success && (
        <p role="status" className="commerce-success">
          {success}
        </p>
      )}
      <form
        className="commerce-card commerce-settings"
        onSubmit={(e) => {
          e.preventDefault();
          void save("/shop", form);
        }}
      >
        <h2>Identificação e atendimento</h2>
        {[
          ["trade_name", "Nome da loja"],
          ["legal_name", "Razão social / nome do fornecedor"],
          ["document", "CPF ou CNPJ do fornecedor"],
          ["address", "Endereço completo"],
          ["email", "E-mail de atendimento e privacidade"],
          ["phone", "WhatsApp (55 + DDD + telefone)"],
          ["hours", "Dias e horários de atendimento"],
          ["pickup_days", "Prazo de preparação para retirada (dias úteis)"],
          ["delivery_region", "Região de entrega"],
          ["cep_start", "CEP inicial (8 dígitos)"],
          ["cep_end", "CEP final (8 dígitos)"],
          ["delivery_fee_cents", "Frete fixo (centavos: 1500 = R$ 15,00)"],
          ["delivery_days", "Prazo de entrega após pagamento (dias úteis)"],
        ].map(([k, label]) => (
          <label key={k}>
            {label}
            <input
              type={
                typeof form[k] === "number"
                  ? "number"
                  : k === "email"
                    ? "email"
                    : "text"
              }
              min={k.endsWith("days") ? 1 : 0}
              value={form[k]}
              onChange={(e) =>
                setForm({
                  ...form,
                  [k]:
                    typeof form[k] === "number"
                      ? Number(e.target.value)
                      : e.target.value,
                })
              }
            />
          </label>
        ))}
        {[
          [
            "delivery_enabled",
            "Habilitar entrega na região e faixa de CEP informadas",
          ],
          [
            "checkout_enabled",
            "Habilitar finalização de compras com pagamento manual",
          ],
        ].map(([k, label]) => (
          <label className="commerce-check" key={k}>
            <input
              type="checkbox"
              checked={form[k]}
              onChange={(e) => setForm({ ...form, [k]: e.target.checked })}
            />
            {label}
          </label>
        ))}
        <button className="primary" disabled={busy}>
          Salvar configuração da loja
        </button>
      </form>
      <form
        className="commerce-card"
        onSubmit={(e) => {
          e.preventDefault();
          void save(`/product-details/${productId}`, details);
        }}
      >
        <h2>Informações obrigatórias dos produtos</h2>
        <p>
          Transcreva dados reais da embalagem e do fabricante. Confira a
          regularização na{" "}
          <a
            href="https://www.gov.br/anvisa/pt-br/sistemas/consulta-a-cosmeticos-regularizados"
            target="_blank"
            rel="noreferrer"
          >
            consulta oficial da Anvisa
          </a>
          . Não invente ingredientes ou alegações terapêuticas.
        </p>
        <label>
          Produto
          <select
            aria-label="Produto"
            required
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
          >
            <option value="">Selecione</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                #{p.id} · {p.name}
              </option>
            ))}
          </select>
        </label>
        {productId &&
          Object.entries(labels).map(([key, label]) => (
            <label key={key}>
              {label}
              <textarea
                required={key !== "anvisa_reference"}
                maxLength={4000}
                value={details[key] || ""}
                onChange={(e) =>
                  setDetails({ ...details, [key]: e.target.value })
                }
              />
            </label>
          ))}
        <button disabled={busy || !productId || !detailsReady}>
          Salvar informações do produto
        </button>
      </form>
      <div className="commerce-card">
        <h2>Antes de operar</h2>
        <p>
          Conecte o banco persistente na Vercel, use HTTPS e uma chave JWT
          própria, troque as credenciais de exemplo e mantenha backups privados.
          Configure pagamento no banco ou provedor e emissão fiscal com seu
          emissor/contador. Este projeto faz conferência manual; não emite nota,
          não cobra nem estorna dinheiro.
        </p>
        <p>
          Atenda os protocolos, efetue a logística reversa e os reembolsos e
          revise retenção de dados e prestadores. Os pedidos reservam estoque
          por 24 horas; reservas expiradas são liberadas ao criar novos pedidos
          ou pelo botão “Liberar reservas expiradas”.
        </p>
        <a href="#/politicas/compra" target="_blank" rel="noreferrer">
          Revisar políticas públicas
        </a>
      </div>
    </section>
  );
}
