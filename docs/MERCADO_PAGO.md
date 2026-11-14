# Mercado Pago — configuração da loja

Domínio definido: **https://lojacoresefragranciasbyberenice.vercel.app**.

A solução implementada é **Checkout Pro via Preferences API**, com SDK oficial Node.js no servidor e MercadoPago.js/Wallet Brick no navegador. A conta pode ser vinculada pela autorização oficial OAuth descrita abaixo. Testes locais usam respostas simuladas e não movimentam dinheiro.

## Conectar sua conta pelo Mercado Pago

Em **Formas de pagamento**, clique em **Preparar conexão com Mercado Pago**. Na primeira vez, abra as integrações no painel do Mercado Pago, selecione a aplicação da loja e habilite o fluxo de autorização com PKCE. Habilite também o acesso offline quando disponível para permitir renovação automática. Informe no formulário protegido da loja o **Client ID**, o **Client Secret** e a assinatura secreta das notificações fornecidos pelo painel. Não envie esses segredos em conversas.

Cadastre esta URL exata de retorno na aplicação do Mercado Pago:

```text
https://lojacoresefragranciasbyberenice.vercel.app/api/mercado-pago/oauth/callback
```

Cadastre também o webhook indicado na seção de notificações deste guia. Depois, use **Salvar e conectar no Mercado Pago**. Nas próximas autorizações, basta **Conectar Mercado Pago**. O navegador abre o site oficial do provedor para login e consentimento. Na volta, a loja registra a conta, mostra seu identificador e ativa a opção Mercado Pago nos pedidos. A senha da conta Mercado Pago é informada exclusivamente no provedor.

O servidor troca o código por Access Token e Public Key automaticamente. O retorno exige a mesma sessão administrativa que iniciou a autorização, estado aleatório de uso único com validade de dez minutos e PKCE S256. O código de retorno não confirma pagamentos: estes continuam dependendo da consulta autenticada e dos webhooks. Uma reconexão não pode trocar a conta recebedora já vinculada aos pedidos.

Client Secret, assinatura, Access Token, Refresh Token e verificadores PKCE ficam criptografados com AES-256-GCM no banco persistente. A chave separada `MERCADO_PAGO_ENCRYPTION_KEY` deve ser preservada no ambiente da hospedagem e em backup privado; nunca a altere sem uma migração das credenciais. A preparação desta instalação já criou essa chave na Vercel e no `.env` privado. O comando `payments:configure` também gera a chave em instalações novas.

Quando o provedor concede `offline_access` e Refresh Token, o servidor renova a autorização próxima ao vencimento e persiste os tokens rotacionados. Uma reserva atômica no banco impede renovações simultâneas entre instâncias. Sem essa permissão, ou após revogação, a tela solicita nova autorização. [Fluxo oficial OAuth e PKCE](https://www.mercadopago.com.br/developers/pt/docs/security/oauth/creation), [renovação oficial](https://www.mercadopago.com.br/developers/pt/docs/security/oauth/renewal).

As instruções de Access Token e Public Key por variáveis abaixo são uma alternativa de configuração direta. Elas não são necessárias quando a conta foi conectada pelo fluxo OAuth. O diagnóstico de linha de comando verifica essa alternativa; para a conta vinculada no banco, use **Verificar conexão** na loja.

## O que o projeto já faz

| Recurso | Implementação |
| --- | --- |
| Preferência por pedido | Itens reais, identificadores, descrições, quantidade, moeda, preço, categoria e imagem quando cadastrada. Preços vêm da reserva no banco. |
| Comprador | Nome, sobrenome, e-mail, telefone e endereço disponíveis no pedido, sem inventar dados pessoais. O documento e os dados de cartão são preenchidos no Mercado Pago. |
| Frete | Valor separado, endereço de entrega e indicação de retirada. [Referência oficial](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/additional-settings/shipping-cost). |
| Aprovação e antifraude | SDK oficial no checkout, Device ID encaminhado em `X-Meli-Session-Id`, referência externa e identificação do estabelecimento na fatura. [Recomendações](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/how-tos/improve-payment-approval/recommendations). |
| Checkout | Wallet Brick em português, abertura na mesma janela e alternativa de link seguro quando o SDK é bloqueado no navegador. [SDK](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/web-integration/add-frontend-sdk). |
| Retorno à loja | URLs HTTPS separadas para sucesso, pendência e falha; retorno ao pedido após login. O retorno nunca confirma um pagamento por si só. [URLs de retorno](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/configure-back-urls). |
| Notificações | Assinatura HMAC, comparação constante, persistência antes de processar, controle de concorrência e consulta canônica na API. Erros transitórios retornam `503` para manter as tentativas do provedor. [Webhooks](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/payment-notifications). |
| Conciliação | Consulta autenticada pelo cliente ou pela equipe, sem aceitar valor/status enviados pelo navegador. Pagamentos divididos precisam pertencer à mesma ordem comercial e somar o total antes de registrar a venda. |
| Cancelamento | Encerra a preferência e tenta cancelar pagamentos pendentes antes de liberar a reserva. Valores recebidos exigem reembolso. |
| Reembolso | Total ou parcial, somente por administrador com confirmação explícita, chave de idempotência persistente e atualização após consulta à API. [Reembolsos](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/additional-settings/refunds-and-cancellations). |
| Alertas | Contestações bloqueiam a evolução da entrega para análise. Alertas de fraude autenticados bloqueiam entrega e solicitam devolução integral automática por padrão, com a mesma idempotência do reembolso administrativo. O código não decide uma contestação nem envia documentos de defesa em nome da loja. |
| Recuperação | Caixa de notificações persistente, reprocessamento administrativo e tarefa privada de recuperação na Vercel. |

## Preparar a configuração privada

Execute na raiz do projeto:

```powershell
npm run payments:configure
```

O comando prepara `.env`, preserva valores existentes e gera `JWT_SECRET` e `CRON_SECRET` quando ausentes, sem imprimir os segredos. O arquivo está ignorado pelo Git e pela Vercel. O diagnóstico retorna código de saída 1 enquanto houver pendências; isso não significa que o arquivo deixou de ser preparado.

Preencha no `.env` privado ou no gerenciador de variáveis da hospedagem:

| Variável | De onde vem |
| --- | --- |
| `PUBLIC_BASE_URL` | `https://lojacoresefragranciasbyberenice.vercel.app` |
| `MERCADO_PAGO_PUBLIC_KEY` | Credenciais da aplicação no Mercado Pago; é a única credencial publicada ao frontend. |
| `MERCADO_PAGO_ACCESS_TOKEN` | Credencial privada da mesma aplicação/conta vendedora. |
| `MERCADO_PAGO_WEBHOOK_SECRET` | Assinatura secreta gerada ao salvar a configuração de Webhooks. |
| `MERCADO_PAGO_SANDBOX` | `true` no ambiente de teste; `false` em produção, com as credenciais correspondentes. |
| `JWT_SECRET` | Chave privada gerada localmente; use a mesma em todas as instâncias da implantação. |
| `CRON_SECRET` | Chave privada gerada localmente; a Vercel a usa para autenticar o cron. |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Banco persistente da loja na conta Turso; obrigatórios para produção na Vercel. |

Variáveis opcionais: `MERCADO_PAGO_STATEMENT_DESCRIPTOR` (padrão `CORESBERENICE`, até 13 caracteres), `MERCADO_PAGO_CATEGORY_ID` (padrão `others`, categoria existente no catálogo da API) e `MERCADO_PAGO_INTEGRATOR_ID` **somente se o Mercado Pago tiver fornecido um identificador oficial ao integrador**. Não copie IDs de exemplos de certificação. A descrição da fatura depende também das regras da bandeira. [Descrição na fatura](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/additional-settings/invoice-description).

`MERCADO_PAGO_AUTO_REFUND_FRAUD=true` é o padrão preparado para cumprir a orientação do provedor: alertas de fraude autenticados devolvem os valores recebidos, sem entregar. `false` mantém o bloqueio e exige que a administração providencie o reembolso; não autoriza liberar a entrega desse pedido. A política é mostrada na tela de configuração antes da ativação. [Alertas de fraude](https://www.mercadopago.com.br/developers/pt/docs/split-payments/additional-content/your-integrations/notifications/additional-info?scope=prod).

Depois de preencher:

```powershell
npm run payments:check
node scripts/configure-payments.mjs --verify --production
```

A verificação consulta a conta vendedora sem criar pagamentos. Ela não comprova que Public Key e Access Token foram copiados da mesma aplicação, nem que o webhook está ativo no painel; isso exige conferência das credenciais e testes de integração.

## Configurar o painel do Mercado Pago

Na aplicação de Checkout Pro da loja, configure a URL:

```text
https://lojacoresefragranciasbyberenice.vercel.app/api/mercado-pago/webhook
```

Habilite **Pagamentos**. Se oferecidos para sua aplicação, habilite também **Ordens comerciais**, **Contestações** e **Alertas de fraude**. Os tópicos tratados são `payment`/`payments`, `merchant_order`/`merchant_orders`, `topic_chargebacks_wh`/`chargebacks` e `stop_delivery_op_wh`. No alerta de fraude, o identificador assinado deve corresponder ao pagamento; quando enviado, `data.payment_id` precisa corresponder a ele. A API confirma recebedor, pedido, moeda, ambiente e valores antes de qualquer reembolso. Recursos sem associação verificada ficam pendentes, sem movimentar dinheiro.

Salve a assinatura secreta em `MERCADO_PAGO_WEBHOOK_SECRET`. Use o simulador do painel com um recurso da conta correspondente. Pagamentos com credenciais de teste podem não produzir notificações reais: valide também pelo simulador e pela consulta autenticada do pedido. Respostas transitórias `503` mantêm a entrega pendente no banco e solicitam nova tentativa do Mercado Pago.

Alertas de fraude são uma exceção: após persistir, o receptor retorna `200` mesmo quando o processamento fica pendente, pois o provedor não reenvia esse tópico. O bloqueio é registrado antes da consulta externa; a caixa persistente, o cron e o botão administrativo permitem recuperar o processamento. Um alerta não pode ser liberado para entrega pela análise administrativa comum: exige devolução. A disponibilidade do receptor e do banco deve ser monitorada.

Os tópicos opcionais dependem das funções usadas pela loja; não é necessário ativar vinculação de aplicações/OAuth para receber na própria conta. [Notificações opcionais](https://www.mercadopago.com.br/developers/en/docs/checkout-pro-preferences/additional-settings/optional-notifications).

## Publicar e ativar

Configure as variáveis na Vercel antes de publicar. Não copie `.env` para arquivos públicos, código do cliente ou variáveis `VITE_*`. `NODE_ENV=production`, HTTPS, chave de sessão forte e banco remoto são exigidos pelo servidor. A aplicação preserva as validações de cadastro legal da loja, detalhes dos produtos e aceite das condições de compra.

Em **Formas de pagamento**, use **Verificar conexão** e ative **Mercado Pago**. Revise as parcelas disponíveis no contrato da conta e habilite a finalização da loja em **Loja online**. O projeto exclui boleto e outros meios offline por causa da reserva de estoque de 24 horas; não habilite compensação posterior sem ajustar a política de reserva e entrega.

As URLs de retorno são montadas automaticamente:

```text
/api/mercado-pago/return/ID-DO-PEDIDO/success
/api/mercado-pago/return/ID-DO-PEDIDO/pending
/api/mercado-pago/return/ID-DO-PEDIDO/failure
```

O cron em `vercel.json` executa a recuperação diariamente às 09:17 UTC (06:17 em São Paulo), usando `CRON_SECRET`. Ele é uma proteção adicional às novas tentativas do Mercado Pago; a consulta no pedido e o reprocessamento administrativo também recuperam a situação. Para frequência maior, confirme os limites do plano Vercel antes de alterar o agendamento. Uma notificação inválida persistente exige revisão; reprocessar não substitui corrigir credenciais ou divergências financeiras.

## Operação e homologação

Em **Meus pedidos**, o cliente paga pelo botão oficial e usa **Consultar pagamento no Mercado Pago** para atualizar a confirmação. Em **Pedidos online**, a equipe consulta os pagamentos; administradores podem solicitar devolução integral ou parcial. A opção parcial requer a escolha de um pagamento quando houver mais de um. Um reembolso parcial reduz os valores financeiros dos produtos proporcionalmente, preservando preços e quantidades aceitos no pedido. Nenhum reembolso repõe produtos automaticamente no estoque.

Depois de uma falha de conexão ao reembolsar, consulte o pedido e repita a mesma solicitação. O projeto mantém a chave da operação para evitar duplicação. Não abra uma solicitação diferente sem conferir a anterior no Mercado Pago. A evolução do envio também reconsulta os pagamentos conhecidos. Alertas comuns exigem análise documentada por administrador; os de fraude exigem devolução. Nenhuma transferência é autorizada por mensagens sem assinatura válida ou dados financeiros não verificados.

As verificações locais cobrem criação, duplicidade, campos do SDK, pagamento dividido, cancelamento, recuperação de falha, reembolso, autorização e alertas. O teste `node scripts/check-mercado-pago-browser.mjs` usa Edge e Playwright com SDK/API simulados, sem movimentar dinheiro. O teste real deve incluir aprovação, recusa, pendência, retorno, notificação, reembolso e confirmação dos totais, seguindo as instruções da conta de teste.

A medição oficial de qualidade pertence ao Mercado Pago e exige um pagamento produtivo elegível; os testes locais não geram nota nem certificação. [Qualidade da integração](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/how-tos/integration-quality).

O 3DS do Checkout Pro é tratado no ambiente do provedor; condições específicas de ativação devem ser confirmadas com o time comercial do Mercado Pago. Acesso à conta, verificação cadastral, MFA da conta Mercado Pago, associação das credenciais, liberação comercial e medição oficial não podem ser concluídos sem a participação do titular. Produtos como Point presencial, assinaturas, publicidade e marketplace não são necessários para este checkout da própria loja e não são ativados por este fluxo.
