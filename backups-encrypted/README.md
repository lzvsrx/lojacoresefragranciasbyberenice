# Backup completo criptografado

A copia atual e `store-unificado-2026-10-15.db.enc`: banco local consolidado e conferido contra o Turso em 15/10/2026, com 890 produtos, 369 vendas, 29 movimentacoes, 26 perdas por vencimento, 8 formas de pagamento e 3 usuarios. Inclui todas as tabelas e imagens.

Formato: gzip + AES-256-GCM. A chave fica somente no computador, em `%LOCALAPPDATA%/CoreseFragrancias/backup-keys/store-unificado-2026-10-15.key`, fora do repositorio e do OneDrive. Guarde uma segunda copia privada da chave; ela e necessaria para restaurar o banco.

Verificar a copia contra o banco local:

```powershell
node scripts/encrypted-backup.js verify backups-encrypted/store-unificado-2026-10-15.db.enc server/data/store.db "$env:LOCALAPPDATA/CoreseFragrancias/backup-keys/store-unificado-2026-10-15.key"
```

Restaurar em um arquivo novo (o destino nao pode existir):

```powershell
node scripts/encrypted-backup.js restore backups-encrypted/store-unificado-2026-10-15.db.enc ../coresefragrancias-bancos-arquivados/store-restaurado.db "$env:LOCALAPPDATA/CoreseFragrancias/backup-keys/store-unificado-2026-10-15.key"
```

O backup de 10/10/2026 permanece como historico e usa sua chave original. A aplicacao hospedada usa o Turso; os arquivos criptografados nao sao carregados automaticamente.
