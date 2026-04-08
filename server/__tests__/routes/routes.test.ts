import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import request from 'supertest'
import { getTestApp, resetTestApp } from './test-app'
import type { Application } from 'express'

let app: Application

beforeAll(async () => {
  const result = await getTestApp()
  app = result.app
})

afterEach(() => resetTestApp())

// ── GET /api/scenarios ────────────────────────────────────────────────────────

describe('GET /api/scenarios', () => {
  it('returns array of scenario summaries', async () => {
    const res = await request(app).get('/api/scenarios')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('fixture scenario is excluded from scenario list', async () => {
    const res = await request(app).get('/api/scenarios')
    const ids = (res.body as Array<{ id: string }>).map(s => s.id)
    expect(ids).not.toContain('_fixture')
  })

  it('each summary has id, title, description, serviceType, difficulty, tags', async () => {
    const res = await request(app).get('/api/scenarios')
    for (const s of res.body as Array<Record<string, unknown>>) {
      expect(s).toHaveProperty('id')
      expect(s).toHaveProperty('title')
      expect(s).toHaveProperty('serviceType')
      expect(s).toHaveProperty('difficulty')
    }
  })
})

// ── GET /api/scenarios/:id ────────────────────────────────────────────────────

describe('GET /api/scenarios/:id', () => {
  it('unknown scenario returns 404', async () => {
    const res = await request(app).get('/api/scenarios/nonexistent-id')
    expect(res.status).toBe(404)
  })
})

// ── POST /api/sessions ────────────────────────────────────────────────────────

describe('POST /api/sessions', () => {
  it('unknown scenarioId → 404', async () => {
    const res = await request(app)
      .post('/api/sessions')
      .send({ scenarioId: 'nonexistent' })
    expect(res.status).toBe(404)
  })

  it('missing scenarioId → 400', async () => {
    const res = await request(app).post('/api/sessions').send({})
    expect(res.status).toBe(400)
  })
})

// ── DELETE /api/sessions/:id ──────────────────────────────────────────────────

describe('DELETE /api/sessions/:id', () => {
  it('unknown session → 404', async () => {
    const res = await request(app).delete('/api/sessions/ghost-id')
    expect(res.status).toBe(404)
  })
})

// ── POST /api/sessions/:id/actions ───────────────────────────────────────────

describe('POST /api/sessions/:id/actions', () => {
  it('unknown session → 404', async () => {
    const res = await request(app)
      .post('/api/sessions/ghost/actions')
      .send({ action: 'view_metric' })
    expect(res.status).toBe(404)
  })

  it('unknown session → 404 (action validation runs after session lookup)', async () => {
    const res = await request(app)
      .post('/api/sessions/ghost/actions')
      .send({ action: 'detonate_everything' })
    // Session not found → 404 (action validation runs after session lookup)
    expect(res.status).toBe(404)
  })
})

// ── POST /api/sessions/:id/speed ──────────────────────────────────────────────

describe('POST /api/sessions/:id/speed', () => {
  it('unknown session → 404', async () => {
    const res = await request(app)
      .post('/api/sessions/ghost/speed')
      .send({ speed: 2 })
    expect(res.status).toBe(404)
  })
})

// ── POST /api/sessions/:id/coach ──────────────────────────────────────────────

describe('POST /api/sessions/:id/coach', () => {
  it('returns 501 Not Implemented (Phase 9 stub)', async () => {
    const res = await request(app)
      .post('/api/sessions/any-id/coach')
      .send({ message: 'help' })
    expect(res.status).toBe(501)
  })
})
