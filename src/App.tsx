import { animate, motion, useAnimationControls, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import { Eye, EyeOff, Maximize2, Minimize2, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type CardColor = {
  hue: number;
  saturation: number;
  lightness: number;
};

type Card = {
  id: number;
  color: CardColor;
};

type FlyingCard = Card & {
  flightId: number;
  isGradient: boolean;
  lineCount: number;
  randomLineColor: boolean;
  startX: number;
  startY: number;
  startRotate: number;
  targetX: number;
  targetY: number;
  targetRotate: number;
  duration: number;
};

const CARD_COUNT = 4;
const MIN_HUE_DISTANCE = 36;
const GRADIENT_UNLOCK_COUNT = 15;
const ONE_LINE_UNLOCK_COUNT = 30;
const TWO_LINE_UNLOCK_COUNT = 50;
const THREE_LINE_UNLOCK_COUNT = 70;
const FOUR_LINE_UNLOCK_COUNT = 90;
const RANDOM_STYLE_UNLOCK_COUNT = 100;
const THROW_VELOCITY = 650;
const THROW_OFFSET = 130;
const KEYBOARD_THROW_VELOCITY = 980;

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

function cardBackground(color: CardColor, isGradient: boolean) {
  if (!isGradient) {
    return colorToCss(color);
  }

  const accent = { ...color, hue: (color.hue + 64) % 360 };
  const warm = { ...color, hue: (color.hue + 138) % 360 };

  return `radial-gradient(circle at 24% 18%, ${colorToCss(warm, 16, 4)} 0%, transparent 34%),
    linear-gradient(135deg, ${colorToCss(color, 10, 6)} 0%, ${colorToCss(accent, 4, 10)} 52%, ${colorToCss(
      color,
      -8,
      2,
    )} 100%)`;
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

function isGradientEnabled(count: number, cardId: number) {
  if (count >= RANDOM_STYLE_UNLOCK_COUNT) {
    return seededNumber(cardId * 53 + 31) > 0.5;
  }

  return count >= GRADIENT_UNLOCK_COUNT;
}

function getVisuals(card: Card, count: number) {
  return {
    isGradient: isGradientEnabled(count, card.id),
    lineCount: getLineCount(count, card.id),
    randomLineColor: count >= RANDOM_STYLE_UNLOCK_COUNT,
  };
}

function edgePoint(seed: number, preferredEdge?: number) {
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

function linePath(cardId: number, lineIndex: number) {
  const seed = cardId * 211 + lineIndex * 997;
  const start = edgePoint(seed + 1);
  const endEdge = (start.edge + 2 + seededInteger(seed + 2, -1, 1) + 4) % 4;
  const end = edgePoint(seed + 3, endEdge);
  const midX = seededBetween(seed + 4, 28, 72);
  const midY = seededBetween(seed + 5, 34, 106);
  const c1X = seededBetween(seed + 6, -18, 118);
  const c1Y = seededBetween(seed + 7, -18, 158);
  const c2X = seededBetween(seed + 8, -18, 118);
  const c2Y = seededBetween(seed + 9, -18, 158);
  const c3X = seededBetween(seed + 10, -18, 118);
  const c3Y = seededBetween(seed + 11, -18, 158);
  const c4X = seededBetween(seed + 12, -18, 118);
  const c4Y = seededBetween(seed + 13, -18, 158);

  return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} C ${c1X.toFixed(1)} ${c1Y.toFixed(1)}, ${c2X.toFixed(
    1,
  )} ${c2Y.toFixed(1)}, ${midX.toFixed(1)} ${midY.toFixed(1)} C ${c3X.toFixed(1)} ${c3Y.toFixed(
    1,
  )}, ${c4X.toFixed(1)} ${c4Y.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
}

function lineStroke(color: CardColor, cardId: number, lineIndex: number, randomLineColor: boolean) {
  if (!randomLineColor) {
    return "hsl(0 0% 6% / 0.58)";
  }

  const hue = (color.hue + 130 + lineIndex * 47 + Math.round(seededBetween(cardId + lineIndex, -18, 18))) % 360;
  const lightness = seededBetween(cardId * 13 + lineIndex, 42, 88);

  return `hsl(${hue} 88% ${lightness.toFixed(1)}% / 0.82)`;
}

function CardLines({ card, lineCount, randomLineColor }: { card: Card; lineCount: number; randomLineColor: boolean }) {
  if (lineCount <= 0) {
    return null;
  }

  return (
    <svg className="cardLines" viewBox="0 0 100 140" aria-hidden="true" focusable="false">
      {Array.from({ length: lineCount }, (_, index) => (
        <path
          key={`${card.id}-${index}`}
          d={linePath(card.id, index)}
          fill="none"
          stroke={lineStroke(card.color, card.id, index, randomLineColor)}
          strokeLinecap="round"
          strokeWidth={seededBetween(card.id * 29 + index, 3.8, 6.8).toFixed(1)}
        />
      ))}
    </svg>
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

export default function App() {
  const [cards, setCards] = useState<Card[]>(createInitialCards);
  const [flyingCards, setFlyingCards] = useState<FlyingCard[]>([]);
  const [thrown, setThrown] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const flightId = useRef(0);
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
      const flyingVisuals = getVisuals(topCard, thrown + 1);
      flightId.current = nextFlightId;

      setFlyingCards((value) => [
        ...value,
        {
          ...topCard,
          flightId: nextFlightId,
          isGradient: flyingVisuals.isGradient,
          lineCount: flyingVisuals.lineCount,
          randomLineColor: flyingVisuals.randomLineColor,
          startX,
          startY,
          startRotate,
          targetX,
          targetY,
          targetRotate: spin,
          duration,
        },
      ]);
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
                background: cardBackground(card.color, visuals.isGradient),
                borderColor: colorToCss(card.color, 12, -18),
                boxShadow: isTop
                  ? "0 28px 80px rgba(0, 0, 0, 0.24), 0 1px 0 rgba(255, 255, 255, 0.3) inset"
                  : "0 16px 45px rgba(0, 0, 0, 0.16)",
                zIndex: index + 1,
                scale: isTop ? 1 : undefined,
              }}
              whileTap={isTop ? { scale: 0.985, cursor: "grabbing" } : undefined}
            >
              <CardLines card={card} lineCount={visuals.lineCount} randomLineColor={visuals.randomLineColor} />
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
              background: cardBackground(card.color, card.isGradient),
              borderColor: colorToCss(card.color, 12, -18),
              boxShadow: "0 28px 80px rgba(0, 0, 0, 0.24), 0 1px 0 rgba(255, 255, 255, 0.3) inset",
            }}
          >
            <CardLines card={card} lineCount={card.lineCount} randomLineColor={card.randomLineColor} />
          </motion.div>
        ))}
      </section>
    </main>
  );
}
