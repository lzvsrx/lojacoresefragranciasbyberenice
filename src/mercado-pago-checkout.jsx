import React, { useEffect, useRef, useState } from "react";
import { loadMercadoPago } from "@mercadopago/sdk-js";

let sdkPromise;
let sdkKey;
const bounded = (promise, ms = 8000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Pagamento demorou para carregar")),
      ms,
    );
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

export async function prepareMercadoPago(api) {
  const config = await api("/shop/mercado-pago", { session: "public" });
  if (!config.enabled || !config.public_key)
    throw new Error("Mercado Pago indisponível no momento");
  if (!sdkPromise || sdkKey !== config.public_key) {
    sdkKey = config.public_key;
    sdkPromise = bounded(loadMercadoPago()).then(
      () => new window.MercadoPago(config.public_key, { locale: "pt-BR" }),
    );
    sdkPromise.catch(() => {
      sdkPromise = null;
    });
  }
  const sdk = await sdkPromise;
  const deadline = Date.now() + 1200;
  while (!window.MP_DEVICE_SESSION_ID && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 50));
  return {
    sdk,
    deviceId:
      typeof window.MP_DEVICE_SESSION_ID === "string" &&
      /^[A-Za-z0-9_-]{1,200}$/.test(window.MP_DEVICE_SESSION_ID)
        ? window.MP_DEVICE_SESSION_ID
        : undefined,
  };
}

export async function mercadoPagoDevice(api) {
  try {
    return (await prepareMercadoPago(api)).deviceId;
  } catch {
    return undefined;
  } // A blocked third-party script must not lose the order.
}

export function MercadoPagoWallet({ api, orderId }) {
  const container = useRef(`mp-wallet-${crypto.randomUUID()}`);
  const [state, setState] = useState({ busy: true, error: "", url: "" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true,
      wallet;
    setState({ busy: true, error: "", url: "" });
    (async () => {
      let prepared;
      try {
        prepared = await prepareMercadoPago(api);
      } catch {}
      const payment = await api(`/customer/orders/${orderId}/payment`, {
        method: "POST",
        session: "customer",
        body: prepared?.deviceId ? { device_id: prepared.deviceId } : {},
      });
      if (!active) return;
      setState({ busy: true, error: "", url: payment.checkout_url });
      if (!prepared?.sdk)
        throw new Error(
          "Não foi possível carregar o botão. Continue pelo link seguro abaixo.",
        );
      wallet = await bounded(
        prepared.sdk.bricks().create("wallet", container.current, {
          initialization: {
            preferenceId: payment.preference_id,
            redirectMode: "self",
          },
          callbacks: {
            onReady: () => {
              if (active) setState((s) => ({ ...s, busy: false }));
            },
            onError: () => {
              if (active)
                setState((s) => ({
                  ...s,
                  busy: false,
                  error:
                    "Não foi possível exibir o botão. Continue pelo link seguro abaixo.",
                }));
            },
          },
        }),
      );
      if (!active) wallet?.unmount();
      else setState((s) => ({ ...s, busy: false }));
    })().catch((error) => {
      if (active)
        setState((s) => ({ ...s, busy: false, error: error.message }));
    });
    return () => {
      active = false;
      wallet?.unmount();
    };
  }, [api, orderId, revision]);
  return (
    <div className="mercado-pago-checkout">
      <p>Escolha como pagar no ambiente seguro do Mercado Pago.</p>
      {state.busy && <p role="status">Preparando pagamento…</p>}
      <div id={container.current} />
      {state.error && <p role="alert">{state.error}</p>}
      {state.error && state.url && (
        <a className="button primary" href={state.url}>
          Pagar no Mercado Pago
        </a>
      )}
      {state.error && (
        <button type="button" onClick={() => setRevision((r) => r + 1)}>
          Carregar novamente
        </button>
      )}
    </div>
  );
}

export function MercadoPagoRefund({ api, order, onUpdated }) {
  const [form, setForm] = useState({
    payment_id: "",
    amount: "",
    confirmed: false,
  });
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const change = (key, value) => {
    setForm((f) => ({
      ...f,
      [key]: value,
      ...(key === "confirmed" ? {} : { confirmed: false }),
    }));
    if (key !== "confirmed") setRequestId(crypto.randomUUID());
  };
  const payments = (order.payments || []).filter(
    (p) => p.status === "approved" && p.amount_cents > p.refunded_cents,
  );
  if (!payments.length) return null;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        try {
          await api(`/online-orders/${order.id}/refund`, {
            method: "POST",
            body: {
              confirmed: form.confirmed,
              request_id: requestId,
              ...(form.payment_id ? { payment_id: form.payment_id } : {}),
              ...(form.amount
                ? { amount_cents: Math.round(Number(form.amount) * 100) }
                : {}),
            },
          });
          setForm({ payment_id: "", amount: "", confirmed: false });
          setRequestId(crypto.randomUUID());
          onUpdated();
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Reembolso pelo Mercado Pago</h3>
      <p>
        Esta ação devolve dinheiro ao cliente. Deixe o valor vazio para devolver
        todo o saldo dos pagamentos selecionados. Produtos devolvidos exigem
        inspeção antes da reposição.
      </p>
      <label>
        Pagamento
        <select
          value={form.payment_id}
          onChange={(e) => change("payment_id", e.target.value)}
        >
          <option value="">Todos os pagamentos</option>
          {payments.map((p) => (
            <option key={p.payment_id} value={p.payment_id}>
              {p.payment_id} — saldo{" "}
              {((p.amount_cents - p.refunded_cents) / 100).toLocaleString(
                "pt-BR",
                { style: "currency", currency: "BRL" },
              )}
            </option>
          ))}
        </select>
      </label>
      <label>
        Valor parcial em reais (opcional)
        <input
          type="number"
          min="0.01"
          step="0.01"
          value={form.amount}
          onChange={(e) => change("amount", e.target.value)}
        />
      </label>
      <label className="check">
        <input
          required
          type="checkbox"
          checked={form.confirmed}
          onChange={(e) => change("confirmed", e.target.checked)}
        />
        Conferi o pedido e confirmo a devolução de dinheiro ao cliente.
      </label>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy || !form.confirmed} type="submit">
        {busy
          ? "Solicitando reembolso…"
          : "Confirmar reembolso no Mercado Pago"}
      </button>
    </form>
  );
}
