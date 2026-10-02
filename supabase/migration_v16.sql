-- Migração v16 — 01/10/2026
-- Popula `fatores_correcao` com os valores REAIS da família do Mignon, achados na Ficha Técnica
-- do Everest (coluna "Q. Baixa Estoque", só linha com "Situação" = ATIVO — método completo
-- documentado em PLANO-TRANSFORMACAO.md). `fator` aqui é "quanto de cru por 1 kg de porcionado"
-- (mesma convenção do comentário original da tabela em schema.sql) — é o valor direto da ficha,
-- sem inverter. Cada linha aponta pro PAI IMEDIATO (não pro insumo-base lá na raiz): o app soma a
-- cadeia toda andando de porcionado em porcionado até não achar mais pai.
--
-- A tabela estava descrita em schema.sql (arquivo de referência de instalação completa) mas nunca
-- tinha sido de fato criada neste banco — por isso esta migração cria ela agora, do mesmo jeito
-- que schema.sql descreve, antes de popular.
create table if not exists fatores_correcao (
  id uuid primary key default uuid_generate_v4(),
  porcionado_id uuid not null references produtos(id) on delete cascade,
  cru_id uuid not null references produtos(id) on delete cascade,
  fator numeric not null,
  criado_em timestamptz not null default now()
);
create index if not exists idx_fatores_porcionado on fatores_correcao (porcionado_id);

alter table fatores_correcao enable row level security;
drop policy if exists "allow all - fatores_correcao" on fatores_correcao;
create policy "allow all - fatores_correcao" on fatores_correcao for all using (true) with check (true);
--
-- Resolve por `produtos.nome` (não tenho o `codigo_everest` de todos ainda) — não é garantido
-- único no schema, então CONFIRME que cada INSERT abaixo afetou exatamente 1 linha antes de dar
-- como certo.
--
-- Acima de 100% (fator < 1, ex.: Parmegianna Empanado) não é erro: a ficha desses itens é a
-- receita do PRATO PRONTO (soma empanamento/molho/creme), não só o corte de carne — confirmado
-- com o Felipe que não tem problema, porque a contagem física pesa o prato pronto do mesmo jeito.
--
-- ATENÇÃO: 'PP FILET MIGNON APARAS' saiu da ficha ATIVA com o MESMO fator do Limpeza (1.0) —
-- parece cópia nunca customizada pro valor real do Aparas, não uma medição própria. Ajustar
-- quando o Felipe confirmar o valor certo.

-- idempotência: permite rodar de novo sem duplicar linha, e atualiza o fator se já existir.
create unique index if not exists idx_fatores_par_unico on fatores_correcao (porcionado_id, cru_id);

insert into fatores_correcao (porcionado_id, cru_id, fator)
select p.id, c.id, v.fator
from (values
  ('PP FILET MIGNON LIMPEZA',             'BOVINO FILET MIGNON PECA',  1.247829),
  ('PP FILET MIGNON APARAS',              'PP FILET MIGNON LIMPEZA',   1.0),
  ('PP FILET MIGNON ESCALOPE PORCIONADO', 'PP FILET MIGNON LIMPEZA',   1.0),
  ('PP FILET MIGNON MEDALHAO PORCIONADO', 'PP FILET MIGNON LIMPEZA',   1.0),
  ('PP FILET MIGNON MEDALHAO SELADO',     'PP FILET MIGNON LIMPEZA',   1.0),
  ('PP FILET MIGNON FUMEIRO',             'PP FILET MIGNON LIMPEZA',   1.333333),
  ('PP PARMEGIANNA PORCIONADO',           'PP FILET MIGNON LIMPEZA',   1.0),
  ('PP PARMEGIANNA EMPANADO',             'PP FILET MIGNON LIMPEZA',   0.652174),
  ('PP FILET MIGNON STROGONOFF FINAL',    'PP FILET MIGNON LIMPEZA',   0.60241),
  ('PP PICADINHO FINAL PRODUCAO',         'PP FILET MIGNON LIMPEZA',   0.694444),
  ('PP PICADINHO FINAL COZINHA',          'PP FILET MIGNON LIMPEZA',   0.5938)
) as v(porcionado_nome, cru_nome, fator)
join produtos p on p.nome = v.porcionado_nome
join produtos c on c.nome = v.cru_nome
on conflict (porcionado_id, cru_id) do update set fator = excluded.fator;
