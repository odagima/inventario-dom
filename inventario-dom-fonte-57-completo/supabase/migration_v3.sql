-- Migração v3 — faxina de dados (05/08/2026)
-- Acompanha a reescrita de importarFichasTecnicas / importarVendasEverest / importarComprasEverest
-- para os formatos novos do Everest (ver DECISOES-TRAVADAS.md §11 e a sessão de faxina).
-- Rode isso ANTES de reimportar ficha/vendas/compras com o código novo.

-- 1. Vendas — data por linha (cada item de venda já vem com sua própria data no relatório novo;
--    antes só existia data_inicio/data_fim no header do arquivo importado, que agora cobre meses
--    inteiros de uma vez e não serve mais pra recortar por mês/período).
alter table vendas_importadas_itens add column if not exists data_movimento date;
alter table vendas_importadas_itens add column if not exists cancelado boolean not null default false;
alter table vendas_importadas_itens add column if not exists valor_liquido numeric;
alter table vendas_importadas_itens add column if not exists numero_conta text;
-- Fantasia (D.O.M./DALVA) por item — o formato novo mistura as duas empresas no mesmo arquivo,
-- sem mais uma "loja" única por header.
alter table vendas_importadas_itens add column if not exists fantasia text;

create index if not exists idx_vendas_itens_data_movimento on vendas_importadas_itens (data_movimento);

-- 2. Compras — quantidade/unidade de compra (embalagem) bruta ao lado da convertida (guardar
--    bruto + convertido lado a lado, §2 do doc de decisões), e o flag do Everest que marca item
--    fora do cálculo de CMV.
alter table notas_importadas_itens add column if not exists quantidade_embalagens numeric;
alter table notas_importadas_itens add column if not exists unidade_compra text;
alter table notas_importadas_itens add column if not exists calcula_cmv boolean not null default true;

-- 3. Fichas técnicas — fantasia (D.O.M./DALVA) do prato, pra rastreabilidade (as duas empresas
--    agora vêm em arquivos separados, mas identidade continua sendo codigo_everest).
alter table fichas_tecnicas add column if not exists fantasia text;

-- Nota: quantidade_producao e custo_producao em fichas_tecnicas continuam existindo — o import
-- novo passa a gravar quantidade_producao = 1 e custo_producao = soma do custo unitário dos
-- ingredientes (ou seja, "custo teórico de 1 unidade do prato"). Isso mantém buscarCMVPonderado,
-- buscarMargemCardapio e buscarCMVSemanal funcionando sem mudança (eles fazem
-- custo_producao ÷ quantidade_producao, que com quantidade_producao=1 já dá o valor certo).
