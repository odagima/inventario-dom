-- Migração v20 — 06/10/2026
-- `requisicao_exige_aprovacao` passou a ter efeito de verdade (ver criarRequisicao em
-- requisicaoTransferenciaApi.js) — a descrição da v18 dizia "sem efeito ainda", que ficou errada.
update configuracoes_sistema
set descricao = 'Desligado (padrão): toda requisição nova é atendida sozinha na hora, com a quantidade cheia, sem precisar de ninguém clicar em "Atender". Ligado: fica pendente esperando atendimento manual de quem tem permissão (estoquista/administrativo/dev).'
where chave = 'requisicao_exige_aprovacao';
