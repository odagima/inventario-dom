-- Migração v19 — 06/10/2026
-- Renomeia "frente" pra "LOCAL DE ESTOQUE" em todo o esquema — pedido do Felipe: "frente" não
-- comunicava bem, e "praça" já tem outro significado na operação (praça das entradas, praça do
-- passe — posto de trabalho, não lugar onde estoque fica parado). Troca é só de rótulo/nome: a
-- tabela e as colunas continuam exatamente com a mesma função, NENHUM DADO MUDA (é RENAME, não
-- recriação — preserva tudo que já foi lançado em Produção/Requisição/Transferência).

alter table frentes rename to locais_estoque;
alter table locais_estoque rename constraint frentes_pkey to locais_estoque_pkey;
alter table locais_estoque rename constraint frentes_nome_key to locais_estoque_nome_key;
alter table locais_estoque rename constraint frentes_unidade_id_fkey to locais_estoque_unidade_id_fkey;
alter policy "frentes_all" on locais_estoque rename to "locais_estoque_all";

alter table producoes rename column frente_id to local_estoque_id;
alter table producoes rename constraint producoes_frente_id_fkey to producoes_local_estoque_id_fkey;
alter index idx_producoes_frente rename to idx_producoes_local_estoque;

alter table requisicoes rename column frente_solicitante_id to local_solicitante_id;
alter table requisicoes rename column frente_atendente_id to local_atendente_id;
alter table requisicoes rename constraint requisicoes_frente_solicitante_id_fkey to requisicoes_local_solicitante_id_fkey;
alter table requisicoes rename constraint requisicoes_frente_atendente_id_fkey to requisicoes_local_atendente_id_fkey;

alter table transferencias rename column frente_origem_id to local_origem_id;
alter table transferencias rename column frente_destino_id to local_destino_id;
alter table transferencias rename constraint transferencias_frente_origem_id_fkey to transferencias_local_origem_id_fkey;
alter table transferencias rename constraint transferencias_frente_destino_id_fkey to transferencias_local_destino_id_fkey;

alter table estoque_movimentos rename column frente_id to local_estoque_id;
alter table estoque_movimentos rename constraint estoque_movimentos_frente_id_fkey to estoque_movimentos_local_estoque_id_fkey;
alter index idx_estoque_mov_frente_codigo rename to idx_estoque_mov_local_codigo;

drop view if exists saldo_calculado_frente;
create or replace view saldo_calculado_local as
select local_estoque_id, codigo_everest, sum(quantidade) as saldo
from estoque_movimentos
group by local_estoque_id, codigo_everest;
