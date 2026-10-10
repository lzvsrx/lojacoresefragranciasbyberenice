# Cores & Fragrâncias by Berenice

Sistema de catálogo, vendas e estoque com React, API Node.js e banco SQLite local ou Turso remoto.

Este documento reúne as funcionalidades e correções implementadas até agora. **A execução local foi validada; o banco Turso ainda precisa ser criado e conectado à Vercel para permitir gravações permanentes no site publicado.**

## Funcionalidades

- Vitrine pública com entrada própria para clientes, cadastro e login separados da equipe.
- Busca sem distinção de acentos, filtros de marca, categoria e preço e ordenação por novidades, nome ou valor.
- Sacola com conferência de preços e estoque no servidor antes de preparar o pedido pelo WhatsApp.

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
| Administração / equipe | `http://localhost:3001/#/admin`             | `http://localhost:5173/#/admin`             |

Clientes navegam sem login. O cadastro exige nome, e-mail, usuário e senha forte; telefone é opcional. Não há confirmação automática de e-mail nem recuperação de senha por e-mail implementada; o acesso tem um link para pedir ajuda à loja. O servidor sempre cria o perfil `cliente`, mesmo que alguém tente enviar outro perfil. Clientes não acessam produtos administrativos, usuários, estoque, vendas ou configurações.

As sessões de equipe e cliente ficam separadas. Sair da conta de cliente não encerra a sessão administrativa. O cadastro público tem limite de 10 tentativas por IP por hora; o login mantém sua proteção contra falhas.

### Catálogo e pedido do cliente

Fotos de usuários exigem autenticação: clientes só consultam a própria foto; a equipe consulta fotos conforme suas permissões. Na administração, a lista começa com 40 produtos e permite carregar mais, mantendo a busca sobre toda a lista e carregando imagens sob demanda.

O catálogo entrega 24 produtos por página (máximo de 48 por chamada), carrega imagens sob demanda e aguarda 250 ms após alterações de busca antes de consultar a API, cancelando consultas anteriores. Metadados públicos têm cache interno de até 15 segundos, invalidado por gravações de produtos, vendas e estoque na mesma instância. A vitrine consulta novamente a cada minuto enquanto está visível e ao retornar à aba. A conferência da sacola consulta o banco diretamente, sem usar esse cache.

A sacola é guardada neste navegador, aceita até 40 produtos diferentes e não reserva estoque. Depois do login, **Conferir valores e disponibilidade** consulta preços atuais e valida quantidades. **Enviar pedido pelo WhatsApp** abre a mensagem para o cliente enviar: não registra uma venda nem confirma pagamento automaticamente. A equipe confirma as condições e registra a venda no painel. Frete e pagamento são combinados no atendimento.

Produtos vencidos são excluídos da vitrine e recusados na conferência da sacola e no registro de novas vendas. Esgotados ficam ocultos por padrão, com filtro para visualização. Produtos próximos do vencimento mostram sua validade.

O banco de exemplo usa usuário `admin` e senha `admin123`. Troque a senha antes de disponibilizar a loja. Um banco operacional existente mantém seus próprios usuários e senhas. Os campos de login não vêm preenchidos na interface.

## Configurar formas de pagamento

Administradores acessam **Formas de pagamento** para ajustar os tipos disponíveis. Cada cartão explica como receber, conferir o pagamento e identificar a transação. Configure nome, disponibilidade, limite de parcelas (1 a 24), exigência de código da transação e orientação exibida no formulário de venda. **Salvar configuração** grava somente aquela forma; **Usar orientação sugerida** preenche um texto para revisar e salvar.

Ativar uma forma permite selecioná-la na venda, mas não cria cobrança, boleto, QR Code ou integração automática. Use seu banco, maquininha ou provedor para receber e conferir. O sistema não calcula juros nem frete. A tela também inclui orientações sobre identificação da loja, preço total, entrega, atendimento e devoluções, com links para o [Decreto do comércio eletrônico](https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm), o [Código de Defesa do Consumidor](https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm) e os [cuidados com comprovantes Pix](https://www.bcb.gov.br/meubc/faqs/s/golpes).

As credenciais do banco ou provedor não devem ser inseridas nas instruções. A emissão fiscal depende de um serviço emissor adequado; registrar uma referência de nota não emite o documento.

## Variáveis de ambiente

O servidor lê `.env` automaticamente. Use `.env.example` como referência e substitua a chave de exemplo antes de publicar.

| Variável             | Finalidade                                       |
| -------------------- | ------------------------------------------------ |
| `PORT`               | Porta do servidor; padrão `3001`.                |
| `JWT_SECRET`         | Chave das sessões; obrigatória com banco remoto. |
| `TURSO_DATABASE_URL` | Endereço do Turso. Vazio usa SQLite local.       |
| `TURSO_AUTH_TOKEN`   | Credencial de acesso ao Turso.                   |
| `DATABASE_PATH`      | Caminho opcional do arquivo SQLite local.        |

Gere uma chave aleatória com:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Não publique `.env`, tokens ou chaves. Sem `JWT_SECRET` no modo local, o servidor cria `.jwt-secret` ao lado do banco. Preserve esse arquivo para manter sessões entre reinicializações. Trocar a senha de um usuário invalida suas sessões anteriores.

## Banco local, privacidade e backup

O banco operacional padrão fica em `server/data/store.db`. Na primeira execução, se ele não existir, o servidor copia `server/data/store.seed.db`.

A base pública contém catálogo, imagens e histórico anonimizado. Banco operacional, backups e credenciais são ignorados pelo Git. Enviar o código ao GitHub não envia os dados atuais da loja.

```bash
npm run backup
```

O comando utiliza o mecanismo de backup do SQLite, incluindo alterações em WAL, e cria uma cópia consistente em `server/data/backups/`. Guarde também uma cópia fora do computador.

Com Turso configurado, esse comando continua copiando **o arquivo local**. O banco remoto precisa de backup pelo serviço Turso.

`npm run create-seed` recria a base pública a partir dos dados locais, removendo informações pessoais, redefinindo o administrador de exemplo e desativando as demais credenciais. Use apenas ao preparar uma base para distribuição.

## Ativar o banco permanente na Vercel

O armazenamento local das funções da Vercel é temporário; consulte a [documentação sobre SQLite na Vercel](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel). Sem banco remoto, a aplicação publicada permite consulta e login, mas bloqueia cadastros, alterações e vendas e mostra um aviso na interface.

**Pendente:** criar o Turso e configurar as credenciais na hospedagem. O suporte e o comando de migração estão implementados; a conexão real em produção ainda não foi validada.

1. Conecte um banco **Turso vazio** pelo [Marketplace da Vercel](https://vercel.com/marketplace/tursocloud).
2. Configure `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` e uma chave própria `JWT_SECRET` na Vercel para o ambiente desejado.
3. Pause cadastros e vendas e pare o servidor local. Execute `npm run backup` antes de migrar.
4. Coloque as mesmas três variáveis no `.env` local e execute `npm run migrate:cloud`.
5. Após concluir, publique novamente na Vercel e reinicie o projeto local. Ambos usarão o mesmo banco remoto.

A migração copia produtos, imagens, usuários e histórico, confere as contagens e mantém uma cópia da origem em `server/data/backups/`. Se houver interrupção, execute novamente para retomar a mesma cópia. O comando recusa sobrescrever um destino já ativado. A aplicação não abre um banco marcado com migração incompleta.

Alterações feitas somente no SQLite depois da cópia não são sincronizadas automaticamente com o Turso. Mantenha as gravações pausadas até os dois ambientes apontarem para o banco remoto.

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

A suíte local passou com **22 testes**, cobrindo autenticação, limites, validade, entradas inválidas, vendas e cancelamentos concorrentes, estoque, importação atômica, sessões, transações, imagens, retomada da migração, busca sem acentos, catálogo público, cadastro seguro de clientes, separação de permissões, conferência de sacola e bloqueio de gravações na Vercel sem banco persistente.

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
src/search.js            Busca compartilhada sem distinção de acentos
server/index.js          API, autenticação e regras do sistema
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
