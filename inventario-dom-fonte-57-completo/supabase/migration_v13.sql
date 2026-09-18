-- Migração v13 — 28/08/2026
-- Registro de perdas/desperdício (§55 do DECISOES-TRAVADAS.md).
--
-- A perda REAPROVEITA as tabelas que já existem (`sessoes_contagem` com tipo = 'perdas' +
-- `itens_contagem`) em vez de criar tabela nova: o tipo 'perdas' já é aceito pelo check da coluna
-- `tipo` desde o schema original, e a tela "Perdas → Histórico / Exportar" do admin já lê daí.
-- O que falta são só 3 informações que a contagem não tem.
--
-- Todas as colunas são NULLABLE de propósito: nenhuma linha de contagem/inventário já existente
-- precisa ser tocada, e o app tem fallback pra quando a coluna ainda não existe (ver
-- `colunaNaoExiste` em src/lib/api.js) — se esta migração não rodar, o lançamento de perda avisa
-- em vez de gravar pela metade.

-- Turno em que a perda aconteceu ('almoco' | 'jantar'). Fica na SESSÃO, não no item: o lançamento
-- é feito uma vez por turno, no fim do expediente (decisão do Felipe). A data do ocorrido já é a
-- `data_referencia`, que existe desde a migration_v4.
alter table sessoes_contagem add column if not exists turno text;

-- Motivo da perda: 'estragado' | 'sobra_praca' | 'erro_preparo'. São três e só três (§55).
-- Sem check constraint de propósito — se um quarto motivo for decidido depois, não quero que o
-- app quebre em produção esperando uma migração.
alter table itens_contagem add column if not exists motivo_perda text;

-- Como a quantidade foi lançada, só pra perda:
--   'peso'  -> `quantidade` está na unidade de estoque do produto (kg/L/un). É o caso normal.
--   'prato' -> `produto_id` aponta pra um PRODUTO ACABADO e `quantidade` é o NÚMERO DE PORÇÕES
--              perdidas. A explosão pelos insumos da ficha acontece na leitura, não aqui — mesma
--              lógica da contagem, que grava o que foi visto e converte na hora de calcular
--              (se a ficha for corrigida depois, o histórico se corrige junto).
alter table itens_contagem add column if not exists modo_perda text;

create index if not exists idx_itens_contagem_motivo_perda on itens_contagem(motivo_perda);
