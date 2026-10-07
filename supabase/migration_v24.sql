-- Migração v24 — 07/10/2026
-- Pedido do Felipe: "se a senha da pessoa está vinculada com loja tal, local y, só consegue abrir
-- aquela [praça]". Cada usuário ganha um local de estoque padrão (opcional) — quem tiver, só abre/
-- fecha esse local; quem não tiver (gerente, por exemplo) continua escolhendo livremente.
--
-- `verificar_pin_seguro` ganha 2 colunas NOVAS no final (local_estoque_padrao_id/nome) — mesmo
-- padrão de extensão aditiva já usado quando essa function ganhou perfil/permissões/unidade (ver
-- comentário em src/lib/api.js): quem chama por nome de campo não quebra, e o app já trata campo
-- novo ausente como null/[] com segurança.

alter table usuarios_app add column if not exists local_estoque_padrao_id uuid references locais_estoque(id);

create or replace function verificar_pin_seguro(pin_informado text)
returns table(
  nome_completo text, nivel_acesso text,
  perfil_id uuid, perfil_nome text, permissoes jsonb, eh_desenvolvedor boolean,
  unidade_id uuid, unidade_nome text,
  local_estoque_padrao_id uuid, local_estoque_padrao_nome text
)
language sql
security definer
set search_path = public
as $$
  select
    u.nome_completo, u.nivel_acesso,
    p.id, p.nome, p.permissoes, coalesce(p.eh_desenvolvedor, false),
    un.id, un.nome,
    l.id, l.nome
  from usuarios_app u
  left join perfis_acesso p on p.id = u.perfil_id and p.ativo = true
  left join unidades un on un.id = u.unidade_id
  left join locais_estoque l on l.id = u.local_estoque_padrao_id
  where u.pin = pin_informado and u.ativo = true
  limit 1;
$$;
grant execute on function verificar_pin_seguro(text) to anon, authenticated;
