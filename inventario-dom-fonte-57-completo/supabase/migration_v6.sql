-- Migração v6 — 07/08/2026
-- Contagem semanal deixa de exigir Loja (ver DECISOES-TRAVADAS.md e feedback do Felipe:
-- "Não precisa ter a loja para contar, na contagem semanal" — Compras já não separa por loja
-- no Everest, e a Contagem Semanal já passou a ser filtrada por Grupo de contagem, não por Loja).
--
-- `sessoes_contagem.unidade_id` era NOT NULL — precisa virar opcional pra sessão semanal poder
-- ser criada sem loja. Sessão mensal continua sempre com loja (o código do app garante isso).

alter table sessoes_contagem alter column unidade_id drop not null;
