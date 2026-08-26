# Nuclear God's Eye — Stage 1

## Baseline

This repository is the dedicated Nuclear God's Eye development repository. The original God's Eye View repository remains untouched.

Baseline: `5006f63f8bd1cb661d6a8c0dafe5938eb602f490`.

## Stage 1 — Preparation

- Existing Cesium 3D globe remains the visual foundation.
- Game-specific code is isolated from existing application modules.
- Secrets are never committed; `.env.example` contains names/placeholders only.
- Replit is a future runtime target and will be connected when access is restored.

## Safety / simulation boundary

Gameplay systems use abstract game parameters. No real-world targeting coordinates, operational plans, or actionable military deployment data are stored here.

## Stage status

**Prepared:** dedicated repository and stage boundary.

**Next:** add the minimal server/WebSocket runtime without replacing the existing Vite/Cesium application, then connect the globe to the game shell.
