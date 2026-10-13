-- Migração v31 — 12/10/2026
-- Pedido do Felipe, pensando em responsabilidade entre praças ("cada setor jogando a culpa pro
-- outro quando falta alguma coisa, fácil de burlar"): hoje só um lado de cada evento (quem
-- manda/libera) declara a quantidade — quem recebe só confirma o número que o outro disse, nunca
-- o seu próprio. Se sumir algo no meio do caminho, não tem registro de onde.
--
-- Duas peças, combinadas com o Felipe:
--
-- 1) DESTINATÁRIO ESPERADO — sempre ativo, sem travar nada, só mapeamento ("Rafael mandou pra
--    Produção, destinatário Humberto, dia/hora/produto/quantidade tal"). Resolve "não sabemos nem
--    quem era esperado receber" com custo zero de fricção.
--
-- 2) CONFIRMAÇÃO DE QUANTIDADE COM DIVERGÊNCIA — pronta, mas DESLIGADA por padrão (mesmo espírito
--    de `requisicao_exige_aprovacao`, migration_v18.sql): quem recebe passa a declarar a PRÓPRIA
--    contagem (não só confirmar a do outro); se os números não baterem, os dois ficam registrados
--    lado a lado (nunca um sobrescrevendo o outro em silêncio). Só liga se começar a dar problema
--    de verdade com sumiço/culpa entre praças — por enquanto, o app continua exatamente como hoje.

alter table transferencias add column if not exists destinatario_esperado text;
alter table transferencias add column if not exists quantidade_recebida numeric;

alter table requisicoes add column if not exists destinatario_esperado text;
alter table requisicoes add column if not exists quantidade_atendida_pendente numeric;

-- `aguardando_confirmacao`: só usado quando o interruptor abaixo estiver ligado — a rodada de
-- atendimento fica aqui até o solicitante confirmar a própria contagem (ver
-- confirmarRecebimentoRequisicao em src/lib/requisicaoTransferenciaApi.js).
alter table requisicoes drop constraint if exists requisicoes_status_check;
alter table requisicoes add constraint requisicoes_status_check check (status in (
  'pendente', 'atendida_parcial', 'atendida', 'negada', 'cancelada', 'aguardando_confirmacao'
));

insert into configuracoes_sistema (chave, valor, descricao) values
  ('transferencia_exige_confirmacao_quantidade', 'false'::jsonb,
   'Quem recebe uma transferência precisa contar e confirmar a própria quantidade (em vez de só confirmar recebimento) — se divergir do que foi enviado, os dois números ficam registrados'),
  ('requisicao_exige_confirmacao_quantidade', 'false'::jsonb,
   'Quem pediu uma requisição precisa contar e confirmar a própria quantidade recebida (em vez de creditar automático com o número de quem atendeu) — se divergir, os dois números ficam registrados')
on conflict (chave) do nothing;
