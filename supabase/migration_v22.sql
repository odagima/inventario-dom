-- Migração v22 — 07/10/2026
-- Pedido do Felipe: "quero ter uma base de funcionários (cargos e salários), equipamentos, lojas
-- e etc... preciso ter essa base, e conseguir consultar e editar as informações." Lojas já existe
-- (`unidades`, tela Unidades.jsx). Esta migração cria as duas que faltam — cadastro simples, sem
-- fluxo nenhum por trás, só listar/incluir/editar/excluir (mesmo molde de `unidades`).

create table if not exists funcionarios (
  id uuid primary key default uuid_generate_v4(),
  nome text not null,
  cargo text,
  salario numeric,
  unidade_id uuid references unidades(id),
  telefone text,
  data_admissao date,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

alter table funcionarios enable row level security;
drop policy if exists "funcionarios_all" on funcionarios;
create policy "funcionarios_all" on funcionarios for all using (true) with check (true);

create table if not exists equipamentos (
  id uuid primary key default uuid_generate_v4(),
  nome text not null,
  local_estoque_id uuid references locais_estoque(id),
  numero_patrimonio text,
  estado text not null default 'funcionando' check (estado in ('funcionando', 'manutencao', 'quebrado')),
  valor numeric,
  data_aquisicao date,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

alter table equipamentos enable row level security;
drop policy if exists "equipamentos_all" on equipamentos;
create policy "equipamentos_all" on equipamentos for all using (true) with check (true);
