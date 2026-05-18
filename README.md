# kwadv.csm

CMS administrativo do site Kevin Willian Advogado, construido com Angular 20 e Supabase.

## Requisitos

- Node.js 22
- npm
- Supabase CLI 2.x para migrations e deploy de Edge Functions

## Comandos

```bash
npm ci
npm start
npm run build
npm test -- --watch=false --browsers=ChromeHeadless
```

## Estrutura

- `src/app/features`: telas do CMS.
- `src/app/core`: servicos HTTP usados pelo Angular.
- `supabase/functions`: Edge Functions do Auth, usuarios, configuracoes, mensagens e publicacao.
- `supabase/migrations`: historico de schema, Storage e defaults.
- `.github/workflows/deploy-pages.yml`: build e deploy do CMS no GitHub Pages.

## Supabase

O CMS usa a publishable key no navegador e envia o token do usuario autenticado para REST, Storage e Edge Functions. Segredos como `SUPABASE_SERVICE_ROLE_KEY`, SMTP, criptografia e `GITHUB_TOKEN` ficam apenas no Supabase/GitHub.

Para aplicar schema em ambiente vinculado:

```bash
npx supabase db push --dry-run
npx supabase db push
```

Para publicar a Edge Function de rebuild:

```bash
npx supabase functions deploy publicar-artigo --project-ref wwwntzwmvjvivputmlqg
```

## Build e deploy

O deploy do CMS roda em push na `main`. O workflow gera `dist/kwadv.csm/browser`, cria entrypoints de rotas SPA e publica no GitHub Pages.

O fluxo de publicacao de artigos chama `supabase/functions/publicar-artigo`, que valida a sessao no Supabase Auth e dispara o workflow `deploy-pages.yml` do repositorio `kwadv.page`.

Variaveis esperadas na Edge Function:

- `GITHUB_TOKEN` com permissao para `actions:write` no repo `kwadv.page`.
- `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_WORKFLOW_ID` e `GITHUB_REF` opcionais.
- `SUPABASE_URL` e `SUPABASE_ANON_KEY` ou `SUPABASE_PUBLISHABLE_KEY`.

## Validacao

Antes de subir mudancas, rode:

```bash
npm run build
npm test -- --watch=false --browsers=ChromeHeadless
npm audit --audit-level=high
```

Tambem revise se nao ha arquivos gerados versionados:

```bash
git status --short
git ls-files | rg "^(dist|node_modules|\\.angular|out-tsc|coverage|\\.env)"
```
