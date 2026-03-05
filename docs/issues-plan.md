# Issue Breakdown

## 01 feat(cli): scaffold npm executable
- TypeScript CLI project, bin entry, args, logger, error codes.

## 02 feat(auth): one-time license start/resume/complete
- Session API client, license prompt, device fingerprint hash, setup-state persistence.

## 03 feat(installer): openclaw install and PATH recovery
- Install command, `openclaw --version` check, zsh/bash PATH fixes.

## 04 feat(onboard): guided semi-automatic onboarding
- Run onboard wizard with operator guidance and phase checkpointing.

## 05 feat(config): schema-driven model prompts + json merge
- Dynamic form by backend schema, models id/name validation, merge write config.

## 06 feat(browser): chrome detection and browser config
- Detect Chrome binary and write isolated browser profile config when available.

## 07 feat(gateway): start and connectivity verification
- Start/restart gateway and verify connectivity with Bearer token.

## 08 chore(release): packaging, docs, ci, npm publish
- README, CI smoke checks, prepublish gates.
