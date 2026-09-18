-- Migração v14 — 28/08/2026
-- PRODUÇÃO: registro da etapa de transformação (§54 — "a etapa de transformação não é
-- registrada... se a limpeza rendeu 70% em vez de 80%, some filet sem aparecer em lugar nenhum").
--
-- Substitui `producoes_cadastradas` / `producoes_andamento` / `producoes_registros`, que gravavam
-- `insumo`/`producao`/`produzido` como TEXTO LIVRE — sem ligação com `codigo_everest`, o motor de
-- CMV nunca conseguiu ler nada dali. As tabelas antigas NÃO são apagadas por esta migração
-- (§5: "não sumir com nada"); a tela vai para Standby e os dados ficam preservados.
--
-- MODELO: um evento por degrau da árvore. "Peça → Limpeza" é um evento; "Limpeza → Tournedot +
-- Escalope + Aparas" é outro. Não amarra a cadeia inteira num lançamento só, porque quem limpa
-- hoje pode porcionar amanhã.
--
-- ⚠️ PRODUÇÃO NÃO MOVIMENTA ESTOQUE. O estoque aqui é MEDIDO pela contagem, não calculado por
-- movimento. A contagem já captura a transformação sozinha (peça a menos, PP a mais). Se a
-- produção também baixasse, o mesmo quilo sairia duas vezes. O valor da produção é medir o
-- RENDIMENTO REAL, que hoje só existe como suposição no fator da ficha.

create table if not exists producoes (
  id uuid primary key default uuid_generate_v4(),

  -- Sem loja de propósito: confirmado com o Felipe que a produção acontece numa cozinha só, que
  -- atende as duas casas. Coluna que ninguém preenche vira ruído no lançamento e na análise.

  -- Data do OCORRIDO (não do lançamento), igual perdas/contagem semanal. Preparo que atravessa
  -- dias usa `data` = início e `finalizada_em` marca o fim real.
  data date not null default current_date,
  turno text,

  -- 'em_andamento' -> aparece no painel da cozinha, qualquer pessoa pode fechar
  -- 'concluida'     -> pesagens lançadas, entra nos indicadores
  -- 'cancelada'     -> abriu por engano; não some (§5), só sai das contas
  status text not null default 'em_andamento' check (status in ('em_andamento', 'concluida', 'cancelada')),

  -- Dois usuários de propósito: a produção pertence à COZINHA, não a uma pessoa. Quem abre pode
  -- não ser quem fecha (troca de turno, preparo de vários dias) — decidido com o Felipe.
  usuario_inicio text,
  usuario_fim text,
  iniciada_em timestamptz not null default now(),
  finalizada_em timestamptz,

  -- Estrutura pré-montada para o planejamento, SEM tela nesta versão (pedido do Felipe: "deixar
  -- uma estrutura pré-montada oculta, só entra em vigor quando acharmos necessário"). Quando o
  -- painel de "o que precisa produzir" existir, é aqui que a meta entra — sem migração nova.
  planejada boolean not null default false,
  meta_quantidade numeric,
  meta_codigo_everest text,

  observacao text,
  registrado_em timestamptz not null default now()
);

create table if not exists producoes_itens (
  id uuid primary key default uuid_generate_v4(),
  producao_id uuid not null references producoes(id) on delete cascade,

  -- 'entrada' = o que foi consumido (a peça crua). 'saida' = o que saiu (PP, porcionados, aparas).
  -- Uma tabela só, simétrica: aceita receita com várias entradas sem mudar nada no schema.
  papel text not null check (papel in ('entrada', 'saida')),

  -- `codigo_everest` é a identidade canônica (§1) e é NOT NULL de propósito: é justamente o que
  -- faltava nas tabelas antigas. `produto_id` é conveniência para join e pode ficar órfão quando
  -- `produtos` é reimportado (§32) — por isso o cálculo nunca depende dele.
  codigo_everest text not null,
  produto_id uuid references produtos(id),

  quantidade numeric not null,
  unidade text,

  usuario text,
  registrado_em timestamptz not null default now()
);

create index if not exists idx_producoes_status on producoes(status);
create index if not exists idx_producoes_data on producoes(data);
create index if not exists idx_producoes_itens_producao on producoes_itens(producao_id);
create index if not exists idx_producoes_itens_codigo on producoes_itens(codigo_everest);

-- RLS aberto, mesmo padrão de todas as tabelas deste app (risco aceito conscientemente para uma
-- ferramenta interna — ver DECISOES-TRAVADAS.md).
alter table producoes enable row level security;
alter table producoes_itens enable row level security;

drop policy if exists "producoes_all" on producoes;
create policy "producoes_all" on producoes for all using (true) with check (true);

drop policy if exists "producoes_itens_all" on producoes_itens;
create policy "producoes_itens_all" on producoes_itens for all using (true) with check (true);
