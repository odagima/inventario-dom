-- Migração v18 — 06/10/2026
-- Painel de configurações do sistema (liga/desliga) — pedido do Felipe: "é possível criarmos um
-- painel no adm pra ativar e desativar alguns parâmetros do sistema?". Tabela chave/valor simples,
-- genérica — cada parâmetro novo é só uma linha nova, não uma coluna nova.
--
-- Primeiro parâmetro: `requisicao_exige_aprovacao`, semeado DESLIGADO. Ele só existe como
-- interruptor por enquanto — nenhuma tela checa esse valor ainda (o Felipe pediu pra deixar
-- desativado e destravado "por enquanto, preciso colocar pra rodar esse sistema"). Quando o fluxo
-- de aprovação for desenhado de verdade, a tela que atende requisição passa a consultar esse valor.
create table if not exists configuracoes_sistema (
  chave text primary key,
  valor jsonb not null,
  descricao text,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);

insert into configuracoes_sistema (chave, valor, descricao) values
  ('requisicao_exige_aprovacao', 'false'::jsonb, 'Exigir uma aprovação extra antes de uma requisição poder ser atendida (hoje: sem efeito nenhuma tela ainda consulta este valor — só o interruptor existe)')
on conflict (chave) do nothing;

alter table configuracoes_sistema enable row level security;
drop policy if exists "configuracoes_sistema_all" on configuracoes_sistema;
create policy "configuracoes_sistema_all" on configuracoes_sistema for all using (true) with check (true);
