# Formulário de qualificação — Dra. Priscilla Cerqueira Moura

Aplicação web mobile-first para uma análise inicial rápida de potenciais clientes. O fluxo apresenta uma pergunta por tela, persiste o acompanhamento na aba `Leads` de uma planilha Google Sheets e libera o contato por WhatsApp somente após confirmação server-side de um lead qualificado.

## Stack

- HTML5 e CSS3
- JavaScript puro com ES Modules
- Node.js 22 ou superior
- Express 5
- Google Sheets API (`googleapis`)
- `node:test`
- npm

## Estrutura

```text
.
├── public/
│   ├── index.html             # documento e metadados
│   ├── styles.css             # sistema visual responsivo
│   └── js/
│       ├── app.js             # estado, renderização e navegação
│       ├── questions.js       # perguntas e opções do formulário
│       ├── validation.js      # normalização e validações puras
│       ├── qualification.js   # classificação e prioridade
│       ├── whatsapp.js        # configuração e criação do link
│       ├── attribution.js     # UTMs, FBCLID, URL inicial e dispositivo
│       ├── metaPixel.js       # eventos do Meta Pixel sem dados pessoais
│       └── leadGateway.js     # chamadas HTTP ao backend
├── server/
│   ├── googleSheets.js        # autenticação e operações na aba Leads
│   ├── leadSchema.js          # fonte única dos 23 cabeçalhos e índices A:W
│   └── leadService.js         # validação, classificação e persistência
├── scripts/
│   ├── migrateSheetColumns.js # migração explícita do CRM para 23 colunas
│   └── repairSheetViews.js     # reparo restrito das seis fórmulas derivadas
├── test/                      # testes unitários e de integração simulada
├── Dockerfile                 # imagem de produção com Node.js 22
├── .dockerignore              # exclusões do contexto de build
├── server.js                  # servidor e health check
├── package.json
└── README.md
```

## Instalação e execução

Requisito: Node.js 22+ e npm.

```bash
npm install
npm start
```

A aplicação fica disponível em `http://localhost:3000`. Para desenvolvimento com reinício automático:

```bash
npm run dev
```

É possível alterar a porta pela variável de ambiente `PORT`.

## Google Sheets e variáveis de ambiente

Configure estas variáveis somente no backend:

```text
GOOGLE_SHEET_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
CONFIRM_SHEET_MIGRATION=false
```

Use `.env.example` apenas como referência. O projeto não carrega `.env` automaticamente: em produção, configure os valores no painel do serviço. A chave privada pode ser armazenada com quebras de linha representadas por `\n`; o servidor faz a normalização antes de autenticar.

A Service Account precisa ter permissão de **Editor** na planilha existente. Compartilhe a planilha com o e-mail configurado em `GOOGLE_SERVICE_ACCOUNT_EMAIL`. Nunca coloque credenciais reais no GitHub.

Durante o uso normal da aplicação, somente a aba `Leads` é escrita. As abas `Qualificados` e `Desqualificados` são derivadas por fórmula e só são ajustadas pelo script explícito de migração.

### Estrutura do CRM

A aba `Leads` usa exatamente 23 colunas (A:W), nesta ordem:

1. Lead ID
2. Data de criação
3. Status
4. Nome
5. WhatsApp
6. E-mail
7. Situação atual
8. Faixa de renda
9. Faixa de pensão alimentícia
10. Urgência
11. Momento da contratação
12. Motivo da classificação
13. Data de conclusão
14. Consentimento de dados
15. Autorização de contato
16. UTM Source
17. UTM Medium
18. UTM Campaign
19. UTM Content
20. UTM Term
21. FBCLID
22. URL de entrada
23. Dispositivo

`Data de criação` e `Data de conclusão` são geradas exclusivamente no servidor. A data de conclusão permanece vazia durante o preenchimento e é registrada somente após validação e classificação bem-sucedidas. O CRM não mantém Prioridade, DDD, Última etapa, Última atualização, WhatsApp acessado, Data do acesso ao WhatsApp, Data do consentimento ou Referrer.

Antes da primeira operação de cada instância do repositório, o backend valida o cabeçalho `Leads!A1:W1` e mantém o resultado em memória. Append e update aceitam somente arrays com exatamente 23 células; qualquer divergência bloqueia a escrita para evitar deslocamento ou expansão silenciosa da planilha.

### Migração controlada da planilha

A migração nunca roda no startup. Estes comandos só devem ser usados em uma migração deliberadamente autorizada. Para validar a estrutura existente sem escrever, use:

```bash
npm run migrate:sheet:dry
```

O script valida as abas `Leads`, `Qualificados`, `Desqualificados` e `Visão geral`, transforma as linhas pelo nome dos cabeçalhos e não imprime dados pessoais. Para aplicar a migração real, depois de revisar o dry-run, defina explicitamente `CONFIRM_SHEET_MIGRATION=true` e execute:

```bash
npm run migrate:sheet
```

A operação reconhece a estrutura antiga de 30 colunas, a estrutura de 22 colunas com `Principal preocupação`, a estrutura de 22 colunas com `Faixa de renda` e a estrutura atual de 23 colunas. Ela preserva os campos compatíveis, os Lead IDs e a Data de conclusão; leads antigos ficam com a nova faixa de pensão vazia. Também atualiza as fórmulas derivadas para `Leads!A2:W`, ajusta filtros para A:W, mantém a primeira linha congelada, remove formatação condicional exclusiva de Prioridade e ajusta fisicamente a quantidade de colunas. Não execute a migração sem revisar o dry-run e reservar uma janela de manutenção.

### Reparo das visões derivadas

As fórmulas de `Visão geral`, `Qualificados` e `Desqualificados` usam `INDIRECT` para manter a origem lógica na linha 2 mesmo que linhas sejam excluídas futuramente. O reparo específico trata `Leads` como somente leitura e pode escrever exclusivamente nas quatro células de indicadores encontradas pelos rótulos e em `Qualificados!A2` e `Desqualificados!A2`.

Para validar sem escrever:

```bash
npm run repair:sheet:views:dry
```

Para executar no ambiente seguro que já possui as credenciais Google, revise primeiro o dry-run, defina `CONFIRM_SHEET_VIEW_REPAIR=true` e execute:

```bash
npm run repair:sheet:views
```

O script exige locale `pt_BR`, valida as quatro abas e os cabeçalhos A:W, compara os Lead IDs antes e depois sem imprimi-los e não altera valores, cabeçalhos, filtros ou formatação da aba `Leads`.

## Docker

Para construir e executar a imagem localmente:

```bash
docker build -t formulario-priscilla-moura .
docker run --rm -p 3000:3000 formulario-priscilla-moura
```

A imagem utiliza Node.js 22 Alpine, instala somente dependências de produção, executa como usuário sem privilégios e verifica periodicamente a rota `/health`. Em plataformas como EasyPanel, selecione a opção **Dockerfile** e mantenha a porta da aplicação em `3000`, salvo quando a plataforma fornecer `PORT` automaticamente.

## Testes

```bash
npm test
```

Os testes cobrem validações, classificação, prioridade, persistência simulada, idempotência, proteção contra fórmulas, falhas do Sheets e controle server-side do WhatsApp. Nenhum teste acessa o Google Sheets real.

## Health check

`GET /health` responde com status HTTP 200:

```json
{"status":"ok"}
```

O Express publica somente o conteúdo de `public/`; arquivos da raiz, testes, módulos do backend e configurações não são expostos. O servidor recebe os dados necessários para persistência, mas não registra payloads nem dados pessoais em logs.

## Classificação

Um lead é qualificado quando informa uma das cinco situações atendidas (inclusive ajuda para familiar), aceita as duas confirmações finais e possui uma destas combinações:

- renda a partir de R$ 6.001 e interesse em contratar ou entender valores e condições;
- renda entre R$ 3.001 e R$ 6.000, urgência identificada e disposição para contratar agora.

O lead é desqualificado quando possui renda de até R$ 3.000, seleciona situação diferente, está apenas pesquisando, busca exclusivamente atendimento gratuito ou não atende à combinação intermediária. A prioridade é:

- `urgent`: prazo em 48 horas, prazo em 7 dias ou acusação de descumprimento;
- `high`: medida em vigor sem conhecimento dos prazos;
- `normal`: sem prazo/medida oficial ou quando não sabe informar.

A função pura `classifyLead` centraliza essas regras e é executada novamente no servidor durante a conclusão. A prioridade interna continua sendo usada apenas para preservar o cálculo do motivo; ela não é persistida nem retornada pela API. Classificação, prioridade e motivo enviados pelo navegador são ignorados.

## WhatsApp

- Número: `5527998737944`
- Mensagem: `Olá, Dra. Priscilla. Acabei de preencher o formulário de análise inicial e gostaria de conversar sobre minha situação.`

O link usa `https://wa.me/`, número somente com dígitos e mensagem codificada com `encodeURIComponent`. Ele só é retornado pelo servidor depois de confirmar que o lead está qualificado. O endpoint não grava o clique no Sheets; o evento `Contact` do Meta Pixel registra o acesso confirmado. Não há redirecionamento automático.

## Meta Pixel

O Pixel ID `959018970525443` é inicializado uma única vez no carregamento real da página. Os eventos configurados são:

- `PageView`: carregamento real da página;
- `FormStarted`: primeiro clique em “Começar”;
- `FormCompleted`: conclusão confirmada pelo backend e pelo Google Sheets;
- `Lead`: somente para leads qualificados pelo backend;
- `Contact`: acesso ao WhatsApp confirmado pelo backend.

Nenhum dado pessoal, resposta do formulário, informação jurídica ou identificador do CRM é enviado como parâmetro à Meta. Advanced Matching e Meta Conversions API (CAPI) não estão implementados.

## Atribuição

No primeiro carregamento são capturados `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `fbclid`, URL de entrada e uma categoria genérica de dispositivo. Referrer não é capturado. Esses dados permanecem em memória até a criação do lead e são gravados nas colunas de atribuição da aba `Leads`. Não há armazenamento em `localStorage` ou `sessionStorage`, nem persistência do User-Agent completo.

## Limitações atuais

- O Lead ID permanece somente na memória da página; atualizar a página reinicia a sessão do formulário.
- A idempotência da criação combina uma chave mantida em memória no navegador e no processo do servidor. Não substitui um armazenamento transacional distribuído em ambientes com múltiplas réplicas.
- Não há proteção antispam, limitação de requisições ou Meta Conversions API.
- A URL da Política de Privacidade ainda não está configurada; o ponto futuro está documentado em `app.js` e nenhum link fictício é mostrado.
- Logo e favicons são provisoriamente substituídos por texto.

## Próximas integrações

Em uma fase futura: proteção antispam e limitação de requisições, política de privacidade definitiva, Meta Conversions API e configuração final do ambiente de deploy.
