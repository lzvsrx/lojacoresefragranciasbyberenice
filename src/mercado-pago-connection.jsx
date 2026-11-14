import React, { useEffect, useState } from "react";
import { CreditCard, ExternalLink } from "lucide-react";

const returnMessages = {
  connected:
    "Conta vinculada. Os pagamentos pelo Mercado Pago foram ativados na loja.",
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
          Clique em conectar, entre no site do Mercado Pago e autorize a loja.
          Ao voltar, sua conta ficará registrada aqui para receber os pedidos.
        </p>
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
              : "Preparar conexão com Mercado Pago"}{" "}
          <ExternalLink size={16} />
        </button>
        {!connection?.application_saved && (
          <p>
            A aplicação da loja precisa ser preparada uma única vez. Depois, a
            conexão é feita diretamente no Mercado Pago.
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
            <h3>Preparar a aplicação da loja</h3>
            <p>
              Abra suas integrações no Mercado Pago, escolha a aplicação da loja
              e habilite OAuth com PKCE e acesso offline. Cadastre a URL de
              retorno abaixo e as notificações de pagamento.
            </p>
            <a
              className="button"
              href="https://www.mercadopago.com.br/developers/panel/app"
              target="_blank"
              rel="noreferrer"
            >
              Abrir integrações no Mercado Pago <ExternalLink size={16} />
            </a>
            <label>
              URL de retorno{" "}
              <input readOnly value={connection?.callback_url || ""} />
            </label>
            <label>
              URL das notificações{" "}
              <input readOnly value={gateway?.webhook_url || ""} />
            </label>
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
