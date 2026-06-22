# Fidget Cards

A tiny full-screen fidget app made with Vite, React, TypeScript, and Framer Motion. Swipe or flick the top card away, then keep going forever.

## Features

- Full-screen responsive card stack for desktop and mobile browsers
- Touch and mouse drag support
- Swipe velocity and direction drive the throw animation
- Weak swipes snap the card back to center
- Pleasant randomized card colors with back-to-back hue separation
- Gradient cards unlock once the counter reaches 15
- Thin black edge-to-edge line patterns unlock as the counter climbs: 1 sweep at 30, paired lines at 50, wave patterns at 70, loose woven lines at 90, then random 0-5 colored pattern lines and random gradient mode at 100
- Random texture families start appearing after later milestones: dots at 110, waves at 125, grid overlays at 145, stars at 165, checker patterns at 185
- Rare card finishes start appearing after 130, with gloss and neon effects first and occasional foil cards after 200
- Random emoji marks start appearing at 200, and the available emoji pool gains another randomly selected emoji every 100 cards after that
- Fast repeated throws build a small combo badge, and successful throws create subtle color particles
- Small counter, reset icon, and counter show/hide control
- Long-press the eye icon on a phone to enter look-throw mode: WebXR AR is used where available, otherwise the app falls back to camera passthrough
- Keyboard shortcuts: arrow keys or WASD to throw, Space/Enter for a random throw, R to reset, C to toggle controls, F for fullscreen
- Mobile haptic vibration on successful throws where supported
- Dockerized static build served by Nginx on container port `80`

## Local Development

```bash
npm install
npm run dev
```

Vite will print the local URL. The app can also be previewed after a production build:

```bash
npm run build
npm run preview
```

## Docker

Build and run with Docker Compose:

```bash
docker compose up -d --build
```

Open:

```text
http://localhost:3095
```

The container serves the app on port `80`, with the compose file mapping host port `3095` to container port `80`.

Camera passthrough and WebXR generally require a secure browser context on phones. For phone testing outside `localhost`, serve the app through HTTPS or a secure reverse proxy/tunnel.

## Temporary TryCloudflare URL

The compose file includes an optional `trycloudflared` service for quick phone testing over HTTPS. It is disabled by default.

Enable it locally with:

```bash
COMPOSE_PROFILES=trycloudflare docker compose up -d --build
```

Then get the temporary public URL from the tunnel logs:

```bash
docker compose logs -f trycloudflared
```

Look for a generated `https://...trycloudflare.com` URL. That URL is temporary and will change when the tunnel restarts.

You can also copy `.env.example` to `.env` and set:

```text
COMPOSE_PROFILES=trycloudflare
```

## Portainer Deployment

1. In Portainer, go to **Stacks**.
2. Select **Add stack**.
3. Name the stack `fidget-cards`.
4. Choose **Repository** if this folder is in a Git repo, or **Web editor** if pasting the compose file manually.
5. Use this compose content:

```yaml
services:
  fidget-cards:
    build:
      context: .
    container_name: fidget-cards
    ports:
      - "3095:80"
    restart: unless-stopped

  trycloudflared:
    image: cloudflare/cloudflared:latest
    container_name: fidget-cards-trycloudflared
    profiles:
      - trycloudflare
    command: tunnel --no-autoupdate --url http://fidget-cards:80
    depends_on:
      - fidget-cards
    restart: unless-stopped
```

6. To enable the temporary HTTPS tunnel in Portainer, add an environment variable for the stack:

```text
COMPOSE_PROFILES=trycloudflare
```

7. Deploy the stack.
8. Visit `http://YOUR_SERVER_IP:3095`, or open the `trycloudflared` container logs and use the generated `https://...trycloudflare.com` URL for phone camera testing.

If Portainer is deploying from a Git repository, keep the `Dockerfile`, `nginx.conf`, `package.json`, `src/`, and `index.html` files in the repository root so the build context is correct.
