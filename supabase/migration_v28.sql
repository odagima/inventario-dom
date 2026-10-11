-- Migração v28 — 11/10/2026
-- `listar_usuarios_seguro` (usada só pra EXIBIR a lista de usuários no Admin) nunca ganhou as 2
-- colunas que `verificar_pin_seguro` já devolve desde a migration_v24.sql (local_estoque_padrao_id/
-- nome) — por isso o campo "Local padrão" no editor de usuário sempre abria em branco, mesmo com
-- um valor já salvo (SALVAR sempre funcionou direto na tabela, só a EXIBIÇÃO que faltava).
--
-- Versão atual confirmada em produção (pedido ao Felipe, 11/10/2026, via
-- `select pg_get_functiondef('listar_usuarios_seguro'::regproc)` — essa function nunca tinha sido
-- commitada em nenhuma migração deste repositório, só editada direto no Supabase): mesmas colunas
-- e mesmos joins de sempre, só acrescentando o que faltava. `drop` antes do `create or replace`
-- porque Postgres não deixa mudar as colunas de retorno de uma function existente (erro 42P13).

drop function if exists listar_usuarios_seguro();

create or replace function listar_usuarios_seguro()
returns table(
  id uuid, nome_completo text, pin text, nivel_acesso text, ativo boolean,
  perfil_id uuid, perfil_nome text, eh_desenvolvedor boolean,
  unidade_id uuid, unidade_nome text, created_at timestamp with time zone,
  local_estoque_padrao_id uuid, local_estoque_padrao_nome text
)
language sql
security definer
set search_path = public
as $$
  select
    u.id, u.nome_completo, u.pin, u.nivel_acesso, u.ativo,
    u.perfil_id, p.nome, coalesce(p.eh_desenvolvedor, false),
    u.unidade_id, un.nome, u.created_at,
    u.local_estoque_padrao_id, l.nome
  from usuarios_app u
  left join perfis_acesso p on p.id = u.perfil_id
  left join unidades un on un.id = u.unidade_id
  left join locais_estoque l on l.id = u.local_estoque_padrao_id
  order by u.nome_completo;
$$;
grant execute on function listar_usuarios_seguro() to anon, authenticated;
