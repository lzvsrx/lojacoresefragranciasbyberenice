# Segurança e operação

## Proteções implementadas

- Sessões do navegador em cookies `HttpOnly`, `SameSite=Lax`, sem tokens em `localStorage` ou no JSON de login do navegador. Em produção, cookies `Secure` com prefixo `__Host-`, sem domínio compartilhado.
- Validação de assinatura HS256, emissor, audiência, sujeito, identificador único e versão da sessão. O banco guarda somente HMAC do token. Tokens anteriores a esta atualização deixam de autenticar.
- Equipe: duração máxima de uma hora e inatividade máxima de 15 minutos. Clientes: oito horas e 30 minutos, respectivamente. Até cinco sessões por usuário. A atividade é registrada no máximo uma vez por minuto; a expiração pode ocorrer até um minuto antes do limite de inatividade.
- Sair revoga a sessão no servidor; **Sair de todos os dispositivos** revoga todas as sessões daquele usuário. Alterações administrativas de cadastro ou senha também invalidam sessões. Revogação e permissões são consultadas a cada requisição autenticada.
- Proteção contra CSRF por verificação de origem, contexto de navegação, cabeçalho do portal e restrição de tipos de conteúdo. Origens não autorizadas não podem enviar gravações pelo navegador. As notificações do Mercado Pago usam sua assinatura própria.
- Login: oito falhas por usuário/IP em 15 minutos, mais 60 tentativas totais por IP em 15 minutos. Cadastro: dez tentativas por IP/hora. Esses limites usam contadores atômicos compartilhados no SQLite/Turso, sobrevivendo a reinicializações e múltiplas instâncias. Identificadores ficam pseudonimizados com HMAC.
- Senhas novas exigem de 12 a 72 caracteres, com maiúscula, minúscula e número, sem truncamento além do limite de 72 bytes do bcrypt. São armazenadas com bcrypt de custo 12. Hashes antigos de custo inferior são atualizados após login válido. Mensagens de login não revelam se o usuário existe. O administrador de exemplo `admin123` impede a inicialização em produção. Senhas antigas não são alteradas automaticamente; solicite sua atualização aos titulares.
- Permissões verificadas no servidor. Funcionários não recebem os dados pessoais privados de outros integrantes da equipe. Exclusão ou rebaixamento concorrente não pode remover o último administrador.
- Uploads autenticados limitados a 4 MB, um arquivo, 20 campos de até 16 KB e quatro uploads simultâneos por processo. Imagens PNG/JPEG são decodificadas, validadas e regravadas, removendo metadados. São recusadas imagens animadas, corrompidas ou acima de 16 milhões de pixels; a saída é limitada a 2048 × 2048 pixels e 4 MB.
- JSON limitado a 128 KB e sem descompressão de requisições. Importação CSV limitada a 5.000 linhas e 20 colunas, com validação e transação. Exportações CSV neutralizam fórmulas.
- CSP, proteção contra enquadramento, `nosniff`, política de referência, HTTPS e restrições de recursos do navegador. Os cabeçalhos também estão configurados no `vercel.json` para arquivos estáticos servidos sem Express.
- Registro de criação/revogação de sessões, falhas de login, acessos sensíveis, recusas de permissão e tentativas/resultados de alterações. Não são registrados senhas, cookies, corpos de requisição ou IPs em texto puro. Logs de erro usam identificadores de requisição sem detalhes internos enviados ao cliente.
- Exclusão de sessões, auditoria e contadores ao gerar banco público. Testes usam um esquema e dados fictícios, sem consultar o banco operacional.

## Configuração de produção

Defina `NODE_ENV=production`, `PUBLIC_BASE_URL=https://SEU-DOMINIO` e uma `JWT_SECRET` aleatória de pelo menos 48 bytes. O servidor recusa chaves fracas ou de exemplo. A origem não deve conter caminho, consulta, usuário ou senha. Não use credenciais reais em variáveis `VITE_*`.

Gere a chave em um terminal privado e salve-a no gerenciador de segredos da hospedagem:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Na Vercel, o banco remoto Turso é obrigatório em produção. Fora da Vercel, encerre HTTPS em um proxy reverso e configure `TRUST_PROXY_HOPS` com o número real de proxies confiáveis, entre 0 e 5. O valor padrão é um na Vercel e zero nos demais ambientes. O proxy deve sobrescrever os cabeçalhos encaminhados e o servidor de origem deve aceitar tráfego somente do proxy. Não exponha diretamente uma origem que confia em cabeçalhos fornecidos pelo público. Produção recusa conexões identificadas como HTTP.

`CORS_ORIGINS` permite outras origens explícitas, separadas por vírgula, quando necessário. `localhost` só é aceito em desenvolvimento. O navegador da aplicação usa a API na mesma origem; mantenha o proxy `/api` no desenvolvimento. O servidor de desenvolvimento escuta somente no computador local por padrão.

Para Mercado Pago, configure as credenciais privadas e o webhook descritos no README. As credenciais de teste e de produção devem permanecer separadas.

O [guia do Mercado Pago](docs/MERCADO_PAGO.md) descreve os SDKs oficiais, as permissões CSP necessárias aos seus domínios, a identificação do dispositivo e o reembolso integrado. `npm run payments:configure` prepara chaves locais sem exibi-las. O `.env` também está excluído do envio à Vercel. O cron de recuperação requer `CRON_SECRET` forte; nunca use a chave de sessão ou o Access Token como senha do cron. Notificações são persistidas antes de processar e consultadas canonicamente; em falhas transitórias, o servidor responde `503` para permitir novas tentativas do provedor. Solicitações ao Mercado Pago têm limite individual de oito segundos e orçamento agregado de 20 segundos por requisição HTTP.

Esta atualização exige novo login. Reinicie/republique todas as instâncias com a mesma chave e o mesmo banco. Não misture versões antigas e novas durante a migração de sessões.

## Auditoria e resposta a incidentes

Administradores autenticados podem consultar `GET /api/security/audit?limit=50`, com até 100 registros por página e cursor `before=ID`. Nunca exponha essa rota publicamente nem compartilhe os dados sem necessidade. A limpeza de eventos com mais de 90 dias ocorre ao criar uma sessão; não há tarefa de limpeza agendada quando a aplicação fica inativa. Os registros são úteis para investigação, mas não constituem um armazenamento imutável: um administrador do banco pode modificá-los.

Tentativas de gravação são registradas antes da operação. Se a gravação do resultado de auditoria falhar depois da operação, o servidor mantém o resultado original para evitar repetição da venda e emite `audit.write_failed` no log operacional. Configure alerta para esse evento e para `request.failed`/`application.start_failed` no provedor de logs.

Em suspeita de conta comprometida, encerre todas as sessões e altere a senha. Em vazamento de segredo, rotacione-o no serviço correspondente; para invalidar globalmente os tokens de sessão, substitua `JWT_SECRET` em todas as instâncias. A troca também muda a pseudonimização dos identificadores de segurança. Preserve evidências com acesso restrito antes de qualquer limpeza.

Backups e cópias de sincronização contêm dados pessoais e devem permanecer fora do repositório e de pastas públicas. `npm run backup` gera um SQLite legível: antes de armazenar fora do servidor, use `scripts/encrypted-backup.js` e mantenha a chave separada do arquivo cifrado. Verifique a restauração. Permissões POSIX de arquivos não substituem ACLs no Windows.

## Validação contínua e limites

Execute `npm ci`, `npm test`, `npm run build` e `npm run security:check`. O CI repete os checks em Node 26.13.1 e npm 12.2.2, incluindo auditoria semanal de dependências. Os testes cobrem sessões, separação de portais, CSRF, revogação, inatividade, uploads falsificados, memória de uploads, contadores concorrentes e confirmação de pagamentos.

A conta `admin` com senha de exemplo impede a inicialização em produção. Para recuperar uma instalação antiga, o operador da hospedagem pode fornecer temporariamente `ADMIN_BOOTSTRAP_PASSWORD_HASH`, um hash bcrypt com custo entre 12 e 16 de uma senha forte gerada privadamente. A aplicação troca exclusivamente a senha de exemplo e invalida suas sessões; contas com senha já alterada permanecem protegidas. Remova a variável da hospedagem após a recuperação. A senha gerada nesta recuperação fica no `.env` local, em `ADMIN_RECOVERY_PASSWORD`, e não deve ser publicada nem enviada em mensagens. Os logs de inicialização identificam erros conhecidos por códigos fixos, sem registrar as mensagens que possam conter segredos.

A verificação opcional `node scripts/check-security-browser.mjs` exercita os dois portais em Edge sem interface, incluindo recarregamento, cookies inacessíveis ao JavaScript e revogação de cookies capturados. Requer o build, Edge e Playwright instalado separadamente; `PLAYWRIGHT_MODULE` pode apontar para seu `index.mjs`. Usa somente banco e credenciais temporários.

Essas mudanças não equivalem a uma certificação ou teste de invasão independente. A aplicação ainda não implementa MFA/passkeys para os usuários. Ative MFA nas contas de hospedagem, banco e Mercado Pago, restrinja seus acessos e avalie MFA na aplicação conforme a exigência da operação. Proteção contra ataques distribuídos volumétricos exige WAF/limites na borda; os limites gerais da API continuam sendo por processo. Mantenha sistema operacional, runtime, dependências, certificados e backups atualizados.

Referências técnicas: [sessões OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [segurança de produção do Express](https://expressjs.com/en/advanced/best-practice-security/) e [guia de uploads OWASP](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).
