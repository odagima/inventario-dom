-- Migração v5 — 07/08/2026
-- Travar acesso direto (via chave anônima) às tabelas de senha/PIN — ver DECISOES-TRAVADAS.md.
--
-- O que achamos: `senhas_acesso` (papéis Owner/Gerente/Cadastro) e `usuarios_app` (PINs de
-- login) estavam com RLS "allow all" — qualquer pessoa com a chave anônima do app (que vai
-- embutida no site publicado, então é pública por natureza) conseguia ler ou escrever essas
-- tabelas direto pela API do Supabase, sem passar pela tela de login nem pelo app.
--
-- O que essa migração faz:
--  1. `senhas_acesso`: a aba "Senhas de acesso" nunca esteve ligada a nenhum login real (nada no
--     app chamava a função de verificação) — removemos a aba do app e travamos a tabela de
--     verdade (sem function nenhuma no lugar, porque não tem mais nada usando).
--  2. `usuarios_app`: continua em uso (login por PIN) — troca o acesso direto por 3 functions no
--     banco (SECURITY DEFINER), que validam e limitam o que pode ser lido/escrito, em vez de
--     abrir a tabela inteira pra qualquer query.
--
-- IMPORTANTE — ordem de aplicação: rode esta migração ANTES de publicar o código novo do app
-- (o código novo já chama as functions abaixo; se publicar antes de rodar isso, o login por PIN
-- para de funcionar até você rodar a migração).
--
-- Limitação que continua existindo, mesmo depois disso: como o app não tem um login "de verdade"
-- (sessão/token) pra admin, ainda não tem como o banco diferenciar "é o admin logado" de
-- "é qualquer um com a chave anônima" — então as functions abaixo continuam acessíveis por
-- qualquer um que souber os nomes certos. O ganho real aqui é: (a) fecha de vez o vazamento de
-- senhas que não protegiam nada, e (b) fecha a possibilidade de dar um "select *" livre ou um
-- insert/update fora do formato esperado direto na tabela de PINs — quem quiser algo, tem que
-- passar pelas regras que a function impõe. Resolver de raiz exigiria login real (Supabase Auth),
-- que é um projeto maior, separado deste.

-- 1. Trava total de `senhas_acesso` — recurso não usado por nenhuma tela do app.
drop policy if exists "allow all - senhas_acesso" on senhas_acesso;
revoke all on senhas_acesso from anon, authenticated;

-- 2. `usuarios_app`: revoga o acesso direto e substitui por functions específicas.
drop policy if exists "allow all - usuarios_app" on usuarios_app;
revoke all on usuarios_app from anon, authenticated;

-- Login por PIN: devolve só nome + nível de UM usuário ativo que bateu o pin — não expõe a
-- tabela nem os PINs dos outros.
create or replace function verificar_pin_seguro(pin_informado text)
returns table(nome_completo text, nivel_acesso text)
language sql
security definer
set search_path = public
as $$
  select nome_completo, nivel_acesso
  from usuarios_app
  where pin = pin_informado and ativo = true
  limit 1;
$$;
grant execute on function verificar_pin_seguro(text) to anon, authenticated;

-- Tela de gestão de usuários (dentro do admin) — lista todo mundo, com PIN (a própria tela
-- precisa mostrar o PIN de cada pessoa pra quem gerencia).
create or replace function listar_usuarios_seguro()
returns table(id uuid, nome_completo text, pin text, nivel_acesso text, ativo boolean)
language sql
security definer
set search_path = public
as $$
  select id, nome_completo, pin, nivel_acesso, ativo
  from usuarios_app
  order by nome_completo;
$$;
grant execute on function listar_usuarios_seguro() to anon, authenticated;

create or replace function criar_usuario_seguro(nome_completo_in text, pin_in text, nivel_in text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into usuarios_app (nome_completo, pin, nivel_acesso)
  values (nome_completo_in, pin_in, nivel_in);
$$;
grant execute on function criar_usuario_seguro(text, text, text) to anon, authenticated;

create or replace function atualizar_usuario_seguro(usuario_id uuid, novo_nivel text default null, novo_ativo boolean default null)
returns void
language sql
security definer
set search_path = public
as $$
  update usuarios_app set
    nivel_acesso = coalesce(novo_nivel, nivel_acesso),
    ativo = coalesce(novo_ativo, ativo)
  where id = usuario_id;
$$;
grant execute on function atualizar_usuario_seguro(uuid, text, boolean) to anon, authenticated;

create or replace function deletar_usuario_seguro(usuario_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from usuarios_app where id = usuario_id;
$$;
grant execute on function deletar_usuario_seguro(uuid) to anon, authenticated;
