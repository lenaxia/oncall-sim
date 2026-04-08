// Typed fixture constants used across multiple test files.
// Avoids repeated file I/O in unit tests.

import type { PersonaConfig, AlarmConfig, RemediationActionConfig } from '../scenario/types'

export const FIXTURE_SCENARIO_ID = '_fixture'
export const FIXTURE_SESSION_ID  = 'test-session-id'

export const FIXTURE_PERSONA: PersonaConfig = {
  id:                   'fixture-persona',
  displayName:          'Test Persona',
  avatarColor:          '#4A90E2',
  initiatesContact:     true,
  cooldownSeconds:      60,
  silentUntilContacted: false,
  systemPrompt:         'You are a test persona.',
}

export const FIXTURE_ALARM: AlarmConfig = {
  id:          'fixture-alarm-001',
  service:     'fixture-service',
  metricId:    'error_rate',
  condition:   'error_rate > 5%',
  severity:    'SEV2',
  onsetSecond: 0,
  autoPage:    true,
  pageMessage: 'fixture-service error rate 12% (threshold: 5%)',
}

export const FIXTURE_REMEDIATION_ACTION: RemediationActionConfig = {
  id:            'rollback_fixture_service',
  type:          'rollback',
  service:       'fixture-service',
  isCorrectFix:  true,
  targetVersion: 'v1.0.0',
}
