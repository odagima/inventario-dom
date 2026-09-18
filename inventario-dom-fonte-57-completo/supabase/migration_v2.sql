-- Migração incremental — roda em cima do banco que você já tem, sem apagar nada.
-- Segura de rodar mais de uma vez (todos os passos verificam antes de aplicar).

create extension if not exists "uuid-ossp";

-- produtos: garante codigo_everest único e categoria
alter table produtos add column if not exists codigo_everest text;
alter table produtos add column if not exists categoria text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'produtos_codigo_everest_key') then
    alter table produtos add constraint produtos_codigo_everest_key unique (codigo_everest);
  end if;
end $$;

-- barcodes: garante a coluna origem (industrializado/interno)
alter table barcodes add column if not exists origem text not null default 'industrializado';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'barcodes_origem_check') then
    alter table barcodes add constraint barcodes_origem_check check (origem in ('industrializado', 'interno'));
  end if;
end $$;

-- sessoes_contagem: garante tipo e grupo_id
alter table sessoes_contagem add column if not exists tipo text not null default 'mensal';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sessoes_contagem_tipo_check') then
    alter table sessoes_contagem add constraint sessoes_contagem_tipo_check check (tipo in ('parcial', 'mensal'));
  end if;
end $$;
alter table sessoes_contagem add column if not exists grupo_id uuid;

-- tabelas novas
create table if not exists grupos_contagem (
  id uuid primary key default uuid_generate_v4(),
  nome text not null,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_sessoes_grupo') then
    alter table sessoes_contagem
      add constraint fk_sessoes_grupo foreign key (grupo_id) references grupos_contagem(id) on delete set null;
  end if;
end $$;

create table if not exists grupos_contagem_itens (
  grupo_id uuid not null references grupos_contagem(id) on delete cascade,
  produto_id uuid not null references produtos(id) on delete cascade,
  primary key (grupo_id, produto_id)
);

create table if not exists itens_esperados_sessao (
  sessao_id uuid not null references sessoes_contagem(id) on delete cascade,
  produto_id uuid not null references produtos(id) on delete cascade,
  primary key (sessao_id, produto_id)
);

-- segurança (RLS) das tabelas novas
alter table grupos_contagem enable row level security;
alter table grupos_contagem_itens enable row level security;
alter table itens_esperados_sessao enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'grupos_contagem' and policyname = 'allow all - grupos_contagem') then
    create policy "allow all - grupos_contagem" on grupos_contagem for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'grupos_contagem_itens' and policyname = 'allow all - grupos_contagem_itens') then
    create policy "allow all - grupos_contagem_itens" on grupos_contagem_itens for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'itens_esperados_sessao' and policyname = 'allow all - itens_esperados_sessao') then
    create policy "allow all - itens_esperados_sessao" on itens_esperados_sessao for all using (true) with check (true);
  end if;
end $$;
