import { animate, motion, useAnimationControls, useMotionValue, type PanInfo } from "framer-motion";
import { Eye, EyeOff, Maximize2, Minimize2, RotateCcw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  memo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { flushSync } from "react-dom";
import { AR_PROOF_BUILD, createArEngine, getArUnavailableMessage, type ArDebugState, type ArEngine } from "./arEngine";

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
type LookModeKind = "ar";
type ArStatus = "idle" | "starting" | "ready" | "unsupported" | "error";

type CardVisuals = {
  isGradient: boolean;
  lineCount: number;
  randomLineColor: boolean;
  patternLevel: number;
  textureKind: TextureKind;
  finishKind: FinishKind;
  emojiMark: EmojiMark | null;
};

type StackCard = Card & CardVisuals;
type FlightMode = "screen" | "look";

type FlyingCard = StackCard & {
  flightMode: FlightMode;
  flightId: number;
  transformOrigin: string;
  startX: number;
  startY: number;
  startZ: number;
  startRotate: number;
  startRotateX: number;
  startRotateY: number;
  targetRotateX: number;
  targetRotateY: number;
  targetScale: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  targetRotate: number;
  duration: number;
};

type EmojiMark = Point & {
  emoji: string;
  size: number;
  rotate: number;
  opacity: number;
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

type DragSample = {
  time: number;
  x: number;
  y: number;
  rotate: number;
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
const EMOJI_UNLOCK_COUNT = 200;
const EMOJI_UNLOCK_STEP = 100;
const THROW_VELOCITY = 240;
const THROW_OFFSET = 24;
const KEYBOARD_THROW_VELOCITY = 980;
const COMBO_WINDOW_MS = 850;
const EYE_LONG_PRESS_MS = 620;
const MIN_FLIGHT_DURATION = 0.22;
const MAX_FLIGHT_DURATION = 3.8;
const AR_CARD_ANGLE = 34;
const AR_DEFAULT_CARD_DISTANCE = 0.82;
const AR_DEFAULT_CARD_TILT = 34;
const EMOJI_POOL = [
  "✨",
  "🌈",
  "⭐",
  "💫",
  "🔥",
  "💎",
  "🍀",
  "⚡",
  "🎲",
  "🎯",
  "🚀",
  "🎨",
  "🌀",
  "🧩",
  "🌟",
  "💥",
];

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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function rotationFromGrab(grab: Point, offsetX: number, offsetY: number, velocityX = 0, velocityY = 0) {
  const lever = Math.max(20, Math.hypot(grab.x, grab.y));
  const torque = (grab.x * offsetY - grab.y * offsetX) / (lever * 18);
  const velocityTorque = (grab.x * velocityY - grab.y * velocityX) / (lever * 120);
  const drift = offsetX / 68;

  return clamp(torque + velocityTorque + drift, -62, 62);
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

function getUnlockedEmojis(count: number) {
  if (count < EMOJI_UNLOCK_COUNT) {
    return [];
  }

  const unlockCount = Math.min(EMOJI_POOL.length, Math.floor((count - EMOJI_UNLOCK_COUNT) / EMOJI_UNLOCK_STEP) + 1);
  const emojis: string[] = [];

  for (let index = 0; index < unlockCount; index += 1) {
    const candidate = EMOJI_POOL[seededInteger(EMOJI_UNLOCK_COUNT + index * 619, 0, EMOJI_POOL.length - 1)];

    if (!emojis.includes(candidate)) {
      emojis.push(candidate);
    }
  }

  for (const emoji of EMOJI_POOL) {
    if (emojis.length >= unlockCount) {
      break;
    }

    if (!emojis.includes(emoji)) {
      emojis.push(emoji);
    }
  }

  return emojis;
}

function getEmojiMark(count: number, cardId: number): EmojiMark | null {
  const emojis = getUnlockedEmojis(count);

  if (emojis.length === 0) {
    return null;
  }

  const chance = Math.min(0.34, 0.16 + emojis.length * 0.025);
  if (seededNumber(cardId * 241 + count * 17) > chance) {
    return null;
  }

  return {
    emoji: emojis[seededInteger(cardId * 269 + count, 0, emojis.length - 1)],
    x: seededBetween(cardId * 277 + count, 16, 84),
    y: seededBetween(cardId * 281 + count, 18, 122),
    size: seededBetween(cardId * 283 + count, 28, 64),
    rotate: seededBetween(cardId * 293 + count, -18, 18),
    opacity: seededBetween(cardId * 307 + count, 0.78, 0.96),
  };
}

function getVisuals(card: Card, count: number): CardVisuals {
  return {
    isGradient: isGradientEnabled(count, card.id),
    lineCount: getLineCount(count, card.id),
    patternLevel: getPatternLevel(count, card.id),
    randomLineColor: count >= RANDOM_STYLE_UNLOCK_COUNT,
    textureKind: getTextureKind(count, card.id),
    finishKind: getFinishKind(count, card.id),
    emojiMark: getEmojiMark(count, card.id),
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
    return "hsl(0 0% 4% / 0.86)";
  }

  const hue = (color.hue + 130 + lineIndex * 47 + Math.round(seededBetween(cardId + lineIndex, -18, 18))) % 360;
  const lightness = seededBetween(cardId * 13 + lineIndex, 42, 88);

  return `hsl(${hue} 88% ${lightness.toFixed(1)}% / 0.96)`;
}

function lineWidth(cardId: number, lineIndex: number, randomLineColor: boolean) {
  const min = randomLineColor ? 0.85 : 0.75;
  const max = randomLineColor ? 1.55 : 1.35;

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

function CardEmoji({ mark }: { mark: EmojiMark | null }) {
  if (!mark) {
    return null;
  }

  return (
    <span
      className="cardEmoji"
      style={
        {
          left: `${mark.x}%`,
          top: `${(mark.y / 140) * 100}%`,
          fontSize: mark.size,
          opacity: mark.opacity,
          transform: `translate(-50%, -50%) rotate(${mark.rotate}deg)`,
        } as CSSProperties
      }
      aria-hidden="true"
    >
      {mark.emoji}
    </span>
  );
}

const CardFace = memo(function CardFace({ card }: { card: StackCard }) {
  return (
    <>
      <CardTexture card={card} kind={card.textureKind} />
      <CardLines
        card={card}
        lineCount={card.lineCount}
        patternLevel={card.patternLevel}
        randomLineColor={card.randomLineColor}
      />
      <CardEmoji mark={card.emojiMark} />
      <CardFinish card={card} kind={card.finishKind} />
    </>
  );
});

function createStackCard(id: number, previousColor: CardColor | undefined, count: number): StackCard {
  const card = {
    id,
    color: createColor(previousColor),
  };

  return {
    ...card,
    ...getVisuals(card, count),
  };
}

function createInitialCards(count = 0) {
  const cards: StackCard[] = [];
  for (let id = 0; id < CARD_COUNT; id += 1) {
    cards.push(createStackCard(id, cards[cards.length - 1]?.color, count));
  }
  return cards;
}

function nextStack(cards: StackCard[], count: number) {
  const bottomColor = cards[0]?.color;
  const nextId = Math.max(...cards.map((card) => card.id)) + 1;

  return [
    createStackCard(nextId, bottomColor, count),
    ...cards.slice(0, -1),
  ];
}

function vibrate() {
  if ("vibrate" in navigator) {
    navigator.vibrate(16);
  }
}

function getExitDistance(unitX: number, unitY: number, startX: number, startY: number) {
  const stage = document.querySelector<HTMLElement>(".lookCardStage") ?? document.querySelector<HTMLElement>(".stage");
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
  return Array.from({ length: 6 }, (_, index): Particle => {
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
  const [cards, setCards] = useState<StackCard[]>(createInitialCards);
  const [flyingCards, setFlyingCards] = useState<FlyingCard[]>([]);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [thrown, setThrown] = useState(0);
  const [combo, setCombo] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [lookMode, setLookMode] = useState<LookModeKind | null>(null);
  const [lookModeMessage, setLookModeMessage] = useState("");
  const [arStatus, setArStatus] = useState<ArStatus>("idle");
  const [arDebug, setArDebug] = useState<ArDebugState | null>(null);
  const [arCardDistance, setArCardDistance] = useState(AR_DEFAULT_CARD_DISTANCE);
  const [arCardTilt, setArCardTilt] = useState(AR_DEFAULT_CARD_TILT);
  const flightId = useRef(0);
  const particleId = useRef(0);
  const thrownRef = useRef(0);
  const lastThrowAt = useRef(0);
  const grabPoint = useRef<Point>({ x: 0, y: 0 });
  const grabOriginRef = useRef("50% 50%");
  const dragSamplesRef = useRef<DragSample[]>([]);
  const eyeHoldTimer = useRef<number | null>(null);
  const eyeLongPressed = useRef(false);
  const arEngineRef = useRef<ArEngine | null>(null);
  const topCardRef = useRef<StackCard | null>(null);
  const controls = useAnimationControls();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useMotionValue(0);
  const [grabOrigin, setGrabOrigin] = useState("50% 50%");
  const topCard = cards[cards.length - 1];
  const isArReady = lookMode === "ar" && arStatus === "ready";

  useEffect(() => {
    topCardRef.current = topCard;
    arEngineRef.current?.setActiveCard(topCard);
  }, [topCard]);

  useEffect(() => {
    arEngineRef.current?.setConfig({
      cardDistance: arCardDistance,
      cardTiltDeg: arCardTilt,
    });
  }, [arCardDistance, arCardTilt]);

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

  useLayoutEffect(() => {
    controls.set({ rotate: 0, scale: 1, opacity: 1 });
    x.set(0);
    y.set(0);
    rotate.set(0);
  }, [controls, rotate, topCard.id, x, y]);

  useEffect(() => {
    if (combo <= 1) {
      return undefined;
    }

    const timeout = window.setTimeout(() => setCombo(0), COMBO_WINDOW_MS + 220);
    return () => window.clearTimeout(timeout);
  }, [combo]);

  function recordDragSample(offsetX: number, offsetY: number, rotation: number) {
    const now = performance.now();
    const samples = [...dragSamplesRef.current, { time: now, x: offsetX, y: offsetY, rotate: rotation }]
      .filter((sample) => now - sample.time <= 180)
      .slice(-8);

    dragSamplesRef.current = samples;
  }

  function estimateRelease(info: PanInfo) {
    const now = performance.now();
    const finalRotation = rotationFromGrab(grabPoint.current, info.offset.x, info.offset.y, info.velocity.x, info.velocity.y);
    const samples = [
      ...dragSamplesRef.current,
      {
        time: now,
        x: info.offset.x,
        y: info.offset.y,
        rotate: finalRotation,
      },
    ]
      .filter((sample) => now - sample.time <= 180)
      .slice(-8);
    const latest = samples[samples.length - 1] ?? {
      time: now,
      x: info.offset.x,
      y: info.offset.y,
      rotate: finalRotation,
    };

    dragSamplesRef.current = samples;

    const earliest =
      [...samples].reverse().find((sample) => latest.time - sample.time >= 28) ??
      samples[0] ??
      latest;
    const deltaSeconds = Math.max(0.016, (latest.time - earliest.time) / 1000);
    const sampledVelocityX = (latest.x - earliest.x) / deltaSeconds;
    const sampledVelocityY = (latest.y - earliest.y) / deltaSeconds;
    const sampledAngularVelocity = (latest.rotate - earliest.rotate) / deltaSeconds;
    const fallbackVelocity = Math.hypot(info.velocity.x, info.velocity.y);
    const sampledVelocity = Math.hypot(sampledVelocityX, sampledVelocityY);

    return {
      offsetX: latest.x,
      offsetY: latest.y,
      rotate: latest.rotate,
      velocityX: sampledVelocity > 24 ? sampledVelocityX : info.velocity.x,
      velocityY: sampledVelocity > 24 ? sampledVelocityY : info.velocity.y,
      angularVelocity: Math.abs(sampledAngularVelocity) > 8 ? sampledAngularVelocity : 0,
      velocity: sampledVelocity > 24 ? sampledVelocity : fallbackVelocity,
    };
  }

  const completeThrow = useCallback(
    (
      directionX: number,
      directionY: number,
      velocity: number,
      angularVelocity: number,
      startX = 0,
      startY = 0,
      releaseRotate = rotate.get(),
      releaseVelocityX = directionX,
      releaseVelocityY = directionY,
    ) => {
      const magnitude = Math.max(1, Math.hypot(directionX, directionY));
      const unitX = directionX / magnitude;
      const unitY = directionY / magnitude;
      const throwSpeed = clamp(velocity || Math.hypot(startX, startY) * 3.2, 220, 5200);
      const isLookThrow = lookMode === "ar" && arStatus === "ready";
      const speedBoost = clamp(throwSpeed / 2500, 0.92, 1.55);
      const exitDistance = getExitDistance(unitX, unitY, startX, startY) * speedBoost;
      const viewportHeight = window.innerHeight || 720;
      const forwardDistance = isLookThrow
        ? clamp(throwSpeed * 1.12 + Math.hypot(startX, startY) * 5.4, 520, 6200)
        : 0;
      const lookLateralDistance = clamp(forwardDistance * 0.24, 160, 1380);
      const targetX = isLookThrow ? startX + unitX * lookLateralDistance : unitX * exitDistance;
      const targetY = isLookThrow
        ? clamp(startY + unitY * lookLateralDistance * 0.35 + forwardDistance * 0.07, -viewportHeight * 0.32, viewportHeight * 0.78)
        : unitY * exitDistance;
      const targetZ = isLookThrow ? -forwardDistance : 0;
      const pixelsPerSecond = clamp(throwSpeed * (isLookThrow ? 0.7 : 0.88), 260, 4700);
      const duration = isLookThrow
        ? clamp(forwardDistance / pixelsPerSecond, 0.95, 6.4)
        : clamp(exitDistance / pixelsPerSecond, MIN_FLIGHT_DURATION, MAX_FLIGHT_DURATION);
      const startRotate = releaseRotate;
      const startRotateX = isLookThrow ? AR_CARD_ANGLE : 0;
      const startRotateY = 0;
      const targetRotateX = isLookThrow ? clamp(AR_CARD_ANGLE + 18 + throwSpeed / 260, 58, 88) : 0;
      const targetRotateY = isLookThrow ? clamp(-unitX * 42, -54, 54) : 0;
      const targetScale = isLookThrow ? clamp(920 / (920 + forwardDistance * 0.62), 0.24, 0.78) : 0.98;
      const targetRotate = isLookThrow
        ? startRotate
        : startRotate + clamp(angularVelocity * duration * 0.72 + releaseVelocityX / 120, -780, 780);
      const nextFlightId = flightId.current + 1;
      const nextThrown = thrownRef.current + 1;
      const now = Date.now();
      const previousThrowAt = lastThrowAt.current;
      const nextParticleId = particleId.current + 10;
      const currentGrabOrigin = grabOriginRef.current;
      flightId.current = nextFlightId;
      particleId.current = nextParticleId;
      thrownRef.current = nextThrown;
      lastThrowAt.current = now;

      if (isLookThrow) {
        arEngineRef.current?.throwCard(topCard, {
          unitX,
          unitY,
          throwSpeed,
          startX,
          startY,
          rotateDeg: startRotate,
          grabX: grabPoint.current.x,
          grabY: grabPoint.current.y,
          releaseVelocityX,
          releaseVelocityY,
          angularVelocityDeg: angularVelocity,
        });
      }

      flushSync(() => {
        controls.set({ rotate: 0, scale: 1, opacity: 1 });
        x.set(0);
        y.set(0);
        rotate.set(0);
        setFlyingCards((value) => {
          if (isLookThrow) {
            return value.filter((card) => card.flightMode !== "look");
          }

          const nextCard: FlyingCard = {
            ...topCard,
            flightMode: "screen",
            flightId: nextFlightId,
            transformOrigin: currentGrabOrigin,
            startX,
            startY,
            startZ: 0,
            startRotate,
            startRotateX,
            startRotateY,
            targetRotateX,
            targetRotateY,
            targetScale,
            targetX,
            targetY,
            targetZ,
            targetRotate,
            duration,
          };
          const nextCards = [...value, nextCard];

          return nextCards;
        });
        setThrown(nextThrown);
        setCards((value) => nextStack(value, nextThrown));
        grabOriginRef.current = "50% 50%";
        setGrabOrigin("50% 50%");
      });
      if (!isLookThrow) {
        setParticles((value) => [...value.slice(-24), ...createParticles(topCard, startX, startY, nextParticleId)]);
      }
      setCombo((value) => (now - previousThrowAt < COMBO_WINDOW_MS ? value + 1 : 1));
      vibrate();
    },
    [arStatus, controls, lookMode, rotate, topCard, x, y],
  );

  const snapBack = useCallback(async () => {
    controls.set({ opacity: 1, scale: 1 });

    await Promise.all([
      animate(x, 0, { type: "spring", stiffness: 420, damping: 30 }),
      animate(y, 0, { type: "spring", stiffness: 420, damping: 30 }),
      animate(rotate, 0, { type: "spring", stiffness: 420, damping: 30 }),
    ]);
    grabOriginRef.current = "50% 50%";
    setGrabOrigin("50% 50%");
  }, [controls, rotate, x, y]);

  const throwFromInput = useCallback(
    async (
      velocityX: number,
      velocityY: number,
      offsetX = 0,
      offsetY = 0,
      releaseRotate = rotate.get(),
      angularVelocity = 0,
    ) => {
      const velocity = Math.hypot(velocityX, velocityY);
      const distance = Math.hypot(offsetX, offsetY);
      const shouldThrow = velocity > THROW_VELOCITY || distance > THROW_OFFSET;

      if (!shouldThrow) {
        await snapBack();
        return;
      }

      const directionX = velocityX || offsetX || (Math.random() > 0.5 ? 1 : -1);
      const directionY = velocityY || offsetY || -1;
      const contactAngularVelocity =
        distance > 0 ? (grabPoint.current.x * velocityY - grabPoint.current.y * velocityX) / 14 : 0;
      const releaseAngularVelocity = clamp(angularVelocity + contactAngularVelocity, -960, 960);

      completeThrow(
        directionX,
        directionY,
        velocity || KEYBOARD_THROW_VELOCITY,
        releaseAngularVelocity,
        offsetX,
        offsetY,
        releaseRotate,
        velocityX,
        velocityY,
      );
    },
    [completeThrow, rotate, snapBack],
  );

  function throwCard(info: PanInfo) {
    const release = estimateRelease(info);

    void throwFromInput(
      release.velocityX,
      release.velocityY,
      release.offsetX,
      release.offsetY,
      release.rotate,
      release.angularVelocity,
    );
  }

  function captureGrabPoint(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const originX = event.clientX - rect.left;
    const originY = event.clientY - rect.top;

    grabPoint.current = {
      x: originX - rect.width / 2,
      y: originY - rect.height / 2,
    };
    grabOriginRef.current = `${originX}px ${originY}px`;
    dragSamplesRef.current = [];
    recordDragSample(0, 0, rotate.get());
    setGrabOrigin(grabOriginRef.current);
  }

  function rotateDuringDrag(info: PanInfo) {
    const nextRotate = rotationFromGrab(grabPoint.current, info.offset.x, info.offset.y, info.velocity.x, info.velocity.y);

    rotate.set(nextRotate);
    recordDragSample(info.offset.x, info.offset.y, nextRotate);
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
    document.documentElement.classList.toggle("xrActive", Boolean(lookMode));
    document.body.classList.toggle("xrActive", Boolean(lookMode));

    return () => {
      document.documentElement.classList.remove("xrActive");
      document.body.classList.remove("xrActive");
    };
  }, [lookMode]);

  const stopLookMode = useCallback(() => {
    arEngineRef.current?.stop();
    arEngineRef.current = null;
    setLookMode(null);
    setLookModeMessage("");
    setArStatus("idle");
    setArDebug(null);
    setFlyingCards((value) => value.filter((card) => card.flightMode !== "look"));
  }, []);

  const enterLookThrowMode = useCallback(async () => {
    setArStatus("starting");
    setLookModeMessage("Starting AR...");
    setArDebug(null);

    try {
      const engine = await createArEngine({
        initialCard: topCardRef.current ?? topCard,
        initialConfig: {
          cardDistance: arCardDistance,
          cardTiltDeg: arCardTilt,
        },
        onDebug: setArDebug,
        onEnd: () => {
          arEngineRef.current = null;
          setLookMode(null);
          setLookModeMessage("");
          setArStatus("idle");
          setArDebug(null);
          setFlyingCards((value) => value.filter((card) => card.flightMode !== "look"));
        },
      });
      arEngineRef.current = engine;
      setLookMode("ar");
      setArStatus("ready");
      setLookModeMessage("AR Throw");
    } catch (error) {
      setArStatus("error");
      setLookModeMessage(getArUnavailableMessage(error));
      arEngineRef.current?.stop();
      arEngineRef.current = null;
      window.setTimeout(() => setLookModeMessage(""), 3200);
    }
  }, [arCardDistance, arCardTilt, topCard]);

  useEffect(() => {
    return () => {
      arEngineRef.current?.stop();
      arEngineRef.current = null;
    };
  }, []);

  function startEyeHold() {
    if (lookMode) {
      return;
    }

    eyeLongPressed.current = false;

    if (eyeHoldTimer.current) {
      window.clearTimeout(eyeHoldTimer.current);
    }

    eyeHoldTimer.current = window.setTimeout(() => {
      eyeLongPressed.current = true;
      void enterLookThrowMode();
    }, EYE_LONG_PRESS_MS);
  }

  function clearEyeHold() {
    if (eyeHoldTimer.current) {
      window.clearTimeout(eyeHoldTimer.current);
      eyeHoldTimer.current = null;
    }
  }

  function handleEyeClick() {
    if (eyeLongPressed.current) {
      eyeLongPressed.current = false;
      return;
    }

    if (lookMode) {
      stopLookMode();
      return;
    }

    setShowControls((value) => !value);
  }

  async function copyArDiagnostics() {
    if (!arDebug?.text) {
      return;
    }

    await navigator.clipboard?.writeText(arDebug.text).catch(() => undefined);
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "escape" && lookMode) {
        event.preventDefault();
        stopLookMode();
        return;
      }

      if (lookMode) {
        return;
      }

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
  }, [arStatus, lookMode, stopLookMode, throwFromInput]);

  function resetCounter() {
    thrownRef.current = 0;
    setThrown(0);
    setCombo(0);
    setParticles([]);
    setFlyingCards([]);
    setCards(createInitialCards(0));
  }

  return (
    <main className={`app${lookMode ? " lookActive" : ""}`} style={{ background: lookMode ? "transparent" : theme.background }}>
      <div className="topBar">
        <button
          className="iconButton"
          type="button"
          onPointerDown={startEyeHold}
          onPointerUp={clearEyeHold}
          onPointerLeave={clearEyeHold}
          onPointerCancel={clearEyeHold}
          onClick={handleEyeClick}
          aria-label={lookMode ? "Exit AR throw mode" : showControls ? "Hide controls" : "Show controls"}
          title={lookMode ? "Exit AR throw mode" : showControls ? "Hide controls (C), hold for AR" : "Show controls (C), hold for AR"}
        >
          {lookMode || !showControls ? <Eye size={17} strokeWidth={2.4} /> : <EyeOff size={17} strokeWidth={2.4} />}
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

      {!lookMode && lookModeMessage ? (
        <div className={`arNotice arNotice-${arStatus}`} role="status" aria-live="polite">
          {lookModeMessage}
        </div>
      ) : null}

      {lookMode ? (
        <section className={`lookMode lookMode-${lookMode} ar-${arStatus}`} aria-label="AR throw mode">
          <div className="arBuildBadge">{AR_PROOF_BUILD}</div>
          <div className="lookModeLabel">{lookModeMessage}</div>
          {!isArReady ? (
            <div className="arModeNotice" role="status" aria-live="polite">
              <strong>{lookModeMessage}</strong>
              <span>Exit with the eye button.</span>
            </div>
          ) : null}
          {isArReady ? (
            <div
              className="arCardStage"
              style={
                {
                  "--ar-card-tilt": `${arCardTilt}deg`,
                  "--ar-card-distance": `${arCardDistance}`,
                } as CSSProperties
              }
              aria-label="AR card stack"
            >
              {cards.map((card, index) => {
                const isTop = index === cards.length - 1;
                const depth = cards.length - 1 - index;

                return (
                  <motion.div
                    key={card.id}
                    className="arCard"
                    drag={isTop}
                    dragMomentum={false}
                    dragElastic={0.12}
                    onPointerDown={isTop ? captureGrabPoint : undefined}
                    onDrag={isTop ? (_, info) => rotateDuringDrag(info) : undefined}
                    onDragEnd={(_, info) => throwCard(info)}
                    animate={isTop ? controls : undefined}
                    transition={{ type: "spring", stiffness: 360, damping: 32, mass: 0.75 }}
                    style={{
                      x: isTop ? x : depth * 5,
                      y: isTop ? y : depth * 8,
                      z: isTop ? 0 : depth * -10,
                      rotate: isTop ? rotate : depth * -1.3,
                      rotateX: arCardTilt,
                      transformOrigin: isTop ? grabOrigin : "center center",
                      background: cardBackground(card, card.isGradient),
                      borderColor: colorToCss(card.color, 12, -18),
                      boxShadow: isTop
                        ? "0 28px 80px rgba(0, 0, 0, 0.26), 0 1px 0 rgba(255, 255, 255, 0.32) inset"
                        : "0 16px 45px rgba(0, 0, 0, 0.18)",
                      zIndex: index + 1,
                      scale: isTop ? 1 : 1 - depth * 0.035,
                    }}
                    whileTap={isTop ? { cursor: "grabbing" } : undefined}
                  >
                    <CardFace card={card} />
                  </motion.div>
                );
              })}

            </div>
          ) : null}
          {isArReady ? (
            <div className="arProofPanel">
              <div className="arProofTitle">Phone-attached card test</div>
              <div className="arControls" aria-label="AR card controls">
                <label className="arControl">
                  <span>Distance {arCardDistance.toFixed(2)}m</span>
                  <input
                    type="range"
                    min="0.30"
                    max="1.80"
                    step="0.05"
                    value={arCardDistance}
                    onChange={(event) => setArCardDistance(Number(event.currentTarget.value))}
                  />
                </label>
                <label className="arControl">
                  <span>Tilt {arCardTilt.toFixed(0)}deg</span>
                  <input
                    type="range"
                    min="-75"
                    max="75"
                    step="1"
                    value={arCardTilt}
                    onChange={(event) => setArCardTilt(Number(event.currentTarget.value))}
                  />
                </label>
              </div>
              {arDebug ? (
                <>
                  <textarea className="arDebugText" value={arDebug.text} readOnly aria-label="AR diagnostics" />
                  <button className="arCopyButton" type="button" onClick={() => void copyArDiagnostics()}>
                    Copy diagnostics
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="stage" aria-label="Swipe cards">
        {cards.map((card, index) => {
          const isTop = index === cards.length - 1;
          const depth = cards.length - 1 - index;

          return (
            <motion.div
              key={card.id}
              className="card"
              drag={isTop}
              dragMomentum={false}
              dragElastic={0.12}
              onPointerDown={isTop ? captureGrabPoint : undefined}
              onDrag={isTop ? (_, info) => rotateDuringDrag(info) : undefined}
              onDragEnd={(_, info) => throwCard(info)}
              animate={isTop ? controls : undefined}
              transition={{ type: "spring", stiffness: 360, damping: 32, mass: 0.75 }}
              style={{
                x: isTop ? x : depth * 9,
                y: isTop ? y : depth * 14,
                rotate: isTop ? rotate : depth * -1.6,
                transformOrigin: isTop ? grabOrigin : "center center",
                background: cardBackground(card, card.isGradient),
                borderColor: colorToCss(card.color, 12, -18),
                boxShadow: isTop
                  ? "0 28px 80px rgba(0, 0, 0, 0.24), 0 1px 0 rgba(255, 255, 255, 0.3) inset"
                  : "0 16px 45px rgba(0, 0, 0, 0.16)",
                zIndex: index + 1,
                scale: isTop ? 1 : 1 - depth * 0.035,
              }}
              whileTap={isTop ? { cursor: "grabbing" } : undefined}
            >
              <CardFace card={card} />
            </motion.div>
          );
        })}

        {flyingCards.filter((card) => card.flightMode === "screen").map((card) => (
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
              transformOrigin: card.transformOrigin,
            }}
          >
            <CardFace card={card} />
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
