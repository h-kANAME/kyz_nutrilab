import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../lib/api';
import {
  addDays,
  todayKey,
  weekEnd,
  weekStart,
  type WeightProgress,
} from '../lib/types';

type Props = { toast: (msg: string) => void };

type RangeMode = 'week' | '30d' | 'custom';

function formatKg(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${n.toFixed(digits)} kg`;
}

function formatPace(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)} kg/sem`;
}

function formatEta(days: number | null, date: string | null): string {
  if (days == null) return 'Sin estimación (ritmo insuficiente o en otra dirección)';
  if (days === 0) return 'Ya estás en el objetivo';
  const label = date
    ? new Date(date + 'T12:00:00').toLocaleDateString('es-AR', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null;
  const weeks = Math.round((days / 7) * 10) / 10;
  return label ? `~${weeks} sem (${label})` : `~${weeks} semanas`;
}

export function ProgresoTab({ toast }: Props) {
  const [mode, setMode] = useState<RangeMode>('30d');
  const [from, setFrom] = useState(() => addDays(todayKey(), -29));
  const [to, setTo] = useState(() => todayKey());
  const [data, setData] = useState<WeightProgress | null>(null);
  const [loading, setLoading] = useState(true);

  const applyPreset = useCallback((m: RangeMode) => {
    setMode(m);
    const today = todayKey();
    if (m === 'week') {
      const start = weekStart(today);
      setFrom(start);
      setTo(weekEnd(start));
    } else if (m === '30d') {
      setFrom(addDays(today, -29));
      setTo(today);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getWeightProgress(from, to);
      setData(res);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [from, to, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.points.map((p) => ({
      date: p.date,
      label: new Date(p.date + 'T12:00:00').toLocaleDateString('es-AR', {
        day: 'numeric',
        month: 'short',
      }),
      weight: p.weight,
    }));
  }, [data]);

  const goal = data?.peso_objetivo ?? null;

  return (
    <div className="tab-panel progreso-panel">
      <div className="chip-row" role="tablist" aria-label="Rango de progreso">
        <button
          type="button"
          className={`chip${mode === 'week' ? ' on' : ''}`}
          onClick={() => applyPreset('week')}
        >
          <span className="chip-label">Semana</span>
        </button>
        <button
          type="button"
          className={`chip${mode === '30d' ? ' on' : ''}`}
          onClick={() => applyPreset('30d')}
        >
          <span className="chip-label">30 días</span>
        </button>
        <button
          type="button"
          className={`chip${mode === 'custom' ? ' on' : ''}`}
          onClick={() => setMode('custom')}
        >
          <span className="chip-label">Custom</span>
        </button>
      </div>

      {mode === 'custom' && (
        <div className="progreso-range">
          <label>
            Desde
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => {
                setMode('custom');
                setFrom(e.target.value);
              }}
            />
          </label>
          <label>
            Hasta
            <input
              type="date"
              value={to}
              min={from}
              max={todayKey()}
              onChange={(e) => {
                setMode('custom');
                setTo(e.target.value);
              }}
            />
          </label>
        </div>
      )}

      {loading && <div className="loading">Cargando…</div>}

      {!loading && data && (
        <>
          <div className="progreso-kpis">
            <div className="progreso-kpi">
              <span className="muted">Actual</span>
              <strong className="mono">{formatKg(data.peso_actual)}</strong>
            </div>
            <div className="progreso-kpi">
              <span className="muted">Objetivo</span>
              <strong className="mono">{formatKg(data.peso_objetivo)}</strong>
            </div>
            <div className="progreso-kpi">
              <span className="muted">Δ rango</span>
              <strong className="mono">
                {data.stats.delta_kg == null
                  ? '—'
                  : `${data.stats.delta_kg > 0 ? '+' : ''}${data.stats.delta_kg.toFixed(1)} kg`}
              </strong>
            </div>
            <div className="progreso-kpi">
              <span className="muted">Gap</span>
              <strong className="mono">
                {data.stats.gap_to_goal_kg == null
                  ? '—'
                  : `${data.stats.gap_to_goal_kg > 0 ? '+' : ''}${data.stats.gap_to_goal_kg.toFixed(1)} kg`}
              </strong>
            </div>
          </div>

          <div className="progreso-chart-wrap">
            {chartData.length === 0 ? (
              <p className="field-hint" style={{ margin: '1rem 0' }}>
                Sin pesajes en este rango. Cargá el peso del día en Hoy.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--stroke)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    domain={['dataMin - 1', 'dataMax + 1']}
                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--surface)',
                      border: '1px solid var(--stroke)',
                      borderRadius: 8,
                    }}
                    labelFormatter={(_, payload) =>
                      payload?.[0]?.payload?.date
                        ? new Date(payload[0].payload.date + 'T12:00:00').toLocaleDateString(
                            'es-AR',
                          )
                        : ''
                    }
                    formatter={(value) => [`${Number(value).toFixed(1)} kg`, 'Peso']}
                  />
                  {goal != null && (
                    <ReferenceLine
                      y={goal}
                      stroke="var(--teal)"
                      strokeDasharray="4 4"
                      label={{
                        value: 'Meta',
                        fill: 'var(--teal)',
                        fontSize: 11,
                        position: 'insideTopRight',
                      }}
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey="weight"
                    stroke="var(--teal)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="progreso-proj">
            <div className="card-title" style={{ marginBottom: 8 }}>
              Proyecciones
            </div>
            {!data.peso_objetivo ? (
              <p className="field-hint">
                Definí un peso objetivo en Ajustes para ver cuándo llegarías según el plan y tu
                ritmo.
              </p>
            ) : (
              <div className="progreso-proj-grid">
                <div>
                  <span className="muted">Según plan</span>
                  <div className="mono">{formatPace(data.projection.plan_kg_per_week)}</div>
                  <p className="field-hint" style={{ marginTop: 4 }}>
                    {formatEta(data.projection.eta_plan_days, data.projection.eta_plan_date)}
                  </p>
                </div>
                <div>
                  <span className="muted">Según tu ritmo</span>
                  <div className="mono">{formatPace(data.projection.observed_kg_per_week)}</div>
                  <p className="field-hint" style={{ marginTop: 4 }}>
                    {formatEta(
                      data.projection.eta_observed_days,
                      data.projection.eta_observed_date,
                    )}
                  </p>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
