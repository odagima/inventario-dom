-- Migração v30 — 12/10/2026
-- Pedido do Felipe: Cozinhas recebem porcionado todo dia e precisam devolver a sobra pra câmara
-- fria à noite — mas hoje Abrir/Fechar praça não move item nenhum (ver TelaOperacao.jsx, `itens`
-- sempre `[]`), e quem leva/devolve material o faz por uma Transferência avulsa, sem nunca CONTAR
-- de verdade o que sobrou. Resultado: o saldo calculado da praça só cresce, nunca reflete o
-- consumo real do serviço (ver discussão com o Felipe, 12/10/2026).
--
-- `tipo_operacao` classifica o Setor (ideia do Felipe): Produção/Confeitaria fazem pros outros e
-- não guardam nada; Bar/Salão guardam o material de vez, sem ciclo diário; Cozinha recebe
-- porcionado e PRECISA devolver à noite. Só 'cozinha' muda comportamento por enquanto (passa a
-- exigir contagem no fechamento, ver `fecharTurnoComContagem` em src/lib/turnosApi.js) — os outros
-- valores (e null, pra quem ainda não foi classificado) continuam com o comportamento de hoje.
alter table locais_estoque add column if not exists tipo_operacao text
  check (tipo_operacao is null or tipo_operacao in ('producao', 'fixo', 'cozinha'));

-- `itens_fechamento` guarda a contagem feita no fechamento (snapshot) — usada só pra SUGERIR a
-- abertura do dia seguinte (mostra o que foi fechado, a pessoa confirma, edita ou adiciona; nunca
-- reabre sozinho sem confirmação). Formato: [{ codigo_everest, quantidade }].
alter table turnos add column if not exists itens_fechamento jsonb;

-- `estoque_movimentos.tipo` já aceita 'ajuste_contagem' desde a migration_v21.sql — sem precisar
-- recriar o check constraint aqui.
