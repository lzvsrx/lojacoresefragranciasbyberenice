# Cores & Fragrâncias by Berenice

Loja online, pedidos, atendimento, vendas e estoque com React, API Node.js e banco SQLite local ou Turso remoto. O recebimento e o reembolso de pagamentos são conferidos manualmente pela equipe.

Este documento reúne as funcionalidades e correções implementadas até agora. **A execução local foi validada; o banco Turso ainda precisa ser criado e conectado à Vercel para permitir gravações permanentes no site publicado.**

## Documentação visual

As **52 capturas identificadas** cobrem loja, cadastro/login, checkout, pedidos, políticas, administração, estoque, vendas, atendimento, permissões e versões para celular. Abra a [galeria de telas](docs/capturas/index.html), o [guia completo em PDF](docs/capturas/guia-das-telas.pdf) ou a [lista técnica das capturas](docs/capturas/manifesto.json).

As imagens têm títulos, numeração e marcações das partes de cada tela. Foram geradas com dados fictícios em banco temporário, sem abrir ou modificar o banco operacional. Veja [como gerar novamente](docs/capturas/README.md).

Para visualizar a galeria no navegador, execute `node scripts/view-captures.mjs` e abra **http://localhost:3002**. Esse servidor disponibiliza somente a documentação visual no computador local.

## Funcionalidades

- Vitrine pública com entrada própria para clientes, cadastro e login separados da equipe.
- Busca sem distinção de acentos, filtros de marca, categoria e preço e ordenação por novidades, nome ou valor.
- Sacola com conferência de preços e estoque no servidor antes de preparar o pedido pelo WhatsApp.
- Checkout em duas etapas, com correção de dados, resumo do frete/total e aceite das condições.
- Pedidos online com reserva de estoque, histórico, pagamento manual, entrega, retirada e reembolso.
- Área do cliente com acompanhamento, confirmação imprimível, correção de cadastro, troca de senha e exportação dos próprios dados.
- Atendimento com protocolo imediato, prazo de manifestação e histórico de respostas.
- Páginas públicas de identificação, compra, entrega, devoluções e privacidade.
- Configuração administrativa da loja e informações detalhadas de produtos, incluindo composição, conteúdo, fabricante e cuidados.

Na tela **Produtos**, o botão **Vender** abre o formulário com o item selecionado, permitindo informar quantidade, cliente e pagamento. Ao confirmar, o estoque é baixado e a coluna **Vendido** atualiza a quantidade e o valor acumulados daquele produto. O painel também mostra as unidades vendidas e o faturamento. Vendas canceladas são desconsideradas; produtos sem estoque têm o botão desativado.

- Login com permissões para administrador, funcionário e cliente.
- Painel de faturamento, vendas, estoque baixo, aniversariantes e validade.
- Cadastro, edição, pesquisa e imagens de produtos.
- Novos produtos primeiro na lista, com atualização após o cadastro.
- Catálogo responsivo, categorias e identificação da validade.
- Pedidos e vendas com validação de pagamento, parcelas e estoque.
- Cancelamento administrativo com devolução de estoque uma única vez.
- Entradas, saídas e ajustes com motivo, responsável e saldos anterior e novo.
- Gestão de clientes e equipe, preferências, aniversários e foto de perfil.
- Importação e exportação de produtos em CSV, exportação de vendas e relatórios PDF.
- Configuração de formas de pagamento e parcelamento.
- Backup consistente do SQLite e migração para Turso.

Pagamentos e referências fiscais são registros internos. O projeto não realiza cobrança por operadora nem emissão fiscal automática.

## Tecnologias

Requer **Node.js 22.12 ou superior**; recomendado: Node.js 24.

As dependências foram atualizadas. As versões declaradas incluem React 19.3, Vite 8.3, Express 5.3, better-sqlite3 13 e cliente libSQL 0.18. O `package-lock.json` registra as versões instaladas.

## Instalar e abrir

Na pasta do projeto:

```bash
npm ci
npm run dev
```

Abra **http://localhost:5173**. A API fica em **http://localhost:3001**.

Para executar a versão compilada:

```bash
npm run build
npm start
```

Abra **http://localhost:3001**. Mantenha o servidor ligado: abrir `dist/index.html` diretamente não inicia a API nem o banco.

No PowerShell, se `npm.ps1` estiver bloqueado, use `npm.cmd` nos mesmos comandos, como `npm.cmd run dev`.

### Acesso inicial

A entrada padrão agora é a loja. Use os acessos separados:

| Área                   | Produção local                              | Desenvolvimento                             |
| ---------------------- | ------------------------------------------- | ------------------------------------------- |
| Vitrine pública        | `http://localhost:3001/#/loja`              | `http://localhost:5173/#/loja`              |
| Login de cliente       | `http://localhost:3001/#/cliente/entrar`    | `http://localhost:5173/#/cliente/entrar`    |
| Cadastro de cliente    | `http://localhost:3001/#/cliente/cadastrar` | `http://localhost:5173/#/cliente/cadastrar` |
| Sacola                 | `http://localhost:3001/#/sacola`            | `http://localhost:5173/#/sacola`            |
| Checkout               | `http://localhost:3001/#/checkout`          | `http://localhost:5173/#/checkout`          |
| Meus pedidos           | `http://localhost:3001/#/pedidos`           | `http://localhost:5173/#/pedidos`           |
| Atendimento e dados    | `http://localhost:3001/#/atendimento`       | `http://localhost:5173/#/atendimento`       |
| Políticas da loja      | `http://localhost:3001/#/politicas/compra`  | `http://localhost:5173/#/politicas/compra`  |
| Administração / equipe | `http://localhost:3001/#/admin`             | `http://localhost:5173/#/admin`             |

Clientes navegam sem login. O cadastro exige nome, e-mail, usuário e senha forte; telefone é opcional. Não há confirmação automática de e-mail nem recuperação de senha por e-mail implementada; o acesso tem um link para pedir ajuda à loja. O servidor sempre cria o perfil `cliente`, mesmo que alguém tente enviar outro perfil. Clientes não acessam produtos administrativos, usuários, estoque, vendas ou configurações.

As sessões de equipe e cliente ficam separadas. Sair da conta de cliente não encerra a sessão administrativa. O cadastro público tem limite de 10 tentativas por IP por hora; o login mantém sua proteção contra falhas.

### Catálogo e pedido do cliente

Fotos de usuários exigem autenticação: clientes só consultam a própria foto; a equipe consulta fotos conforme suas permissões. Na administração, a lista começa com 40 produtos e permite carregar mais, mantendo a busca sobre toda a lista e carregando imagens sob demanda.

O catálogo entrega 24 produtos por página (máximo de 48 por chamada), carrega imagens sob demanda e aguarda 250 ms após alterações de busca antes de consultar a API, cancelando consultas anteriores. Metadados públicos têm cache interno de até 15 segundos, invalidado por gravações de produtos, vendas e estoque na mesma instância. A vitrine consulta novamente a cada minuto enquanto está visível e ao retornar à aba. A conferência da sacola consulta o banco diretamente, sem usar esse cache.

A sacola é guardada neste navegador, aceita até 40 produtos diferentes e não reserva estoque. **Finalizar pedido** abre o checkout, que consulta os preços atuais e permite escolher retirada ou entrega na região/intervalo de CEP configurados, além da forma de pagamento. O cliente revisa o total e aceita as condições antes de confirmar. Se o valor mudar, o servidor recusa a confirmação e exige nova conferência. **Enviar pedido pelo WhatsApp** continua sendo uma alternativa de atendimento: a mensagem, por si só, não registra pedido ou venda.

### Habilitar a loja online

No painel, entre em **Loja online** e preencha razão social/nome do fornecedor, CPF ou CNPJ, endereço, e-mail, WhatsApp, horário, prazos e condições de entrega. O documento tem validação de dígitos verificadores, incluindo CNPJ alfanumérico; isso não consulta nem comprova a situação cadastral perante a Receita. Dados legais não foram inventados: a finalização começa **desativada**.

Preencha também as informações reais dos produtos: descrição, composição, conteúdo/unidade, fabricante/origem e modo de uso/cuidados. O checkout recusa produtos sem esses campos. Informe a referência de regularização Anvisa quando aplicável e confira a situação do produto no serviço oficial; o sistema não faz essa consulta automaticamente.

Revise as páginas públicas e só então marque **Habilitar finalização de compras com pagamento manual**. O servidor exige identificação e atendimento completos e impede habilitar vendas enquanto a conta `admin` mantiver a senha de exemplo `admin123`. Na Vercel, conecte primeiro o banco persistente.

### Pedidos online e estoque

1. A confirmação cria um pedido `WEB-…`, preservando nomes, preços, informações dos produtos, fornecedor, entrega, pagamento e versão das condições. A reserva baixa o estoque disponível por 24 horas, em transação única.
2. Repetir a mesma confirmação com o mesmo identificador não duplica o pedido nem a reserva. Confirmações concorrentes não permitem estoque negativo. Cada cliente pode ter até três pedidos aguardando pagamento.
3. A equipe abre **Pedidos online**, verifica o recebimento no banco/caixa e informa a referência para marcar **Pago**. Isso registra as vendas pelos preços aceitos no checkout, sem nova baixa de estoque. O site não movimenta dinheiro, não gera Pix/boleto e não recebe cartão.
4. A equipe atualiza separação, envio ou retirada e entrega. O cliente consulta o histórico e imprime a confirmação em **Meus pedidos**. Uma chave de nota já emitida pode ser registrada; a impressão do pedido não é documento fiscal.
5. Cancelar uma reserva libera o estoque uma única vez. Reservas expiradas são liberadas ao criar novos pedidos ou pelo botão **Liberar reservas expiradas** no painel. Não há tarefa agendada: a equipe deve usar esse botão ao iniciar o atendimento.
6. Pedidos pagos seguem pelo fluxo de solicitação e confirmação de reembolso. Somente administrador confirma **Reembolsado**, com referência e conferência da operação externa. As vendas deixam de compor o faturamento. Itens devolvidos **não voltam automaticamente ao estoque**: precisam de inspeção e movimentação apropriada. Produtos vencidos não devem ser repostos para venda.

As vendas e os indicadores antigos contabilizam o valor dos **produtos**; o frete aparece separadamente no pedido online e integra o total devido pelo cliente. Não registre novamente pela tela de venda um pedido online já marcado como pago. Vendas ligadas a pedidos online não podem ser canceladas isoladamente pela rota antiga.

Os pedidos mostram pagamento à vista, sem parcelamento automático. Configurar parcelas na venda administrativa não cria contrato de crédito nem cobrança no checkout. Estorno, logística reversa, conciliação de pagamentos, documento fiscal e comunicação externa continuam sob responsabilidade da equipe e dos serviços contratados.

### Atendimento, devoluções e privacidade

O cliente pode registrar atendimento, arrependimento, troca/defeito, cancelamento e solicitações de privacidade. A confirmação com protocolo `SAC-…` é imediata; o painel mostra a manifestação prevista em até cinco dias e destaca solicitações sem resposta com prazo ultrapassado. Esse prazo operacional não substitui os prazos específicos de cada direito. Respostas ficam no portal e são preservadas em histórico; não há envio automático de e-mail ou WhatsApp. A equipe deve acompanhar **Atendimento** diariamente. E-mail e WhatsApp públicos também atendem pessoas sem conta.

As políticas informam o direito de arrependimento de sete dias nas compras fora do estabelecimento, os canais de solicitação e a restituição nos termos da lei, sem impor embalagem lacrada como condição geral. O sistema não decide automaticamente se um pedido de devolução está dentro do prazo nem recusa protocolos por esse motivo.

Em **Atendimento e meus dados**, o cliente pode corrigir nome/e-mail/telefone, baixar seus dados e trocar a senha mediante a senha atual. A troca invalida todas as sessões anteriores de cliente. Pedidos de eliminação e demais direitos são avaliados pela equipe, respeitando a conservação legal; não há apagamento automático do histórico de vendas. Não há consentimento de marketing embutido no cadastro. A política descreve sessão/sacola no navegador e Google Fonts; não há analytics ou publicidade de terceiros no código atual.

### Referências e pendências externas

As páginas e os fluxos foram preparados com base no [Decreto 7.962/2013](https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm), no [CDC](https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm), na [LGPD](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm), nas [orientações de segurança da ANPD](https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-publica-guia-de-seguranca-para-agentes-de-tratamento-de-pequeno-porte), na [consulta de cosméticos da Anvisa](https://www.gov.br/anvisa/pt-br/sistemas/consulta-a-cosmeticos-regularizados) e na [documentação do CNPJ alfanumérico da Receita](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj). Revisão: 10/10/2026.

O código não certifica conformidade integral. Antes de operar, a loja precisa fornecer dados reais, validar suas regras empresariais/fiscais/sanitárias com os responsáveis, conferir produtos e rotulagem, definir retenção e prestadores de dados, conectar Turso/HTTPS, manter backups, contratar/configurar recebimento e emissão fiscal e executar atendimento, entregas e devoluções. Recuperação automática de senha e confirmação de e-mail dependem de integração de e-mail ainda não implementada; a ajuda de acesso permanece pelo atendimento. Não foram criadas credenciais ou integrações fictícias.

Produtos vencidos são excluídos da vitrine e recusados na conferência da sacola e no registro de novas vendas. Esgotados ficam ocultos por padrão, com filtro para visualização. Produtos próximos do vencimento mostram sua validade.

O banco de exemplo usa usuário `admin` e senha `admin123`. Troque a senha antes de disponibilizar a loja. Um banco operacional existente mantém seus próprios usuários e senhas. Os campos de login não vêm preenchidos na interface.

## Configurar formas de pagamento

Administradores acessam **Formas de pagamento** para ajustar os tipos disponíveis. Cada cartão explica como receber, conferir o pagamento e identificar a transação. Configure nome, disponibilidade, limite de parcelas (1 a 24), exigência de código da transação e orientação exibida no formulário de venda. **Salvar configuração** grava somente aquela forma; **Usar orientação sugerida** preenche um texto para revisar e salvar.

Ativar uma forma permite selecioná-la na venda, mas não cria cobrança, boleto, QR Code ou integração automática. Use seu banco, maquininha ou provedor para receber e conferir. O sistema não calcula juros nem frete. A tela também inclui orientações sobre identificação da loja, preço total, entrega, atendimento e devoluções, com links para o [Decreto do comércio eletrônico](https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm), o [Código de Defesa do Consumidor](https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm) e os [cuidados com comprovantes Pix](https://www.bcb.gov.br/meubc/faqs/s/golpes).

As credenciais do banco ou provedor não devem ser inseridas nas instruções. A emissão fiscal depende de um serviço emissor adequado; registrar uma referência de nota não emite o documento.

## Variáveis de ambiente

O servidor lê `.env` automaticamente. Use `.env.example` como referência e substitua a chave de exemplo antes de publicar.

| Variável        | Finalidade                                       |
| --------------- | ------------------------------------------------ |
| `PORT`          | Porta do servidor; padrão `3001`.                |
| `JWT_SECRET`    | Chave das sessões; gerada localmente se ausente. |
| `DATABASE_PATH` | Caminho opcional do arquivo SQLite local.        |
| `TURSO_DATABASE_URL` | URL do banco libSQL persistente; tem prioridade sobre o SQLite local. |
| `TURSO_AUTH_TOKEN` | Token privado de acesso ao banco remoto. |

Gere uma chave aleatória com:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Não publique `.env`, tokens ou chaves. Sem `JWT_SECRET` no modo local, o servidor cria `.jwt-secret` ao lado do banco. Preserve esse arquivo para manter sessões entre reinicializações. Trocar a senha de um usuário invalida suas sessões anteriores.

## Banco local, privacidade e backup

O banco operacional local fica em `server/data/store.db`, o unico arquivo SQLite mantido no projeto. Se estiver ausente, execute `npm run sync:from-cloud` para restaurar a copia do Turso.

Para usar os mesmos dados no computador e na Vercel, crie um banco libSQL vazio no Turso, configure `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` no `.env` local e execute `npm run migrate:cloud`. A migração usa um backup consistente, copia registros, imagens, índices, sequências, views e triggers e confere contagens e chaves estrangeiras. Depois configure essas duas variáveis na Vercel e publique novamente. Reinicie o servidor local para ele passar a usar o mesmo banco remoto. O SQLite original permanece como cópia local; não há sincronização automática entre arquivos SQLite separados.

A Vercel deve usar o Turso. Sem banco remoto ou banco local restaurado, o servidor informa que a base esta ausente. O backup criptografado no GitHub permite recuperar todos os dados com a chave privada e nao e carregado automaticamente.

O banco operacional e as credenciais sao ignorados pelo Git. A copia completa atualizada e publicada somente com criptografia em `backups-encrypted/`; as chaves permanecem fora do repositorio.

```bash
npm run backup
```

O comando utiliza o mecanismo de backup do SQLite, incluindo alterações em WAL, e cria uma cópia consistente em `../coresefragrancias-bancos-arquivados/` (ou `BACKUP_DIR`). Guarde também uma cópia fora do computador.

O backup copia o banco SQLite local usado pelo servidor.

`npm run create-seed` recria a base pública a partir dos dados locais, removendo informações pessoais, pedidos online, endereços de entrega, protocolos e configuração privada do fornecedor, redefinindo o administrador de exemplo e desativando as demais credenciais. Use apenas ao preparar uma base para distribuição. O banco operacional não deve ser enviado ao GitHub.

## SQLite local e hospedagem

O servidor usa o banco persistente Turso quando `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` estão configurados no `.env` privado. Sem essas variáveis, usa `server/data/store.db` ou `DATABASE_PATH`. A Vercel deve usar as mesmas credenciais para compartilhar os dados; SQLite em `/tmp` é temporário.

Para atualizar a cópia SQLite local com o banco remoto, execute `npm run sync:from-cloud` na raiz do projeto. O comando confere registros e imagens, verifica a integridade e salva um backup anterior em `../coresefragrancias-bancos-arquivados/` (ou `BACKUP_DIR`). A cópia representa o momento da sincronização; o banco remoto pode continuar recebendo alterações. O banco remoto nao e alterado por esse comando.

O cadastro e a edição de produtos possuem **Valor de venda** (`price`) e **Valor de compra** (`purchase_price`), em reais. Produtos existentes recebem valor de compra zero até que a equipe informe o custo real. O valor de venda continua sendo utilizado na vitrine, pedidos e vendas. Os custos de compra ficam na API administrativa e não são enviados no catálogo público.

## Validade e ordem dos produtos

- **Vencido:** validade anterior à data de hoje.
- **Quase vencendo:** vence hoje ou nos próximos 30 dias, incluindo o último dia.
- Sem validade cadastrada, não há alerta automático.

O cálculo usa o calendário de São Paulo. Os avisos são recalculados a cada minuto e quando a página volta a ficar visível. O resumo considera produtos em estoque; a lista e o catálogo identificam a validade de cada item.

Os produtos aparecem pelo identificador de cadastro, do mais recente para o mais antigo. Ao cadastrar um produto, a pesquisa é limpa para mostrar o novo item.

## Correções implementadas

### Retirada de vencidos e lista de perdas

O botão **Baixar PDF**, na tela Produtos, inclui o histórico de perdas por vencimento com nome do produto, quantidade, validade, data de retirada, preço unitário e valor total, além do total de unidades e valores. Uma seção separada mostra os vencidos ainda em estoque pelo preço atual, sem somá-los às perdas já registradas.

O painel principal mostra **Perdas por vencimento** (valor acumulado das retiradas) e **Unidades retiradas por vencimento**, com a contagem de produtos diferentes. Esses indicadores usam o histórico de baixas, não os produtos vencidos que ainda aguardam retirada, e preservam o preço registrado na baixa.

Na tela **Produtos**, administradores e funcionários podem usar **Retirar vencido** em um item ou **Retirar vencidos do estoque** para todos os vencidos com saldo. A ação pede confirmação, zera o estoque e registra uma saída com motivo `Retirada por vencimento`, preservando o cadastro e o histórico.

A seção **Perdas por vencimento** mostra data da retirada, produto, validade, quantidade, preço unitário, valor perdido e responsável, além do total acumulado. Os valores são estimados pelo **preço de venda cadastrado no momento da retirada**, pois o sistema não possui custo de compra. Alterações posteriores no nome ou preço não modificam a perda registrada.

Produtos que vencem hoje, ainda válidos ou sem data não podem ser retirados por essa função. A operação é transacional e impede baixar o mesmo estoque duas vezes. Repor estoque posteriormente permite uma nova retirada, registrada separadamente.

- Login: oito falhas por usuário normalizado e IP em 15 minutos; acessos bem-sucedidos não consomem a cota.
- API: 500 requisições por 15 minutos, com login e leitura de imagens fora da contagem para evitar bloqueio ao carregar o catálogo.
- Validação de preços, quantidades inteiras, datas, parcelas, clientes e formas de pagamento no servidor.
- Transações para vendas, cancelamentos, estoque e importações, com testes de operações concorrentes.
- Recusa de edições com quantidade desatualizada, evitando sobrescrever movimentações recentes; a interface atualiza a lista para nova tentativa.
- Registro de ajustes de estoque ao alterar quantidades por edição ou CSV.
- Proteção contra exclusão de produtos e usuários vinculados ao histórico.
- Recuperação de referências antigas a produtos apagados como `Produto histórico #código`, com estoque zero, preservando vendas sem inventar saldo.
- Bloqueio de novos envios de formulário enquanto uma gravação está em andamento.
- Mensagens de falha de carregamento com opção de tentar novamente.
- Imagens PNG e JPEG de até 4 MB, validadas antes do envio e no servidor.
- Listagem sem carregar todos os arquivos de imagem na memória.
- Erros padronizados sem exposição de detalhes internos do banco.
- Relatórios de quantidade vendida desconsideram vendas canceladas.

Os limites de requisição protegem a API e não representam um limite de usuários cadastrados.

## Importação e exportação CSV

Exporte os produtos para obter o modelo das colunas. A importação aceita datas `AAAA-MM-DD` ou `DD/MM/AAAA` e decimais com vírgula, respeitando as aspas e separadores do CSV.

Nome é obrigatório. Preços negativos, quantidades fracionadas e datas inválidas são recusados. Uma linha inválida desfaz toda a importação. IDs existentes permitem atualizar produtos, registrando ajustes de estoque.

Exportações de produtos e vendas protegem células que poderiam ser interpretadas como fórmulas por planilhas.

## Comandos

| Comando                 | Finalidade                                     |
| ----------------------- | ---------------------------------------------- |
| `npm ci`                | Instalar conforme o lockfile.                  |
| `npm run dev`           | Iniciar API e interface em desenvolvimento.    |
| `npm run server`        | Iniciar somente a API com reinício automático. |
| `npm run client`        | Iniciar somente o Vite.                        |
| `npm run build`         | Gerar a interface em `dist/`.                  |
| `npm start`             | Servir API e interface compilada.              |
| `npm test`              | Executar os testes automatizados.              |
| `npm run backup`        | Copiar o SQLite local de forma consistente.    |
| `npm run migrate:cloud` | Migrar a cópia local para Turso.               |
| `npm run create-seed`   | Recriar a base pública anonimizada.            |
| `npm audit`             | Verificar vulnerabilidades conhecidas.         |

## Validações realizadas

A atualização passou com **32 testes**, além de build e auditoria sem vulnerabilidades encontradas. O fluxo de cadastro, detalhes, checkout, reserva, confirmação manual de pagamento, atendimento e correção de cadastro foi exercitado em navegador, com verificação de layout nas larguras 320, 390 e 1440 pixels.

A suíte inclui testes de autenticação, limites, validade, entradas inválidas, vendas e cancelamentos concorrentes, estoque, importação atômica, sessões, transações, imagens, retomada da migração, busca sem acentos, catálogo público, cadastro seguro de clientes, separação de permissões, conferência de sacola e bloqueio de gravações na Vercel sem banco persistente. Os testes de comércio acrescentam identificação do fornecedor, informações de produtos, aceite, preço/frete, idempotência, concorrência, privacidade entre contas, pagamento/reembolso, expiração e liberação de reservas e troca de senha.

Também foram verificados a compilação, os fluxos principais em navegador e o comportamento responsivo. A auditoria de dependências não apontou vulnerabilidades na verificação realizada; reavalie esse resultado ao atualizar o projeto.

```bash
npm test
npm run build
npm audit
```

Os testes usam bancos temporários isolados. O adaptador libSQL foi testado com o cliente oficial em arquivo local; isso não substitui a validação de um Turso real.

O workflow `.github/workflows/ci.yml` está configurado para instalação, testes, compilação e auditoria de vulnerabilidades altas, com Node.js 22 e 24, em pushes para `main` e pull requests. Consulte o resultado das execuções na aba Actions do repositório.

## Estrutura

```text
src/                     Interface React, estilos e regras de validade
src/storefront.jsx       Vitrine, cadastro, login e sacola de clientes
src/storefront.css       Estilos da área pública
src/commerce.jsx         Checkout, pedidos, políticas, atendimento e configuração da loja
src/commerce.css         Estilos dos fluxos de comércio
src/search.js            Busca compartilhada sem distinção de acentos
server/index.js          API, autenticação e regras do sistema
server/commerce.js       Pedidos online, reservas, atendimento e dados do cliente
server/database.js       Adaptador SQLite local / libSQL remoto
server/validation.js     Validação de entradas
server/rate-limits.js    Limites de login e requisições
server/*.test.js         Testes da API, banco e limites
server/data/             Banco local e base pública
scripts/backup.js        Backup local
scripts/migrate-cloud.js Migração para Turso
scripts/create-seed.js   Geração da base anonimizada
api/index.js             Entrada da API na Vercel
.github/workflows/ci.yml Validação automática
dist/                    Interface gerada pelo build
```
