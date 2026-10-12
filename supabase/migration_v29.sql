-- Migração v29 — 11/10/2026
-- Pedido do Felipe: Recebimento sempre entra direto no Setor "Estoque" — não precisa (nem faz
-- sentido) trocar de Setor aqui, "os itens vão entrar por DOM ou Dalva e tudo entra direto pelo
-- estoque". Mas a Loja (CNPJ de verdade — DOM ou Dalva) ainda precisa ficar registrada, separada
-- do Setor, pra bater com a nota fiscal quando a reconciliação (`notas_importadas`) acontecer.
-- `recebimentos` não guardava Loja nenhuma até aqui, só `local_estoque_id`.

alter table recebimentos add column if not exists unidade_id uuid references unidades(id);
