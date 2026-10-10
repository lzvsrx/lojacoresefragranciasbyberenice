# Capturas identificadas do projeto

Foram geradas 52 capturas de telas e estados funcionais, incluindo versões para celular.

- Abra [a galeria](index.html) para pesquisar e ampliar as fotos.
- Abra [o guia em PDF](guia-das-telas.pdf) para consultar todas as telas.
- [Relatório de produtos demonstrativo](relatorio-produtos-demonstracao.pdf).
- [Manifesto](manifesto.json): nomes, áreas, caminhos e partes identificadas.

Os dados são fictícios e as fotos de produtos vieram exclusivamente da base pública do projeto. O banco operacional não foi aberto ou alterado. As marcações numeradas foram adicionadas somente durante a captura.

## Gerar novamente

Execute o build primeiro. O script exige Microsoft Edge e Playwright disponível como módulo ou pelo caminho absoluto na variável PLAYWRIGHT_MODULE. Não é necessário instalar um navegador adicional ao usar o canal msedge.

```powershell
npm.cmd run build
$env:PLAYWRIGHT_MODULE = 'CAMINHO/para/playwright/index.mjs'
node scripts/capture-screens.mjs
```

A geração inicia um servidor em porta temporária e cria/remove somente seu próprio banco temporário. Reexecutar substitui os arquivos de documentação de mesmo nome.
