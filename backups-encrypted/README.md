# Cópia completa criptografada

`store-completo-2026-10-10.db.enc` contém o banco local completo: 883 produtos, 367 vendas, 26 perdas por vencimento, 26 movimentações, 8 formas de pagamento, 3 usuários e as demais tabelas, inclusive imagens e credenciais armazenadas no banco. A cópia foi validada por tabela e passou nas verificações de integridade e chaves estrangeiras.

O arquivo usa compressão gzip e criptografia autenticada AES-256-GCM com chave aleatória de 256 bits. A chave está **somente no computador**, em `server/data/backup-keys/store-completo-2026-10-10.key`, caminho ignorado pelo Git. Guarde uma segunda cópia da chave em local privado: sem ela, o backup não pode ser recuperado.

Para verificar a recuperação contra a cópia local:

```powershell
node scripts/encrypted-backup.js verify backups-encrypted/store-completo-2026-10-10.db.enc server/data/backups/store-completo-2026-10-10.db server/data/backup-keys/store-completo-2026-10-10.key
```

Para restaurar em um arquivo novo, sem substituir o banco em uso:

```powershell
node scripts/encrypted-backup.js restore backups-encrypted/store-completo-2026-10-10.db.enc server/data/backups/store-restaurado.db server/data/backup-keys/store-completo-2026-10-10.key
```

Esta cópia é um backup. Ela não substitui automaticamente a base da aplicação na Vercel nem torna o armazenamento da hospedagem persistente.
