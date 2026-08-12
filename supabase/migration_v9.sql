-- Migração v9 — 12/08/2026
-- Pedido do Felipe: no Histórico de Ficha Técnica, o que importa não é a data em que a planilha
-- de Ficha Técnica foi reimportada — é o MÊS em que o insumo foi de fato COMPRADO (ex.: "AGUA:
-- Jan-2,50, Fev-2,60, Mar-2,60 [repete o último preço se não houver compra em março]"). Pra montar
-- essa linha do tempo com segurança, é preciso casar cada compra ao insumo pelo CÓDIGO EVEREST —
-- não pelo `produto_id`, que sofre do mesmo problema de FK órfã já documentado no doc de decisões
-- (§5/§29.10/§29.13): se `produtos` for zerado/reimportado depois de uma compra já salva, o
-- `produto_id` gravado na compra fica órfão e a compra "desaparece" de qualquer relatório que só
-- souber achar pelo id antigo.
--
-- `notas_importadas_itens` hoje só guarda `produto_id` (resolvido na hora do import) — nunca
-- guardou o código Everest bruto da linha, mesmo ele já vindo pronto no relatório "Compras no
-- Período" (coluna "Item", já lida pelo import — ver `importarComprasEverest`). Esta migração
-- adiciona a coluna pra guardar esse código diretamente, e o import passa a gravá-lo a partir de
-- agora.
--
-- Backfill: pra compras já importadas ANTES desta migração, tenta preencher `codigo_everest` a
-- partir do `produto_id` gravado — só funciona pras linhas cujo produto_id ainda aponta pro
-- cadastro atual (não é garantia de 100%, é melhor-esforço). Linhas que não resolverem no backfill
-- ficam com `codigo_everest = null` e simplesmente não entram na linha do tempo por mês até serem
-- reimportadas — nunca inventamos um código errado.

alter table notas_importadas_itens add column if not exists codigo_everest text;

update notas_importadas_itens ni
set codigo_everest = p.codigo_everest
from produtos p
where ni.produto_id = p.id
  and ni.codigo_everest is null;

create index if not exists idx_notas_itens_codigo on notas_importadas_itens (codigo_everest);
