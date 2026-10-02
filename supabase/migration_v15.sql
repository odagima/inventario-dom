-- Migração v15 — 01/10/2026
-- FRENTE + SALDO CALCULADO POR FRENTE, separado do saldo por contagem que já existe.
--
-- Reverte conscientemente parte do aviso da v14 ("produção não movimenta estoque") — decisão do
-- Felipe: fazia sentido quando era uma cozinha só, mas agora a produção/estoque acontece em
-- frentes diferentes (Estoque Central, Produção, Serviço Dalva, Serviço D.O.M., Confeitaria) e
-- ele quer visibilidade de movimentação em tempo real pra achar desfalque — não dá pra achar
-- desfalque só com contagem periódica, porque não existe um "esperado" pra comparar com o que foi
-- contado.
--
-- Pra não correr o risco de duplicar contagem (o motivo original do aviso da v14), o saldo
-- calculado fica em tabela PRÓPRIA (`estoque_movimentos`), separada do saldo por contagem que já
-- existe hoje (`itens_contagem` / `Saldo.jsx` em admin, que continuam exatamente como estão,
-- intocados por esta migração). A Contagem Semanal não vai sobrescrever o saldo calculado — só
-- aponta diferença; a reconciliação vira um movimento tipo 'ajuste_contagem' explícito, nunca uma
-- sobrescrita silenciosa. Isso é trabalho de API/tela, não desta migração.
--
-- O MODELO "um evento por degrau da árvore" da v14 continua do jeito que está — não forçamos a
-- cadeia inteira numa ordem só (confirmado com o Felipe: útil pra quando limpar e porcionar
-- acontecem em dias ou pessoas diferentes, mesmo sendo a exceção, segundo o chef de cozinha). O
-- caso comum (mesma pessoa limpa e já porciona) vira contínuo só NA TELA (botão "Continuar e
-- porcionar agora" abrindo o próximo evento pré-preenchido), rastreado aqui por
-- `producao_origem_id` — sem mudar o modelo de baixo, só de leve.
--
-- `producoes.planejada` / `meta_quantidade` / `meta_codigo_everest` já existiam (v14, estrutura
-- pré-montada a pedido do Felipe). Esta migração não mexe neles — o painel "o que falta produzir"
-- (pedido do Felipe) é feito só de API/tela em cima do que já existe: uma produção "a fazer" é
-- uma linha com planejada = true e ainda sem nenhum producoes_itens vinculado.

-- ── Frentes: áreas operacionais onde se produz/estoca — diferente de `unidades` (CNPJ/loja
-- legal). Uma frente pode pertencer a uma unidade (ex.: Serviço D.O.M. -> unidade DOM) ou não
-- (ex.: Produção e Confeitaria hoje atendem mais de uma casa, sem unidade própria ainda).
create table if not exists frentes (
  id uuid primary key default uuid_generate_v4(),
  nome text not null unique,
  unidade_id uuid references unidades(id),
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

insert into frentes (nome, unidade_id) values
  ('Estoque Central', null),
  ('Produção', null),
  ('Serviço Dalva', (select id from unidades where nome = 'Dalva e Dito')),
  ('Serviço D.O.M.', (select id from unidades where nome = 'DOM')),
  ('Confeitaria', null)
on conflict (nome) do nothing;

-- ── Produção ganha frente (nullable: lançamentos antigos continuam válidos sem frente, e o
-- motor de CMV/relatórios antigos não quebra) e rastreio opcional de encadeamento.
alter table producoes add column if not exists frente_id uuid references frentes(id);
alter table producoes add column if not exists producao_origem_id uuid references producoes(id);

create index if not exists idx_producoes_frente on producoes(frente_id);
create index if not exists idx_producoes_origem on producoes(producao_origem_id);

-- ── Requisição: pedir pra um estoque/cofre que precisa de autorização pra liberar (Central,
-- Compras). Atendimento parcial é normal (decidido antes, ver PLANO-TRANSFORMACAO.md) — a
-- requisição só fecha de vez quando o solicitante confirma que não precisa mais do restante.
-- Autorização de verdade (quem aprova) fica fora desta migração — combinado adiar pra quando
-- chegar a fundação de perfil/acesso; por ora todo mundo com acesso à tela pode atender.
create table if not exists requisicoes (
  id uuid primary key default uuid_generate_v4(),
  frente_solicitante_id uuid not null references frentes(id),
  frente_atendente_id uuid not null references frentes(id),
  codigo_everest text not null,
  quantidade_solicitada numeric not null,
  quantidade_atendida numeric not null default 0,
  status text not null default 'pendente'
    check (status in ('pendente', 'atendida_parcial', 'atendida', 'negada', 'cancelada')),
  usuario_solicitante text,
  usuario_atendente text,
  solicitado_em timestamptz not null default now(),
  atendido_em timestamptz,
  observacao text
);

create index if not exists idx_requisicoes_status on requisicoes(status);
create index if not exists idx_requisicoes_codigo on requisicoes(codigo_everest);

-- ── Transferência: quem manda já tem o material em mãos (Produção mandando pra Serviço, ou
-- devolvendo pro Central) — só precisa o destino confirmar recebimento, sem gate de autorização.
-- Fica "em trânsito" entre o envio e o recebimento: debita a origem ao enviar, credita o destino
-- só quando confirmado (reflete a realidade física — ninguém tem o produto nesse meio-tempo).
create table if not exists transferencias (
  id uuid primary key default uuid_generate_v4(),
  frente_origem_id uuid not null references frentes(id),
  frente_destino_id uuid not null references frentes(id),
  codigo_everest text not null,
  quantidade numeric not null,
  status text not null default 'enviada' check (status in ('enviada', 'recebida', 'cancelada')),
  usuario_envio text,
  usuario_recebimento text,
  enviado_em timestamptz not null default now(),
  recebido_em timestamptz
);

create index if not exists idx_transferencias_status on transferencias(status);
create index if not exists idx_transferencias_codigo on transferencias(codigo_everest);

-- ── Saldo calculado por frente: ledger só de inserção (nunca edita/apaga linha — mesmo espírito
-- de "não sumir com nada" das outras tabelas). O saldo de cada frente/produto é sempre a SOMA
-- dessas linhas, nunca um número guardado à parte — assim ele não corre o risco de desviar da
-- própria história (ver view `saldo_calculado_frente` logo abaixo).
--
-- `contagem_item_id` aponta pra `itens_contagem` como primeira hipótese de onde um ajuste de
-- contagem física vai nascer — mas a tela exata de "contagem por frente" ainda não existe (a
-- Contagem Semanal de hoje usa grupo_contagem, não frente), então esse vínculo pode mudar quando
-- essa tela for desenhada. Não bloqueia o resto desta migração.
create table if not exists estoque_movimentos (
  id uuid primary key default uuid_generate_v4(),
  frente_id uuid not null references frentes(id),
  codigo_everest text not null,

  -- quantidade com sinal: positivo credita a frente, negativo debita. Mantém a soma (= saldo) simples.
  quantidade numeric not null,

  tipo text not null check (tipo in (
    'producao_entrada', 'producao_saida',
    'transferencia_saida', 'transferencia_entrada',
    'requisicao_saida', 'requisicao_entrada',
    'ajuste_contagem'
  )),

  -- de onde veio o movimento, pra auditoria — cada tipo preenche só a coluna correspondente, as
  -- outras ficam nulas (não polimórfico de propósito, mesmo estilo de `producoes_itens`).
  producao_id uuid references producoes(id),
  transferencia_id uuid references transferencias(id),
  requisicao_id uuid references requisicoes(id),
  contagem_item_id uuid references itens_contagem(id),

  usuario text,
  registrado_em timestamptz not null default now()
);

create index if not exists idx_estoque_mov_frente_codigo on estoque_movimentos(frente_id, codigo_everest);
create index if not exists idx_estoque_mov_producao on estoque_movimentos(producao_id);
create index if not exists idx_estoque_mov_transferencia on estoque_movimentos(transferencia_id);
create index if not exists idx_estoque_mov_requisicao on estoque_movimentos(requisicao_id);

create or replace view saldo_calculado_frente as
select frente_id, codigo_everest, sum(quantidade) as saldo
from estoque_movimentos
group by frente_id, codigo_everest;

-- RLS aberto, mesmo padrão de todas as tabelas deste app (risco aceito conscientemente para uma
-- ferramenta interna — ver nota da v14).
alter table frentes enable row level security;
drop policy if exists "frentes_all" on frentes;
create policy "frentes_all" on frentes for all using (true) with check (true);

alter table requisicoes enable row level security;
drop policy if exists "requisicoes_all" on requisicoes;
create policy "requisicoes_all" on requisicoes for all using (true) with check (true);

alter table transferencias enable row level security;
drop policy if exists "transferencias_all" on transferencias;
create policy "transferencias_all" on transferencias for all using (true) with check (true);

alter table estoque_movimentos enable row level security;
drop policy if exists "estoque_movimentos_all" on estoque_movimentos;
create policy "estoque_movimentos_all" on estoque_movimentos for all using (true) with check (true);
