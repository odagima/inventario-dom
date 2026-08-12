# Inventário · Grupo DOM

App de contagem de inventário com leitura de código de barras pela câmera do celular.

## Stack

- React + Vite (PWA-ready)
- Supabase (Postgres + API)
- `html5-qrcode` para leitura de código de barras (EAN-13, EAN-8, UPC-A/E, Code128, Code39, ITF)

## Setup

1. Criar um projeto no [Supabase](https://supabase.com) (plano free serve).
2. No SQL Editor do Supabase, rodar o arquivo `supabase/schema.sql`.
3. Copiar `.env.example` para `.env` e preencher com a URL e a chave anon do seu projeto
   (Project Settings → API no painel do Supabase).
4. Instalar dependências e rodar:

   ```bash
   npm install
   npm run dev
   ```

5. Pra testar a câmera no celular: o navegador exige HTTPS (ou localhost) pra liberar a câmera.
   Em dev, acesse pelo IP da máquina na mesma rede (`npm run dev` já expõe via `--host`), ou
   use um túnel como `ngrok`/`cloudflared` se precisar de HTTPS local.

## Fluxo do app

1. Escolhe a unidade e informa o nome de quem está contando.
2. Abre (ou retoma) uma sessão de contagem daquela unidade.
3. Escaneia o código de barras:
   - **Encontrado** → mostra nome/categoria/unidade de medida, você ajusta a quantidade e confirma.
   - **Não encontrado** → formulário rápido de cadastro (nome, unidade de medida, categoria, código ERP
     opcional). Depois de salvo, o código fica gravado pra sempre — próxima leitura já reconhece direto.
4. Lista dos itens já contados na sessão atual fica visível abaixo do scanner.
5. Botão "Finalizar" encerra a sessão.

## Importar/sincronizar o cadastro do Everest

O código do item no Everest é a chave real do produto — o nome pode mudar
sem quebrar vínculos de código de barras ou histórico de contagens.

```bash
npm install
node scripts/import-everest.js caminho/para/export.xlsx
```

Aceita `.xlsx`, `.csv` ou `.tsv`, desde que tenha as colunas `Item`, `Descrição do Item` e `UM`
(exatamente como sai do Everest). Se o export também tiver uma coluna de código de barras
(`Código de Barras`, `EAN` ou `GTIN` — o script reconhece qualquer uma dessas), ele já vincula
automaticamente como `industrializado`, sem precisar gerar etiqueta interna pra esses itens.

A categoria de cada produto é derivada automaticamente da faixa do código:

| Faixa | Categoria |
|---|---|
| < 2.000.000 | venda (cardápio — não entra na contagem física) |
| 2.000.000 – 2.999.999 | insumo |
| 3.000.000 – 3.999.999 | embalagem |
| 4.000.000 – 4.999.999 | pre_preparo |
| 6.000.000 – 6.999.999 | limpeza_uniforme |
| 7.000.000 – 7.999.999 | equipamento |

Rode de novo sempre que atualizar a planilha no Excel — o script sincroniza (upsert),
não duplica.

## Deploy (Cloudflare Pages)

Front-end é estático (build do Vite), então banda/acesso simultâneo não custa nada extra —
o que importa é o limite de conexões do Supabase, que no free tier aguenta tranquilamente
até umas 30-40 pessoas simultâneas.

```bash
npx wrangler login          # só na primeira vez, abre o navegador pra autenticar
npm run deploy               # builda e sobe pro Cloudflare Pages
```

As variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` do `.env` são embutidas no
build (não são segredo — a chave anon é pública por design, protegida pelas policies de RLS
que já estão no `schema.sql`).

Se preferir deploy automático a cada push (como no Irlanda 2027), dá pra conectar o repositório
no painel do Cloudflare Pages em vez de usar o CLI — aí é só configurar build command
`npm run build` e output directory `dist`.

## Próximos passos sugeridos

- Autenticação (trocar o campo "nome" livre por login de verdade via Supabase Auth)
- Tela de relatório/exportação da sessão finalizada (comparar contado x sistema)
- Suporte a leitura de código de balança (peso embutido no próprio EAN, prefixo 2)
- Deploy em Netlify/Cloudflare Pages, igual aos outros projetos
