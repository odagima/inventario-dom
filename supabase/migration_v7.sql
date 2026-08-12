-- Migração v7 — 10/08/2026
-- Histórico de preço de Ficha Técnica, pedido do Felipe: "queremos ter o histórico do preço das
-- FT no tempo" (ex. filet mignon julho R$80, agosto R$82,30...). Hoje `fichas_tecnicas` guarda só
-- o custo ATUAL (cada reimportação sobrescreve, upsert por codigo_everest) — essa tabela nova
-- passa a guardar um retrato (snapshot) do custo teórico de cada ficha a cada import, sem tocar
-- em nada que já existe.

create table if not exists fichas_tecnicas_historico (
  id uuid primary key default uuid_generate_v4(),
  ficha_id uuid not null references fichas_tecnicas(id) on delete cascade,
  codigo_everest text not null,
  nome text,
  custo_producao numeric not null default 0,
  capturado_em timestamptz not null default now()
);

create index if not exists idx_ft_historico_ficha on fichas_tecnicas_historico (ficha_id);
create index if not exists idx_ft_historico_codigo on fichas_tecnicas_historico (codigo_everest);
create index if not exists idx_ft_historico_capturado on fichas_tecnicas_historico (capturado_em);

alter table fichas_tecnicas_historico enable row level security;
create policy "allow all - fichas_tecnicas_historico" on fichas_tecnicas_historico for all using (true) with check (true);
