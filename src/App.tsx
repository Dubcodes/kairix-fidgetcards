import { motion, useAnimationControls, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import { Eye, EyeOff, Maximize2, Minimize2, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type CardColor = {
  hue: number;
  saturation: number;
  lightness: number;
};

type Card = {
  id: number;
  color: CardColor;
};

const CARD_COUNT = 4;
const MIN_HUE_DISTANCE = 36;
const THROW_DISTANCE = 1600;
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
  const topColor = cards[cards.length - 1]?.color;
  return [
    ...cards.slice(0, -1),
    {
      id: cards[cards.length - 1].id + 1,
      color: createColor(topColor),
    },
  ];
}

function vibrate() {
  if ("vibrate" in navigator) {
    navigator.vibrate(16);
  }
}

export default function App() {
  const [cards, setCards] = useState<Card[]>(createInitialCards);
  const [thrown, setThrown] = useState(0);
  const [showCounter, setShowCounter] = useState(true);
  const [isThrowing, setIsThrowing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
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
    controls.set({ x: 0, y: 0, rotate: 0, scale: 1, opacity: 1 });
    x.set(0);
    y.set(0);
  }, [controls, topCard.id, x, y]);

  const completeThrow = useCallback(
    async (directionX: number, directionY: number, velocity: number, spin: number) => {
      if (isThrowing) {
        return;
      }

      const magnitude = Math.max(1, Math.hypot(directionX, directionY));
      const speedBoost = Math.min(1.8, Math.max(0.9, velocity / 1050));
      const targetX = (directionX / magnitude) * THROW_DISTANCE * speedBoost;
      const targetY = (directionY / magnitude) * THROW_DISTANCE * speedBoost;
      const duration = Math.max(0.2, Math.min(0.42, 0.52 - velocity / 3600));

      setIsThrowing(true);
      vibrate();

      try {
        await controls.start({
          x: targetX,
          y: targetY,
          rotate: spin,
          opacity: 0.98,
          transition: {
            duration,
            ease: [0.16, 0.78, 0.22, 1],
          },
        });

        setThrown((value) => value + 1);
        setCards((value) => nextStack(value));
      } finally {
        setIsThrowing(false);
      }
    },
    [controls, isThrowing],
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

      await completeThrow(directionX, directionY, velocity || KEYBOARD_THROW_VELOCITY, spin);
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
      if (event.repeat || isThrowing) {
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
        setShowCounter((value) => !value);
        return;
      }

      if (key === "f") {
        event.preventDefault();
        void toggleFullscreen();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isThrowing, throwFromInput]);

  function resetCounter() {
    setThrown(0);
  }

  return (
    <main className="app" style={{ background: theme.background }}>
      <div className="topBar">
        {showCounter ? (
          <div className="counter" aria-live="polite">
            <span>{thrown}</span>
          </div>
        ) : null}
        <button
          className="iconButton"
          type="button"
          onClick={() => setShowCounter((value) => !value)}
          aria-label="Toggle counter"
          title="Toggle counter"
        >
          {showCounter ? <EyeOff size={17} strokeWidth={2.4} /> : <Eye size={17} strokeWidth={2.4} />}
        </button>
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
      </div>

      <section className="stage" aria-label="Swipe cards">
        {cards.map((card, index) => {
          const isTop = index === cards.length - 1;
          const depth = cards.length - 1 - index;

          return (
            <motion.div
              key={card.id}
              className="card"
              drag={isTop && !isThrowing}
              dragMomentum={false}
              dragElastic={0.12}
              onDragEnd={(_, info) => throwCard(info)}
              animate={isTop ? controls : undefined}
              style={{
                x: isTop ? x : 0,
                y: isTop ? y : depth * 14,
                rotate: isTop ? rotate : depth * -1.6,
                backgroundColor: colorToCss(card.color),
                borderColor: colorToCss(card.color, 12, -18),
                boxShadow: isTop
                  ? "0 28px 80px rgba(0, 0, 0, 0.24), 0 1px 0 rgba(255, 255, 255, 0.3) inset"
                  : "0 16px 45px rgba(0, 0, 0, 0.16)",
                zIndex: index + 1,
                scale: 1 - depth * 0.035,
              }}
              whileTap={isTop ? { scale: 0.985, cursor: "grabbing" } : undefined}
            />
          );
        })}
      </section>
    </main>
  );
}
