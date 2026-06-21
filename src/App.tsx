import { motion, useAnimationControls, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import { Eye, EyeOff, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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
  const controls = useAnimationControls();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-320, 320], [-12, 12]);
  const topCard = cards[cards.length - 1];

  const theme = useMemo(
    () => ({
      background: `radial-gradient(circle at 20% 10%, ${colorToCss(topCard.color, 20, -8)}, transparent 28%),
        linear-gradient(135deg, ${colorToCss(topCard.color, 28, -18)} 0%, ${colorToCss(topCard.color, -8, -5)} 100%)`,
    }),
    [topCard.color],
  );

  useEffect(() => {
    controls.set({ x: 0, y: 0, rotate: 0, scale: 1 });
    x.set(0);
    y.set(0);
  }, [controls, topCard.id, x, y]);

  async function throwCard(info: PanInfo) {
    const velocity = Math.hypot(info.velocity.x, info.velocity.y);
    const distance = Math.hypot(info.offset.x, info.offset.y);
    const shouldThrow = velocity > THROW_VELOCITY || distance > THROW_OFFSET;

    if (!shouldThrow) {
      await controls.start({
        x: 0,
        y: 0,
        rotate: 0,
        transition: { type: "spring", stiffness: 420, damping: 30 },
      });
      return;
    }

    const directionX = info.velocity.x || info.offset.x || (Math.random() > 0.5 ? 1 : -1);
    const directionY = info.velocity.y || info.offset.y || -1;
    const magnitude = Math.max(1, Math.hypot(directionX, directionY));
    const speedBoost = Math.min(1.7, Math.max(0.85, velocity / 1100));
    const targetX = (directionX / magnitude) * THROW_DISTANCE * speedBoost;
    const targetY = (directionY / magnitude) * THROW_DISTANCE * speedBoost;
    const spin = Math.max(-38, Math.min(38, info.offset.x / 5 + info.velocity.x / 85));

    setIsThrowing(true);
    vibrate();

    await controls.start({
      x: targetX,
      y: targetY,
      rotate: spin,
      scale: 0.98,
      transition: {
        type: "inertia",
        velocity,
        power: 0.75,
        timeConstant: 280,
        bounceStiffness: 0,
        bounceDamping: 0,
        duration: 0.42,
      },
    });

    setThrown((value) => value + 1);
    setCards((value) => nextStack(value));
    setIsThrowing(false);
  }

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
              onDragEnd={(_, info) => void throwCard(info)}
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
