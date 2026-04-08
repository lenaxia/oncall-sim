import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Badge, severityVariant, logLevelVariant } from '../../src/components/Badge'

describe('Badge', () => {
  describe('rendering', () => {
    it('renders the label text', () => {
      const { getByText } = render(<Badge label="SEV1" />)
      expect(getByText('SEV1')).toBeInTheDocument()
    })

    it('default variant renders without error', () => {
      const { getByText } = render(<Badge label="tag" />)
      expect(getByText('tag')).toBeInTheDocument()
    })
  })

  describe('variants', () => {
    it('variant=sev1 has text-sim-red class', () => {
      const { container } = render(<Badge label="SEV1" variant="sev1" />)
      expect(container.firstChild).toHaveClass('text-sim-red')
    })

    it('variant=sev2 has text-sim-orange class', () => {
      const { container } = render(<Badge label="SEV2" variant="sev2" />)
      expect(container.firstChild).toHaveClass('text-sim-orange')
    })

    it('variant=sev3 has text-sim-yellow class', () => {
      const { container } = render(<Badge label="SEV3" variant="sev3" />)
      expect(container.firstChild).toHaveClass('text-sim-yellow')
    })

    it('variant=sev4 has text-sim-info class', () => {
      const { container } = render(<Badge label="SEV4" variant="sev4" />)
      expect(container.firstChild).toHaveClass('text-sim-info')
    })

    it('variant=success has text-sim-green class', () => {
      const { container } = render(<Badge label="OK" variant="success" />)
      expect(container.firstChild).toHaveClass('text-sim-green')
    })

    it('variant=warning has text-sim-yellow class', () => {
      const { container } = render(<Badge label="WARN" variant="warning" />)
      expect(container.firstChild).toHaveClass('text-sim-yellow')
    })

    it('variant=info has text-sim-info class', () => {
      const { container } = render(<Badge label="INFO" variant="info" />)
      expect(container.firstChild).toHaveClass('text-sim-info')
    })
  })

  describe('pulse', () => {
    it('pulse=true adds animate-pulse class', () => {
      const { container } = render(<Badge label="FIRING" variant="sev1" pulse />)
      expect(container.firstChild).toHaveClass('animate-pulse')
    })

    it('pulse=false does not add animate-pulse', () => {
      const { container } = render(<Badge label="ACK" variant="sev1" pulse={false} />)
      expect(container.firstChild).not.toHaveClass('animate-pulse')
    })

    it('pulse defaults to false', () => {
      const { container } = render(<Badge label="X" variant="sev1" />)
      expect(container.firstChild).not.toHaveClass('animate-pulse')
    })
  })
})

describe('severityVariant', () => {
  it('SEV1 → sev1', () => expect(severityVariant('SEV1')).toBe('sev1'))
  it('SEV2 → sev2', () => expect(severityVariant('SEV2')).toBe('sev2'))
  it('SEV3 → sev3', () => expect(severityVariant('SEV3')).toBe('sev3'))
  it('SEV4 → sev4', () => expect(severityVariant('SEV4')).toBe('sev4'))
})

describe('logLevelVariant', () => {
  it('ERROR → sev1', () => expect(logLevelVariant('ERROR')).toBe('sev1'))
  it('WARN → warning', () => expect(logLevelVariant('WARN')).toBe('warning'))
  it('INFO → info', () => expect(logLevelVariant('INFO')).toBe('info'))
  it('DEBUG → debug', () => expect(logLevelVariant('DEBUG')).toBe('debug'))
})
