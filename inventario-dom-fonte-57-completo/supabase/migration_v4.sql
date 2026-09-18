-- Migração v4 — 06/08/2026
-- Data editável no lançamento da contagem semanal (ver DECISOES-TRAVADAS.md §18).
-- Não precisa reimportar nada — só roda uma vez, sessões antigas ficam com data_referencia = null
-- (o app já cai de volta pra iniciada_em nesse caso).

alter table sessoes_contagem add column if not exists data_referencia date;
