// Motivos e categorias do registro de perdas (§55 do DECISOES-TRAVADAS.md).
//
// Fica num módulo próprio porque a lista é usada nos dois lados do app: na tela de lançamento
// (src/pages/TelaPerdas.jsx, celular) e no relatório do admin (src/admin/pages/Relatorio.jsx).
// Duas listas separadas viravam divergência na primeira vez que alguém mudasse um rótulo.
//
// O que ficou DE FORA, de propósito:
// - Resto (o que volta do prato do cliente): o prato já foi vendido e já baixou estoque. É métrica
//   de porcionamento, não de perda de insumo.
// - Aparas: já estão embutidas no fator de correção da ficha (§43) — lançar de novo seria contar
//   a mesma perda duas vezes.
// - Cortesia e consumo interno: passam pelo PDV e já aparecem nas vendas.

// 28/08/2026: o motivo passou a ser o PRIMEIRO passo do lançamento (antes vinha depois do item).
// Com ele na frente, a categoria vira um pré-filtro da busca e o caso "prato inteiro" deixa de
// precisar de um botão separado — é só mais uma categoria dentro de "erro de preparo".
export const MOTIVOS_PERDA = [
  {
    valor: 'estragado',
    label: 'Estragado ou vencido',
    descricao: 'Passou da validade, quebrou o frio, contaminou. Foi pro lixo.'
  },
  {
    valor: 'sobra_praca',
    label: 'Sobra descartada',
    // O aviso é a parte importante do rótulo: sobra que volta pra geladeira e é usada no dia
    // seguinte NÃO é perda — ela reaparece na contagem normalmente. Lançar aqui contaria duas
    // vezes e deixaria o número pior do que sem registro nenhum.
    descricao: 'Sobrou na praça e foi pro lixo. O que voltou pra geladeira não se lança aqui.'
  },
  {
    valor: 'erro_preparo',
    label: 'Erro de preparo',
    descricao: 'Errou o preparo e teve que descartar.'
  }
]

export const LABEL_MOTIVO_PERDA = Object.fromEntries(MOTIVOS_PERDA.map((m) => [m.valor, m.label]))

// Pré-filtro da busca. A ordem é a mesma já decidida no §56 (compra → processo → venda), que é
// também a ordem em que a cozinha pensa: o que chegou, o que virou, o que saiu.
//
// `tiposItem` são os valores do "Tipo do Item" declarado pelo Everest, exatamente como chegam na
// coluna `produtos.tipo_item` (maiúsculo, sem acento). Ficam aqui e não espalhados pelas telas
// porque essa é a mesma classificação que o motor de conversão usa (§ "Leia primeiro", item 2) —
// divergir dela aqui criaria duas verdades sobre o que é matéria-prima.
export const CATEGORIAS_PERDA = [
  {
    valor: 'materia_prima',
    label: 'Matéria-prima',
    descricao: 'Como chega da compra.',
    tiposItem: ['MATERIA PRIMA', 'MERCADORIA PARA REVENDA']
  },
  {
    valor: 'pre_preparo',
    label: 'Pré-preparo',
    descricao: 'PP — o que a cozinha já transformou.',
    tiposItem: ['PRODUTO EM PROCESSO']
  },
  {
    valor: 'prato',
    label: 'Prato',
    descricao: 'Item do cardápio. Lançado por porções.',
    tiposItem: ['PRODUTO ACABADO']
  }
]

export const LABEL_CATEGORIA_PERDA = Object.fromEntries(CATEGORIAS_PERDA.map((c) => [c.valor, c.label]))

export const LABEL_TURNO = { almoco: 'Almoço', jantar: 'Jantar' }
