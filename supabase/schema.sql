-- Schema: Inventário Grupo DOM
-- Rodar no SQL Editor do Supabase (ou via supabase CLI: supabase db push)

create extension if not exists "uuid-ossp";

-- 1. Unidades do grupo
create table if not exists unidades (
  id uuid primary key default uuid_generate_v4(),
  nome text not null unique,
  cnpj text, -- CNPJ do Everest correspondente (Dalva e Dito, Mercadinho e RESID compartilham o mesmo CNPJ do Dalva)
  codigo_deposito text, -- número do depósito no Everest, usado na exportação
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

insert into unidades (nome) values
  ('Dalva e Dito'),
  ('Mercadinho Dalva'),
  ('RESID Bar'),
  ('DOM')
on conflict (nome) do nothing;

-- 2. Cadastro mestre de produtos (espelha o cadastro do Everest)
create table if not exists produtos (
  id uuid primary key default uuid_generate_v4(),
  nome text not null,
  unidade_medida text not null default 'un', -- unidade de medida usada pelo Everest: un, kg, lt
  codigo_everest text unique, -- código do produto no ERP Everest — é a identidade real do item, não o nome
  categoria text, -- derivada automaticamente da faixa do código no import (venda, insumo, embalagem, pre_preparo, limpeza_uniforme, equipamento)
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_produtos_codigo_everest on produtos (codigo_everest);
create index if not exists idx_produtos_nome_busca on produtos using gin (to_tsvector('portuguese', nome));

alter table produtos add column if not exists sigla text;
alter table produtos add column if not exists tipo_item text;
alter table produtos add column if not exists grande_grupo text;
alter table produtos add column if not exists grupo_everest text;
alter table produtos add column if not exists subgrupo_everest text;
alter table produtos add column if not exists venda boolean;
alter table produtos add column if not exists compra boolean;
alter table produtos add column if not exists empresa text;

create table if not exists siglas_internas (
  sigla text primary key,
  significado text not null
);

insert into siglas_internas (sigla, significado) values
  ('PP', 'Produto de produção'),
  ('DOM', 'Itens de venda e revenda do DOM'),
  ('DD', 'Itens de venda e revenda do Dalva'),
  ('EV', 'Itens de venda e revenda de Eventos (Dalva)'),
  ('RB', 'Itens de venda e revenda do Resid Bar (Dalva)'),
  ('MC', 'Itens de venda e revenda do Mercadinho (Dalva)'),
  ('VH', 'Vinhos'),
  ('SB', 'Sobremesa'),
  ('BCO', 'Vinho branco'),
  ('TTO', 'Vinho tinto')
on conflict (sigla) do nothing;

-- 3. Vínculo entre código de barras e produto (atalho opcional pra busca manual)
create table if not exists barcodes (
  id uuid primary key default uuid_generate_v4(),
  codigo_barras text not null unique,
  produto_id uuid not null references produtos(id) on delete cascade,
  origem text not null default 'industrializado' check (origem in ('industrializado', 'interno')), -- 'interno' = etiqueta gerada por nós a partir do código Everest
  created_at timestamptz not null default now()
);

create index if not exists idx_barcodes_produto on barcodes (produto_id);

-- 4. Sessões de contagem (uma "rodada" de inventário por unidade)
create table if not exists sessoes_contagem (
  id uuid primary key default uuid_generate_v4(),
  unidade_id uuid not null references unidades(id),
  usuario text not null,
  tipo text not null default 'mensal' check (tipo in ('mensal', 'semanal', 'diario', 'outros', 'producao', 'perdas')),
  grupo_id uuid, -- referência ao grupo usado (só quando tipo = 'parcial'; ver tabela grupos_contagem)
  mes_referencia integer not null default extract(month from now()), -- 1-12
  ano_referencia integer not null default extract(year from now()),
  data_referencia date, -- dia real da contagem (semanal) — editável no lançamento; iniciada_em continua sendo o timestamp real de criação
  status text not null default 'em_andamento' check (status in ('em_andamento', 'finalizada')),
  iniciada_em timestamptz not null default now(),
  finalizada_em timestamptz
);

create index if not exists idx_sessoes_unidade on sessoes_contagem (unidade_id, status);

-- 4a. Grupos salvos de contagem parcial (ex: "Laticínios", "Bebidas")
create table if not exists grupos_contagem (
  id uuid primary key default uuid_generate_v4(),
  nome text not null,
  created_at timestamptz not null default now()
);

alter table sessoes_contagem
  add constraint fk_sessoes_grupo foreign key (grupo_id) references grupos_contagem(id) on delete set null;

-- 4b. Quais produtos pertencem a cada grupo salvo
create table if not exists grupos_contagem_itens (
  grupo_id uuid not null references grupos_contagem(id) on delete cascade,
  produto_id uuid not null references produtos(id) on delete cascade,
  primary key (grupo_id, produto_id)
);

-- 4c. Lista de itens esperados numa sessão específica — snapshot no momento em que a
-- sessão começa (pro mensal, todos os produtos físicos ativos; pro parcial, copiado do
-- grupo escolhido, já podendo ser ajustado antes de iniciar). É o que permite mostrar
-- "X de Y itens contados" e a lista do que ainda falta.
create table if not exists itens_esperados_sessao (
  sessao_id uuid not null references sessoes_contagem(id) on delete cascade,
  produto_id uuid not null references produtos(id) on delete cascade,
  primary key (sessao_id, produto_id)
);

-- 5. Itens lançados dentro de uma sessão
-- quantidade = valor final já convertido, na unidade_medida do produto (a mesma do Everest)
create table if not exists itens_contagem (
  id uuid primary key default uuid_generate_v4(),
  sessao_id uuid not null references sessoes_contagem(id) on delete cascade,
  produto_id uuid not null references produtos(id),
  codigo_barras_usado text, -- preenchido só quando o item veio da câmera
  modo_entrada text not null check (modo_entrada in ('embalagem', 'direto')),
  qtd_embalagens numeric, -- preenchido só quando modo_entrada = 'embalagem'
  peso_embalagem numeric, -- preenchido só quando modo_entrada = 'embalagem'; varia a cada contagem
  quantidade numeric not null, -- total convertido: qtd_embalagens * peso_embalagem, ou o valor direto
  registrado_em timestamptz not null default now()
);

create index if not exists idx_itens_sessao on itens_contagem (sessao_id);

-- Saídas registradas DURANTE a contagem: itens retirados/usados no momento do inventário.
-- A contagem original é preservada; a saída fica à parte (rastreável). Estoque efetivo =
-- quantidade contada - saídas.
create table if not exists saidas_contagem (
  id uuid primary key default uuid_generate_v4(),
  sessao_id uuid not null references sessoes_contagem(id) on delete cascade,
  produto_id uuid not null references produtos(id),
  quantidade numeric not null,
  motivo text,
  usuario text,
  registrado_em timestamptz not null default now()
);
create index if not exists idx_saidas_sessao on saidas_contagem (sessao_id);

-- Fatores de correção: converte item porcionado de volta ao insumo cru.
-- Ex.: PP FILET MEDALHÃO -> FILET MIGNON, fator 1.25 (1,25 kg de cru por 1 kg de porcionado).
create table if not exists fatores_correcao (
  id uuid primary key default uuid_generate_v4(),
  porcionado_id uuid not null references produtos(id) on delete cascade,
  cru_id uuid not null references produtos(id) on delete cascade,
  fator numeric not null,
  criado_em timestamptz not null default now()
);
create index if not exists idx_fatores_porcionado on fatores_correcao (porcionado_id);

-- 6. Histórico de notas fiscais importadas (pra alimentar o comparativo do dashboard)
create table if not exists notas_importadas (
  id uuid primary key default uuid_generate_v4(),
  numero_nota text,
  fornecedor text,
  cnpj_destinatario text, -- CNPJ de quem recebeu (usado só nas notas de NF-e, sem coluna fantasia)
  fantasia text, -- "DOM" ou "DALVA", vindo direto da planilha de Compras — mais simples que CNPJ
  data_emissao date,
  importado_em timestamptz not null default now()
);

create table if not exists notas_importadas_itens (
  id uuid primary key default uuid_generate_v4(),
  nota_id uuid not null references notas_importadas(id) on delete cascade,
  produto_id uuid references produtos(id), -- null se não deu pra vincular a nenhum produto
  nome_xml text,
  ean text,
  unidade text,
  quantidade numeric,
  valor_unitario numeric,
  valor_total numeric,
  custo_medio numeric
);

alter table notas_importadas add column if not exists fantasia text;

-- v3 (05/08/2026) — quantidade/unidade de compra bruta ao lado da convertida, e flag do Everest
-- que marca item fora do cálculo de CMV. Ver supabase/migration_v3.sql.
alter table notas_importadas_itens add column if not exists quantidade_embalagens numeric;
alter table notas_importadas_itens add column if not exists unidade_compra text;
alter table notas_importadas_itens add column if not exists calcula_cmv boolean not null default true;

-- v9 (12/08/2026) — código Everest bruto da linha de compra, gravado direto (não só via
-- produto_id, que fica órfão se `produtos` for zerado/reimportado depois). Ver migration_v9.sql.
alter table notas_importadas_itens add column if not exists codigo_everest text;

create index if not exists idx_notas_itens_nota on notas_importadas_itens (nota_id);
create index if not exists idx_notas_itens_produto on notas_importadas_itens (produto_id);
create index if not exists idx_notas_itens_codigo on notas_importadas_itens (codigo_everest);

-- 6b. Vendas importadas (relatório "Vendas por grupo - Analítico" do Everest, por loja/turno/dia)
create table if not exists vendas_importadas (
  id uuid primary key default uuid_generate_v4(),
  loja text,
  turno text, -- 'almoco' | 'jantar' | outro
  data_inicio date,
  data_fim date,
  nome_arquivo text,
  importado_em timestamptz not null default now()
);

create table if not exists vendas_importadas_itens (
  id uuid primary key default uuid_generate_v4(),
  venda_id uuid not null references vendas_importadas(id) on delete cascade,
  produto_id uuid references produtos(id),
  codigo_everest text,
  nome_original text,
  grupo_venda text,
  quantidade numeric,
  valor_total numeric
);

-- v3 (05/08/2026) — formato novo "Vendas Integração PDV" traz data e fantasia por linha (não
-- mais por header do arquivo importado, que agora cobre meses inteiros de uma vez). Ver
-- supabase/migration_v3.sql.
alter table vendas_importadas_itens add column if not exists data_movimento date;
alter table vendas_importadas_itens add column if not exists cancelado boolean not null default false;
alter table vendas_importadas_itens add column if not exists valor_liquido numeric;
alter table vendas_importadas_itens add column if not exists numero_conta text;
alter table vendas_importadas_itens add column if not exists fantasia text;

-- v8 (12/08/2026) — o Felipe pediu pra parar de usar `valor_liquido` (V.Líquido do Everest) no
-- cálculo de faturamento/CMV: esse campo é financeiro e carrega desconto do produto, que não deve
-- entrar na conta. Guarda agora também `valor_unitario` (V.Unitário do Everest, preço de tabela do
-- item) — o faturamento passa a ser `valor_unitario × quantidade × 1,13` (13% de gorjeta), sem
-- depender de desconto. `valor_liquido` NÃO foi removido (nunca se apaga dado, §5) — só deixou de
-- ser a fonte usada no cálculo. Ver supabase/migration_v8.sql.
alter table vendas_importadas_itens add column if not exists valor_unitario numeric;

create index if not exists idx_vendas_itens_venda on vendas_importadas_itens (venda_id);
create index if not exists idx_vendas_itens_produto on vendas_importadas_itens (produto_id);
create index if not exists idx_vendas_itens_data_movimento on vendas_importadas_itens (data_movimento);

-- 6c. Fichas técnicas (receitas) — base pro consumo teórico e CMV
create table if not exists fichas_tecnicas (
  id uuid primary key default uuid_generate_v4(),
  produto_id uuid references produtos(id),
  codigo_everest text unique,
  nome text,
  unidade_medida text,
  tipo_item text,
  quantidade_producao numeric,
  versao text,
  data_versao date,
  custo_producao numeric,
  situacao text,
  atualizado_em timestamptz not null default now()
);

-- v3 (05/08/2026) — fantasia (D.O.M./DALVA) do prato; quantidade_producao passa a ser gravada
-- como 1 e custo_producao como o custo teórico somado dos ingredientes (ver adminApi.js,
-- importarFichasTecnicas). Ver supabase/migration_v3.sql.
alter table fichas_tecnicas add column if not exists fantasia text;

create table if not exists fichas_tecnicas_ingredientes (
  id uuid primary key default uuid_generate_v4(),
  ficha_id uuid not null references fichas_tecnicas(id) on delete cascade,
  produto_id uuid references produtos(id),
  codigo_everest text,
  nome text,
  unidade_medida text,
  embalagem text,
  tipo_item text,
  quantidade_aplicada numeric,
  percentual_aproveitamento numeric,
  fator_aplicacao numeric,
  quantidade_baixa_estoque numeric,
  custo_medio numeric,
  custo_unitario numeric,
  tipo_baixa text
);

create index if not exists idx_ft_ingredientes_ficha on fichas_tecnicas_ingredientes (ficha_id);
create index if not exists idx_ft_ingredientes_produto on fichas_tecnicas_ingredientes (produto_id);

-- v7 (10/08/2026) — histórico de preço da ficha técnica (snapshot a cada import). Ver
-- supabase/migration_v7.sql.
create table if not exists fichas_tecnicas_historico (
  id uuid primary key default uuid_generate_v4(),
  ficha_id uuid not null references fichas_tecnicas(id) on delete cascade,
  codigo_everest text not null,
  nome text,
  custo_producao numeric not null default 0,
  capturado_em timestamptz not null default now()
);
create index if not exists idx_ft_historico_ficha on fichas_tecnicas_historico (ficha_id);
create index if not exists idx_ft_historico_codigo on fichas_tecnicas_historico (codigo_everest);
create index if not exists idx_ft_historico_capturado on fichas_tecnicas_historico (capturado_em);

-- 6d. Produtividade — cronometragem de produção por praça/funcionário (separado do registro de
-- produção/estoque). Mede tempo, kg e porções por processo, pra entender esforço x resultado.
create table if not exists producoes_cadastradas (
  id uuid primary key default uuid_generate_v4(),
  nome text not null,
  praca_padrao text,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists producoes_andamento (
  id uuid primary key default uuid_generate_v4(),
  unidade_id uuid references unidades(id),
  praca text,
  insumo text,
  producao text,
  funcionario text,
  turno text,
  iniciado_em timestamptz not null default now(),
  parado_em timestamptz,
  status text not null default 'em_andamento' check (status in ('em_andamento', 'finalizado', 'cancelado'))
);

create table if not exists producoes_registros (
  id uuid primary key default uuid_generate_v4(),
  andamento_id uuid references producoes_andamento(id),
  unidade_id uuid references unidades(id),
  data date not null default current_date,
  praca text,
  insumo text,
  producao text,
  produzido text,
  funcionario text,
  turno text,
  inicio timestamptz,
  fim timestamptz,
  tempo_min numeric,
  kg numeric,
  porcoes numeric,
  obs text,
  origem text not null default 'manual' check (origem in ('cronometrado', 'manual')),
  registrado_em timestamptz not null default now()
);

create index if not exists idx_prod_registros_data on producoes_registros (data);
create index if not exists idx_prod_registros_funcionario on producoes_registros (funcionario);

-- 7. Histórico de contagens feitas antes desse app existir (planilhas antigas)
-- Fica separado das tabelas operacionais — é só referência/análise, não participa do fluxo ao vivo.
create table if not exists contagens_historicas (
  id uuid primary key default uuid_generate_v4(),
  produto_id uuid references produtos(id), -- null se não deu pra casar com nenhum produto
  codigo_everest text,
  nome_original text,
  responsavel text,
  local_original text,
  unidade_medida text,
  quantidade numeric,
  registrado_em timestamptz
);

create index if not exists idx_contagens_historicas_produto on contagens_historicas (produto_id);
create index if not exists idx_contagens_historicas_data on contagens_historicas (registrado_em);

-- 8. Senhas de acesso por papel (owner troca tudo; gerente entra em cadastro+admin; cadastro só cadastro)
create table if not exists senhas_acesso (
  papel text primary key check (papel in ('owner', 'gerente', 'cadastro')),
  senha text not null
);

insert into senhas_acesso (papel, senha) values
  ('owner', 'Aeb@1234'),
  ('gerente', 'Bcapanema@456'),
  ('cadastro', 'Dom@123')
on conflict (papel) do nothing;

-- 9. Configuração geral (chave/valor) — usado pro mês ativo do inventário mensal
create table if not exists configuracao_geral (
  chave text primary key,
  valor text
);

-- Pessoas que usam o app de lançamento, identificadas por PIN de 4 dígitos (não é senha de acesso).
create table if not exists usuarios_app (
  id uuid primary key default uuid_generate_v4(),
  nome_completo text not null,
  pin text not null unique check (pin ~ '^[0-9]{4}$'),
  nivel_acesso text not null default 'operacao' check (nivel_acesso in ('administrativo', 'estoque_compras', 'operacao')),
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

alter table usuarios_app add column if not exists nivel_acesso text not null default 'operacao';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'usuarios_app_nivel_acesso_check') then
    alter table usuarios_app add constraint usuarios_app_nivel_acesso_check check (nivel_acesso in ('administrativo', 'estoque_compras', 'operacao'));
  end if;
end $$;

-- Candidatos a sigla descartados (palavra comum, não é sigla de verdade) — pra não
-- ficar sugerindo de novo na tela de siglas não mapeadas.
create table if not exists siglas_ignoradas (
  sigla text primary key,
  ignorado_em timestamptz not null default now()
);

-- RLS: liberado para a chave anon por enquanto (uso interno, sem login ainda).
alter table unidades enable row level security;
alter table produtos enable row level security;
alter table barcodes enable row level security;
alter table sessoes_contagem enable row level security;
alter table itens_contagem enable row level security;
alter table grupos_contagem enable row level security;
alter table grupos_contagem_itens enable row level security;
alter table itens_esperados_sessao enable row level security;
alter table notas_importadas enable row level security;
alter table notas_importadas_itens enable row level security;
alter table contagens_historicas enable row level security;
alter table senhas_acesso enable row level security;
alter table configuracao_geral enable row level security;
alter table siglas_internas enable row level security;
alter table usuarios_app enable row level security;
alter table vendas_importadas enable row level security;
alter table vendas_importadas_itens enable row level security;
alter table fichas_tecnicas enable row level security;
alter table fichas_tecnicas_ingredientes enable row level security;
alter table fichas_tecnicas_historico enable row level security;
alter table producoes_cadastradas enable row level security;
alter table producoes_andamento enable row level security;
alter table producoes_registros enable row level security;
alter table siglas_ignoradas enable row level security;
alter table saidas_contagem enable row level security;
drop policy if exists "allow all - saidas_contagem" on saidas_contagem;
create policy "allow all - saidas_contagem" on saidas_contagem for all using (true) with check (true);
alter table fatores_correcao enable row level security;
drop policy if exists "allow all - fatores_correcao" on fatores_correcao;
create policy "allow all - fatores_correcao" on fatores_correcao for all using (true) with check (true);

create policy "allow all - unidades" on unidades for all using (true) with check (true);
create policy "allow all - produtos" on produtos for all using (true) with check (true);
create policy "allow all - barcodes" on barcodes for all using (true) with check (true);
create policy "allow all - sessoes_contagem" on sessoes_contagem for all using (true) with check (true);
create policy "allow all - itens_contagem" on itens_contagem for all using (true) with check (true);
create policy "allow all - grupos_contagem" on grupos_contagem for all using (true) with check (true);
create policy "allow all - grupos_contagem_itens" on grupos_contagem_itens for all using (true) with check (true);
create policy "allow all - itens_esperados_sessao" on itens_esperados_sessao for all using (true) with check (true);
create policy "allow all - notas_importadas" on notas_importadas for all using (true) with check (true);
create policy "allow all - notas_importadas_itens" on notas_importadas_itens for all using (true) with check (true);
create policy "allow all - contagens_historicas" on contagens_historicas for all using (true) with check (true);
create policy "allow all - senhas_acesso" on senhas_acesso for all using (true) with check (true);
create policy "allow all - configuracao_geral" on configuracao_geral for all using (true) with check (true);
create policy "allow all - siglas_internas" on siglas_internas for all using (true) with check (true);
create policy "allow all - usuarios_app" on usuarios_app for all using (true) with check (true);
create policy "allow all - siglas_ignoradas" on siglas_ignoradas for all using (true) with check (true);
create policy "allow all - vendas_importadas" on vendas_importadas for all using (true) with check (true);
create policy "allow all - vendas_importadas_itens" on vendas_importadas_itens for all using (true) with check (true);
create policy "allow all - fichas_tecnicas" on fichas_tecnicas for all using (true) with check (true);
create policy "allow all - fichas_tecnicas_ingredientes" on fichas_tecnicas_ingredientes for all using (true) with check (true);
create policy "allow all - fichas_tecnicas_historico" on fichas_tecnicas_historico for all using (true) with check (true);
create policy "allow all - producoes_cadastradas" on producoes_cadastradas for all using (true) with check (true);
create policy "allow all - producoes_andamento" on producoes_andamento for all using (true) with check (true);
create policy "allow all - producoes_registros" on producoes_registros for all using (true) with check (true);
