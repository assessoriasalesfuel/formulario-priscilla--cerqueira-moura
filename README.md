# Formulário de qualificação — Dra. Priscilla Cerqueira Moura

Aplicação web mobile-first para uma análise inicial rápida de potenciais clientes. O Formulário Mini apresenta três perguntas, uma por tela, leva aproximadamente 30 segundos, persiste a conclusão na aba `Leads` de uma planilha Google Sheets e libera o contato por WhatsApp somente após confirmação server-side de um lead qualificado.

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
│       ├── qualification.js   # classificação do Formulário Mini
│       ├── whatsapp.js        # configuração e criação do link
│       ├── attribution.js     # UTMs, FBCLID, URL inicial e dispositivo
│       ├── metaPixel.js       # eventos do Meta Pixel sem dados pessoais
│       └── leadGateway.js     # chamadas HTTP ao backend
├── server/
│   ├── googleSheets.js        # autenticação e operações na aba Leads
│   ├── leadSchema.js          # fonte única dos 18 cabeçalhos e índices A:R
│   └── leadService.js         # validação, classificação e persistência
├── scripts/
│   ├── migrateSheetColumns.js # migração protegida do CRM para 18 colunas
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

É possível alterar a porta pela variável de ambiente `PORT`. Em produção, o Express escuta em `0.0.0.0` para ser acessível pelo proxy do EasyPanel.

## Google Sheets e variáveis de ambiente

Configure estas variáveis somente no backend:

```text
GOOGLE_SHEET_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
CONFIRM_SHEET_MIGRATION=false
CONFIRM_SHEET_BACKUP_VERIFIED=false
GOOGLE_SHEET_BACKUP_ID=
CONFIRM_SHEET_VIEW_REPAIR=false
```

Use `.env.example` apenas como referência. O projeto não carrega `.env` automaticamente: em produção, configure os valores no painel do serviço. A chave privada pode ser armazenada com quebras de linha representadas por `\n`; o servidor faz a normalização antes de autenticar.

A Service Account precisa ter permissão de **Editor** na planilha existente. Compartilhe a planilha com o e-mail configurado em `GOOGLE_SERVICE_ACCOUNT_EMAIL`. Nunca coloque credenciais reais no GitHub.

Durante o uso normal da aplicação, somente a aba `Leads` é escrita. As abas `Qualificados` e `Desqualificados` são derivadas por fórmula e só são ajustadas pelo script explícito de migração.

### Estrutura do CRM

A aba `Leads` usa exatamente 18 colunas (A:R), nesta ordem:

1. Lead ID
2. Data de criação
3. Status
4. Tempo desde a medida protetiva
5. Disponibilidade para investir
6. WhatsApp
7. Motivo da classificação
8. Data de conclusão
9. Consentimento de dados
10. Autorização de contato
11. UTM Source
12. UTM Medium
13. UTM Campaign
14. UTM Content
15. UTM Term
16. FBCLID
17. URL de entrada
18. Dispositivo

`Data de criação` e `Data de conclusão` são geradas exclusivamente no servidor. A aba `Histórico — Formulário anterior` mantém integralmente o modelo anterior e não é escrita pelo fluxo operacional nem pela migração. As abas `Leads`, `Qualificados` e `Desqualificados` usam os mesmos 18 cabeçalhos.

Antes da primeira operação de cada instância do repositório, o backend valida o cabeçalho `Leads!A1:R1` e mantém o resultado em memória. Append e update aceitam somente arrays com exatamente 18 células; qualquer divergência bloqueia a escrita.

### Migração controlada da planilha

A migração nunca roda no startup. Estes comandos só devem ser usados em uma migração deliberadamente autorizada. Para validar a estrutura existente sem escrever, use:

```bash
npm run migrate:sheet:dry
```

O dry-run valida as seis abas atuais, exige 52 Lead IDs únicos em `Histórico — Formulário anterior`, confirma que `Leads — Mini` não contém registros e não imprime dados pessoais. A execução real permanece bloqueada até existir uma cópia separada e verificada da planilha. Depois de criar essa cópia, informe seu ID e habilite as duas confirmações:

```text
GOOGLE_SHEET_BACKUP_ID=<id da cópia verificada>
CONFIRM_SHEET_BACKUP_VERIFIED=true
CONFIRM_SHEET_MIGRATION=true
```

Somente então execute:

```bash
npm run migrate:sheet
```

A operação transforma o schema operacional legado de 23 colunas no schema de 18, atualiza cabeçalhos, fórmulas `Leads!A2:R`, filtros e congelamento da primeira linha. A aba `Leads — Mini` só é removida se estiver vazia. O conteúdo de `Histórico — Formulário anterior` é comparado antes e depois, e a migração aborta se o backup não for idêntico ao estado atual. Não execute sem revisar o dry-run e reservar uma janela de manutenção.

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

O script exige locale `pt_BR`, valida as quatro abas operacionais e os cabeçalhos A:R, compara os Lead IDs antes e depois sem imprimi-los e não altera valores, cabeçalhos, filtros ou formatação da aba `Leads`.

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

Os testes cobrem as três perguntas, validação do WhatsApp, consentimentos, classificação, persistência simulada, idempotência, proteção contra fórmulas, falhas do Sheets, Meta Pixel e controle server-side do WhatsApp. Nenhum teste acessa o Google Sheets real.

## Health check

`GET /health` responde com status HTTP 200:

```json
{"status":"ok"}
```

O Express publica somente o conteúdo de `public/`; arquivos da raiz, testes, módulos do backend e configurações não são expostos. O servidor recebe os dados necessários para persistência, mas não registra payloads nem dados pessoais em logs.

## Classificação

O Formulário Mini possui três perguntas:

1. quando a medida protetiva foi recebida;
2. disponibilidade para investir em uma defesa profissional;
3. WhatsApp com os dois consentimentos obrigatórios exibidos na mesma etapa.

Um lead é qualificado exclusivamente quando consegue investir, inclusive por parcelamento. É desqualificado somente quando informa que não consegue investir agora. O tempo desde a medida continua obrigatório, é registrado no Sheets e não influencia a classificação.

A função pura `classifyLead` centraliza essas regras e é executada novamente no servidor durante a conclusão. Classificação e motivo enviados pelo navegador são ignorados. Os textos de resultado não prometem revogação da medida nem qualquer resultado jurídico.

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
