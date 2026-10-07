-- Migração v23 — 07/10/2026
-- Turno de operação por local de estoque (pedido do Felipe: "tipo caixa... abre, opera, precisa
-- fechar pra operar o próximo turno"). Só UM turno aberto por local por vez (índice parcial
-- abaixo). Período (almoço/jantar) NÃO é escolhido por ninguém — é só uma etiqueta calculada pelo
-- horário de abertura (10h-16h = almoço, resto = jantar), só pra relatório (ver `periodoDoTurno`
-- em src/lib/turnosApi.js).
--
-- Abrir = transferência de saída (câmara fria/central → local). Fechar = transferência de volta
-- (local → estoque, "tudo volta pra câmara fria"). As duas usam a MESMA tabela `transferencias`
-- que já existe — só ganham o vínculo `turno_id` pra saber de qual turno vieram.
--
-- Trava das 3h: se um turno ficar aberto além das 3h da manhã (calculado em
-- src/lib/turnosApi.js::turnoVencido, não travado aqui por SQL — fácil de ajustar o horário de
-- corte sem migração nova), a única ação permitida nele vira "fechar" — só depois de fechado um
-- turno novo pode abrir, liberando o dia seguinte.

create table if not exists turnos (
  id uuid primary key default uuid_generate_v4(),
  local_estoque_id uuid not null references locais_estoque(id),
  status text not null default 'aberto' check (status in ('aberto', 'fechado')),
  aberto_em timestamptz not null default now(),
  aberto_por text,
  fechado_em timestamptz,
  fechado_por text
);

-- Só um turno ABERTO por local ao mesmo tempo.
create unique index if not exists idx_turno_aberto_unico on turnos (local_estoque_id) where status = 'aberto';
create index if not exists idx_turnos_local on turnos (local_estoque_id);

alter table turnos enable row level security;
drop policy if exists "turnos_all" on turnos;
create policy "turnos_all" on turnos for all using (true) with check (true);

alter table transferencias add column if not exists turno_id uuid references turnos(id);
alter table estoque_movimentos add column if not exists turno_id uuid references turnos(id);
