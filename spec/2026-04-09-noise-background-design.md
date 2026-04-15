# Noise Field Shader Background

Animated simplex noise WebGL shader rendered behind auth pages. Subtle dark gray variations on `#0a0a0a`, slow drift, ambient feel.

## Component

`NoiseBackground` — full-screen `<canvas>` with WebGL2 fragment shader.

### Visual

- Base color: `#0a0a0a` (matches `--color-background`)
- Noise varies brightness by ~3-5% — visible if you look, not distracting
- Slow drift: ~0.05 speed factor on time uniform
- 2 octaves of fractional Brownian motion (fbm) for organic texture
- Monochrome only — no colors

### Shader

- Single fragment shader with simplex noise
- Uniforms: `u_time` (elapsed seconds), `u_resolution` (canvas size)
- No mouse interaction — purely ambient

### Rendering

- `requestAnimationFrame` loop
- Canvas: `position: fixed`, `inset: 0`, behind all content
- Resizes with window via `ResizeObserver`

### Fallback

- If `canvas.getContext("webgl2")` returns null, render nothing
- Plain `bg-background` shows through — no error, no degraded mode

## Integration

Add `<NoiseBackground />` to each auth page's outer container.

## Files

| Path | Action |
|---|---|
| `apps/console/src/components/noise-background.tsx` | Create |
| `apps/console/src/app/(auth)/auth/signin/page.tsx` | Modify — add NoiseBackground |
| `apps/console/src/app/(auth)/auth/signup/page.tsx` | Modify — add NoiseBackground |
| `apps/console/src/app/(auth)/auth/forgot-password/page.tsx` | Modify — add NoiseBackground |
| `apps/console/src/app/(auth)/auth/reset-password/page.tsx` | Modify — add NoiseBackground |
| `apps/console/src/app/(auth)/auth/auth-code-error/page.tsx` | Modify — add NoiseBackground |
