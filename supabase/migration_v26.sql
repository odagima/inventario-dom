-- Migração v26 — 08/10/2026
-- Rótulos do sistema (pedido do Felipe: "eu quero ter o poder de mexer nisso... quero que todos
-- falem a mesma língua" — poder trocar as PALAVRAS que o app usa pra Loja/Setor/Usuário/Item/Turno,
-- direto pelo Admin, sem precisar pedir pra mexer no código). Reaproveita a tabela genérica
-- chave/valor já criada na v18 (configuracoes_sistema) — um JSON só, com um campo por conceito.
insert into configuracoes_sistema (chave, valor, descricao) values
  (
    'rotulos_sistema',
    '{"loja":"Loja","setor":"Setor","usuario":"Usuário","item":"Item","turno":"Turno"}'::jsonb,
    'Palavras usadas no app pra cada conceito (Loja/Setor/Usuário/Item/Turno) — editável em Admin > Nomenclatura. Se a pessoa trocar aqui, atualiza em todo canto que usa essa palavra.'
  )
on conflict (chave) do nothing;
