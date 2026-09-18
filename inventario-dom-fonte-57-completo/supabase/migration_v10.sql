-- Migração v10 — 17/08/2026
-- Pedido do Felipe, testando a Contagem semanal com o time da cozinha: (1) ele escolheu a data
-- 03/08 pra contar, mas ao abrir a tela caiu numa sessão de OUTRA PESSOA, do dia 17/08 — a busca
-- de "sessão em andamento" (ver `buscarSessaoEmAndamento`, `src/lib/api.js`) filtrava só por
-- tipo + loja/grupo, sem checar a data escolhida nem quem estava logado, então reaproveitava
-- qualquer sessão aberta daquele grupo/loja, de qualquer dia e de qualquer pessoa. Isso já foi
-- corrigido no código (agora isola por usuário sempre, e por data quando aplicável) — essa
-- migração cobre a parte de BANCO da correção: guardar quem fez o quê, pra nunca mais existir uma
-- contagem "sem dono" ou com o nome errado.
--
-- (2) Felipe também relatou uma contagem aparecendo com o nome dele sem ele lembrar de ter
-- enviado — hipótese: ele começou, não enviou, e outra pessoa (nesse cenário de bug, sem querer)
-- continuou e mandou. `sessoes_contagem.usuario` é gravado só na criação e nunca mudava — não
-- tinha como saber se quem abriu foi o mesmo que enviou. `usuario_finalizou` guarda isso
-- separadamente. E `itens_contagem` nunca guardou usuário/quem lançou cada item (diferente de
-- `saidas_contagem`, que já tinha esse campo) — só a data/hora (`registrado_em`, já existia).
-- Pedido explícito: "vamos guardar a informação de data hora e o que mais você conseguir pegar
-- do usuário" — `usuario` por item é o que dá pra capturar hoje (login é por nome/PIN, sem
-- e-mail/dispositivo — ver `usuarios_app`/`verificar_pin_seguro`).
--
-- Ambas as colunas são NULLABLE de propósito — linhas/sessões já existentes antes desta migração
-- ficam sem esse dado (nunca inventamos um valor), só as novas passam a ter.

alter table itens_contagem add column if not exists usuario text;
alter table sessoes_contagem add column if not exists usuario_finalizou text;

create index if not exists idx_itens_contagem_usuario on itens_contagem (usuario);
