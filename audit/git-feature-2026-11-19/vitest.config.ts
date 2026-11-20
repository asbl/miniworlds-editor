import { defineConfig } from 'vitest/config'

// Audit probes intentionally assert the observed defects; excluded from normal unit tests.
export default defineConfig({ test: { environment: 'node', include: ['audit/git-feature-2026-11-19/probes.ts'] } })
