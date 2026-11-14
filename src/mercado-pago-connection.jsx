import React, { useEffect, useState } from "react";
import { CreditCard, ExternalLink } from "lucide-react";

const returnMessages = {
  connected:
    "Conta conectada. As formas de pagamento foram cadastradas e salvas automaticamente.",
  connected_sync_pending:
    "Conta conectada e salva. As formas de pagamento serão sincronizadas automaticamente assim que o Mercado Pago responder.",
  cancelled: "A autorização foi cancelada. Você pode tentar novamente.",
  failed:
    "Não foi possível vincular a conta. Inicie uma nova autorização; confira a URL de retorno e os dados da aplicação.",
  account_mismatch:
    "Autorize a mesma conta que já recebe os pagamentos desta loja.",
};

export default function MercadoPagoConnection({ api, gateway, onChanged }) {
  const [connection, setConnection] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState(
    () =>
      returnMessages[
        new URLSearchParams(location.hash.split("?")[1] || "").get(
          "mp_connection",
        )
      ] || "",
  );
  const [error, setError] = useState("");
  const [fields, setFields] = useState({
    client_id: "",
    client_secret: "",
    webhook_secret: "",
  });
  const reload = async () => {
    const value = await api("/mercado-pago/oauth/status");
    setConnection(value);
    setFields((f) => ({ ...f, client_id: value.client_id || "" }));
  };
  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, [api]);
  useEffect(() => {
    if (
      !connection?.connected ||
      connection.payment_methods?.status !== "pending"
    )
      return;
    const timer = setTimeout(
      () => reload().catch((e) => setError(e.message)),
      Math.max(
        1000,
        Math.min(
          65000,
          (connection.payment_methods.retry_at || 0) - Date.now() + 1000,
        ),
      ),
    );
    return () => clearTimeout(timer);
  }, [
    connection?.connected,
    connection?.payment_methods?.status,
    connection?.payment_methods?.retry_at,
  ]);
  const connect = async () => {
    const result = await api("/mercado-pago/oauth/start", {
      method: "POST",
      body: {},
    });
    const url = new URL(result.authorization_url);
    if (
      url.origin !== "https://auth.mercadopago.com" ||
      url.pathname !== "/authorization"
    )
      throw new Error("Endereço de autorização inválido.");
    location.assign(url.href);
  };
  const action = async (work) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="payments-intro">
      <CreditCard size={28} />
      <div className="mercado-pago-connection">
        <b>
          {connection?.connected
            ? "Conta Mercado Pago conectada"
            : connection?.reconnect_required
              ? "Autorize sua conta novamente"
              : gateway?.configured
                ? "Recebimentos configurados"
                : "Vincule sua conta Mercado Pago"}
        </b>
        <p>
          Autorize sua conta no site do Mercado Pago. Na volta, a loja cadastra
          e salva as formas de pagamento automaticamente.
        </p>
        <ol className="mp-connection-steps" aria-label="Como conectar">
          <li>Autorizar a conta</li>
          <li>Importar as formas</li>
          <li>Salvar e receber</li>
        </ol>
        {connection?.account && (
          <p>
            <strong>{connection.account.name}</strong> · Conta{" "}
            {connection.account.id}
          </p>
        )}
        {connection?.connected && (
          <p>
            {connection.automatic_renewal
              ? "A autorização é renovada automaticamente."
              : "A autorização tem prazo de validade. O Mercado Pago precisa conceder acesso offline para permitir a renovação automática."}
          </p>
        )}
        <button
          type="button"
          className="primary"
          disabled={busy || !connection}
          onClick={() =>
            connection.ready ? action(connect) : setEditing(true)
          }
        >
          {busy
            ? "Aguarde…"
            : connection?.ready
              ? connection.connected
                ? "Autorizar novamente no Mercado Pago"
                : "Conectar Mercado Pago"
              : "Conectar Mercado Pago"}{" "}
          <ExternalLink size={16} />
        </button>
        {!connection?.application_saved && (
          <p>
            Primeiro acesso: os dados da aplicação precisam ser informados uma
            única vez. As formas de pagamento serão importadas após a
            autorização.
          </p>
        )}
        {connection?.application_saved && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setEditing((v) => !v)}
          >
            Configurar aplicação
          </button>
        )}
        {editing && (
          <form
            className="mercado-pago-application"
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              action(async () => {
                await api("/mercado-pago/oauth/application", {
                  method: "POST",
                  body: fields,
                });
                setFields((f) => ({
                  ...f,
                  client_secret: "",
                  webhook_secret: "",
                }));
                await reload();
                setEditing(false);
                await connect();
              });
            }}
          >
            <h3>Configuração inicial · uma única vez</h3>
            <p>
              O Mercado Pago exige estes dados para permitir a autorização.
              Depois de salvar, você conecta sua conta pelo site deles; não
              precisa cadastrar Pix, cartões ou bandeiras individualmente.
            </p>
            <a
              className="button"
              href="https://www.mercadopago.com.br/developers/panel/app"
              target="_blank"
              rel="noreferrer"
            >
              Abrir integrações no Mercado Pago <ExternalLink size={16} />
            </a>
            <details className="mp-registration-urls">
              <summary>
                URLs para cadastrar na aplicação do Mercado Pago
              </summary>
              <p>
                Habilite OAuth com PKCE e acesso offline no painel do provedor.
              </p>
              <label>
                URL de retorno{" "}
                <input readOnly value={connection?.callback_url || ""} />
              </label>
              <label>
                URL das notificações{" "}
                <input readOnly value={gateway?.webhook_url || ""} />
              </label>
            </details>
            <label>
              ID da aplicação (Client ID)
              <input
                required
                inputMode="numeric"
                value={fields.client_id}
                maxLength={30}
                onChange={(e) =>
                  setFields((f) => ({ ...f, client_id: e.target.value.trim() }))
                }
              />
            </label>
            <label>
              Segredo da aplicação (Client Secret)
              <input
                required
                type="password"
                autoComplete="new-password"
                value={fields.client_secret}
                minLength={16}
                maxLength={512}
                onChange={(e) =>
                  setFields((f) => ({
                    ...f,
                    client_secret: e.target.value.trim(),
                  }))
                }
              />
            </label>
            <label>
              Assinatura secreta das notificações
              <input
                required
                type="password"
                autoComplete="new-password"
                value={fields.webhook_secret}
                minLength={16}
                maxLength={512}
                onChange={(e) =>
                  setFields((f) => ({
                    ...f,
                    webhook_secret: e.target.value.trim(),
                  }))
                }
              />
            </label>
            <p>
              Esses dados são fornecidos pelo Mercado Pago. Os segredos ficam
              criptografados no servidor; a senha da sua conta Mercado Pago é
              informada somente no site deles.
            </p>
            {!connection?.storage_ready && (
              <p role="alert">
                A hospedagem precisa ser preparada para armazenar a conexão
                protegida.
              </p>
            )}
            <button
              type="submit"
              className="primary"
              disabled={busy || !connection?.storage_ready}
            >
              Salvar e conectar no Mercado Pago
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Cancelar
            </button>
          </form>
        )}
        <PaymentMethodRegistry
          connection={connection}
          busy={busy}
          onSync={() =>
            action(async () => {
              const result = await api("/mercado-pago/methods/sync", {
                method: "POST",
                body: {},
              });
              await reload();
              await onChanged();
              setMessage(
                result.status === "ready"
                  ? "Formas de pagamento atualizadas e salvas."
                  : "A sincronização está pendente. Vamos tentar novamente automaticamente.",
              );
            })
          }
        />
        {gateway?.sandbox && <p>Ambiente de testes ativado.</p>}
        <p>
          O cliente paga no Mercado Pago, e a aprovação é registrada
          automaticamente no pedido. Alertas de fraude bloqueiam a entrega
          {gateway?.auto_refund_fraud
            ? " e solicitam a devolução integral automática"
            : " até a devolução"}
          .
        </p>
        {!!gateway?.pending_notifications && (
          <p role="alert">
            {gateway.pending_notifications} notificações aguardam processamento.
          </p>
        )}
        {gateway?.configured && (
          <div>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                action(async () => {
                  const result = await api("/mercado-pago/verify", {
                    method: "POST",
                    body: {},
                  });
                  setMessage(
                    `Conexão verificada com a conta ${result.account_id}.`,
                  );
                })
              }
            >
              Verificar conexão
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                action(async () => {
                  const result = await api(
                    "/mercado-pago/retry-notifications",
                    { method: "POST", body: {} },
                  );
                  setMessage(`${result.processed} notificações verificadas.`);
                  await onChanged();
                })
              }
            >
              Reprocessar notificações
            </button>
          </div>
        )}
        {message && <p role="status">{message}</p>}
        {error && <p role="alert">{error}</p>}
      </div>
    </div>
  );
}

const typeNames = {
  bank_transfer: "Transferência / Pix",
  credit_card: "Cartão de crédito",
  debit_card: "Cartão de débito",
  prepaid_card: "Cartão pré-pago",
  account_money: "Saldo Mercado Pago",
  ticket: "Boleto",
  atm: "Caixa eletrônico",
  digital_currency: "Moeda digital",
  digital_wallet: "Carteira digital",
};

function PaymentMethodRegistry({ connection, busy, onSync }) {
  const registry = connection?.payment_methods;
  if (!connection?.account)
    return (
      <div className="mp-methods-preview">
        <strong>Cadastro automático após a conexão</strong>
        <p>
          A loja busca os meios informados pelo Mercado Pago e mantém o cadastro
          salvo. A escolha do cliente e as parcelas são apresentadas no checkout
          do Mercado Pago.
        </p>
      </div>
    );
  const methods = registry?.items || [],
    enabled = methods.filter((m) => m.enabled);
  return (
    <section
      className="mp-method-registry"
      aria-label="Formas de pagamento importadas"
    >
      <div className="mp-method-registry-heading">
        <div>
          <h3>Formas de pagamento salvas</h3>
          <p>
            {methods.length} cadastradas · {enabled.length} disponíveis para o
            checkout
          </p>
        </div>
        <button
          type="button"
          disabled={busy || !connection.connected}
          onClick={onSync}
        >
          Atualizar formas
        </button>
      </div>
      {registry?.synced_at && (
        <p>
          Última sincronização:{" "}
          {new Date(registry.synced_at).toLocaleString("pt-BR")}
        </p>
      )}
      {registry?.status !== "ready" && (
        <p role="status">
          Sincronização pendente. Uma nova tentativa será feita automaticamente.
        </p>
      )}
      {!!methods.length && (
        <ul className="mp-imported-methods">
          {methods.map((method) => (
            <li key={method.id}>
              <div>
                <strong>{method.name}</strong>
                <small>{typeNames[method.type] || method.type}</small>
              </div>
              <span className={`pill ${method.enabled ? "green" : ""}`}>
                {method.enabled
                  ? "Cadastrada"
                  : method.status === "active"
                    ? "Não oferecida na loja"
                    : method.status === "removed"
                      ? "Removida pelo provedor"
                      : "Indisponível no provedor"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p>
        As opções finais dependem da conta, do comprador e do valor no Mercado
        Pago. Boleto e caixa eletrônico permanecem fora do checkout por causa da
        reserva de estoque de 24 horas.
      </p>
    </section>
  );
}
