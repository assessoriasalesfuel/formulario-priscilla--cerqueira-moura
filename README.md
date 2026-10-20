# Formulário de medida protetiva — Dra. Priscilla Cerqueira Moura

Formulário mobile-first para captação e qualificação comercial em situações relacionadas a medida protetiva. O frontend e a API são servidos pelo mesmo processo Express, e o backend grava exclusivamente na aba `Leads` do CRM definitivo.

## Estrutura

```text
public/                    interface, estilos e JavaScript do formulário
server/
  googleSheets.js          autenticação, idempotência e gravação no CRM
  leadSchema.js            contrato canônico das 24 colunas A:X
  leadService.js           validação, normalização e submissão
  qualification.js        classificação e prioridade comercial
scripts/
  repairSheetViews.js      verificação/reparo controlado das visões
test/                      testes unitários e de API simulada
server.js                  servidor Express
```

## Fluxo e CRM

O formulário possui cinco etapas: situação atual, principal preocupação, intenção de contratação, condição de pagamento e contato/consentimentos. As quatro primeiras etapas possuem quatro alternativas cada.

Todos os usuários percorrem as cinco etapas e as submissões válidas são classificadas somente no backend, depois do envio. Os status são `Qualificado`, `Pendente de qualificação financeira` e `Desqualificado`. Com capacidade financeira compatível declarada, contratação imediata gera prioridade `Alta`, contratação em até sete dias gera `Média` e quem ainda está avaliando recebe `Baixa`. Quem precisa conhecer os valores fica pendente e sem prioridade. Busca apenas por informações, ausência de intenção ou indisponibilidade financeira desqualificam e prevalecem sobre a pendência. A principal preocupação não interfere na classificação. A prioridade é exclusivamente comercial, não uma avaliação de gravidade jurídica.

O CRM definitivo possui `Visão geral`, `Leads`, `Qualificados` e `Desqualificados`. O contrato real de `Leads` possui 24 colunas (A:X). A situação e a principal preocupação são registradas juntas em `Situação atual`; a condição financeira e a forma de pagamento ficam juntas em `Disponibilidade para contratação`. As colunas legadas `Tempo desde a ciência do caso` e `Situação com advogado` ficam vazias porque não correspondem a perguntas do formulário atual. As cinco UTMs e o FBCLID ocupam Q:V; URL de entrada e dispositivo ocupam W:X. Nenhum cabeçalho é alterado. A visão `Qualificados` exibe somente qualificados; a visão operacional `Desqualificados` reúne desqualificados e pendentes, preservando o status distinto de cada registro.

A data é gravada em `DD/MM/AAAA HH:MM` no fuso `America/Sao_Paulo`. O `submissionId` também é o Lead ID e a chave de idempotência. A consulta idempotente lê somente a coluna de IDs e os campos comerciais necessários da linha encontrada. O WhatsApp oficial é liberado exclusivamente para qualificados; pendentes e desqualificados recebem mensagens neutras, sem exposição da classificação ou do motivo.

## Configuração

Copie apenas os nomes necessários de `.env.example` e mantenha os valores reais fora do Git:

```text
GOOGLE_SHEET_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_APPLICATION_CREDENTIALS=
NODE_ENV=production
CONFIRM_SHEET_VIEW_REPAIR=false
```

`GOOGLE_APPLICATION_CREDENTIALS` é uma alternativa local ao e-mail e à chave privada da Service Account.
O servidor carrega o `.env` a partir da raiz do projeto e resolve caminhos relativos de credenciais nessa mesma raiz. Variáveis fornecidas pelo ambiente de produção continuam tendo precedência. `GET /api/integration-status` realiza uma verificação autenticada somente de leitura e nunca grava leads.

## Execução

```bash
npm start
npm test
npm run sheets:verify
```

`npm run sheets:repair` altera somente as seis fórmulas da aba `Visão geral` e das abas derivadas e exige `CONFIRM_SHEET_VIEW_REPAIR=true`. O dry-run deve ser revisado antes. O script valida o ID do CRM definitivo e não altera dados da aba `Leads`.

## Segurança e privacidade

- O backend valida payload, consentimentos, opções e cabeçalho A:X.
- Textos iniciados por caracteres de fórmula são neutralizados e o Sheets usa `RAW`.
- A API limita requisições com memória limitada, restringe o corpo a 32 KB e não devolve stack traces ou erros internos do parser.
- CSP, `Permissions-Policy`, `Referrer-Policy`, `nosniff` e `Cache-Control: no-store` protegem a aplicação e as respostas da API.
- Credenciais ficam somente no backend; `.env`, backups e artefatos estão ignorados.
- UTMs e FBCLID utilizados são preservados sem carregar Pixel, fontes ou scripts de terceiros.
- O aviso atual permanece em `public/js/formConfig.js`; os dados formais de privacidade precisam ser preenchidos antes da publicação definitiva.
