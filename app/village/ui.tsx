// The robot-eye chrome of Approval Desk Village: header, stage frame, scene overlays,
// console rail, dialogue bar, device strip and the two pixel portraits.
// All of these are server components (no state, no browser APIs); pages compose them
// with their own content. Every display label is sentence case in the DOM and
// uppercased by village.css, so tests and screen readers read plain words.
import Link from "next/link";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { villageFontClass } from "./fonts.ts";
import "./village.css";

/* ---------- Places and stages ---------- */

export type PlaceId = "inbox" | "shop" | "agent" | "gate" | "human-desk" | "factory";
export type StageId = "agent" | "gate" | "human-desk" | "factory";

/** The pills in the header, in order. */
export const STAGES: ReadonlyArray<{ id: StageId; label: string }> = [
  { id: "agent", label: "Agent" },
  { id: "gate", label: "Gate" },
  { id: "human-desk", label: "Human desk" },
  { id: "factory", label: "Factory" },
];

// The scene photo is laid out at 1083×682 (the stage's 688 minus its 3px borders);
// overlays are placed in percentages of it so they scale with the scene.
const SCENE_W = 1083;
const SCENE_H = 682;
const pct = (n: number, of: number) => `${((n / of) * 100).toFixed(3)}%`;
/** Style that puts an overlay at (left, top) of the 1083×688 scene, so it scales with it. */
export const scenePos = (left: number, top: number): CSSProperties => ({ left: pct(left, SCENE_W), top: pct(top, SCENE_H) });

type MapPoint = { left: number; top: number };
export const PLACES: Record<
  PlaceId,
  {
    label: string;
    /** "You are at the <caption>" on the mini-map. */
    caption: string;
    /** Top-left of the place sign in the scene; width is only set for wide signs. */
    marker: MapPoint & { width?: number };
    /** Where the targeting reticle sits when this is the current place. */
    reticle: MapPoint;
    /** Where the mini-map shows you when this is the current place. */
    map: { halo: MapPoint; arrow: MapPoint };
  }
> = {
  inbox: {
    label: "Inbox",
    caption: "the inbox",
    marker: { left: 482, top: 415 },
    reticle: { left: 505, top: 460 },
    map: { halo: { left: 16, top: 7 }, arrow: { left: 23, top: 12 } },
  },
  shop: {
    label: "Shop",
    caption: "the shop",
    marker: { left: 371, top: 155, width: 145 },
    reticle: { left: 401, top: 200 },
    map: { halo: { left: 66, top: 10 }, arrow: { left: 73, top: 15 } },
  },
  agent: {
    label: "Agent",
    caption: "the agent office",
    marker: { left: 44, top: 342 },
    reticle: { left: 60, top: 387 },
    map: { halo: { left: 15, top: 75 }, arrow: { left: 22, top: 80 } },
  },
  gate: {
    label: "Gate",
    caption: "the gate",
    marker: { left: 701, top: 255 },
    reticle: { left: 727, top: 300 },
    map: { halo: { left: 102, top: 47 }, arrow: { left: 109, top: 52 } },
  },
  "human-desk": {
    label: "Human desk",
    caption: "the human desk",
    marker: { left: 914, top: 369 },
    reticle: { left: 929, top: 410 },
    map: { halo: { left: 63, top: 81 }, arrow: { left: 70, top: 86 } },
  },
  factory: {
    label: "Factory",
    caption: "the factory",
    marker: { left: 949, top: 189 },
    reticle: { left: 975, top: 234 },
    map: { halo: { left: 141, top: 75 }, arrow: { left: 148, top: 80 } },
  },
};
const PLACE_ORDER: PlaceId[] = ["inbox", "shop", "agent", "gate", "human-desk", "factory"];

/* ---------- Icons (the SVGs in public/village/icons, at their own size) ---------- */

const ICONS = {
  "map-pin": [25, 25],
  "user-round": [21, 21],
  "lock-keyhole": [15, 15],
  "stage-marker": [7, 7],
  "stage-marker-active": [7, 7],
  "optic-light": [6, 6],
  "status-light": [8, 8],
  "connection-light": [7, 7],
  "destination-halo": [27, 27],
  "robot-position": [14, 17],
} as const;
type IconName = keyof typeof ICONS;

export function Icon({ name, className, style }: { name: IconName; className?: string; style?: CSSProperties }) {
  const [w, h] = ICONS[name];
  return (
    // Plain <img>: these are tiny static SVGs served from /public, nothing to optimize.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/village/icons/${name}.svg`} width={w} height={h} alt="" aria-hidden="true" className={`v-icon ${className ?? ""}`} style={style} />
  );
}

/* ---------- Page root and header ---------- */

export type Shortcut = { keyCap: string; label: string; count?: string; href: string };

/** The page root: fonts, the dark background, the 24px column, and the header. */
export function VillageShell({
  chapter,
  activeStage,
  shortcut,
  children,
}: {
  chapter: string;
  activeStage: StageId;
  shortcut: Shortcut;
  children: ReactNode;
}) {
  return (
    <main className={`village-ui ${villageFontClass}`}>
      <VillageHeader chapter={chapter} activeStage={activeStage} shortcut={shortcut} />
      {children}
    </main>
  );
}

export function VillageHeader({ chapter, activeStage, shortcut }: { chapter: string; activeStage: StageId; shortcut: Shortcut }) {
  return (
    <header className="v-header">
      <div className="v-identity">
        <div className="v-emblem" aria-hidden="true">
          <RobotPortrait />
        </div>
        <div className="v-title-block">
          <h1 className="v-title">Approval Desk Village</h1>
          <p className="v-chapter v-mono">
            <span className="v-chapter-dot" aria-hidden="true" />
            <span>
              Field adventure
              <span className="v-chapter-sep" aria-hidden="true">
                /
              </span>
              {chapter}
            </span>
          </p>
        </div>
      </div>
      <StagePills active={activeStage} />
      <Link href={shortcut.href} className="v-shortcut" aria-keyshortcuts={shortcut.keyCap} data-key={shortcut.keyCap.toLowerCase()}>
        <ControlKey variant="dark">{shortcut.keyCap}</ControlKey>
        <span className="v-shortcut-label">{shortcut.label}</span>
        {shortcut.count !== undefined && <span className="v-shortcut-count v-mono">{shortcut.count}</span>}
      </Link>
    </header>
  );
}

/** Agent · Gate · Human desk · Factory. A stage with an href renders as a link. */
export function StagePills({ active, stages = STAGES }: { active: StageId; stages?: ReadonlyArray<{ id: StageId; label: string; href?: string }> }) {
  return (
    <nav aria-label="Stages" className="v-pills-nav">
      <ol className="v-pills">
        {stages.map((s) => {
          const isActive = s.id === active;
          const inner = (
            <>
              <Icon name={isActive ? "stage-marker-active" : "stage-marker"} />
              <span>{s.label}</span>
            </>
          );
          const cls = `v-pill${isActive ? " v-pill--active" : ""}`;
          return (
            <li key={s.id} className={s.href ? undefined : cls} aria-current={isActive && !s.href ? "step" : undefined} style={s.href ? { display: "contents" } : undefined}>
              {s.href ? (
                <Link href={s.href} className={cls} aria-current={isActive ? "step" : undefined}>
                  {inner}
                </Link>
              ) : (
                inner
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** A key cap. Dark on the dark chrome, light on cream surfaces. */
export function ControlKey({ variant, children }: { variant: "dark" | "light"; children: ReactNode }) {
  return <kbd className={`v-key v-key--${variant}`}>{children}</kbd>;
}

/* ---------- Stage: scene + console rail ---------- */

export function Stage({ children, label = "Stage" }: { children: ReactNode; label?: string }) {
  return (
    <section className="v-stage" aria-label={label}>
      {children}
    </section>
  );
}

/** The first-person view with its standard overlays. Children are extra overlays (for example an IdentityChip). */
export function Scene({
  placeName,
  placeNumber,
  currentPlace,
  image,
  imagePosition,
  children,
}: {
  placeName: string;
  /** Two digits, like "03". */
  placeNumber: string;
  currentPlace: PlaceId;
  /** Another background photo, if one day there is one; defaults to the gate plaza. */
  image?: string;
  /** Which part of the photo to show when it is wider than the scene (CSS background-position). */
  imagePosition?: string;
  children?: ReactNode;
}) {
  const style: CSSProperties = {};
  if (image) style.backgroundImage = `url("${image}")`;
  if (imagePosition) style.backgroundPosition = imagePosition;
  return (
    <div className="v-scene" style={style}>
      <LocationPlaque placeName={placeName} placeNumber={placeNumber} />
      <VisionChip />
      <PlaceMarkers current={currentPlace} />
      <Reticle current={currentPlace} />
      <MiniMap current={currentPlace} />
      {children}
    </div>
  );
}

export function LocationPlaque({ placeName, placeNumber }: { placeName: string; placeNumber: string }) {
  return (
    <div className="v-plaque" style={scenePos(21, 21)}>
      <Icon name="map-pin" />
      <div>
        <div className="v-plaque-name">{placeName}</div>
        <div className="v-plaque-sub v-mono">Approval Desk Village · {placeNumber}</div>
      </div>
    </div>
  );
}

export function VisionChip({ label = "Robot-eye / live" }: { label?: string }) {
  return (
    <div className="v-vision v-mono" style={scenePos(609, 21)}>
      <Icon name="optic-light" className="v-blink-slow" />
      <span>{label}</span>
    </div>
  );
}

/** Every place sign in the scene; the current one is gold. */
export function PlaceMarkers({ current }: { current: PlaceId }) {
  return (
    <>
      {PLACE_ORDER.map((id) => {
        const p = PLACES[id];
        return (
          <div key={id} className={`v-marker${id === current ? " v-marker--current" : ""}`} style={scenePos(p.marker.left, p.marker.top)}>
            <span className="v-marker-sign" style={p.marker.width ? { width: p.marker.width } : undefined}>
              {p.label}
            </span>
            <span className="v-marker-stem" />
          </div>
        );
      })}
    </>
  );
}

/** The targeting frame around the current place. */
export function Reticle({ current, position }: { current: PlaceId; position?: MapPoint }) {
  const at = position ?? PLACES[current].reticle;
  return <div className="v-reticle" style={scenePos(at.left, at.top)} aria-hidden="true" />;
}

export function MiniMap({ current }: { current: PlaceId }) {
  const here = PLACES[current].map;
  const box = (left: number, top: number, width: number, height: number | string): CSSProperties => ({ left, top, width, height });
  return (
    <div className="v-minimap" style={scenePos(21, 461)}>
      <div className="v-minimap-head">
        <span>Village map</span>
        <span className="v-minimap-north">N ↑</span>
      </div>
      <div className="v-minimap-plan" aria-hidden="true">
        <span className="v-map-road" style={box(88, 0, 22, "100%")} />
        <span className="v-map-road" style={{ left: 0, top: 53, width: "100%", height: 17 }} />
        <span className="v-map-building" style={{ ...box(13, 9, 34, 24), background: "var(--v-map-inbox)" }} />
        <span className="v-map-building" style={{ ...box(55, 7, 49, 33), background: "var(--v-map-shop)" }} />
        <span className="v-map-building" style={{ ...box(12, 76, 33, 26), background: "var(--v-map-agent)" }} />
        <span className="v-map-building" style={{ ...box(61, 82, 30, 24), background: "var(--v-map-desk)" }} />
        <span className="v-map-building" style={{ ...box(136, 71, 37, 35), background: "var(--v-map-factory)" }} />
        <span className="v-map-crossing" style={box(115, 42, 9, 35)} />
        <Icon name="destination-halo" style={{ position: "absolute", left: here.halo.left, top: here.halo.top }} />
        <Icon name="robot-position" style={{ position: "absolute", left: here.arrow.left, top: here.arrow.top }} />
      </div>
      <div className="v-minimap-caption v-mono">You are at {PLACES[current].caption}</div>
    </div>
  );
}

/** The chip at the bottom of the scene saying who you are facing. */
export function IdentityChip({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="v-identity-chip" style={{ ...scenePos(608, 571), ...style }}>
      <Icon name="status-light" className="v-blink-slow" />
      <span>{children}</span>
    </div>
  );
}

export function ConsoleRail({ children, label = "Console" }: { children: ReactNode; label?: string }) {
  return (
    <aside className="v-rail" aria-label={label}>
      {children}
    </aside>
  );
}

/* ---------- Console contents ---------- */

export function EncounterIndicator({ symbol = "!", children }: { symbol?: string; children: ReactNode }) {
  return (
    <div className="v-indicator">
      <span aria-hidden="true">{symbol}</span>
      <span>{children}</span>
    </div>
  );
}

/** The dark frame with the cream display inside. Compose: PanelHeader, then PanelBody. */
export function EncounterPanel({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <section className="v-panel" aria-label={label}>
      <div className="v-panel-display">{children}</div>
    </section>
  );
}

export function PanelHeader({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <header className="v-panel-head">
      <h2 className="v-panel-title">{title}</h2>
      {aside !== undefined && <span className="v-panel-aside v-mono">{aside}</span>}
    </header>
  );
}

export function PanelBody({ children }: { children: ReactNode }) {
  return <div className="v-panel-body">{children}</div>;
}

/** The heading row at the top of a panel body: a title and, usually, a Badge. */
export function PanelHeading({ children, badge }: { children: ReactNode; badge?: ReactNode }) {
  return (
    <div className="v-heading-row">
      <h3 className="v-heading">{children}</h3>
      {badge}
    </div>
  );
}

export function Badge({ tone, children }: { tone: "red" | "blue"; children: ReactNode }) {
  return <span className={`v-badge v-mono v-badge--${tone}`}>{children}</span>;
}

export function AmountBlock({ label, amount, tone = "ink" }: { label: string; amount: string; tone?: "red" | "ink" }) {
  return (
    <div className={`v-amount v-amount--${tone}`}>
      <div className="v-amount-label v-mono">{label}</div>
      <div className="v-amount-value">{amount}</div>
    </div>
  );
}

export function Divider() {
  return <hr className="v-divider" />;
}

/** One rule, in plain words: red blocks, blue sends to a human. */
export function RuleRow({ tone, symbol, title, sub }: { tone: "red" | "blue"; symbol: string; title: string; sub: string }) {
  return (
    <div className={`v-rule v-rule--${tone}`}>
      <span className="v-rule-symbol" aria-hidden="true">
        {symbol}
      </span>
      <div>
        <div className="v-rule-title">{title}</div>
        <div className="v-rule-sub v-mono">{sub}</div>
      </div>
    </div>
  );
}

export function StatusRow({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="v-status">
      <Icon name="user-round" />
      <div>
        <div className="v-status-title">{title}</div>
        <div className="v-status-sub v-mono">{sub}</div>
      </div>
    </div>
  );
}

export function LockStrip({ children }: { children: ReactNode }) {
  return (
    <div className="v-lock v-mono">
      <Icon name="lock-keyhole" />
      <span>{children}</span>
    </div>
  );
}

export function ClosingLine({ children }: { children: ReactNode }) {
  return <p className="v-closing">{children}</p>;
}

/* ---------- Dialogue bar ---------- */

export function DialogueBar({
  portrait,
  speakerName,
  speakerLabel,
  subLabel,
  headline,
  body,
  actions,
}: {
  /** A RobotPortrait or HumanPortrait. */
  portrait: ReactNode;
  speakerName: string;
  speakerLabel: string;
  subLabel: string;
  headline: ReactNode;
  body: ReactNode;
  /** DialogueAction elements, primary first. */
  actions: ReactNode;
}) {
  return (
    <section className="v-dialogue" aria-label="Dialogue">
      <div className="v-dialogue-inner">
        <div className="v-speaker">
          {portrait}
          <span className="v-speaker-name">{speakerName}</span>
        </div>
        <div className="v-dialogue-content">
          <div className="v-speaker-row v-mono">
            <span className="v-speaker-label">{speakerLabel}</span>
            <span className="v-speaker-sep" aria-hidden="true" />
            <span className="v-speaker-sub">{subLabel}</span>
          </div>
          <h2 className="v-headline">{headline}</h2>
          <p className="v-body">{body}</p>
        </div>
        <div className="v-actions">{actions}</div>
      </div>
    </section>
  );
}

type DialogueActionProps = {
  variant: "primary" | "secondary";
  /** The key that triggers it, shown as a key cap. */
  keyCap: string;
  label: string;
  /** With an href the action is a link; without one it is a button (pass type/name/value for forms). */
  href?: string;
  /** The trailing arrow; on by default for the primary action. */
  arrow?: boolean;
} & Pick<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "name" | "value" | "disabled" | "formAction">;

export function DialogueAction({ variant, keyCap, label, href, arrow = variant === "primary", ...buttonProps }: DialogueActionProps) {
  const cls = `v-action v-action--${variant}`;
  const inner = (
    <>
      <ControlKey variant="light">{keyCap}</ControlKey>
      <span>{label}</span>
      {arrow && (
        <span className="v-action-arrow" aria-hidden="true">
          →
        </span>
      )}
    </>
  );
  const shortcut = { "aria-keyshortcuts": keyCap, "data-key": keyCap.toLowerCase() };
  if (href !== undefined) {
    return (
      <Link href={href} className={cls} {...shortcut}>
        {inner}
      </Link>
    );
  }
  return (
    <button {...buttonProps} type={buttonProps.type ?? "button"} className={cls} {...shortcut}>
      {inner}
    </button>
  );
}

/* ---------- Device strip ---------- */

export function DeviceStrip({
  left = "Field link active",
  motto = "Agent suggests. Gate decides. Factory pays.",
  right,
}: {
  left?: ReactNode;
  motto?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <footer className="v-device v-mono">
      <div className="v-device-left">
        <Icon name="connection-light" />
        <span>{left}</span>
      </div>
      <div className="v-motto">{motto}</div>
      <div className="v-device-right">
        {right ?? (
          <>
            <span>Start</span>
            <span>Menu</span>
            <span aria-hidden="true">♪</span>
            <span>Sound on</span>
          </>
        )}
      </div>
    </footer>
  );
}

/* ---------- Pixel portraits: 56×56, positioned divs ---------- */

function Px({ x, y, w, h, color, className }: { x: number; y: number; w: number; h: number; color: string; className?: string }) {
  return <span className={`v-px ${className ?? ""}`} style={{ left: x, top: y, width: w, height: h, background: `var(--v-${color})` }} />;
}

/** The rule keeper: the robot from the design brief. Its eyes blink now and then. */
export function RobotPortrait() {
  return (
    <span className="v-portrait" role="img" aria-label="Robot">
      <Px x={26} y={1} w={4} h={8} color="cream" />
      <Px x={24} y={0} w={8} h={4} color="gold" />
      <Px x={6} y={10} w={44} h={36} color="ink" />
      <Px x={10} y={10} w={36} h={32} color="cream" />
      <Px x={14} y={18} w={28} h={16} color="deep" />
      <Px x={18} y={22} w={5} h={7} color="teal" className="v-robot-eye" />
      <Px x={33} y={22} w={5} h={7} color="teal" className="v-robot-eye" />
      <Px x={2} y={21} w={8} h={14} color="gold" />
      <Px x={46} y={21} w={8} h={14} color="gold" />
      <Px x={22} y={44} w={12} h={5} color="steel-light" />
      <Px x={12} y={49} w={32} h={7} color="blue" />
    </span>
  );
}

/** The desk keeper: a person behind a desk, in the same palette. */
export function HumanPortrait() {
  return (
    <span className="v-portrait" role="img" aria-label="Person at a desk">
      {/* hair */}
      <Px x={15} y={4} w={26} h={10} color="ink" />
      <Px x={13} y={10} w={4} h={12} color="ink" />
      <Px x={39} y={10} w={4} h={12} color="ink" />
      {/* face */}
      <Px x={17} y={12} w={22} h={18} color="gold-light" />
      <Px x={21} y={18} w={4} h={5} color="ink" />
      <Px x={31} y={18} w={4} h={5} color="ink" />
      <Px x={25} y={26} w={6} h={2} color="red" />
      {/* neck and shirt with a collar */}
      <Px x={24} y={30} w={8} h={4} color="gold-light" />
      <Px x={10} y={34} w={36} h={10} color="blue" />
      <Px x={22} y={34} w={4} h={4} color="cream" />
      <Px x={30} y={34} w={4} h={4} color="cream" />
      <Px x={26} y={34} w={4} h={6} color="cream" />
      {/* badge */}
      <Px x={36} y={37} w={7} h={7} color="ink" />
      <Px x={37} y={38} w={5} h={5} color="gold" />
      {/* desk, with a sheet of paper */}
      <Px x={4} y={44} w={48} h={8} color="map-inbox" />
      <Px x={4} y={44} w={48} h={2} color="ink" />
      <Px x={9} y={47} w={11} h={4} color="white" />
      <Px x={4} y={52} w={6} h={4} color="ink" />
      <Px x={46} y={52} w={6} h={4} color="ink" />
    </span>
  );
}
