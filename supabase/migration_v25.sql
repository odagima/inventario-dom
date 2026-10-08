-- Migração v25 — 08/10/2026
-- Pedido do Felipe: "todos os setores serão padronizados e todos os lançamentos precisam puxar
-- dessa base" — Perdas (e, depois, Contagem) ganham o mesmo "Setor" que Produção/Requisição/Abrir
-- praça já usam (`locais_estoque`), pra aparecer no cabeçalho de cada lançamento, igual Loja.
alter table sessoes_contagem add column if not exists local_estoque_id uuid references locais_estoque(id);
