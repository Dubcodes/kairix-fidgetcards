export type ArCardColor = {
  hue: number;
  saturation: number;
  lightness: number;
};

export type ArCard = {
  id: number;
  color: ArCardColor;
};

export const AR_PROOF_BUILD = "ar-floor-proof-2026-06-24-02";

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
  camera: { x: number; y: number; z: number } | null;
  plane: { x: number; y: number; z: number } | null;
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
  mvpLocation: WebGLUniformLocation | null;
  colorLocation: WebGLUniformLocation | null;
  vertexBuffer: WebGLBuffer;
};

export type ArEngine = {
  setActiveCard: (card: ArCard) => void;
  throwCard: (card: ArCard, gesture: ArThrowGesture) => void;
  stop: () => void;
};

const PLANE_SIZE_METERS = 1.25;
const PLANE_DISTANCE_METERS = 1.7;

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

function normalizeHorizontal(vector: Vec3) {
  const length = Math.hypot(vector.x, vector.z);

  if (length < 0.001) {
    return { x: 0, y: 0, z: -1 };
  }

  return { x: vector.x / length, y: 0, z: vector.z / length };
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
    new Float32Array([-0.5, 0, -0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5]),
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

function createDebug({
  frameCount,
  poseFrameCount,
  viewCount,
  drawnObjects,
  planeLocked,
  camera,
  plane,
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
    `camera=${formatVec(camera)}`,
    `plane=${formatVec(plane)}`,
    `userAgent=${navigator.userAgent}`,
  ].join("\n");

  return {
    frameCount,
    poseFrameCount,
    viewCount,
    drawnObjects,
    planeLocked,
    referenceSpace,
    camera,
    plane,
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
    let planeCenter: Vec3 | null = null;
    let planeForward: Vec3 = { x: 0, y: 0, z: -1 };
    let lastCamera: Vec3 | null = null;

    const drawPlane = (modelMatrix: Float32Array, viewProjection: Float32Array, color: readonly [number, number, number], alpha: number) => {
      const mvp = multiplyMatrix4(viewProjection, modelMatrix);

      gl.useProgram(renderer.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, renderer.vertexBuffer);
      gl.enableVertexAttribArray(renderer.positionLocation);
      gl.vertexAttribPointer(renderer.positionLocation, 3, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(renderer.mvpLocation, false, mvp);
      gl.uniform4f(renderer.colorLocation, color[0], color[1], color[2], alpha);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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
          camera: lastCamera,
          plane: planeCenter,
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
      }

      let drawnObjects = 0;

      for (const view of pose.views) {
        const viewport = layer.getViewport(view);
        const viewMatrix = view.transform?.inverse?.matrix;

        if (!viewport || !viewMatrix || !planeCenter) {
          continue;
        }

        gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        const viewProjection = multiplyMatrix4(view.projectionMatrix, viewMatrix);
        const model = floorPlaneMatrix(planeCenter, planeForward, PLANE_SIZE_METERS);
        drawPlane(model, viewProjection, [1, 1, 1], 0.78);
        drawnObjects += 1;
      }

      emitDebug(time, pose.views.length, drawnObjects, planeCenter ? "Drawing local-floor white plane" : "Waiting to lock floor plane");
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
    onDebug?.(
      createDebug({
        frameCount: 0,
        poseFrameCount: 0,
        viewCount: 0,
        drawnObjects: 0,
        planeLocked: false,
        camera: null,
        plane: null,
        message: "XR session started; waiting for local-floor pose",
      }),
    );

    return {
      setActiveCard: () => undefined,
      throwCard: () => undefined,
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
