-- Migração v21 — 06/10/2026
-- Recebimento de Mercadoria — pedido do Felipe: "faça a área do recebimento apenas pra
-- conseguirmos enxergar o saldo do item, mas assim que chegar a NF... ou se ele identificar duas
-- entradas do mesmo fornecedor com a mesma quantidade, ele informa e dá a opção de excluir o
-- antigo. Precisa ser algo simples."
--
-- Lançamento rápido de "chegou material" ANTES da nota fiscal ser processada no Admin (que pode
-- levar dias) — credita o saldo calculado na hora (mesmo ledger de Produção/Requisição/
-- Transferência, `estoque_movimentos`), pra não ficar cego até a NF-e ser importada. A detecção de
-- duplicado (mesmo fornecedor + mesma quantidade) e a reconciliação com a NF de verdade são
-- trabalho de tela/API, não desta migração — aqui só a estrutura.
create table if not exists recebimentos (
  id uuid primary key default uuid_generate_v4(),
  local_estoque_id uuid not null references locais_estoque(id),
  codigo_everest text not null,
  quantidade numeric not null,
  fornecedor text not null,
  numero_nota text,
  usuario text,
  registrado_em timestamptz not null default now()
);
create index if not exists idx_recebimentos_fornecedor_qtd on recebimentos (fornecedor, quantidade, codigo_everest);

alter table estoque_movimentos add column if not exists recebimento_id uuid references recebimentos(id);
create index if not exists idx_estoque_mov_recebimento on estoque_movimentos(recebimento_id);

-- `tipo` era uma lista fechada (check constraint) sem 'recebimento' — precisa recriar pra incluir.
alter table estoque_movimentos drop constraint if exists estoque_movimentos_tipo_check;
alter table estoque_movimentos add constraint estoque_movimentos_tipo_check check (tipo in (
  'producao_entrada', 'producao_saida',
  'transferencia_saida', 'transferencia_entrada',
  'requisicao_saida', 'requisicao_entrada',
  'ajuste_contagem', 'recebimento'
));

alter table recebimentos enable row level security;
drop policy if exists "recebimentos_all" on recebimentos;
create policy "recebimentos_all" on recebimentos for all using (true) with check (true);
