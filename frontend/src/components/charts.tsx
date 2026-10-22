/* Graphiques sobres en SVG pur (aucune dépendance, PWA légère).
   Institutionnel : encre + accent orange unique, grille discrète. */

export function BarChart({ data, height = 148 }: { data: { label: string; value: number; hot?: boolean }[]; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 560; const gap = 14; const n = Math.max(1, data.length);
  const bw = (w - gap * (n + 1)) / n;
  return (
    <div className="chart" role="img" aria-label={`Graphique en barres : ${data.map((d) => `${d.label} ${d.value}`).join(', ')}`}>
      <svg viewBox={`0 0 ${w} ${height + 26}`} style={{ maxHeight: height + 26 }}>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1="0" x2={w} y1={height * (1 - f)} y2={height * (1 - f)} stroke="var(--chart-grid)" strokeWidth="1" />
        ))}
        {data.map((d, i) => {
          const h = Math.max(4, (d.value / max) * (height - 8));
          const x = gap + i * (bw + gap);
          return (
            <g key={d.label}>
              <rect x={x} y={height - h} width={bw} height={h} rx="6"
                fill={d.hot ? 'var(--accent)' : 'var(--chart-bar)'} opacity={d.hot ? 1 : 0.85} />
              <text x={x + bw / 2} y={height + 16} textAnchor="middle" fontSize="11" fill="var(--chart-muted)">{d.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* progress 0→1 : tracé animé (le parent anime, réduit si l'usager le demande). */
export function AreaChart({ data, height = 140, progress = 1 }: {
  data: number[]; height?: number; progress?: number;
}) {
  const w = 560;
  const max = Math.max(1, ...data);
  const min = Math.min(0, ...data);
  const px = (i: number) => (i / Math.max(1, data.length - 1)) * w;
  const py = (v: number) => height - 8 - ((v - min) / Math.max(1, max - min)) * (height - 24);
  const line = data.map((v, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  const id = `g${data.length}-${Math.round(max)}`;
  const clip = `clip${id}`;
  const shown = data.map((_, i) => i / Math.max(1, data.length - 1) <= progress + 0.001);
  return (
    <div className="chart" role="img" aria-label={`Évolution cumulée : ${data.join(', ')}`}>
      <svg viewBox={`0 0 ${w} ${height}`} style={{ maxHeight: height }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--chart-area)" stopOpacity="0.28" />
            <stop offset="1" stopColor="var(--chart-area)" stopOpacity="0.03" />
          </linearGradient>
          <clipPath id={clip}><rect x="0" y="0" width={w * Math.min(1, Math.max(0, progress))} height={height} /></clipPath>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={w} y1={height * f} y2={height * f} stroke="var(--chart-grid)" strokeWidth="1" />
        ))}
        <g clipPath={`url(#${clip})`}>
          <path d={`${line} L${w},${height} L0,${height} Z`} fill={`url(#${id})`} />
          <path d={line} fill="none" stroke="var(--chart-area)" strokeWidth="2.5" strokeLinecap="round" />
        </g>
        {data.map((v, i) => shown[i] && (
          <circle key={i} cx={px(i)} cy={py(v)} r={i === data.length - 1 ? 4.5 : 2.5}
            fill={i === data.length - 1 ? 'var(--accent)' : 'var(--surface)'}
            stroke="var(--chart-area)" strokeWidth="2" />
        ))}
        {data.length > 0 && shown[data.length - 1] && (
          <text x={w - 4} y={py(data[data.length - 1]) - 10} textAnchor="end"
            fontSize="14" fontWeight="800" fill="var(--chart-ink)" className="num">
            {data[data.length - 1]}
          </text>
        )}
      </svg>
    </div>
  );
}

export function Donut({ slices, size = 132 }: {
  slices: { label: string; value: number; color: string }[]; size?: number;
}) {
  const total = Math.max(1, slices.reduce((s, x) => s + x.value, 0));
  const R = 52; const C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox="0 0 132 132" role="img"
        aria-label={slices.map((s) => `${s.label} ${s.value}`).join(', ')}>
        <circle cx="66" cy="66" r={R} fill="none" stroke="var(--chart-grid)" strokeWidth="16" />
        {slices.map((s) => {
          const frac = s.value / total;
          const dash = `${(frac * C).toFixed(1)} ${(C - frac * C).toFixed(1)}`;
          const rot = (acc / total) * 360;
          acc += s.value;
          return (
            <circle key={s.label} cx="66" cy="66" r={R} fill="none"
              stroke={s.color} strokeWidth="16" strokeDasharray={dash}
              transform={`rotate(${-90 + rot} 66 66)`} strokeLinecap="butt" />
          );
        })}
        <text x="66" y="62" textAnchor="middle" fontSize="20" fontWeight="800" fill="var(--chart-ink)" className="num">{total}</text>
        <text x="66" y="80" textAnchor="middle" fontSize="11" fill="var(--chart-muted)">réservations</text>
      </svg>
      <div className="chart-legend" style={{ display: 'grid', gap: 6 }}>
        {slices.map((s) => (
          <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <i style={{ background: s.color }} aria-hidden="true" />
            {s.label} — <strong className="num">{s.value}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}
