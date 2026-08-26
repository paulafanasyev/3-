# Nuclear God's Eye — Stage 1

## Baseline

The game is developed in this repository as a separate project from the original God's Eye View repository.

Baseline source commit: `5006f63f8bd1cb661d6a8c0dafe5938eb602f490`

## Stage 1 — Preparation

- Preserve the existing 3D globe application as the visual foundation.
- Keep game-specific code isolated under `src/nuclear/` and `data/nuclear/`.
- Keep secrets out of Git; use `.env.example` only for documented variable names.
- Replit will be used later as the runtime/deployment environment when access is restored.

## Runtime contract

- Existing application start/build commands remain authoritative until inspected and adapted.
- Nuclear gameplay modules must not replace the existing globe renderer during Stage 1.
- All gameplay parameters are simulation/gameplay abstractions, not real-world targeting data.

## Change log

### Stage 1

Prepared a dedicated project boundary and documentation for Nuclear God's Eye. No changes are made to the original `paulafanasyev/-_-` repository.
