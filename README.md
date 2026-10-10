# Cores & Fragrâncias by Berenice

Sistema completo de vendas, catálogo e controle de estoque migrado para React + Node.js.

## Executar em desenvolvimento

Requer Node.js 22.12 ou superior (recomendado: Node.js 24).

```bash
npm install
npm run dev
```

Abra `http://localhost:5173`. A API é executada em `http://localhost:3001`.

## Executar em produção

```bash
npm run build
npm start
```

Abra `http://localhost:3001`.

## Alertas de validade

O painel e a lista de produtos mostram um resumo dos itens em estoque vencidos ou próximos do vencimento. A lista e o catálogo também identificam cada produto com **Vencido** ou **Quase vencendo**.

- **Vencido:** a data de validade já passou.
- **Quase vencendo:** vence hoje ou nos próximos 30 dias.
- Produtos sem data de validade não recebem um alerta automático.

As datas seguem o calendário de São Paulo e os alertas são recalculados automaticamente enquanto a página permanece aberta. Novos produtos aparecem primeiro na lista.

## Validação

```bash
npm test
npm run build
npm audit
```

## Acesso inicial

- Usuário: `admin`
- Senha: `admin123`

Troque a senha pelo painel de usuários após o primeiro acesso.

## Recursos

- autenticação e permissões para administrador, funcionário e cliente;
- dashboard de faturamento, vendas, estoque baixo e aniversariantes;
- cadastro, edição, busca e exclusão segura de produtos;
- imagens originais do projeto, incluindo imagens armazenadas no SQLite;
- PDV com baixa transacional e validação de estoque;
- histórico de vendas;
- entradas, saídas e ajustes de estoque com motivo, responsável e saldo anterior/novo;
- cancelamento administrativo de vendas com devolução transacional ao estoque;
- exportação do histórico de vendas em CSV;
- gestão de equipe e clientes com preferências e foto de perfil;
- catálogo responsivo para clientes;
- importação e exportação de produtos em CSV.

O banco migrado está em `server/data/store.db`. Faça cópias de segurança desse arquivo regularmente.

## Banco de dados e privacidade

O repositório inclui `server/data/store.seed.db`, com o catálogo, as imagens e um histórico comercial anonimizado, sem dados pessoais de clientes. Na primeira execução ele é copiado automaticamente para `server/data/store.db`. O banco operacional é ignorado pelo Git para impedir a publicação acidental de clientes, vendas e senhas.
