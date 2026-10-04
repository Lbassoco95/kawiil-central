import { useRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { POSE_SRC, deltaWords, money } from "./assets";
import type {
  CashflowPoint,
  ChatMessage,
  GroupItem,
  InsightItem,
  InvoiceRow,
  KpiTone,
  LineageStep,
  MailPoint,
  PeriodId,
  Pose,
  ProposalStatus,
  RankItem,
  RequestFilter,
  RequestItem,
  Source,
  TeamMember,
} from "./types";
import { pushDemoToast } from "../lib/demoStore";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** Caja circular fija para íconos Lucide (misma métrica en login, nav y listas). */
export function IconBadge({
  icon: Icon,
  size = "md",
  className,
}: {
  icon: LucideIcon;
  size?: "sm" | "md";
  className?: string;
}) {
  const px = size === "sm" ? 16 : 20;
  return (
    <span className={cx("kw-iconbox", size === "sm" && "kw-iconbox--sm", className)} aria-hidden>
      <Icon size={px} strokeWidth={1.75} />
    </span>
  );
}

const SOURCES: Record<Source, { label: string; via: string; color: string }> = {
  sat: { label: "CFDI · SAT", via: "vía Moffin", color: "var(--kawiil-blue)" },
  savio: { label: "Savio", via: "cobranza", color: "var(--kawiil-mint)" },
  manual: { label: "Captura manual", via: "", color: "var(--ink-muted)" },
  estados: { label: "Estados financieros", via: "archivo cargado", color: "var(--kawiilito-orange)" },
  buzon: { label: "Buzón tributario", via: "SAT", color: "var(--kawiilito-orange)" },
  pendiente: { label: "Pendiente de cargar", via: "", color: "var(--caution-text)" },
};

const TONES: Record<KpiTone, string> = {
  ingreso: "var(--chart-ingreso)",
  egreso: "var(--chart-egreso)",
  neto: "var(--chart-neto)",
  impuesto: "var(--ink-muted)",
};

const PROPOSAL: Record<ProposalStatus, { word: string; color: string }> = {
  confirmada: { word: "Registrada por tu contador", color: "var(--positive-text)" },
  sugerida: { word: "Propuesta de Kawiil · falta tu respuesta", color: "var(--link)" },
  cliente: { word: "Confirmado por ti · lo registra tu contador", color: "var(--link)" },
  revisar: { word: "Por revisar", color: "var(--caution-text)" },
};

export function GlassPanel({
  tone = "default",
  size,
  lift,
  padded = true,
  as: Tag = "div",
  className,
  children,
  ...rest
}: {
  tone?: "default" | "strong" | "tint";
  size?: "md" | "xl";
  lift?: boolean;
  padded?: boolean;
  as?: "div" | "section" | "article" | "aside";
  className?: string;
  children?: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  return (
    <Tag
      className={cx(
        "kw-glass",
        padded && "kw-glass--pad",
        tone === "strong" && "kw-glass--strong",
        tone === "tint" && "kw-glass--tint",
        size === "xl" && "kw-glass--xl",
        size === "md" && "kw-glass--md",
        lift && "kw-glass--lift",
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function SourceChip({
  source,
  label,
  via,
  onClick,
}: {
  source: Source;
  label?: string;
  via?: string;
  onClick?: () => void;
}) {
  const s = SOURCES[source] || SOURCES.manual;
  const pending = source === "pendiente";
  const cls = cx("kw-chip", pending && "kw-chip--pending");
  const body = (
    <>
      <span
        className="kw-chip__dot"
        style={{
          background: pending ? "transparent" : s.color,
          border: pending ? "2px dashed var(--control-border)" : "none",
        }}
        aria-hidden
      />
      <span>{label || s.label}</span>
      {(via || s.via) && !pending ? <span className="kw-chip__via">{via || s.via}</span> : null}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick} aria-label={`Origen: ${label || s.label}. Abrir ¿De dónde sale?`}>
        {body}
      </button>
    );
  }
  return <span className={cls}>{body}</span>;
}

export function KwButton({
  variant = "default",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "text" }) {
  return (
    <button
      type={type}
      className={cx("kw-btn", variant === "primary" && "kw-btn--primary", variant === "text" && "kw-btn--text", className)}
      {...props}
    />
  );
}

export function KpiTile({
  label,
  value,
  delta,
  tone = "ingreso",
  spark,
  source = "sat",
  note,
  onExplain,
}: {
  label: string;
  value: number | null;
  delta?: number;
  tone?: KpiTone;
  spark?: number[];
  source?: Source;
  note?: string;
  onExplain?: () => void;
}) {
  const color = TONES[tone];
  const words = deltaWords(delta);
  let sparkEl: ReactNode = null;
  if (spark && spark.length > 1) {
    const W = 96;
    const H = 36;
    const mn = Math.min(...spark);
    const mx = Math.max(...spark);
    const rng = mx - mn || 1;
    const pts = spark.map((v, i) => [(i / (spark.length - 1)) * (W - 8) + 4, H - 6 - ((v - mn) / rng) * (H - 12)] as const);
    const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
    const last = pts[pts.length - 1];
    sparkEl = (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Tendencia de los últimos ${spark.length} meses`}>
        <path d={d} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" />
        <circle
          cx={last[0]}
          cy={last[1]}
          r={tone === "egreso" ? 4 : 4.5}
          fill={tone === "egreso" ? "var(--surface-glass-strong)" : color}
          stroke={color}
          strokeWidth={2}
        />
      </svg>
    );
  }
  return (
    <GlassPanel lift className="kw-kpi" padded={false}>
      <div className="kw-kpi__top">
        <div className="kw-kpi__tag">
          <span
            className="kw-kpi__cap"
            style={{
              background: tone === "egreso" ? "transparent" : color,
              border: tone === "egreso" ? `2px solid ${color}` : "none",
            }}
            aria-hidden
          />
          <span className="kw-caption">{label}</span>
        </div>
        {onExplain ? (
          <KwButton variant="text" onClick={onExplain}>
            ¿De dónde sale?
          </KwButton>
        ) : null}
      </div>
      <div className="kw-kpi__row">
        <div>
          <div className="kw-figure kw-kpi__value">{money(value)}</div>
          {words ? (
            <div className="kw-kpi__delta" aria-label={`Cambio: ${words}`}>
              <span aria-hidden>{(delta ?? 0) > 0 ? "↑" : (delta ?? 0) < 0 ? "↓" : "→"}</span>
              {words}
            </div>
          ) : null}
        </div>
        {sparkEl}
      </div>
      <div className="kw-kpi__foot">
        <SourceChip source={source} onClick={onExplain} />
        {note ? <span className="kw-small">{note}</span> : null}
      </div>
    </GlassPanel>
  );
}

export function CashflowChart({
  data,
  title = "Ingresos y egresos",
  subtitle,
  source = "sat",
  footer,
  series = "both",
  onExplain,
}: {
  data: CashflowPoint[];
  title?: string;
  subtitle?: string;
  source?: Source;
  footer?: string;
  series?: "both" | "ingresos" | "egresos";
  onExplain?: () => void;
}) {
  const [asTable, setAsTable] = useState(false);
  const W = 680;
  const H = 280;
  const PL = 56;
  const PR = 70;
  const PT = 16;
  const PB = 34;
  let maxV = 0;
  data.forEach((d) => {
    if (series !== "egresos") maxV = Math.max(maxV, d.ingresos);
    if (series !== "ingresos") maxV = Math.max(maxV, d.egresos);
  });
  const step = Math.pow(10, Math.floor(Math.log10(maxV || 1)));
  maxV = Math.ceil(maxV / step) * step || 1;
  const n = data.length;
  const X = (i: number) => PL + (n < 2 ? 0 : (i / (n - 1)) * (W - PL - PR));
  const Y = (v: number) => PT + (1 - v / maxV) * (H - PT - PB);
  const inPts = data.map((d, i) => [X(i), Y(d.ingresos)] as const);
  const egPts = data.map((d, i) => [X(i), Y(d.egresos)] as const);
  const path = (pts: readonly (readonly [number, number])[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area =
    series !== "egresos" && inPts.length
      ? `${path(inPts)} L${inPts[inPts.length - 1][0].toFixed(1)},${(H - PB).toFixed(1)} L${inPts[0][0].toFixed(1)},${(H - PB).toFixed(1)} Z`
      : "";

  return (
    <GlassPanel padded={false} className="kw-chart">
      <div className="kw-chart__head">
        <div>
          <h3 className="kw-title">{title}</h3>
          {subtitle ? <p className="kw-small" style={{ margin: "2px 0 0" }}>{subtitle}</p> : null}
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <SourceChip source={source} onClick={onExplain} />
          <KwButton variant="text" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
            {asTable ? "Ver gráfica" : "Ver como tabla"}
          </KwButton>
        </div>
      </div>
      {!asTable && (
        <div className="kw-chart__legend" aria-hidden>
          {series !== "egresos" && (
            <span className="kw-chart__key">
              <span style={{ width: 14, height: 14, borderRadius: "50%", background: "var(--chart-ingreso)" }} />
              Ingresos
            </span>
          )}
          {series !== "ingresos" && (
            <span className="kw-chart__key">
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  border: "2px solid var(--chart-egreso)",
                  background: "transparent",
                }}
              />
              Egresos
            </span>
          )}
        </div>
      )}
      {asTable ? (
        <table className="kw-table">
          <caption className="kw-sr">{title}</caption>
          <thead>
            <tr>
              <th scope="col">Mes</th>
              {series !== "egresos" && <th scope="col">Ingresos</th>}
              {series !== "ingresos" && <th scope="col">Egresos</th>}
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.label}>
                <td>{d.label}</td>
                {series !== "egresos" && <td>{money(d.ingresos)}</td>}
                {series !== "ingresos" && <td>{money(d.egresos)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="kw-chart__plot">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <line key={t} x1={PL} x2={W - PR} y1={Y(maxV * t)} y2={Y(maxV * t)} stroke="var(--line)" strokeWidth={1} />
            ))}
            {series !== "egresos" && (
              <>
                <path d={area} fill="var(--chart-ingreso)" opacity={0.12} />
                <path d={path(inPts)} fill="none" stroke="var(--chart-ingreso)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                {inPts.map((p, i) => (
                  <circle key={`i${i}`} cx={p[0]} cy={p[1]} r={4.5} fill="var(--chart-ingreso)" />
                ))}
              </>
            )}
            {series !== "ingresos" && (
              <>
                <path d={path(egPts)} fill="none" stroke="var(--chart-egreso)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                {egPts.map((p, i) => (
                  <circle key={`e${i}`} cx={p[0]} cy={p[1]} r={4.5} fill="var(--surface-glass-strong)" stroke="var(--chart-egreso)" strokeWidth={2} />
                ))}
              </>
            )}
            {data.map((d, i) => (
              <text key={d.label} x={X(i)} y={H - 10} textAnchor="middle" fill="var(--ink-muted)" fontSize={12} fontFamily="var(--font-sans)">
                {d.label}
              </text>
            ))}
          </svg>
        </div>
      )}
      {footer ? <p className="kw-small" style={{ marginTop: 12 }}>{footer}</p> : null}
    </GlassPanel>
  );
}

export function LineagePanel({ title, subtitle, steps }: { title?: string; subtitle?: string; steps: LineageStep[] }) {
  return (
    <GlassPanel padded={false} className="kw-lineage">
      <h3 className="kw-title">{title || "¿De dónde sale este dato?"}</h3>
      {subtitle ? <p className="kw-small" style={{ margin: "2px 0 0" }}>{subtitle}</p> : null}
      <ol className="kw-lineage__list">
        {steps.map((s, i) => {
          const pending = s.state === "pending";
          return (
            <li key={i} className="kw-lineage__item">
              <span
                className={cx("kw-lineage__node", pending && "kw-lineage__node--pending", s.state === "done" && "kw-lineage__node--done")}
                aria-hidden
              >
                {pending ? "!" : String(i + 1)}
              </span>
              <div className="kw-lineage__body">
                <p className="kw-lineage__title">
                  {s.title}
                  {pending ? <span style={{ color: "var(--caution-text)", marginLeft: 8 }}>Pendiente</span> : null}
                </p>
                {s.detail ? <p className="kw-lineage__detail">{s.detail}</p> : null}
                <div className="kw-lineage__meta">
                  {s.source ? <SourceChip source={s.source} /> : null}
                  {s.meta ? <span className="kw-small">{s.meta}</span> : null}
                </div>
                {s.uuids?.length ? (
                  <div className="kw-lineage__uuid">
                    {s.uuids.map((u) => (
                      <code key={u} className="kw-mono">
                        {u}
                      </code>
                    ))}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </GlassPanel>
  );
}

export function KawiilitoGuide({
  pose = "saluda",
  title,
  side = "left",
  actions,
  children,
  className,
}: {
  pose?: Pose;
  title?: string;
  side?: "left" | "right";
  actions?: { label: string; primary?: boolean; text?: boolean; onClick?: () => void }[];
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("kw-guide", side === "right" && "kw-guide--right", className)} role="complementary" aria-label="Kawiilito, tu guía">
      <img className="kw-guide__mascot" src={POSE_SRC[pose]} alt="Kawiilito" />
      <GlassPanel tone="tint" padded={false} className="kw-guide__bubble" size="md">
        <div className="kw-guide__name kw-caption">
          <i aria-hidden />
          Kawiilito
        </div>
        {title ? <p className="kw-guide__title">{title}</p> : null}
        <p className="kw-guide__text">{children}</p>
        {actions?.length ? (
          <div className="kw-guide__actions">
            {actions.map((a) => (
              <KwButton key={a.label} variant={a.primary ? "primary" : a.text ? "text" : "default"} onClick={a.onClick}>
                {a.label}
              </KwButton>
            ))}
          </div>
        ) : null}
      </GlassPanel>
    </div>
  );
}

export function KawiilitoDock({ label = "Preguntar a Kawiilito", onClick }: { label?: string; onClick?: () => void }) {
  return (
    <button type="button" className="kw-dock" onClick={onClick} aria-label={label}>
      <span className="kw-avatar">
        <img src={POSE_SRC.saluda} alt="" />
      </span>
      {label}
    </button>
  );
}

export function PeriodSwitch({
  value,
  onChange,
  label,
  onPrev,
  onNext,
}: {
  value: PeriodId;
  onChange: (id: PeriodId) => void;
  label?: string;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const opts: { id: PeriodId; label: string }[] = [
    { id: "mes", label: "Mes" },
    { id: "trimestre", label: "Trimestre" },
    { id: "anio", label: "Año" },
  ];
  return (
    <div className="kw-period">
      <div className="kw-seg" role="group" aria-label="Ver por">
        {opts.map((o) => (
          <button key={o.id} type="button" className="kw-seg__btn" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
      {label ? (
        <div className="kw-period__nav">
          <button type="button" className="kw-iconbtn" aria-label="Periodo anterior" onClick={onPrev} disabled={!onPrev}>
            ‹
          </button>
          <span className="kw-period__label">{label}</span>
          <button type="button" className="kw-iconbtn" aria-label="Periodo siguiente" onClick={onNext} disabled={!onNext}>
            ›
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ProposalBadge({
  account,
  code,
  status,
  note,
}: {
  account?: string;
  code?: string;
  status?: ProposalStatus;
  note?: string;
}) {
  if (!account && !status && !note) return <span className="kw-small">—</span>;
  const p = PROPOSAL[status || (note ? "cliente" : "sugerida")];
  return (
    <span className="kw-prop">
      {account ? (
        <span className="kw-prop__acct">
          {code ? <span className="kw-mono" style={{ marginRight: 6, color: "var(--ink-muted)" }}>{code}</span> : null}
          {account}
        </span>
      ) : null}
      {note ? <span className="kw-prop__note">Tú dijiste: «{note}»</span> : null}
      <span className="kw-prop__state" style={{ color: p.color }}>
        {p.word}
      </span>
    </span>
  );
}

export function RankedList({
  title,
  subtitle,
  items,
  tone = "ingreso",
  source = "sat",
  onExplain,
}: {
  title: string;
  subtitle?: string;
  items: RankItem[];
  tone?: KpiTone;
  source?: Source;
  onExplain?: () => void;
}) {
  const color = TONES[tone];
  const maxShare = Math.max(1, ...items.filter((i) => !i.other).map((i) => i.share));
  return (
    <GlassPanel padded={false} className="kw-rank">
      <div className="kw-chart__head">
        <div>
          <h3 className="kw-title">{title}</h3>
          {subtitle ? <p className="kw-small" style={{ margin: "2px 0 0" }}>{subtitle}</p> : null}
        </div>
        <SourceChip source={source} onClick={onExplain} />
      </div>
      <ol className="kw-rank__list">
        {items.map((it, i) => (
          <li key={i}>
            <div className="kw-rank__top">
              <span className="kw-rank__name">
                <span className="kw-rank__n">{i + 1}</span>
                {it.name}
              </span>
              <span className="kw-figure" style={{ fontSize: 16 }}>
                {money(it.amount)}
              </span>
            </div>
            <div className="kw-rank__bar">
              <span style={{ width: `${Math.max(3, (it.share / maxShare) * 100)}%`, background: color, opacity: it.other ? 0.45 : 1 }} />
            </div>
            {it.meta ? <p className="kw-small kw-rank__meta">{it.meta}</p> : null}
          </li>
        ))}
      </ol>
    </GlassPanel>
  );
}

export function InvoiceTable({
  title,
  subtitle,
  rows,
  partyLabel = "Cliente",
  source = "sat",
  onExplain,
}: {
  title: string;
  subtitle?: string;
  rows: InvoiceRow[];
  partyLabel?: string;
  source?: Source;
  onExplain?: () => void;
}) {
  return (
    <GlassPanel padded={false} className="kw-inv">
      <div className="kw-chart__head">
        <div>
          <h3 className="kw-title">{title}</h3>
          {subtitle ? <p className="kw-small" style={{ margin: "2px 0 0" }}>{subtitle}</p> : null}
        </div>
        <SourceChip source={source} onClick={onExplain} />
      </div>
      <div className="kw-inv__scroll" tabIndex={0} role="region" aria-label={title}>
        <table className="kw-table kw-inv__table">
          <caption className="kw-sr">{title}, ordenadas de mayor a menor total</caption>
          <thead>
            <tr>
              <th scope="col">Fecha</th>
              <th scope="col">{partyLabel}</th>
              <th scope="col">Folio fiscal</th>
              <th scope="col">Total</th>
              <th scope="col">Estatus</th>
              <th scope="col">Propuesta</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.folio} className={r.status === "cancelado" ? "kw-inv__canc" : undefined}>
                <td>{r.date}</td>
                <td>
                  <span className="kw-inv__party">{r.party}</span>
                  {r.rfc ? <span className="kw-inv__rfc kw-mono">{r.rfc}</span> : null}
                </td>
                <td className="kw-mono">{r.folio}</td>
                <td className="kw-inv__total">{money(r.total, true)}</td>
                <td>
                  <span className="kw-status" style={{ color: r.status === "vigente" ? "var(--positive-text)" : "var(--ink-muted)" }}>
                    {r.status === "vigente" ? "Vigente" : "Cancelado"}
                  </span>
                </td>
                <td>{r.proposal ? <ProposalBadge {...r.proposal} /> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="md:hidden" style={{ listStyle: "none", margin: "16px 0 0", padding: 0, display: "grid", gap: 12 }}>
        {rows.map((r) => (
          <li key={`m-${r.folio}`}>
            <GlassPanel tone="strong" size="md">
              <p className="kw-caption">{r.date}</p>
              <p className="kw-title" style={{ fontSize: 16, marginTop: 4 }}>{r.party}</p>
              <p className="kw-mono kw-small" style={{ marginTop: 4 }}>{r.folio}</p>
              <p className="kw-figure" style={{ fontSize: 22, marginTop: 8 }}>{money(r.total, true)}</p>
              <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
                <span className="kw-status" style={{ color: r.status === "vigente" ? "var(--positive-text)" : "var(--ink-muted)" }}>
                  {r.status === "vigente" ? "Vigente" : "Cancelado"}
                </span>
                {r.proposal ? <ProposalBadge {...r.proposal} /> : null}
              </div>
            </GlassPanel>
          </li>
        ))}
      </ul>
    </GlassPanel>
  );
}

export function GroupBreakdown({
  title,
  subtitle,
  groups,
  tone = "ingreso",
  source = "sat",
}: {
  title: string;
  subtitle?: string;
  groups: GroupItem[];
  tone?: KpiTone;
  source?: Source;
}) {
  const color = TONES[tone];
  const ops = [1, 0.74, 0.56, 0.42, 0.3];
  let k = 0;
  return (
    <GlassPanel padded={false} className="kw-grp">
      <div className="kw-chart__head">
        <div>
          <h3 className="kw-title">{title}</h3>
          {subtitle ? <p className="kw-small" style={{ margin: "2px 0 0" }}>{subtitle}</p> : null}
        </div>
        <SourceChip source={source} />
      </div>
      <div className="kw-grp__bar" aria-hidden>
        {groups.map((g, i) => (
          <span
            key={i}
            style={{
              flex: Math.max(g.share, 2),
              opacity: g.unclassified ? 0.7 : ops[Math.min(k++, ops.length - 1)],
              background: g.unclassified
                ? "repeating-linear-gradient(135deg, var(--ink-muted) 0 3px, transparent 3px 7px)"
                : color,
            }}
          />
        ))}
      </div>
      <ul className="kw-grp__list">
        {groups.map((g, i) => (
          <li key={i} className="kw-grp__row">
            <span
              className="kw-grp__sw"
              style={{
                background: g.unclassified
                  ? "repeating-linear-gradient(135deg, var(--ink-muted) 0 3px, transparent 3px 7px)"
                  : color,
                opacity: g.unclassified ? 0.7 : ops[Math.min(i, ops.length - 1)],
              }}
            />
            <div>
              <div className="kw-grp__line">
                <span className="kw-grp__name">{g.name}</span>
                <span className="kw-figure" style={{ fontSize: 16 }}>{money(g.amount)}</span>
              </div>
              <p className="kw-small">
                {g.share.toFixed(0)}%{g.count != null ? ` · ${g.count} facturas` : ""}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </GlassPanel>
  );
}

export function MailboxCard({
  urgency = "info",
  kind,
  date,
  unread,
  title,
  folio,
  summary,
  points,
  reviewed,
  onOpenOriginal,
}: {
  urgency?: "info" | "atencion" | "urgente";
  kind: string;
  date: string;
  unread?: boolean;
  title: string;
  folio?: string;
  summary: string;
  points: MailPoint[];
  reviewed?: boolean;
  onOpenOriginal?: () => void;
}) {
  const u = {
    info: { word: "Informativo", color: "var(--ink-muted)", text: "var(--ink-muted)" },
    atencion: { word: "Requiere atención", color: "var(--caution-text)", text: "var(--caution-text)" },
    urgente: { word: "Con plazo cercano", color: "var(--kawiilito-orange)", text: "var(--on-accent)", fill: "var(--kawiilito-orange)" },
  }[urgency];
  return (
    <GlassPanel padded={false} className="kw-mail" as="article">
      <div className="kw-mail__top">
        <span className="kw-urg" style={{ color: u.text, borderColor: u.color, background: "fill" in u ? u.fill : "transparent" }}>
          {u.word}
        </span>
        <span className="kw-caption">
          {kind} · {date}
        </span>
        {unread ? <span className="kw-mail__unread">Sin leer</span> : null}
      </div>
      <h3 className="kw-title kw-mail__title">{title}</h3>
      {folio ? <p className="kw-mono" style={{ margin: "4px 0 0", color: "var(--ink-muted)" }}>{folio}</p> : null}
      <div className="kw-mail__sum">
        <p className="kw-guide__text" style={{ margin: 0 }}>{summary}</p>
        <dl className="kw-mail__pts">
          {points.map((p) => (
            <div key={p.label}>
              <dt>{p.label}</dt>
              <dd>{p.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="kw-mail__foot">
        <div className="kw-mail__meta">
          <SourceChip source="buzon" label="Buzón tributario" />
          <span className="kw-small" style={{ color: reviewed ? "var(--positive-text)" : "var(--caution-text)" }}>
            {reviewed ? "Revisado por tu contador" : "Tu contador aún lo revisa"}
          </span>
        </div>
        <KwButton
          onClick={() => {
            if (onOpenOriginal) onOpenOriginal();
            else pushDemoToast({ tone: "info", text: "En el demo: el mensaje original del SAT se muestra en un panel (abre el botón desde Buzón)." });
          }}
        >
          Ver mensaje original
        </KwButton>
      </div>
    </GlassPanel>
  );
}

export function ClassificationPrompt({
  kind = "ingreso",
  invoice,
  proposal,
  options,
  flag,
  onAnswer,
}: {
  kind?: "ingreso" | "gasto";
  invoice: { date: string; party: string; folio: string; total: number; concept: string };
  proposal: string;
  options?: { id: string; label: string }[];
  flag?: string;
  onAnswer?: (id: string) => void;
}) {
  const [ans, setAns] = useState<string | null>(null);
  const opts = options || [{ id: "otro", label: "No, fue otra cosa" }];
  return (
    <GlassPanel padded={false} className="kw-cls" as="article">
      <div className="kw-cls__top">
        <span className="kw-caption">{kind === "gasto" ? "Factura recibida" : "Factura emitida"} · {invoice.date}</span>
        <span className="kw-figure" style={{ fontSize: 18 }}>{money(invoice.total, true)}</span>
      </div>
      <p className="kw-cls__party">{invoice.party}</p>
      <div className="kw-cls__concept">
        <span className="kw-caption">Concepto en el CFDI</span>
        <span>{invoice.concept}</span>
        <span className="kw-mono kw-small">{invoice.folio}</span>
      </div>
      <div className="kw-cls__read">
        <img src={POSE_SRC.cifras} alt="" width={56} height={56} />
        <div>
          <p className="kw-caption">Propuesta de Kawiil</p>
          <p className="kw-cls__label">{proposal}</p>
        </div>
      </div>
      {flag ? (
        <div className="kw-cls__flag" role="status">
          <strong>Posible error de emisión</strong>
          <p className="kw-small" style={{ margin: 0 }}>{flag}</p>
        </div>
      ) : null}
      {ans ? (
        <div className="kw-cls__done">
          <span className="kw-prop__state" style={{ color: "var(--positive-text)" }}>
            Registramos tu respuesta. Tu contador lo confirma.
          </span>
        </div>
      ) : (
        <>
          <p className="kw-cls__q">¿Qué fue esta factura?</p>
          <div className="kw-cls__btns">
            <KwButton
              variant="primary"
              onClick={() => {
                setAns("si");
                onAnswer?.("si");
              }}
            >
              Sí, es correcto
            </KwButton>
            {opts.map((o) => (
              <KwButton
                key={o.id}
                onClick={() => {
                  setAns(o.id);
                  onAnswer?.(o.id);
                }}
              >
                {o.label}
              </KwButton>
            ))}
          </div>
        </>
      )}
    </GlassPanel>
  );
}

export function InsightList({ title, subtitle, items, footer }: { title?: string; subtitle?: string; items: InsightItem[]; footer?: string }) {
  const statusWord = (s?: InsightItem["status"]) =>
    s === "cerrado" ? "Cerrado" : s === "en_seguimiento" ? "En seguimiento" : s === "abierto" ? "Abierto" : null;
  return (
    <GlassPanel padded={false} className="kw-ins">
      <div className="kw-chart__head">
        <div>
          <h3 className="kw-title">{title || "Seguimientos de Kawiil"}</h3>
          {subtitle ? <p className="kw-small" style={{ margin: "2px 0 0" }}>{subtitle}</p> : null}
        </div>
      </div>
      <ul className="kw-ins__list">
        {items.map((it, i) => (
          <li key={i} className="kw-ins__row">
            <span className="kw-ins__dot" aria-hidden />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="kw-ins__t" style={{ margin: 0 }}>{it.title}</p>
                {statusWord(it.status) ? (
                  <span className="kw-caption" style={{ color: it.status === "abierto" ? "var(--caution-text)" : "var(--link)" }}>
                    {statusWord(it.status)}
                  </span>
                ) : null}
              </div>
              <p className="kw-small" style={{ margin: "2px 0 0" }}>{it.detail}</p>
              {it.followUp ? (
                <p className="kw-small" style={{ margin: "6px 0 0" }}>
                  <strong>Seguimiento:</strong> {it.followUp}
                </p>
              ) : null}
              {it.owner ? <p className="kw-caption" style={{ margin: "4px 0 0" }}>Equipo: {it.owner}</p> : null}
              {it.basis ? <p className="kw-caption" style={{ margin: "4px 0 0" }}>{it.basis}</p> : null}
            </div>
          </li>
        ))}
      </ul>
      {footer ? <p className="kw-small" style={{ marginTop: 16 }}>{footer}</p> : null}
    </GlassPanel>
  );
}

export function TeamRoster({ members, label }: { members: TeamMember[]; label?: string }) {
  return (
    <div className="kw-team" role="list" aria-label={label || "Tu equipo en Kawiil"}>
      {members.map((m, i) => {
        const ini = m.name
          .split(" ")
          .slice(0, 2)
          .map((x) => x.charAt(0))
          .join("")
          .toUpperCase();
        return (
          <span key={i} className="kw-member" role="listitem">
            <span className={cx("kw-member__ini", m.area === "Legal" && "kw-member__ini--legal")} aria-hidden>
              {ini}
            </span>
            <span className="kw-member__n">
              {m.name}
              <span className="kw-member__r">{m.area}</span>
            </span>
          </span>
        );
      })}
    </div>
  );
}

export function TeamChat({
  members,
  messages: initial,
  status,
  title,
  subtitle,
}: {
  members?: TeamMember[];
  messages: ChatMessage[];
  status?: string;
  title?: string;
  subtitle?: string;
}) {
  const [msgs, setMsgs] = useState(initial);
  const [draft, setDraft] = useState("");
  return (
    <GlassPanel padded={false} className="kw-chat">
      <div className="kw-chart__head">
        <div>
          <h3 className="kw-title">{title || "Mensajes con tu equipo"}</h3>
          <p className="kw-small" style={{ margin: "2px 0 0" }}>
            {subtitle || "Tu equipo contable y legal te responde en este chat."}
          </p>
        </div>
        {status ? <span className="kw-caption">{status}</span> : null}
      </div>
      {members ? <TeamRoster members={members} /> : null}
      <div className="kw-chat__log" aria-live="polite">
        {msgs.map((m, i) => (
          <div key={i} className={cx("kw-msg", m.from === "yo" && "kw-msg--me")}>
            <div className="kw-msg__meta">
              {m.from === "yo" ? "Tú" : m.name}
              {m.area ? ` · ${m.area}` : ""} · {m.time}
            </div>
            <div className="kw-msg__body">{m.text}</div>
            {m.attachment ? <span className="kw-msg__att">{m.attachment}</span> : null}
          </div>
        ))}
      </div>
      <form
        className="kw-compose"
        onSubmit={(e) => {
          e.preventDefault();
          const t = draft.trim();
          if (!t) return;
          setMsgs((prev) => [...prev, { from: "yo", time: "Ahora", text: t }]);
          setDraft("");
          pushDemoToast({ tone: "ok", text: "Mensaje enviado al equipo (demo local)." });
        }}
      >
        <label className="kw-label" style={{ flex: 1 }}>
          <span className="kw-sr">Escribe un mensaje</span>
          <textarea
            className="kw-field"
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Escribe a tu equipo…"
          />
        </label>
        <KwButton variant="primary" type="submit">
          Enviar
        </KwButton>
      </form>
    </GlassPanel>
  );
}

export function InvoiceRequestForm({
  onSubmitted,
}: {
  onSubmitted?: (payload: { cliente: string; monto: string; concepto: string }) => void;
}) {
  const [sent, setSent] = useState(false);
  if (sent) {
    return (
      <GlassPanel padded={false} className="kw-form" as="section">
        <div className="kw-cls__done">
          <span className="kw-prop__state" style={{ color: "var(--positive-text)" }}>
            Solicitud enviada. La verás en el seguimiento con estatus «Solicitada».
          </span>
        </div>
        <KwButton
          variant="text"
          onClick={() => setSent(false)}
          style={{ marginTop: 8 }}
        >
          Pedir otra factura
        </KwButton>
      </GlassPanel>
    );
  }
  return (
    <GlassPanel padded={false} className="kw-form" as="section">
      <div>
        <h3 className="kw-title">Solicitar una factura</h3>
        <p className="kw-small" style={{ margin: "2px 0 0" }}>Tu equipo la emite y te avisa aquí cuando esté lista.</p>
      </div>
      <form
        className="grid"
        style={{ gap: 16 }}
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const payload = {
            cliente: String(fd.get("cliente") || ""),
            monto: String(fd.get("monto") || ""),
            concepto: String(fd.get("concepto") || ""),
          };
          onSubmitted?.(payload);
          pushDemoToast({ tone: "ok", text: "Solicitud de factura registrada en el demo (local)." });
          setSent(true);
          e.currentTarget.reset();
        }}
      >
        <div className="kw-form__row">
          <label className="kw-label">
            Cliente o razón social
            <input className="kw-field" required name="cliente" />
          </label>
          <label className="kw-label">
            Monto (MXN)
            <input className="kw-field" required name="monto" inputMode="decimal" />
          </label>
        </div>
        <label className="kw-label">
          Concepto
          <textarea className="kw-field" required name="concepto" rows={3} />
        </label>
        <KwButton variant="primary" type="submit">
          Enviar solicitud
        </KwButton>
      </form>
    </GlassPanel>
  );
}

export function UploadBox({
  onUploaded,
}: {
  onUploaded?: (files: { name: string; source: "foto" | "galeria" | "archivo" }[]) => void;
}) {
  const [over, setOver] = useState(false);
  const [files, setFiles] = useState<{ name: string; source: "foto" | "galeria" | "archivo" }[]>([]);
  const cam = useRef<HTMLInputElement>(null);
  const gal = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);

  const take = (list: FileList | null, source: "foto" | "galeria" | "archivo") => {
    const next = Array.from(list || []).map((f) => ({ name: f.name, source }));
    if (!next.length) return;
    const merged = [...next, ...files];
    setFiles(merged);
    onUploaded?.(next);
    pushDemoToast({
      tone: "ok",
      text:
        source === "foto"
          ? `Foto lista: ${next.map((f) => f.name).join(", ")}. Estatus: Solicitada → En proceso.`
          : `Recibo(s) agregados desde ${source === "galeria" ? "galería" : "archivo"}.`,
    });
  };

  return (
    <GlassPanel padded={false} className="kw-form" as="section">
      <div>
        <h3 className="kw-title">Subir recibos / tickets</h3>
        <p className="kw-small" style={{ margin: "2px 0 0" }}>
          Toma una foto, elige de la galería o sube un archivo. En el demo se guarda en este dispositivo.
        </p>
      </div>
      <input
        ref={cam}
        type="file"
        accept="image/*"
        capture="environment"
        className="kw-sr"
        onChange={(e) => {
          take(e.target.files, "foto");
          e.target.value = "";
        }}
      />
      <input
        ref={gal}
        type="file"
        accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif,application/pdf"
        multiple
        className="kw-sr"
        onChange={(e) => {
          take(e.target.files, "galeria");
          e.target.value = "";
        }}
      />
      <input
        ref={file}
        type="file"
        accept="image/jpeg,image/png,application/pdf,.pdf"
        multiple
        className="kw-sr"
        onChange={(e) => {
          take(e.target.files, "archivo");
          e.target.value = "";
        }}
      />
      <div className="kw-upload-actions">
        <KwButton variant="primary" onClick={() => cam.current?.click()}>
          Tomar foto
        </KwButton>
        <KwButton onClick={() => gal.current?.click()}>Galería</KwButton>
        <KwButton onClick={() => file.current?.click()}>Subir archivo</KwButton>
      </div>
      <div
        className={cx("kw-drop", over && "kw-drop--over")}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files, "archivo");
        }}
      >
        <p className="kw-title" style={{ fontSize: 16 }}>O arrastra archivos aquí</p>
        <p className="kw-small" style={{ margin: 0 }}>JPG, PNG, HEIC o PDF · demo local</p>
      </div>
      {files.length ? (
        <ul className="kw-small" style={{ margin: 0, paddingLeft: 18 }}>
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              {f.name} · vía {f.source}
            </li>
          ))}
        </ul>
      ) : null}
    </GlassPanel>
  );
}

function filterBucket(step: number): Exclude<RequestFilter, "todas"> {
  if (step <= 0) return "pendiente";
  if (step >= 2) return "hecha";
  return "en_proceso";
}

export function RequestTracker({
  items,
  title,
  subtitle,
  filter = "todas",
  onFilterChange,
}: {
  items: RequestItem[];
  title?: string;
  subtitle?: string;
  filter?: RequestFilter;
  onFilterChange?: (f: RequestFilter) => void;
}) {
  const stepsFor = (kind: RequestItem["kind"]) =>
    kind === "recibo" ? ["Subido", "En revisión", "Registrado"] : ["Solicitada", "En proceso", "Emitida"];
  const counts = {
    todas: items.length,
    pendiente: items.filter((i) => filterBucket(i.step) === "pendiente").length,
    en_proceso: items.filter((i) => filterBucket(i.step) === "en_proceso").length,
    hecha: items.filter((i) => filterBucket(i.step) === "hecha").length,
  };
  const visible = filter === "todas" ? items : items.filter((i) => filterBucket(i.step) === filter);
  const filters: { id: RequestFilter; label: string }[] = [
    { id: "todas", label: `Todas (${counts.todas})` },
    { id: "pendiente", label: `Pendientes (${counts.pendiente})` },
    { id: "en_proceso", label: `En proceso (${counts.en_proceso})` },
    { id: "hecha", label: `Hechas (${counts.hecha})` },
  ];
  return (
    <GlassPanel padded={false} className="kw-track" as="section">
      <div className="kw-chart__head">
        <div>
          <h3 className="kw-title">{title || "Cuáles ya se hicieron"}</h3>
          <p className="kw-small" style={{ margin: "2px 0 0" }}>
            {subtitle || "Facturas y recibos: pendiente · en proceso · hecha"}
          </p>
        </div>
      </div>
      {onFilterChange ? (
        <div className="kw-filter-row" style={{ padding: "0 16px 8px" }} role="group" aria-label="Filtrar por estatus">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              className="kw-filter-chip"
              aria-pressed={filter === f.id}
              onClick={() => onFilterChange(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      ) : null}
      <ul className="kw-track__list">
        {visible.length === 0 ? (
          <li className="kw-req">
            <p className="kw-small">No hay elementos en este filtro.</p>
          </li>
        ) : (
          visible.map((it, i) => {
            const steps = stepsFor(it.kind);
            const bucket = filterBucket(it.step);
            const bucketLabel = bucket === "pendiente" ? "Pendiente" : bucket === "en_proceso" ? "En proceso" : "Hecha";
            return (
              <li key={`${it.title}-${i}`} className="kw-req">
                <div className="kw-req__top">
                  <p className="kw-req__t">{it.title}</p>
                  <span className="kw-caption">
                    {it.kind === "recibo" ? "Recibo" : "Factura"} · {bucketLabel} · {it.date}
                  </span>
                </div>
                {it.detail ? <p className="kw-small">{it.detail}</p> : null}
                {it.folio ? <p className="kw-mono kw-small">Folio: {it.folio}</p> : null}
                <div className="kw-steps">
                  {steps.map((s, si) => (
                    <span key={s} className={cx("kw-step", si < it.step && "kw-step--done", si === it.step && "kw-step--now")}>
                      {s}
                    </span>
                  ))}
                </div>
              </li>
            );
          })
        )}
      </ul>
    </GlassPanel>
  );
}

export function SampleBanner() {
  return (
    <p className="kw-small" role="note" style={{ margin: 0 }}>
      Datos de ejemplo · sin validez fiscal
    </p>
  );
}

export function PageHead({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="kw-page-head">
      <div>
        <h1 className="kw-page-title">{title}</h1>
        {subtitle ? <p className="kw-page-sub">{subtitle}</p> : null}
        <SampleBanner />
      </div>
      {actions}
    </div>
  );
}
