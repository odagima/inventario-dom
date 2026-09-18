-- Migração v8 — 12/08/2026
-- O Felipe reportou que `valor_liquido` (coluna "V.Líquido" do relatório "Vendas Integração PDV"
-- do Everest) é um campo FINANCEIRO — carrega desconto do produto — e não deve ser usado no
-- cálculo de faturamento/CMV. O pedido original de 11/08 (usar valor líquido + gorjeta) foi
-- refeito: a partir de agora o faturamento usado em todo o app é
--
--     valor_unitario (V.Unitário, preço de tabela do item) × quantidade × 1,13 (13% de gorjeta)
--
-- em vez de ler `valor_liquido` direto. Isso exige guardar `valor_unitario` por item, que até
-- agora não era salvo (só valor_total e valor_liquido).
--
-- `valor_liquido` NÃO é apagado — continua gravado (nunca se descarta dado já importado, ver §5
-- do doc de decisões), só deixou de alimentar o cálculo de receita.
--
-- Depois de rodar esta migração, é preciso reimportar as Vendas (Importar dados → Vendas) pra que
-- os itens já existentes ganhem o valor_unitario (fica null em registros antigos até reimportar —
-- o app já tem fallback pra não zerar receita nesse meio tempo, ver `valorVenda` em adminApi.js).

alter table vendas_importadas_itens add column if not exists valor_unitario numeric;
