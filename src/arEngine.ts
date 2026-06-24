export type ArCardColor = {
  hue: number;
  saturation: number;
  lightness: number;
};

export type ArCard = {
  id: number;
  color: ArCardColor;
  isGradient?: boolean;
  lineCount?: number;
  patternLevel?: number;
  randomLineColor?: boolean;
  textureKind?: string;
  finishKind?: string;
  emojiMark?: {
    emoji: string;
    x: number;
    y: number;
    size: number;
    rotate: number;
    opacity: number;
  } | null;
};

export const AR_PROOF_BUILD = "ar-world-card-physics-2026-06-25-01";

export type ArCardControls = {
  cardDistance: number;
  cardTiltDeg: number;
};

export type ArThrowGesture = {
  unitX: number;
  unitY: number;
  throwSpeed: number;
  spin: number;
  startX: number;
  startY: number;
};

export type ArDebugState = {
  frameCount: number;
  poseFrameCount: number;
  viewCount: number;
  drawnObjects: number;
  planeLocked: boolean;
  referenceSpace: string;
  cardControls: ArCardControls;
  camera: { x: number; y: number; z: number } | null;
  plane: { x: number; y: number; z: number } | null;
  card: { x: number; y: number; z: number } | null;
  activeCardId: number | null;
  worldCardCount: number;
  message: string;
  text: string;
};

type XrSystemLike = {
  isSessionSupported?: (mode: "immersive-ar") => Promise<boolean>;
  requestSession?: (mode: "immersive-ar", options?: unknown) => Promise<XrSessionLike>;
};

type XrSessionLike = {
  end: () => Promise<void>;
  addEventListener: (type: "end", listener: () => void) => void;
  removeEventListener?: (type: "end", listener: () => void) => void;
  requestAnimationFrame?: (callback: (time: number, frame: unknown) => void) => number;
  cancelAnimationFrame?: (handle: number) => void;
  requestReferenceSpace?: (type: "local-floor") => Promise<unknown>;
  renderState?: { baseLayer?: XrWebGlLayerLike };
  updateRenderState?: (state: unknown) => void;
};

type XrViewportLike = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type XrWebGlLayerLike = {
  framebuffer: WebGLFramebuffer | null;
  getViewport?: (view: unknown) => XrViewportLike | null;
};

type XrFrameLike = {
  getViewerPose?: (referenceSpace: unknown) => XrViewerPoseLike | null;
};

type XrMatrixLike = {
  matrix: Float32Array;
};

type XrViewLike = {
  projectionMatrix: Float32Array;
  transform?: {
    matrix?: Float32Array;
    inverse?: XrMatrixLike;
  };
};

type XrViewerPoseLike = {
  transform?: {
    matrix?: Float32Array;
  };
  views: XrViewLike[];
};

type Vec3 = {
  x: number;
  y: number;
  z: number;
};

type Renderer = {
  program: WebGLProgram;
  positionLocation: number;
  uvLocation: number;
  mvpLocation: WebGLUniformLocation | null;
  textureLocation: WebGLUniformLocation | null;
  vertexBuffer: WebGLBuffer;
};

type WorldCard = {
  key: number;
  card: ArCard;
  position: Vec3;
  velocity: Vec3;
  right: Vec3;
  vertical: Vec3;
  normal: Vec3;
  spinVelocity: number;
  tumbleVelocity: number;
  age: number;
  settled: boolean;
};

export type ArEngine = {
  setActiveCard: (card: ArCard) => void;
  setConfig: (config: Partial<ArCardControls>) => void;
  throwCard: (card: ArCard, gesture: ArThrowGesture) => void;
  stop: () => void;
};

const PLANE_SIZE_METERS = 1.25;
const PLANE_DISTANCE_METERS = 1.7;
const CARD_WIDTH_METERS = 0.17;
const CARD_HEIGHT_METERS = 0.238;
const CARD_VERTICAL_OFFSET_METERS = -0.04;
const WORLD_CARD_LIMIT = 18;
const WORLD_GRAVITY = 2.35;
const WORLD_DRAG = 0.32;
const WORLD_FLOOR_Y = 0.018;
const AR_CARD_MIN_PX = 110;
const AR_CARD_MAX_PX = 220;
const AR_CARD_VIEWPORT_SCALE = 0.28;
const DEFAULT_CARD_CONTROLS: ArCardControls = {
  cardDistance: 0.82,
  cardTiltDeg: 56,
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function multiplyMatrix4(a: Float32Array, b: Float32Array) {
  const out = new Float32Array(16);

  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        a[0 * 4 + row] * b[column * 4 + 0] +
        a[1 * 4 + row] * b[column * 4 + 1] +
        a[2 * 4 + row] * b[column * 4 + 2] +
        a[3 * 4 + row] * b[column * 4 + 3];
    }
  }

  return out;
}

function cameraPositionFromMatrix(matrix: Float32Array): Vec3 {
  return { x: matrix[12], y: matrix[13], z: matrix[14] };
}

function forwardFromMatrix(matrix: Float32Array): Vec3 {
  return { x: -matrix[8], y: -matrix[9], z: -matrix[10] };
}

function rightFromMatrix(matrix: Float32Array): Vec3 {
  return { x: matrix[0], y: matrix[1], z: matrix[2] };
}

function upFromMatrix(matrix: Float32Array): Vec3 {
  return { x: matrix[4], y: matrix[5], z: matrix[6] };
}

function addVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scaleVec3(vector: Vec3, scale: number): Vec3 {
  return { x: vector.x * scale, y: vector.y * scale, z: vector.z * scale };
}

function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function rotateVecAroundAxis(vector: Vec3, axis: Vec3, angle: number): Vec3 {
  const unitAxis = normalizeVec3(axis);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dot = vector.x * unitAxis.x + vector.y * unitAxis.y + vector.z * unitAxis.z;
  const cross = crossVec3(unitAxis, vector);

  return normalizeVec3({
    x: vector.x * cos + cross.x * sin + unitAxis.x * dot * (1 - cos),
    y: vector.y * cos + cross.y * sin + unitAxis.y * dot * (1 - cos),
    z: vector.z * cos + cross.z * sin + unitAxis.z * dot * (1 - cos),
  });
}

function normalizeVec3(vector: Vec3): Vec3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);

  if (length < 0.001) {
    return { x: 0, y: 1, z: 0 };
  }

  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function normalizeHorizontal(vector: Vec3) {
  const length = Math.hypot(vector.x, vector.z);

  if (length < 0.001) {
    return { x: 0, y: 0, z: -1 };
  }

  return { x: vector.x / length, y: 0, z: vector.z / length };
}

function horizontalOrFallback(vector: Vec3, fallback: Vec3) {
  const length = Math.hypot(vector.x, vector.z);

  if (length < 0.001) {
    return normalizeHorizontal(fallback);
  }

  return { x: vector.x / length, y: 0, z: vector.z / length };
}

function floorRightFromForward(forward: Vec3): Vec3 {
  return { x: forward.z, y: 0, z: -forward.x };
}

function floorPlaneMatrix(center: Vec3, yawForward: Vec3, size: number) {
  const right = { x: yawForward.z, y: 0, z: -yawForward.x };
  const matrix = new Float32Array(16);

  matrix[0] = right.x * size;
  matrix[1] = 0;
  matrix[2] = right.z * size;
  matrix[4] = 0;
  matrix[5] = 0;
  matrix[6] = 1;
  matrix[8] = yawForward.x * size;
  matrix[9] = 0;
  matrix[10] = yawForward.z * size;
  matrix[12] = center.x;
  matrix[13] = center.y + 0.01;
  matrix[14] = center.z;
  matrix[15] = 1;

  return matrix;
}

function orientedPlaneMatrix(center: Vec3, xAxis: Vec3, zAxis: Vec3, width: number, height: number) {
  const matrix = new Float32Array(16);

  matrix[0] = xAxis.x * width;
  matrix[1] = xAxis.y * width;
  matrix[2] = xAxis.z * width;
  matrix[4] = 0;
  matrix[5] = 0;
  matrix[6] = 0;
  matrix[8] = zAxis.x * height;
  matrix[9] = zAxis.y * height;
  matrix[10] = zAxis.z * height;
  matrix[12] = center.x;
  matrix[13] = center.y;
  matrix[14] = center.z;
  matrix[15] = 1;

  return matrix;
}

function phoneCardPoseFromMatrix(matrix: Float32Array, controls: ArCardControls) {
  const camera = cameraPositionFromMatrix(matrix);
  const right = normalizeVec3(rightFromMatrix(matrix));
  const up = normalizeVec3(upFromMatrix(matrix));
  const forward = normalizeVec3(forwardFromMatrix(matrix));
  const tiltRad = (controls.cardTiltDeg * Math.PI) / 180;
  const vertical = normalizeVec3(addVec3(scaleVec3(up, Math.cos(tiltRad)), scaleVec3(forward, Math.sin(tiltRad))));
  const center = addVec3(
    addVec3(camera, scaleVec3(forward, controls.cardDistance)),
    scaleVec3(up, CARD_VERTICAL_OFFSET_METERS),
  );

  return {
    center,
    right,
    forward,
    vertical,
  };
}

function arCardPixelWidth(controls: ArCardControls) {
  const viewportWidth = window.innerWidth || 390;

  return clamp((viewportWidth * AR_CARD_VIEWPORT_SCALE) / controls.cardDistance, AR_CARD_MIN_PX, AR_CARD_MAX_PX);
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const h = ((hue % 360) + 360) % 360;
  const s = clamp(saturation, 0, 100) / 100;
  const l = clamp(lightness, 0, 100) / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - chroma / 2;
  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 60) {
    r = chroma;
    g = x;
  } else if (h < 120) {
    r = x;
    g = chroma;
  } else if (h < 180) {
    g = chroma;
    b = x;
  } else if (h < 240) {
    g = x;
    b = chroma;
  } else if (h < 300) {
    r = x;
    b = chroma;
  } else {
    r = chroma;
    b = x;
  }

  return [r + m, g + m, b + m];
}

function colorToCanvasCss(color: ArCardColor, lightnessOffset = 0, saturationOffset = 0, alpha = 1) {
  const saturation = clamp(color.saturation + saturationOffset, 0, 100);
  const lightness = clamp(color.lightness + lightnessOffset, 0, 100);

  if (alpha >= 1) {
    return `hsl(${color.hue} ${saturation}% ${lightness}%)`;
  }

  return `hsl(${color.hue} ${saturation}% ${lightness}% / ${alpha})`;
}

function seededNumber(seed: number) {
  const value = Math.sin(seed * 9301 + 49297) * 233280;
  return value - Math.floor(value);
}

function seededBetween(seed: number, min: number, max: number) {
  return min + seededNumber(seed) * (max - min);
}

function roundedRectPath(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function drawCanvasLinePattern(context: CanvasRenderingContext2D, card: ArCard, width: number, height: number) {
  const lineCount = Math.max(0, Math.min(5, card.lineCount ?? 0));

  if (!lineCount) {
    return;
  }

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";

  for (let index = 0; index < lineCount; index += 1) {
    const seed = card.id * 211 + index * 997;
    const startY = seededBetween(seed + 1, 0.08, 0.92) * height;
    const endY = seededBetween(seed + 2, 0.08, 0.92) * height;
    const bend = seededBetween(seed + 3, -0.18, 0.18) * height;
    const lineHue = (card.color.hue + 130 + index * 47) % 360;

    context.strokeStyle = card.randomLineColor ? `hsl(${lineHue} 86% 62% / 0.92)` : "hsl(0 0% 4% / 0.82)";
    context.lineWidth = card.randomLineColor ? 2.6 : 2.1;
    context.beginPath();
    context.moveTo(0, startY);
    context.bezierCurveTo(width * 0.32, startY + bend, width * 0.68, endY - bend, width, endY);
    context.stroke();
  }

  context.restore();
}

function drawCanvasTexture(context: CanvasRenderingContext2D, card: ArCard, width: number, height: number) {
  const kind = card.textureKind;

  if (!kind || kind === "none") {
    return;
  }

  context.save();
  context.globalAlpha = 0.34;
  context.strokeStyle = "rgba(255, 255, 255, 0.58)";
  context.fillStyle = "rgba(255, 255, 255, 0.34)";

  if (kind === "dots") {
    for (let index = 0; index < 22; index += 1) {
      const seed = card.id * 307 + index * 3;
      context.beginPath();
      context.arc(seededBetween(seed, 0.08, 0.92) * width, seededBetween(seed + 1, 0.08, 0.92) * height, seededBetween(seed + 2, 1.2, 3.6), 0, Math.PI * 2);
      context.fill();
    }
  } else if (kind === "grid") {
    context.lineWidth = 1.2;
    for (let x = 16; x < width; x += 28) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x + 10, height);
      context.stroke();
    }
    for (let y = 18; y < height; y += 30) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y + 7);
      context.stroke();
    }
  } else if (kind === "checker") {
    const cell = 24;
    for (let y = 0; y < height; y += cell) {
      for (let x = 0; x < width; x += cell) {
        if ((Math.floor(x / cell) + Math.floor(y / cell) + card.id) % 2 === 0) {
          context.fillRect(x, y, cell, cell);
        }
      }
    }
  }

  context.restore();
}

function createCardCanvas(card: ArCard) {
  const width = 256;
  const height = 358;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  canvas.width = width;
  canvas.height = height;

  if (!context) {
    return canvas;
  }

  context.clearRect(0, 0, width, height);
  context.save();
  roundedRectPath(context, 6, 6, width - 12, height - 12, 24);
  context.clip();

  if (card.isGradient) {
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, colorToCanvasCss(card.color, 14, 6));
    gradient.addColorStop(0.54, colorToCanvasCss({ ...card.color, hue: (card.color.hue + 68) % 360 }, 4, 8));
    gradient.addColorStop(1, colorToCanvasCss({ ...card.color, hue: (card.color.hue + 166) % 360 }, -5, 4));
    context.fillStyle = gradient;
  } else {
    context.fillStyle = colorToCanvasCss(card.color);
  }
  context.fillRect(0, 0, width, height);

  const glow = context.createRadialGradient(width * 0.26, height * 0.18, 0, width * 0.26, height * 0.18, width * 0.72);
  glow.addColorStop(0, "rgba(255, 255, 255, 0.28)");
  glow.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  drawCanvasTexture(context, card, width, height);
  drawCanvasLinePattern(context, card, width, height);

  if (card.emojiMark) {
    context.save();
    context.globalAlpha = card.emojiMark.opacity;
    context.translate((card.emojiMark.x / 100) * width, (card.emojiMark.y / 140) * height);
    context.rotate((card.emojiMark.rotate * Math.PI) / 180);
    context.font = `${Math.max(22, card.emojiMark.size * 1.35)}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(card.emojiMark.emoji, 0, 0);
    context.restore();
  }

  if (card.finishKind && card.finishKind !== "none") {
    const shine = context.createLinearGradient(0, height * 0.2, width, height * 0.72);
    shine.addColorStop(0, "rgba(255,255,255,0)");
    shine.addColorStop(0.48, "rgba(255,255,255,0.22)");
    shine.addColorStop(0.62, "rgba(255,255,255,0)");
    context.fillStyle = shine;
    context.fillRect(0, 0, width, height);
  }

  context.restore();
  roundedRectPath(context, 8, 8, width - 16, height - 16, 22);
  context.lineWidth = 3;
  context.strokeStyle = colorToCanvasCss(card.color, 10, -18, 0.72);
  context.stroke();

  return canvas;
}

function formatVec(vector: Vec3 | null) {
  if (!vector) {
    return "null";
  }

  return `${vector.x.toFixed(3)}, ${vector.y.toFixed(3)}, ${vector.z.toFixed(3)}`;
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);

  if (!shader) {
    throw new Error("Shader unavailable");
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Shader compile failed";
    gl.deleteShader(shader);
    throw new Error(message);
  }

  return shader;
}

function createRenderer(gl: WebGLRenderingContext): Renderer {
  const vertexShader = compileShader(
    gl,
    gl.VERTEX_SHADER,
    `
      attribute vec3 aPosition;
      attribute vec2 aUv;
      uniform mat4 uMvp;
      varying vec2 vUv;

      void main() {
        vUv = aUv;
        gl_Position = uMvp * vec4(aPosition, 1.0);
      }
    `,
  );
  const fragmentShader = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    `
      precision mediump float;
      uniform sampler2D uTexture;
      varying vec2 vUv;

      void main() {
        gl_FragColor = texture2D(uTexture, vUv);
      }
    `,
  );
  const program = gl.createProgram();

  if (!program) {
    throw new Error("WebGL program unavailable");
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "WebGL program link failed");
  }

  const vertexBuffer = gl.createBuffer();

  if (!vertexBuffer) {
    throw new Error("WebGL buffer unavailable");
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      -0.5, 0, -0.5, 0, 1,
      0.5, 0, -0.5, 1, 1,
      -0.5, 0, 0.5, 0, 0,
      0.5, 0, 0.5, 1, 0,
    ]),
    gl.STATIC_DRAW,
  );

  return {
    program,
    positionLocation: gl.getAttribLocation(program, "aPosition"),
    uvLocation: gl.getAttribLocation(program, "aUv"),
    mvpLocation: gl.getUniformLocation(program, "uMvp"),
    textureLocation: gl.getUniformLocation(program, "uTexture"),
    vertexBuffer,
  };
}

function createCanvas() {
  const canvas = document.createElement("canvas");
  canvas.className = "xrRenderCanvas";

  const resizeCanvas = () => {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(window.innerWidth * pixelRatio));
    canvas.height = Math.max(1, Math.floor(window.innerHeight * pixelRatio));
  };

  resizeCanvas();
  return { canvas, resizeCanvas };
}

function createDebug({
  frameCount,
  poseFrameCount,
  viewCount,
  drawnObjects,
  planeLocked,
  cardControls,
  camera,
  plane,
  card,
  activeCardId,
  worldCardCount,
  message,
}: Omit<ArDebugState, "referenceSpace" | "text">): ArDebugState {
  const referenceSpace = "local-floor";
  const text = [
    `message=${message}`,
    `frames=${frameCount}`,
    `poseFrames=${poseFrameCount}`,
    `views=${viewCount}`,
    `drawnObjects=${drawnObjects}`,
    `planeLocked=${planeLocked}`,
    `referenceSpace=${referenceSpace}`,
    `build=${AR_PROOF_BUILD}`,
    `activeCardId=${activeCardId ?? "null"}`,
    `worldCards=${worldCardCount}`,
    `cardDistance=${cardControls.cardDistance.toFixed(2)}m`,
    `cardTilt=${cardControls.cardTiltDeg.toFixed(0)}deg`,
    `camera=${formatVec(camera)}`,
    `plane=${formatVec(plane)}`,
    `phoneCard=${formatVec(card)}`,
    `userAgent=${navigator.userAgent}`,
  ].join("\n");

  return {
    frameCount,
    poseFrameCount,
    viewCount,
    drawnObjects,
    planeLocked,
    referenceSpace,
    cardControls,
    camera,
    plane,
    card,
    activeCardId,
    worldCardCount,
    message,
    text,
  };
}

export function getArUnavailableMessage(error?: unknown) {
  if (!window.isSecureContext) {
    return "AR needs HTTPS";
  }

  const xr = (navigator as Navigator & { xr?: XrSystemLike }).xr;

  if (!xr?.isSessionSupported || !xr.requestSession) {
    return "WebXR AR is not available";
  }

  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "AR permission blocked";
    }

    return `${error.name}: ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "AR could not start";
}

export async function createArEngine({
  initialCard,
  initialConfig,
  onEnd,
  onDebug,
}: {
  initialCard: ArCard;
  initialConfig?: Partial<ArCardControls>;
  onEnd: () => void;
  onDebug?: (state: ArDebugState) => void;
}): Promise<ArEngine> {
  const xr = (navigator as Navigator & { xr?: XrSystemLike }).xr;

  if (!window.isSecureContext || !xr?.isSessionSupported || !xr.requestSession) {
    throw new Error(getArUnavailableMessage());
  }

  if (!(await xr.isSessionSupported("immersive-ar"))) {
    throw new Error("AR is not supported on this browser");
  }

  const session = await xr.requestSession("immersive-ar", {
    requiredFeatures: ["local-floor"],
    optionalFeatures: ["dom-overlay"],
    domOverlay: { root: document.body },
  });

  try {
    const { canvas, resizeCanvas } = createCanvas();
    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: true,
      preserveDrawingBuffer: false,
      xrCompatible: true,
    } as WebGLContextAttributes & { xrCompatible: boolean }) as
      | (WebGLRenderingContext & { makeXRCompatible?: () => Promise<void> })
      | null;

    if (!gl) {
      throw new Error("WebGL unavailable");
    }

    await gl.makeXRCompatible?.();

    const XRWebGLLayerCtor = (window as unknown as {
      XRWebGLLayer?: new (
        session: XrSessionLike,
        context: WebGLRenderingContext,
        options?: { alpha?: boolean; antialias?: boolean; depth?: boolean },
      ) => XrWebGlLayerLike;
    }).XRWebGLLayer;

    if (!XRWebGLLayerCtor || !session.updateRenderState || !session.requestAnimationFrame) {
      throw new Error("XR WebGL layer unavailable");
    }

    const baseLayer = new XRWebGLLayerCtor(session, gl, { alpha: true, antialias: false, depth: true });
    session.updateRenderState({ baseLayer });
    const referenceSpace = await session.requestReferenceSpace?.("local-floor");

    if (!referenceSpace) {
      throw new Error("local-floor reference space unavailable");
    }

    const renderer = createRenderer(gl);
    let frameHandle: number | null = null;
    let running = true;
    let ended = false;
    let frameCount = 0;
    let poseFrameCount = 0;
    let lastDebugAt = 0;
    let lastFrameTime = 0;
    let planeCenter: Vec3 | null = null;
    let planeForward: Vec3 = { x: 0, y: 0, z: -1 };
    let lastCamera: Vec3 | null = null;
    let lastCardPosition: Vec3 | null = null;
    let lastCardPose: ReturnType<typeof phoneCardPoseFromMatrix> | null = null;
    let activeCard = initialCard;
    let nextWorldCardKey = 1;
    let worldCards: WorldCard[] = [];
    const textureCache = new Map<string, WebGLTexture>();
    let cardControls: ArCardControls = {
      ...DEFAULT_CARD_CONTROLS,
      ...initialConfig,
    };

    const setConfig = (config: Partial<ArCardControls>) => {
      cardControls = {
        cardDistance: clamp(config.cardDistance ?? cardControls.cardDistance, 0.3, 1.8),
        cardTiltDeg: clamp(config.cardTiltDeg ?? cardControls.cardTiltDeg, -75, 75),
      };
    };

    const getCardTexture = (card: ArCard) => {
      const textureKey = [
        card.id,
        card.color.hue,
        card.color.saturation,
        card.color.lightness,
        card.isGradient ? 1 : 0,
        card.lineCount ?? 0,
        card.patternLevel ?? 0,
        card.randomLineColor ? 1 : 0,
        card.textureKind ?? "none",
        card.finishKind ?? "none",
        card.emojiMark?.emoji ?? "",
      ].join(":");
      const cachedTexture = textureCache.get(textureKey);

      if (cachedTexture) {
        return cachedTexture;
      }

      const texture = gl.createTexture();

      if (!texture) {
        return null;
      }

      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, createCardCanvas(card));
      textureCache.set(textureKey, texture);

      if (textureCache.size > 48) {
        const firstKey = textureCache.keys().next().value;
        const oldTexture = firstKey ? textureCache.get(firstKey) : null;

        if (firstKey) {
          textureCache.delete(firstKey);
        }

        if (oldTexture) {
          gl.deleteTexture(oldTexture);
        }
      }

      return texture;
    };

    const drawTexturedPlane = (modelMatrix: Float32Array, viewProjection: Float32Array, texture: WebGLTexture) => {
      const mvp = multiplyMatrix4(viewProjection, modelMatrix);

      gl.useProgram(renderer.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, renderer.vertexBuffer);
      gl.enableVertexAttribArray(renderer.positionLocation);
      gl.vertexAttribPointer(renderer.positionLocation, 3, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(renderer.uvLocation);
      gl.vertexAttribPointer(renderer.uvLocation, 2, gl.FLOAT, false, 20, 12);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniformMatrix4fv(renderer.mvpLocation, false, mvp);
      gl.uniform1i(renderer.textureLocation, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    const spawnWorldCard = (card: ArCard, gesture: ArThrowGesture) => {
      if (!lastCardPose) {
        return;
      }

      const throwSpeed = clamp(gesture.throwSpeed / 560, 1.05, 8.4);
      const screenLift = clamp(-gesture.unitY, -0.45, 1);
      const metersPerPixel = CARD_WIDTH_METERS / arCardPixelWidth(cardControls);
      const releaseOffset = addVec3(
        scaleVec3(lastCardPose.right, clamp(gesture.startX * metersPerPixel, -CARD_WIDTH_METERS * 1.25, CARD_WIDTH_METERS * 1.25)),
        scaleVec3(lastCardPose.vertical, clamp(-gesture.startY * metersPerPixel, -CARD_HEIGHT_METERS * 1.25, CARD_HEIGHT_METERS * 1.25)),
      );
      const direction = normalizeVec3(
        addVec3(
          addVec3(scaleVec3(lastCardPose.forward, 1.16 + clamp(throwSpeed * 0.035, 0, 0.3)), scaleVec3(lastCardPose.right, gesture.unitX * 0.82)),
          scaleVec3(lastCardPose.vertical, screenLift * 0.72 + 0.08),
        ),
      );
      const offsetCarry = addVec3(scaleVec3(lastCardPose.right, gesture.startX * metersPerPixel * 1.4), scaleVec3(lastCardPose.vertical, -gesture.startY * metersPerPixel * 1.4));
      const velocity = addVec3(addVec3(scaleVec3(direction, throwSpeed), scaleVec3(lastCardPose.vertical, screenLift * 0.32)), offsetCarry);
      const normal = normalizeVec3(crossVec3(lastCardPose.right, lastCardPose.vertical));

      worldCards = [
        ...worldCards.slice(-(WORLD_CARD_LIMIT - 1)),
        {
          key: nextWorldCardKey,
          card,
          position: addVec3(addVec3(lastCardPose.center, releaseOffset), scaleVec3(lastCardPose.forward, 0.025)),
          velocity,
          right: lastCardPose.right,
          vertical: lastCardPose.vertical,
          normal,
          spinVelocity: clamp(gesture.spin * 0.09 + gesture.unitX * 3.2, -10, 10),
          tumbleVelocity: clamp(throwSpeed * 1.15 + Math.abs(gesture.unitY) * 1.2, 0.6, 7.2),
          age: 0,
          settled: false,
        },
      ];
      nextWorldCardKey += 1;
    };

    const settleWorldCard = (card: WorldCard) => {
      const forward = horizontalOrFallback(card.velocity, planeForward);
      card.position.y = WORLD_FLOOR_Y;
      card.velocity = { x: 0, y: 0, z: 0 };
      card.vertical = forward;
      card.right = floorRightFromForward(forward);
      card.normal = { x: 0, y: 1, z: 0 };
      card.spinVelocity = 0;
      card.tumbleVelocity = 0;
      card.settled = true;
    };

    const updateWorldCards = (time: number) => {
      if (!lastFrameTime) {
        lastFrameTime = time;
        return;
      }

      const dt = clamp((time - lastFrameTime) / 1000, 0.001, 0.05);
      lastFrameTime = time;

      for (const card of worldCards) {
        card.age += dt;

        if (card.settled) {
          continue;
        }

        card.velocity.y -= WORLD_GRAVITY * dt;
        const drag = Math.max(0, 1 - WORLD_DRAG * dt);
        card.velocity.x *= drag;
        card.velocity.y *= Math.max(0, 1 - WORLD_DRAG * 0.35 * dt);
        card.velocity.z *= drag;
        card.position = addVec3(card.position, scaleVec3(card.velocity, dt));

        if (Math.abs(card.spinVelocity) > 0.001) {
          card.right = rotateVecAroundAxis(card.right, card.normal, card.spinVelocity * dt);
          card.vertical = rotateVecAroundAxis(card.vertical, card.normal, card.spinVelocity * dt);
        }

        if (Math.abs(card.tumbleVelocity) > 0.001) {
          card.vertical = rotateVecAroundAxis(card.vertical, card.right, card.tumbleVelocity * dt);
          card.normal = rotateVecAroundAxis(card.normal, card.right, card.tumbleVelocity * dt);
        }

        card.spinVelocity *= Math.max(0, 1 - 0.72 * dt);
        card.tumbleVelocity *= Math.max(0, 1 - 0.88 * dt);

        if (card.position.y <= WORLD_FLOOR_Y) {
          if (Math.hypot(card.velocity.x, card.velocity.y, card.velocity.z) < 0.46 || card.age > 3.2) {
            settleWorldCard(card);
          } else {
            card.position.y = WORLD_FLOOR_Y;
            card.velocity.y = Math.abs(card.velocity.y) * 0.12;
            card.velocity.x *= 0.82;
            card.velocity.z *= 0.82;
            card.tumbleVelocity *= 0.64;
          }
        }
      }

      worldCards = worldCards.filter((card) => card.age < 24 || card.settled).slice(-WORLD_CARD_LIMIT);
    };

    const emitDebug = (time: number, viewCount: number, drawnObjects: number, message: string) => {
      if (time - lastDebugAt < 500) {
        return;
      }

      lastDebugAt = time;
      onDebug?.(
        createDebug({
          frameCount,
          poseFrameCount,
          viewCount,
          drawnObjects,
          planeLocked: Boolean(planeCenter),
          cardControls,
          camera: lastCamera,
          plane: planeCenter,
          card: lastCardPosition,
          activeCardId: activeCard?.id ?? null,
          worldCardCount: worldCards.length,
          message,
        }),
      );
    };

    const drawFrame = (time: number, frame: unknown) => {
      if (!running) {
        return;
      }

      frameHandle = session.requestAnimationFrame?.(drawFrame) ?? null;
      frameCount += 1;
      const layer = session.renderState?.baseLayer ?? baseLayer;
      const pose = (frame as XrFrameLike).getViewerPose?.(referenceSpace);

      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      if (!pose?.views.length || !layer.getViewport) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        emitDebug(time, 0, 0, "No XR pose yet");
        return;
      }

      poseFrameCount += 1;
      const poseMatrix = pose.transform?.matrix ?? pose.views[0]?.transform?.matrix;

      if (poseMatrix) {
        lastCamera = cameraPositionFromMatrix(poseMatrix);

        if (!planeCenter) {
          planeForward = normalizeHorizontal(forwardFromMatrix(poseMatrix));
          planeCenter = {
            x: lastCamera.x + planeForward.x * PLANE_DISTANCE_METERS,
            y: 0,
            z: lastCamera.z + planeForward.z * PLANE_DISTANCE_METERS,
          };
        }
      } else {
        lastCardPosition = null;
      }

      let drawnObjects = 0;
      const cardPose = poseMatrix ? phoneCardPoseFromMatrix(poseMatrix, cardControls) : null;
      lastCardPosition = cardPose?.center ?? null;
      lastCardPose = cardPose;
      updateWorldCards(time);

      for (const view of pose.views) {
        const viewport = layer.getViewport(view);
        const viewMatrix = view.transform?.inverse?.matrix;

        if (!viewport || !viewMatrix || !planeCenter) {
          continue;
        }

        gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        const viewProjection = multiplyMatrix4(view.projectionMatrix, viewMatrix);

        for (const worldCard of worldCards) {
          const texture = getCardTexture(worldCard.card);

          if (!texture) {
            continue;
          }

          const model = orientedPlaneMatrix(
            addVec3(worldCard.position, scaleVec3(worldCard.normal, 0.004)),
            worldCard.right,
            worldCard.vertical,
            CARD_WIDTH_METERS,
            CARD_HEIGHT_METERS,
          );

          drawTexturedPlane(model, viewProjection, texture);
          drawnObjects += 1;
        }
      }

      emitDebug(
        time,
        pose.views.length,
        drawnObjects,
        planeCenter ? "AR tracking active; thrown cards live in world physics" : "Waiting to lock floor plane",
      );
    };

    const cleanup = () => {
      running = false;
      window.removeEventListener("resize", resizeCanvas);
      for (const texture of textureCache.values()) {
        gl.deleteTexture(texture);
      }
      textureCache.clear();
      canvas.remove();
    };

    const handleEnd = () => {
      if (ended) {
        return;
      }

      ended = true;
      cleanup();
      onEnd();
    };

    window.addEventListener("resize", resizeCanvas);
    document.body.appendChild(canvas);
    session.addEventListener("end", handleEnd);
    frameHandle = session.requestAnimationFrame(drawFrame);
    onDebug?.(
      createDebug({
        frameCount: 0,
        poseFrameCount: 0,
        viewCount: 0,
        drawnObjects: 0,
        planeLocked: false,
        cardControls,
        camera: null,
        plane: null,
        card: null,
        activeCardId: activeCard?.id ?? null,
        worldCardCount: worldCards.length,
        message: "XR session started; waiting for local-floor pose",
      }),
    );

    return {
      setActiveCard: (card: ArCard) => {
        activeCard = card;
      },
      setConfig,
      throwCard: spawnWorldCard,
      stop: () => {
        if (ended) {
          return;
        }

        ended = true;
        cleanup();
        session.removeEventListener?.("end", handleEnd);

        if (frameHandle !== null) {
          session.cancelAnimationFrame?.(frameHandle);
          frameHandle = null;
        }

        void session.end().catch(() => undefined);
      },
    };
  } catch (error) {
    void session.end().catch(() => undefined);
    throw error;
  }
}
