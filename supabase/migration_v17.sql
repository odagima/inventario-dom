-- Migração v17 — 02/10/2026
-- `fator` passa a aceitar NULL. Motivo (teste do Felipe em tablet, com "PP FILET MIGNON CABECA E
-- RABO PARA LIMPAR"): às vezes só sabemos a ORDEM do processo — o que vira o quê — antes de medir
-- o rendimento de verdade. Exigir o número junto pra cadastrar a ordem trava o cadastro, e o medo
-- dele é o processo de lançamento virar grande demais e o time abandonar. Com `fator` nulo, o item
-- já aparece certo na navegação em etapas da Produção (ver `filhosDiretos` em fatoresCorrecaoApi.js)
-- — só fica sem F.C. teórico calculado até alguém medir o rendimento de verdade.
alter table fatores_correcao alter column fator drop not null;

-- "Cabeça e rabo" é a outra metade direta da peça limpa, junto com a Limpeza (já cadastrada desde
-- a v16) — ainda sem fator medido. Resolve por nome (mesma ressalva da v16: `nome` não é garantido
-- único, confira se afetou 1 linha só).
insert into fatores_correcao (porcionado_id, cru_id, fator)
select p.id, c.id, null
from produtos p, produtos c
where p.nome = 'PP FILET MIGNON CABECA E RABO PARA LIMPAR'
  and c.nome = 'BOVINO FILET MIGNON PECA'
on conflict (porcionado_id, cru_id) do nothing;
