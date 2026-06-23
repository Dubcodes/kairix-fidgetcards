export type ArCardColor = {
  hue: number;
  saturation: number;
  lightness: number;
};

export type ArCard = {
  id: number;
  color: ArCardColor;
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
  drawnCards: number;
  message: string;
  error?: string;
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
  requestReferenceSpace?: (type: "local-floor" | "local" | "viewer") => Promise<unknown>;
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

type CameraBasis = {
  position: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
};

type ThrownArCard = {
  card: ArCard;
  position: Vec3;
  velocity: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  spin: number;
  spinVelocity: number;
  age: number;
};

type Renderer = {
  program: WebGLProgram;
  positionLocation: number;
  mvpLocation: WebGLUniformLocation | null;
  colorLocation: WebGLUniformLocation | null;
  vertexBuffer: WebGLBuffer;
};

export type ArEngine = {
  setActiveCard: (card: ArCard) => void;
  throwCard: (card: ArCard, gesture: ArThrowGesture) => void;
  stop: () => void;
};

const MAX_THROWN_CARDS = 8;
const CARD_WIDTH = 0.42;
const CARD_HEIGHT = 0.58;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function vecAdd(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function vecScale(vector: Vec3, scale: number): Vec3 {
  return { x: vector.x * scale, y: vector.y * scale, z: vector.z * scale };
}

function hslToRgb(color: ArCardColor) {
  const saturation = color.saturation / 100;
  const lightness = color.lightness / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const huePrime = color.hue / 60;
  const secondary = chroma * (1 - Math.abs((huePrime % 2) - 1));
  const match = lightness - chroma / 2;
  let red = 0;
  let green = 0;
  let blue = 0;

  if (huePrime < 1) {
    red = chroma;
    green = secondary;
  } else if (huePrime < 2) {
    red = secondary;
    green = chroma;
  } else if (huePrime < 3) {
    green = chroma;
    blue = secondary;
  } else if (huePrime < 4) {
    green = secondary;
    blue = chroma;
  } else if (huePrime < 5) {
    red = secondary;
    blue = chroma;
  } else {
    red = chroma;
    blue = secondary;
  }

  return [red + match, green + match, blue + match] as const;
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

function cameraBasisFromMatrix(matrix: Float32Array): CameraBasis {
  return {
    position: { x: matrix[12], y: matrix[13], z: matrix[14] },
    right: { x: matrix[0], y: matrix[1], z: matrix[2] },
    up: { x: matrix[4], y: matrix[5], z: matrix[6] },
    forward: { x: -matrix[8], y: -matrix[9], z: -matrix[10] },
  };
}

function cardModelMatrix(position: Vec3, right: Vec3, up: Vec3, forward: Vec3, width: number, height: number, spin: number) {
  const cos = Math.cos(spin);
  const sin = Math.sin(spin);
  const xAxis = vecAdd(vecScale(right, cos), vecScale(up, sin));
  const yAxis = vecAdd(vecScale(right, -sin), vecScale(up, cos));
  const matrix = new Float32Array(16);

  matrix[0] = xAxis.x * width;
  matrix[1] = xAxis.y * width;
  matrix[2] = xAxis.z * width;
  matrix[4] = yAxis.x * height;
  matrix[5] = yAxis.y * height;
  matrix[6] = yAxis.z * height;
  matrix[8] = forward.x * 0.02;
  matrix[9] = forward.y * 0.02;
  matrix[10] = forward.z * 0.02;
  matrix[12] = position.x;
  matrix[13] = position.y;
  matrix[14] = position.z;
  matrix[15] = 1;

  return matrix;
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
      uniform mat4 uMvp;

      void main() {
        gl_Position = uMvp * vec4(aPosition, 1.0);
      }
    `,
  );
  const fragmentShader = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    `
      precision mediump float;
      uniform vec4 uColor;

      void main() {
        gl_FragColor = uColor;
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
    new Float32Array([-0.5, -0.7, 0, 0.5, -0.7, 0, -0.5, 0.7, 0, 0.5, 0.7, 0]),
    gl.STATIC_DRAW,
  );

  return {
    program,
    positionLocation: gl.getAttribLocation(program, "aPosition"),
    mvpLocation: gl.getUniformLocation(program, "uMvp"),
    colorLocation: gl.getUniformLocation(program, "uColor"),
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

function createDebug(frameCount: number, poseFrameCount: number, viewCount: number, drawnCards: number, message: string): ArDebugState {
  return { frameCount, poseFrameCount, viewCount, drawnCards, message };
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
  onEnd,
  onDebug,
}: {
  initialCard: ArCard;
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
    optionalFeatures: ["dom-overlay", "local-floor"],
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
    const referenceSpace = await session.requestReferenceSpace?.("local-floor").catch(() => session.requestReferenceSpace?.("local"));

    if (!referenceSpace) {
      throw new Error("XR reference space unavailable");
    }

    const renderer = createRenderer(gl);
    const thrownCards: ThrownArCard[] = [];
    let activeCard: ArCard = initialCard;
    let frameHandle: number | null = null;
    let running = true;
    let frameCount = 0;
    let poseFrameCount = 0;
    let lastDebugAt = 0;
    let lastFrameTime = 0;
    let ended = false;
    let lastCamera: CameraBasis = {
      position: { x: 0, y: 1.45, z: 0 },
      right: { x: 1, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      forward: { x: 0, y: 0, z: -1 },
    };

    const drawCard = (card: ArCard, modelMatrix: Float32Array, viewProjection: Float32Array, alpha = 0.96) => {
      const mvp = multiplyMatrix4(viewProjection, modelMatrix);
      const [red, green, blue] = hslToRgb(card.color);

      gl.useProgram(renderer.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, renderer.vertexBuffer);
      gl.enableVertexAttribArray(renderer.positionLocation);
      gl.vertexAttribPointer(renderer.positionLocation, 3, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(renderer.mvpLocation, false, mvp);
      gl.uniform4f(renderer.colorLocation, red, green, blue, alpha);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    const updateThrownCards = (deltaSeconds: number) => {
      for (const card of thrownCards) {
        card.age += deltaSeconds;
        card.velocity.y -= 0.45 * deltaSeconds;
        card.position = vecAdd(card.position, vecScale(card.velocity, deltaSeconds));
        card.spin += card.spinVelocity * deltaSeconds;
      }

      for (let index = thrownCards.length - 1; index >= 0; index -= 1) {
        const card = thrownCards[index];
        const distance = Math.hypot(
          card.position.x - lastCamera.position.x,
          card.position.y - lastCamera.position.y,
          card.position.z - lastCamera.position.z,
        );

        if (card.age > 9 || distance > 14) {
          thrownCards.splice(index, 1);
        }
      }
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
        onDebug?.(createDebug(frameCount, poseFrameCount, 0, 0, "No XR pose yet"));
        return;
      }

      poseFrameCount += 1;
      const poseMatrix = pose.transform?.matrix ?? pose.views[0]?.transform?.matrix;

      if (poseMatrix) {
        lastCamera = cameraBasisFromMatrix(poseMatrix);
      }

      const deltaSeconds = lastFrameTime > 0 ? clamp((time - lastFrameTime) / 1000, 0.001, 0.05) : 0.016;
      lastFrameTime = time;
      updateThrownCards(deltaSeconds);

      let drawnCards = 0;

      for (const view of pose.views) {
        const viewport = layer.getViewport(view);
        const viewMatrix = view.transform?.inverse?.matrix;

        if (!viewport || !viewMatrix) {
          continue;
        }

        gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        const viewProjection = multiplyMatrix4(view.projectionMatrix, viewMatrix);

        for (const thrownCard of thrownCards) {
          drawCard(
            thrownCard.card,
            cardModelMatrix(thrownCard.position, thrownCard.right, thrownCard.up, thrownCard.forward, CARD_WIDTH, CARD_HEIGHT, thrownCard.spin),
            viewProjection,
            clamp(1 - thrownCard.age / 10, 0.28, 0.96),
          );
          drawnCards += 1;
        }

        const activePosition = vecAdd(vecAdd(lastCamera.position, vecScale(lastCamera.forward, 0.82)), vecScale(lastCamera.up, -0.08));
        drawCard(
          activeCard,
          cardModelMatrix(activePosition, lastCamera.right, lastCamera.up, lastCamera.forward, CARD_WIDTH * 0.9, CARD_HEIGHT * 0.9, 0),
          viewProjection,
          0.98,
        );
        drawnCards += 1;
      }

      if (time - lastDebugAt > 500) {
        lastDebugAt = time;
        onDebug?.(createDebug(frameCount, poseFrameCount, pose.views.length, drawnCards, "XR drawing cards"));
      }
    };

    const cleanup = () => {
      running = false;
      window.removeEventListener("resize", resizeCanvas);
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
    onDebug?.(createDebug(0, 0, 0, 0, "XR session started"));

    return {
      setActiveCard: (card) => {
        activeCard = card;
      },
      throwCard: (card, gesture) => {
        const offsetRight = clamp(gesture.startX / 620, -0.42, 0.42);
        const offsetUp = clamp(-gesture.startY / 620, -0.52, 0.52);
        const speed = clamp(gesture.throwSpeed / 850, 0.45, 5.8);
        const lateral = speed * 0.26;
        const lift = speed * 0.1;

        thrownCards.push({
          card,
          position: vecAdd(
            vecAdd(vecAdd(lastCamera.position, vecScale(lastCamera.forward, 0.82)), vecScale(lastCamera.right, offsetRight)),
            vecScale(lastCamera.up, offsetUp - 0.08),
          ),
          velocity: vecAdd(
            vecAdd(vecScale(lastCamera.forward, speed), vecScale(lastCamera.right, gesture.unitX * lateral)),
            vecScale(lastCamera.up, -gesture.unitY * lift),
          ),
          right: lastCamera.right,
          up: lastCamera.up,
          forward: lastCamera.forward,
          spin: 0,
          spinVelocity: clamp(gesture.spin / 30, -4.4, 4.4),
          age: 0,
        });

        if (thrownCards.length > MAX_THROWN_CARDS) {
          thrownCards.splice(0, thrownCards.length - MAX_THROWN_CARDS);
        }
      },
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

        canvas.remove();
        void session.end().catch(() => undefined);
      },
    };
  } catch (error) {
    void session.end().catch(() => undefined);
    throw error;
  }
}
