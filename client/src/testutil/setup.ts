/// <reference types="vitest/globals" />
import '@testing-library/jest-dom'
import { setupServer } from 'msw/node'
import { defaultHandlers } from './msw-handlers'

// Suppress console.error in tests unless explicitly expected
// (avoids noise from intentional error paths being tested)

// MSW server — intercepts all fetch calls in tests
export const server = setupServer(...defaultHandlers)

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

// ResizeObserver is not implemented in all jsdom versions — required by Recharts
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// requestAnimationFrame / cancelAnimationFrame: polyfill if not present.
// In vitest 4, vi.useFakeTimers() adds these; vi.useRealTimers() removes them.
// Components cleanup via cancelAnimationFrame so it must always exist.
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    return setTimeout(() => cb(Date.now()), 16) as unknown as number
  }
}
if (typeof globalThis.cancelAnimationFrame === 'undefined') {
  globalThis.cancelAnimationFrame = (id: number): void => {
    clearTimeout(id)
  }
}
