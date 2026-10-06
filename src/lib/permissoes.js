// Quem pode ATENDER uma requisição (liberar material de um estoque/cofre controlado) — pedido do
// Felipe (06/10/2026): "está aparecendo pra qualquer um aceitar, e está errado. Precisa ser só
// estoquista, gestores, adm e dev."
//
// Diferente do `podeVer` do Admin (AdminShell.jsx), que deixa "sem perfil vinculado" ver TUDO por
// compatibilidade — aqui o pedido é travar AGORA, então quem não tem perfil cai no nível antigo
// (`nivel_acesso`), não num bypass geral. Não existe nível "gestor" separado hoje (só
// administrativo/estoque_compras/operacao, ver schema.sql) — administrativo cobre esse papel até
// o Felipe criar perfis específicos (ele pediu exatamente essa possibilidade: perfil é cadastro
// configurável, ver UsuariosPerfis.jsx `AREAS` → "Requisição e transferência").
export function podeAtenderRequisicao(usuario) {
  if (!usuario) return false
  if (usuario.ehDesenvolvedor) return true
  const lista = Array.isArray(usuario.permissoes) ? usuario.permissoes : []
  if (lista.includes('requisicoes.atender')) return true
  if (lista.length) return false // tem perfil, mas essa permissão não foi marcada — bloqueia de propósito
  // sem perfil vinculado (legado): só quem já tinha o nível mais alto de acesso
  return usuario.nivelAcesso === 'administrativo' || usuario.nivelAcesso === 'estoque_compras'
}
