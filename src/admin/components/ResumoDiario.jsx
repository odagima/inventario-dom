import { useEffect, useState } from 'react'
import { buscarComparativoFaturamentoOntem, LOJAS_LABEL } from '../lib/adminApi'
import { formatarMoeda, formatarPercentual } from '../lib/formato'
import Icon from './Icon'

// Widget da barra lateral (13/08/2026) — substitui o antigo "Resumo do mês vigente"
// (`ResumoMesVigente.jsx`, mantido no código mas não mais chamado em `AdminShell.jsx` — pedido do
// Felipe foi trocar tudo, não somar) por 3 blocos: data de hoje, tempo (ícone) e o faturamento de
// ontem por loja com seta de tendência.

const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const NOMES_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

function formatarDataHoje() {
  const hoje = new Date()
  return `${DIAS_SEMANA[hoje.getDay()]}, ${hoje.getDate()} de ${NOMES_MES[hoje.getMonth()]}`
}

// Coordenadas de Jardins, São Paulo (pedido do Felipe) — fixas, sem geolocalização: o widget é o
// mesmo pra qualquer pessoa que abrir o painel, então uma cidade fixa é mais previsível do que
// depender de onde o navegador de cada usuário diz que está.
const LATITUDE_TEMPO = -23.567
const LONGITUDE_TEMPO = -46.657

// Códigos de tempo do Open-Meteo (WMO) → ícone/label em pt-BR. Não cobre TODO código possível (ex.
// neve, raro em São Paulo) — cai no `nublado` como fallback neutro em vez de travar o widget.
function classificarTempo(codigo) {
  if (codigo === 0) return { icone: 'sol', label: 'Céu limpo' }
  if (codigo === 1) return { icone: 'sol', label: 'Poucas nuvens' }
  if (codigo === 2) return { icone: 'parcialNublado', label: 'Parcialmente nublado' }
  if (codigo === 3) return { icone: 'nublado', label: 'Nublado' }
  if ([45, 48].includes(codigo)) return { icone: 'neblina', label: 'Neblina' }
  if ([51, 53, 55, 56, 57].includes(codigo)) return { icone: 'chuva', label: 'Chuvisco' }
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(codigo)) return { icone: 'chuva', label: 'Chuva' }
  if ([71, 73, 75, 77, 85, 86].includes(codigo)) return { icone: 'neblina', label: 'Neve' }
  if ([95, 96, 99].includes(codigo)) return { icone: 'tempestade', label: 'Tempestade' }
  return { icone: 'nublado', label: 'Tempo' }
}

function Tempo() {
  const [tempo, setTempo] = useState(null) // { temperatura, ...classificarTempo() } | 'erro' | null (carregando)

  useEffect(() => {
    let vivo = true
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${LATITUDE_TEMPO}&longitude=${LONGITUDE_TEMPO}&current_weather=true&timezone=America%2FSao_Paulo`)
      .then((r) => r.json())
      .then((d) => {
        if (!vivo) return
        if (d?.current_weather) setTempo({ temperatura: d.current_weather.temperature, ...classificarTempo(d.current_weather.weathercode) })
        else setTempo('erro')
      })
      .catch(() => { if (vivo) setTempo('erro') })
    return () => { vivo = false }
  }, [])

  if (tempo === 'erro') return <p className="muted" style={{ margin: 0, fontSize: 12 }}>Tempo indisponível agora.</p>
  if (!tempo) return <p className="muted" style={{ margin: 0, fontSize: 12 }}>Carregando tempo…</p>
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Icon nome={tempo.icone} tamanho={22} cor="var(--accent)" />
      <div>
        <span style={{ fontSize: 15, fontWeight: 600 }}>{Math.round(tempo.temperatura)}°C</span>
        <span className="muted" style={{ fontSize: 12, marginLeft: 6 }}>{tempo.label}</span>
      </div>
    </div>
  )
}

// Seta de tendência do faturamento por loja — mesma lógica visual da seta de CMV em `Cardapio.jsx`
// (verde/vermelho/cinza com título explicativo), só que aqui "pra cima" é sempre bom (mais
// faturamento), nunca invertido como no CMV. ±10% é a faixa "estável" — variação diária de
// faturamento é naturalmente ruidosa, então uma diferença pequena não deveria parecer alarmante.
function SetaFaturamento({ variacaoPercentual }) {
  if (variacaoPercentual >= 10) return <span style={{ color: 'var(--success)' }} title="Acima da média dos 7 dias anteriores">↑</span>
  if (variacaoPercentual <= -10) return <span style={{ color: 'var(--danger)' }} title="Abaixo da média dos 7 dias anteriores">↓</span>
  return <span className="muted" title="Perto da média dos 7 dias anteriores">→</span>
}

function FaturamentoOntemPorLoja() {
  const [dados, setDados] = useState(null)

  useEffect(() => {
    let vivo = true
    buscarComparativoFaturamentoOntem().then((r) => { if (vivo) setDados(r) }).catch(() => {})
    return () => { vivo = false }
  }, [])

  if (!dados) return <p className="muted" style={{ margin: 0, fontSize: 12 }}>Carregando faturamento…</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {Object.entries(dados.porLoja).map(([loja, v]) => (
        <div key={loja} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12.5 }}>
          <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{LOJAS_LABEL[loja]}</span>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexShrink: 0, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ fontWeight: 600 }}>{formatarMoeda(v.ontem)}</span>
            <SetaFaturamento variacaoPercentual={v.variacaoPercentual} />
          </span>
        </div>
      ))}
    </div>
  )
}

export default function ResumoDiario() {
  return (
    <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{formatarDataHoje()}</p>
      <Tempo />
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <p className="muted" style={{ margin: '0 0 8px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
          Faturamento de ontem
        </p>
        <FaturamentoOntemPorLoja />
      </div>
    </div>
  )
}
