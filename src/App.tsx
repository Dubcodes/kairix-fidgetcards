import { animate, motion, useAnimationControls, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import { Eye, EyeOff, Maximize2, Minimize2, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

type CardColor = {
  hue: number;
  saturation: number;
  lightness: number;
};

type Card = {
  id: number;
  color: CardColor;
};

type TextureKind = "none" | "dots" | "grid" | "waves" | "stars" | "checker";
type FinishKind = "none" | "gloss" | "neon" | "foil";

type CardVisuals = {
  isGradient: boolean;
  lineCount: number;
  randomLineColor: boolean;
  patternLevel: number;
  textureKind: TextureKind;
  finishKind: FinishKind;
};

type FlyingCard = Card &
  CardVisuals & {
    flightId: number;
    startX: number;
    startY: number;
    startRotate: number;
    targetX: number;
    targetY: number;
    targetRotate: number;
    duration: number;
  };

type Particle = {
  id: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  hue: number;
  size: number;
  duration: number;
};

type Point = {
  x: number;
  y: number;
};

type EdgePoint = Point & {
  edge: number;
};

type StarPoint = Point & {
  radius: number;
  rotate: number;
};

type TextureShape =
  | ({ type: "dot" } & Point & { radius: number })
  | ({ type: "gridLine" } & { x1: number; y1: number; x2: number; y2: number })
  | ({ type: "wave" } & { d: string })
  | ({ type: "star" } & StarPoint)
  | ({ type: "check" } & Point & { width: number; height: number });

type TextureSpec = {
  shapes: TextureShape[];
  stroke: string;
  fill: string;
};

const CARD_COUNT = 4;
const MIN_HUE_DISTANCE = 36;
const GRADIENT_UNLOCK_COUNT = 15;
const ONE_LINE_UNLOCK_COUNT = 30;
const TWO_LINE_UNLOCK_COUNT = 50;
const THREE_LINE_UNLOCK_COUNT = 70;
const FOUR_LINE_UNLOCK_COUNT = 90;
const RANDOM_STYLE_UNLOCK_COUNT = 100;
const DOTS_UNLOCK_COUNT = 110;
const WAVES_UNLOCK_COUNT = 125;
const RARE_FINISH_UNLOCK_COUNT = 130;
const GRID_UNLOCK_COUNT = 145;
const STARS_UNLOCK_COUNT = 165;
const CHECKER_UNLOCK_COUNT = 185;
const FOIL_UNLOCK_COUNT = 200;
const THROW_VELOCITY = 650;
const THROW_OFFSET = 130;
const KEYBOARD_THROW_VELOCITY = 980;
const COMBO_WINDOW_MS = 850;

function randomBetween(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function hueDistance(a: number, b: number) {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}

function createColor(previous?: CardColor): CardColor {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const color = {
      hue: randomBetween(0, 359),
      saturation: randomBetween(62, 78),
      lightness: randomBetween(56, 70),
    };

    if (!previous || hueDistance(color.hue, previous.hue) >= MIN_HUE_DISTANCE) {
      return color;
    }
  }

  return {
    hue: previous ? (previous.hue + 137) % 360 : randomBetween(0, 359),
    saturation: randomBetween(62, 78),
    lightness: randomBetween(58, 68),
  };
}

function colorToCss(color: CardColor, lightnessOffset = 0, saturationOffset = 0) {
  return `hsl(${color.hue} ${Math.max(0, color.saturation + saturationOffset)}% ${Math.max(
    0,
    Math.min(100, color.lightness + lightnessOffset),
  )}%)`;
}

function cardBackground(card: Card, isGradient: boolean) {
  const color = card.color;

  if (!isGradient) {
    return colorToCss(color);
  }

  const seed = card.id * 409;
  const variant = seededInteger(seed + 1, 0, 3);
  const angle = seededBetween(seed + 2, 18, 162).toFixed(1);
  const glowX = seededBetween(seed + 3, 18, 82).toFixed(1);
  const glowY = seededBetween(seed + 4, 16, 84).toFixed(1);
  const secondGlowX = seededBetween(seed + 5, 12, 88).toFixed(1);
  const secondGlowY = seededBetween(seed + 6, 12, 88).toFixed(1);
  const accent = { ...color, hue: (color.hue + seededBetween(seed + 7, 42, 96)) % 360 };
  const warm = { ...color, hue: (color.hue + seededBetween(seed + 8, 118, 172)) % 360 };
  const cool = { ...color, hue: (color.hue + seededBetween(seed + 9, 196, 248)) % 360 };

  if (variant === 0) {
    return `radial-gradient(circle at ${glowX}% ${glowY}%, ${colorToCss(warm, 16, 4)} 0%, transparent 36%),
      linear-gradient(${angle}deg, ${colorToCss(color, 10, 6)} 0%, ${colorToCss(accent, 4, 10)} 52%, ${colorToCss(
        color,
        -8,
        2,
      )} 100%)`;
  }

  if (variant === 1) {
    return `radial-gradient(ellipse at ${glowX}% ${glowY}%, ${colorToCss(accent, 18, 6)} 0%, transparent 42%),
      radial-gradient(circle at ${secondGlowX}% ${secondGlowY}%, ${colorToCss(cool, 12, 2)} 0%, transparent 34%),
      linear-gradient(${angle}deg, ${colorToCss(color, 8, 6)} 0%, ${colorToCss(warm, -4, 8)} 100%)`;
  }

  if (variant === 2) {
    return `linear-gradient(${angle}deg, ${colorToCss(color, 14, 4)} 0%, transparent 58%),
      radial-gradient(circle at ${secondGlowX}% ${secondGlowY}%, ${colorToCss(warm, 10, 8)} 0%, transparent 38%),
      linear-gradient(${Number(angle) + 76}deg, ${colorToCss(cool, -2, 10)} 0%, ${colorToCss(accent, 6, 6)} 100%)`;
  }

  return `conic-gradient(from ${angle}deg at ${glowX}% ${glowY}%, ${colorToCss(color, 8, 8)}, ${colorToCss(
    accent,
    2,
    10,
  )}, ${colorToCss(warm, 10, 4)}, ${colorToCss(cool, -4, 8)}, ${colorToCss(color, 8, 8)})`;
}

function seededNumber(seed: number) {
  const value = Math.sin(seed * 9301 + 49297) * 233280;
  return value - Math.floor(value);
}

function seededBetween(seed: number, min: number, max: number) {
  return min + seededNumber(seed) * (max - min);
}

function seededInteger(seed: number, min: number, max: number) {
  return Math.floor(seededBetween(seed, min, max + 1));
}

function getLineCount(count: number, cardId: number) {
  if (count >= RANDOM_STYLE_UNLOCK_COUNT) {
    return seededInteger(cardId * 71 + 19, 0, 5);
  }

  if (count >= FOUR_LINE_UNLOCK_COUNT) {
    return 4;
  }

  if (count >= THREE_LINE_UNLOCK_COUNT) {
    return 3;
  }

  if (count >= TWO_LINE_UNLOCK_COUNT) {
    return 2;
  }

  if (count >= ONE_LINE_UNLOCK_COUNT) {
    return 1;
  }

  return 0;
}

function getPatternLevel(count: number, cardId: number) {
  if (count >= RANDOM_STYLE_UNLOCK_COUNT) {
    return seededInteger(cardId * 97 + 23, 1, 4);
  }

  if (count >= FOUR_LINE_UNLOCK_COUNT) {
    return 4;
  }

  if (count >= THREE_LINE_UNLOCK_COUNT) {
    return 3;
  }

  if (count >= TWO_LINE_UNLOCK_COUNT) {
    return 2;
  }

  if (count >= ONE_LINE_UNLOCK_COUNT) {
    return 1;
  }

  return 0;
}

function isGradientEnabled(count: number, cardId: number) {
  if (count >= RANDOM_STYLE_UNLOCK_COUNT) {
    return seededNumber(cardId * 53 + 31) > 0.5;
  }

  return count >= GRADIENT_UNLOCK_COUNT;
}

function getTextureKind(count: number, cardId: number): TextureKind {
  if (count < DOTS_UNLOCK_COUNT) {
    return "none";
  }

  const available: TextureKind[] = ["dots"];
  let chance = 0.2;

  if (count >= WAVES_UNLOCK_COUNT) {
    available.push("waves");
    chance = 0.28;
  }

  if (count >= GRID_UNLOCK_COUNT) {
    available.push("grid");
    chance = 0.34;
  }

  if (count >= STARS_UNLOCK_COUNT) {
    available.push("stars");
    chance = 0.42;
  }

  if (count >= CHECKER_UNLOCK_COUNT) {
    available.push("checker");
    chance = 0.5;
  }

  if (seededNumber(cardId * 131 + count * 7) > chance) {
    return "none";
  }

  return available[seededInteger(cardId * 173 + count, 0, available.length - 1)];
}

function getFinishKind(count: number, cardId: number): FinishKind {
  if (count < RARE_FINISH_UNLOCK_COUNT) {
    return "none";
  }

  const available: FinishKind[] = ["gloss"];
  let chance = 0.08;

  if (count >= STARS_UNLOCK_COUNT) {
    available.push("neon");
    chance = 0.11;
  }

  if (count >= FOIL_UNLOCK_COUNT) {
    available.push("foil");
    chance = 0.15;
  }

  if (seededNumber(cardId * 181 + count * 11) > chance) {
    return "none";
  }

  return available[seededInteger(cardId * 199 + count, 0, available.length - 1)];
}

function getVisuals(card: Card, count: number): CardVisuals {
  return {
    isGradient: isGradientEnabled(count, card.id),
    lineCount: getLineCount(count, card.id),
    patternLevel: getPatternLevel(count, card.id),
    randomLineColor: count >= RANDOM_STYLE_UNLOCK_COUNT,
    textureKind: getTextureKind(count, card.id),
    finishKind: getFinishKind(count, card.id),
  };
}

function edgePoint(seed: number, preferredEdge?: number): EdgePoint {
  const edge = preferredEdge ?? seededInteger(seed, 0, 3);
  const position = seededBetween(seed + 17, 0, 1);

  if (edge === 0) {
    return { edge, x: position * 100, y: 0 };
  }

  if (edge === 1) {
    return { edge, x: 100, y: position * 140 };
  }

  if (edge === 2) {
    return { edge, x: position * 100, y: 140 };
  }

  return { edge, x: 0, y: position * 140 };
}

function smoothPoint(start: Point, end: Point, t: number, offset: number): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const normalX = -dy / length;
  const normalY = dx / length;

  return {
    x: start.x + dx * t + normalX * offset,
    y: start.y + dy * t + normalY * offset,
  };
}

function linePath(cardId: number, lineIndex: number, patternLevel: number) {
  const seed = cardId * 211 + lineIndex * 997;
  const baseEdge = patternLevel >= 4 && lineIndex % 2 === 1 ? 0 : 3;
  const start = edgePoint(seed + 1, baseEdge);
  const endEdge = patternLevel >= 4 && lineIndex % 2 === 1 ? 2 : 1;
  const end = edgePoint(seed + 3, endEdge);
  const wave = seededBetween(seed + 4, -18, 18);
  const laneOffset = (lineIndex - 1.5) * (patternLevel >= 3 ? 7 : 9);

  if (patternLevel <= 1) {
    const c1 = smoothPoint(start, end, 0.32, wave);
    const c2 = smoothPoint(start, end, 0.68, -wave * 0.85);

    return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(
      1,
    )} ${c2.y.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
  }

  const c1 = smoothPoint(start, end, 0.2, wave + laneOffset);
  const c2 = smoothPoint(start, end, 0.36, wave * 0.35 + laneOffset);
  const mid = smoothPoint(start, end, 0.5, -wave * 0.65 + laneOffset);
  const c3 = smoothPoint(start, end, 0.64, -wave + laneOffset);
  const c4 = smoothPoint(start, end, 0.82, -wave * 0.4 + laneOffset);

  return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(
    1,
  )} ${c2.y.toFixed(1)}, ${mid.x.toFixed(1)} ${mid.y.toFixed(1)} C ${c3.x.toFixed(1)} ${c3.y.toFixed(
    1,
  )}, ${c4.x.toFixed(1)} ${c4.y.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
}

function lineStroke(color: CardColor, cardId: number, lineIndex: number, randomLineColor: boolean) {
  if (!randomLineColor) {
    return "hsl(0 0% 5% / 0.68)";
  }

  const hue = (color.hue + 130 + lineIndex * 47 + Math.round(seededBetween(cardId + lineIndex, -18, 18))) % 360;
  const lightness = seededBetween(cardId * 13 + lineIndex, 42, 88);

  return `hsl(${hue} 88% ${lightness.toFixed(1)}% / 0.9)`;
}

function lineWidth(cardId: number, lineIndex: number, randomLineColor: boolean) {
  const min = randomLineColor ? 1.25 : 1.15;
  const max = randomLineColor ? 2.25 : 2.05;

  return seededBetween(cardId * 29 + lineIndex, min, max).toFixed(1);
}

function texturePaint(color: CardColor, cardId: number) {
  const brightInk = seededNumber(cardId * 41) > 0.58;
  const hue = (color.hue + seededBetween(cardId * 47, 120, 230)) % 360;

  if (brightInk) {
    return {
      stroke: `hsl(${hue} 84% 94% / 0.34)`,
      fill: `hsl(${hue} 84% 94% / 0.22)`,
    };
  }

  return {
    stroke: "hsl(0 0% 4% / 0.22)",
    fill: "hsl(0 0% 4% / 0.14)",
  };
}

function wavePath(seed: number, row: number) {
  const y = 22 + row * 24 + seededBetween(seed + row, -5, 5);
  const bend = seededBetween(seed + row * 5, -9, 9);

  return `M 0 ${y.toFixed(1)} C 22 ${(y + bend).toFixed(1)}, 28 ${(y - bend).toFixed(1)}, 50 ${y.toFixed(
    1,
  )} S 78 ${(y + bend).toFixed(1)}, 100 ${y.toFixed(1)}`;
}

function starPath(star: StarPoint) {
  const points = Array.from({ length: 8 }, (_, index) => {
    const radius = index % 2 === 0 ? star.radius : star.radius * 0.42;
    const angle = star.rotate + (Math.PI * 2 * index) / 8;
    return `${(star.x + Math.cos(angle) * radius).toFixed(1)},${(star.y + Math.sin(angle) * radius).toFixed(1)}`;
  });

  return points.join(" ");
}

function getTextureSpec(card: Card, kind: TextureKind): TextureSpec | null {
  if (kind === "none") {
    return null;
  }

  const seed = card.id * 307;
  const paint = texturePaint(card.color, card.id);

  if (kind === "dots") {
    return {
      ...paint,
      shapes: Array.from({ length: 22 }, (_, index) => ({
        type: "dot",
        x: seededBetween(seed + index * 3, 7, 93),
        y: seededBetween(seed + index * 3 + 1, 8, 132),
        radius: seededBetween(seed + index * 3 + 2, 0.65, 1.8),
      })),
    };
  }

  if (kind === "grid") {
    const spacing = seededBetween(seed + 1, 13, 18);
    const vertical = Array.from({ length: 7 }, (_, index) => {
      const x = index * spacing - 2 + seededBetween(seed + index, -1.4, 1.4);
      return { type: "gridLine" as const, x1: x, y1: 0, x2: x + seededBetween(seed + index + 20, -7, 7), y2: 140 };
    });
    const horizontal = Array.from({ length: 10 }, (_, index) => {
      const y = index * spacing - 2 + seededBetween(seed + index + 40, -1.4, 1.4);
      return { type: "gridLine" as const, x1: 0, y1: y, x2: 100, y2: y + seededBetween(seed + index + 60, -6, 6) };
    });

    return {
      ...paint,
      shapes: [...vertical, ...horizontal],
    };
  }

  if (kind === "waves") {
    return {
      ...paint,
      shapes: Array.from({ length: 5 }, (_, index) => ({ type: "wave", d: wavePath(seed, index) })),
    };
  }

  if (kind === "stars") {
    return {
      ...paint,
      shapes: Array.from({ length: 11 }, (_, index) => ({
        type: "star",
        x: seededBetween(seed + index * 4, 9, 91),
        y: seededBetween(seed + index * 4 + 1, 10, 130),
        radius: seededBetween(seed + index * 4 + 2, 1.8, 4.2),
        rotate: seededBetween(seed + index * 4 + 3, 0, Math.PI),
      })),
    };
  }

  const cell = seededInteger(seed + 1, 9, 13);
  const cols = Math.ceil(100 / cell) + 1;
  const rows = Math.ceil(140 / cell) + 1;

  return {
    ...paint,
    shapes: Array.from({ length: cols * rows }, (_, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      return {
        type: "check" as const,
        x: col * cell,
        y: row * cell,
        width: cell,
        height: cell,
      };
    }).filter((shape) => (Math.floor(shape.x / cell) + Math.floor(shape.y / cell) + card.id) % 2 === 0),
  };
}

function CardLines({
  card,
  lineCount,
  patternLevel,
  randomLineColor,
}: {
  card: Card;
  lineCount: number;
  patternLevel: number;
  randomLineColor: boolean;
}) {
  if (lineCount <= 0) {
    return null;
  }

  return (
    <svg className="cardLines" viewBox="0 0 100 140" aria-hidden="true" focusable="false">
      {Array.from({ length: lineCount }, (_, index) => (
        <path
          key={`${card.id}-${index}`}
          d={linePath(card.id, index, patternLevel)}
          fill="none"
          stroke={lineStroke(card.color, card.id, index, randomLineColor)}
          strokeLinecap="round"
          strokeWidth={lineWidth(card.id, index, randomLineColor)}
        />
      ))}
    </svg>
  );
}

function CardTexture({ card, kind }: { card: Card; kind: TextureKind }) {
  const spec = getTextureSpec(card, kind);

  if (!spec) {
    return null;
  }

  return (
    <svg className={`cardTexture texture-${kind}`} viewBox="0 0 100 140" aria-hidden="true" focusable="false">
      {spec.shapes.map((shape, index) => {
        if (shape.type === "dot") {
          return <circle key={index} cx={shape.x} cy={shape.y} r={shape.radius} fill={spec.fill} />;
        }

        if (shape.type === "gridLine") {
          return (
            <line
              key={index}
              x1={shape.x1}
              y1={shape.y1}
              x2={shape.x2}
              y2={shape.y2}
              stroke={spec.stroke}
              strokeWidth="0.8"
            />
          );
        }

        if (shape.type === "wave") {
          return <path key={index} d={shape.d} fill="none" stroke={spec.stroke} strokeWidth="1.05" />;
        }

        if (shape.type === "star") {
          return <polygon key={index} points={starPath(shape)} fill={spec.fill} stroke={spec.stroke} strokeWidth="0.45" />;
        }

        return <rect key={index} x={shape.x} y={shape.y} width={shape.width} height={shape.height} fill={spec.fill} />;
      })}
    </svg>
  );
}

function CardFinish({ card, kind }: { card: Card; kind: FinishKind }) {
  if (kind === "none") {
    return null;
  }

  return (
    <div
      className={`cardFinish finish-${kind}`}
      style={{ "--finish-hue": card.color.hue } as CSSProperties}
      aria-hidden="true"
    />
  );
}

function createInitialCards() {
  const cards: Card[] = [];
  for (let id = 0; id < CARD_COUNT; id += 1) {
    cards.push({
      id,
      color: createColor(cards[cards.length - 1]?.color),
    });
  }
  return cards;
}

function nextStack(cards: Card[]) {
  const bottomColor = cards[0]?.color;
  const nextId = Math.max(...cards.map((card) => card.id)) + 1;

  return [
    {
      id: nextId,
      color: createColor(bottomColor),
    },
    ...cards.slice(0, -1),
  ];
}

function vibrate() {
  if ("vibrate" in navigator) {
    navigator.vibrate(16);
  }
}

function getExitDistance(unitX: number, unitY: number, startX: number, startY: number) {
  const stage = document.querySelector<HTMLElement>(".stage");
  const stageRect = stage?.getBoundingClientRect();
  const viewportWidth = window.innerWidth || 1280;
  const viewportHeight = window.innerHeight || 720;
  const cardWidth = stageRect?.width ?? Math.min(viewportWidth * 0.76, 560);
  const cardHeight = stageRect?.height ?? Math.min(viewportHeight * 0.72, 720);
  const exitX =
    Math.abs(unitX) > 0.04 ? (viewportWidth / 2 + cardWidth / 2 + Math.abs(startX) + 180) / Math.abs(unitX) : Infinity;
  const exitY =
    Math.abs(unitY) > 0.04 ? (viewportHeight / 2 + cardHeight / 2 + Math.abs(startY) + 180) / Math.abs(unitY) : Infinity;

  return Math.min(exitX, exitY);
}

function createParticles(card: Card, startX: number, startY: number, nextId: number) {
  return Array.from({ length: 9 }, (_, index): Particle => {
    const seed = card.id * 389 + index * 29 + nextId;
    const angle = seededBetween(seed, 0, Math.PI * 2);
    const distance = seededBetween(seed + 1, 68, 150);

    return {
      id: nextId + index,
      x: startX,
      y: startY,
      targetX: startX + Math.cos(angle) * distance,
      targetY: startY + Math.sin(angle) * distance,
      hue: (card.color.hue + seededBetween(seed + 2, -28, 42) + 360) % 360,
      size: seededBetween(seed + 3, 4, 9),
      duration: seededBetween(seed + 4, 0.42, 0.78),
    };
  });
}

export default function App() {
  const [cards, setCards] = useState<Card[]>(createInitialCards);
  const [flyingCards, setFlyingCards] = useState<FlyingCard[]>([]);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [thrown, setThrown] = useState(0);
  const [combo, setCombo] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const flightId = useRef(0);
  const particleId = useRef(0);
  const lastThrowAt = useRef(0);
  const controls = useAnimationControls();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-320, 320], [-12, 12]);
  const topCard = cards[cards.length - 1];

  const theme = useMemo(
    () => ({
      background: `radial-gradient(circle at 20% 10%, ${colorToCss(topCard.color, 24, -38)}, transparent 30%),
        linear-gradient(135deg, ${colorToCss(topCard.color, 32, -44)} 0%, ${colorToCss(
          { ...topCard.color, hue: (topCard.color.hue + 34) % 360 },
          22,
          -36,
        )} 100%)`,
    }),
    [topCard.color],
  );

  useEffect(() => {
    controls.set({ rotate: 0, scale: 1, opacity: 1 });
    x.set(0);
    y.set(14);
    const rise = animate(y, 0, {
      type: "spring",
      stiffness: 360,
      damping: 32,
      mass: 0.75,
    });

    return () => rise.stop();
  }, [controls, topCard.id, x, y]);

  useEffect(() => {
    if (combo <= 1) {
      return undefined;
    }

    const timeout = window.setTimeout(() => setCombo(0), COMBO_WINDOW_MS + 220);
    return () => window.clearTimeout(timeout);
  }, [combo]);

  const completeThrow = useCallback(
    (directionX: number, directionY: number, velocity: number, spin: number, startX = 0, startY = 0) => {
      const magnitude = Math.max(1, Math.hypot(directionX, directionY));
      const unitX = directionX / magnitude;
      const unitY = directionY / magnitude;
      const speedBoost = Math.min(1.08, Math.max(1, velocity / 3600));
      const exitDistance = getExitDistance(unitX, unitY, startX, startY) * speedBoost;
      const targetX = unitX * exitDistance;
      const targetY = unitY * exitDistance;
      const duration = Math.max(1.7, Math.min(2.15, 2.2 - velocity / 11000));
      const startRotate = Math.max(-14, Math.min(14, startX / 26));
      const nextFlightId = flightId.current + 1;
      const flyingVisuals = getVisuals(topCard, thrown);
      const now = Date.now();
      const previousThrowAt = lastThrowAt.current;
      const nextParticleId = particleId.current + 10;
      flightId.current = nextFlightId;
      particleId.current = nextParticleId;
      lastThrowAt.current = now;

      setFlyingCards((value) => [
        ...value,
        {
          ...topCard,
          flightId: nextFlightId,
          isGradient: flyingVisuals.isGradient,
          lineCount: flyingVisuals.lineCount,
          randomLineColor: flyingVisuals.randomLineColor,
          patternLevel: flyingVisuals.patternLevel,
          textureKind: flyingVisuals.textureKind,
          finishKind: flyingVisuals.finishKind,
          startX,
          startY,
          startRotate,
          targetX,
          targetY,
          targetRotate: spin,
          duration,
        },
      ]);
      setParticles((value) => [...value.slice(-36), ...createParticles(topCard, startX, startY, nextParticleId)]);
      setCombo((value) => (now - previousThrowAt < COMBO_WINDOW_MS ? value + 1 : 1));
      setThrown((value) => value + 1);
      setCards((value) => nextStack(value));
      controls.set({ rotate: 0, scale: 1, opacity: 1 });
      x.set(0);
      y.set(14);
      vibrate();
    },
    [controls, thrown, topCard, x, y],
  );

  const snapBack = useCallback(async () => {
    await controls.start({
      x: 0,
      y: 0,
      rotate: 0,
      opacity: 1,
      transition: { type: "spring", stiffness: 420, damping: 30 },
    });
  }, [controls]);

  const throwFromInput = useCallback(
    async (velocityX: number, velocityY: number, offsetX = 0, offsetY = 0) => {
      const velocity = Math.hypot(velocityX, velocityY);
      const distance = Math.hypot(offsetX, offsetY);
      const shouldThrow = velocity > THROW_VELOCITY || distance > THROW_OFFSET;

      if (!shouldThrow) {
        await snapBack();
        return;
      }

      const directionX = velocityX || offsetX || (Math.random() > 0.5 ? 1 : -1);
      const directionY = velocityY || offsetY || -1;
      const spin = Math.max(-34, Math.min(34, offsetX / 5 + velocityX / 90));

      completeThrow(directionX, directionY, velocity || KEYBOARD_THROW_VELOCITY, spin, offsetX, offsetY);
    },
    [completeThrow, snapBack],
  );

  function throwCard(info: PanInfo) {
    void throwFromInput(info.velocity.x, info.velocity.y, info.offset.x, info.offset.y);
  }

  async function toggleFullscreen() {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen?.();
      return;
    }

    await document.exitFullscreen?.();
  }

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        return;
      }

      const key = event.key.toLowerCase();
      const throws: Record<string, [number, number]> = {
        arrowleft: [-KEYBOARD_THROW_VELOCITY, 0],
        a: [-KEYBOARD_THROW_VELOCITY, 0],
        arrowright: [KEYBOARD_THROW_VELOCITY, 0],
        d: [KEYBOARD_THROW_VELOCITY, 0],
        arrowup: [0, -KEYBOARD_THROW_VELOCITY],
        w: [0, -KEYBOARD_THROW_VELOCITY],
        arrowdown: [0, KEYBOARD_THROW_VELOCITY],
        s: [0, KEYBOARD_THROW_VELOCITY],
      };

      if (key in throws) {
        event.preventDefault();
        const [velocityX, velocityY] = throws[key];
        void throwFromInput(velocityX, velocityY, velocityX / 5, velocityY / 5);
        return;
      }

      if (key === " " || key === "enter") {
        event.preventDefault();
        const direction = Math.random() * Math.PI * 2;
        void throwFromInput(Math.cos(direction) * KEYBOARD_THROW_VELOCITY, Math.sin(direction) * KEYBOARD_THROW_VELOCITY);
        return;
      }

      if (key === "r") {
        event.preventDefault();
        resetCounter();
        return;
      }

      if (key === "c") {
        event.preventDefault();
        setShowControls((value) => !value);
        return;
      }

      if (key === "f") {
        event.preventDefault();
        void toggleFullscreen();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [throwFromInput]);

  function resetCounter() {
    setThrown(0);
    setCombo(0);
    setParticles([]);
  }

  return (
    <main className="app" style={{ background: theme.background }}>
      <div className="topBar">
        <button
          className="iconButton"
          type="button"
          onClick={() => setShowControls((value) => !value)}
          aria-label={showControls ? "Hide controls" : "Show controls"}
          title={showControls ? "Hide controls (C)" : "Show controls (C)"}
        >
          {showControls ? <EyeOff size={17} strokeWidth={2.4} /> : <Eye size={17} strokeWidth={2.4} />}
        </button>
        {showControls ? (
          <div className="counter" aria-live="polite">
            <span>{thrown}</span>
          </div>
        ) : null}
        {showControls && combo >= 3 ? (
          <div className="combo" aria-live="polite">
            <span>x{combo}</span>
          </div>
        ) : null}
        {showControls ? (
          <>
            <button className="iconButton reset" type="button" onClick={resetCounter} aria-label="Reset counter" title="Reset counter">
              <RotateCcw size={17} strokeWidth={2.4} />
            </button>
            <button
              className="iconButton"
              type="button"
              onClick={() => void toggleFullscreen()}
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              title={isFullscreen ? "Exit fullscreen (F)" : "Enter fullscreen (F)"}
            >
              {isFullscreen ? <Minimize2 size={17} strokeWidth={2.4} /> : <Maximize2 size={17} strokeWidth={2.4} />}
            </button>
          </>
        ) : null}
      </div>

      <section className="stage" aria-label="Swipe cards">
        {cards.map((card, index) => {
          const isTop = index === cards.length - 1;
          const depth = cards.length - 1 - index;
          const visuals = getVisuals(card, thrown);

          return (
            <motion.div
              key={card.id}
              className="card"
              drag={isTop}
              dragMomentum={false}
              dragElastic={0.12}
              onDragEnd={(_, info) => throwCard(info)}
              animate={
                isTop
                  ? controls
                  : {
                      y: depth * 14,
                      rotate: depth * -1.6,
                      scale: 1 - depth * 0.035,
                    }
              }
              transition={{ type: "spring", stiffness: 360, damping: 32, mass: 0.75 }}
              style={{
                x: isTop ? x : 0,
                y: isTop ? y : undefined,
                rotate: isTop ? rotate : undefined,
                background: cardBackground(card, visuals.isGradient),
                borderColor: colorToCss(card.color, 12, -18),
                boxShadow: isTop
                  ? "0 28px 80px rgba(0, 0, 0, 0.24), 0 1px 0 rgba(255, 255, 255, 0.3) inset"
                  : "0 16px 45px rgba(0, 0, 0, 0.16)",
                zIndex: index + 1,
                scale: isTop ? 1 : undefined,
              }}
              whileTap={isTop ? { scale: 0.985, cursor: "grabbing" } : undefined}
            >
              <CardTexture card={card} kind={visuals.textureKind} />
              <CardLines
                card={card}
                lineCount={visuals.lineCount}
                patternLevel={visuals.patternLevel}
                randomLineColor={visuals.randomLineColor}
              />
              <CardFinish card={card} kind={visuals.finishKind} />
            </motion.div>
          );
        })}

        {flyingCards.map((card) => (
          <motion.div
            key={card.flightId}
            className="card flyingCard"
            initial={{
              x: card.startX,
              y: card.startY,
              rotate: card.startRotate,
              scale: 1,
              opacity: 1,
            }}
            animate={{
              x: card.targetX,
              y: card.targetY,
              rotate: card.targetRotate,
              scale: 0.98,
              opacity: 0.98,
            }}
            transition={{
              duration: card.duration,
              ease: "linear",
            }}
            onAnimationComplete={() => {
              setFlyingCards((value) => value.filter((flyingCard) => flyingCard.flightId !== card.flightId));
            }}
            style={{
              background: cardBackground(card, card.isGradient),
              borderColor: colorToCss(card.color, 12, -18),
              boxShadow: "0 28px 80px rgba(0, 0, 0, 0.24), 0 1px 0 rgba(255, 255, 255, 0.3) inset",
            }}
          >
            <CardTexture card={card} kind={card.textureKind} />
            <CardLines
              card={card}
              lineCount={card.lineCount}
              patternLevel={card.patternLevel}
              randomLineColor={card.randomLineColor}
            />
            <CardFinish card={card} kind={card.finishKind} />
          </motion.div>
        ))}

        {particles.map((particle) => (
          <motion.span
            key={particle.id}
            className="particle"
            initial={{ x: particle.x, y: particle.y, scale: 0.4, opacity: 0.95 }}
            animate={{ x: particle.targetX, y: particle.targetY, scale: 1, opacity: 0 }}
            transition={{ duration: particle.duration, ease: "easeOut" }}
            onAnimationComplete={() => {
              setParticles((value) => value.filter((current) => current.id !== particle.id));
            }}
            style={{
              width: particle.size,
              height: particle.size,
              color: `hsl(${particle.hue} 92% 72%)`,
              backgroundColor: `hsl(${particle.hue} 92% 72%)`,
            }}
          />
        ))}
      </section>
    </main>
  );
}
