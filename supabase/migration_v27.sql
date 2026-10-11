-- Migração v27 — 11/10/2026
-- Pedido do Felipe: preparar pra trocar os nomes de usuário atuais (hoje no formato
-- "Nome _ LOJA SETOR", ex. "Arthur _ DOM Cozinha") pelo nome real da pessoa, sem perder a
-- referência antiga nem duplicar o usuário. `nome_completo` passa a guardar o nome real; o que
-- estava lá vira `apelido` (nome social/apelido) — edição em cada registro já existente, nunca
-- criando um novo. Serve também de ponte pra quando a parte de RH (`colaboradores`, branch
-- `transformacao`, ver PLANO-TRANSFORMACAO.md) mesclar com essa base.

alter table usuarios_app add column if not exists apelido text;
