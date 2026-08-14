import { describe, expect, it } from 'vitest'
import { Config, validateConfig } from '../src/index.ts'

// A schemastery schema is a callable: Config(input) validates and returns the
// normalized output with defaults applied. The type is erased here because the
// generic infers from the interface; we only exercise runtime behavior.
function parse(input: Record<string, unknown>): unknown {
  return (Config as unknown as (v: unknown) => unknown)(input)
}

describe('Config schema', () => {
  it('defaults enabled, browser, minRunSeconds and keeps a valid app target', () => {
    const result = parse({ target: { kind: 'app', app: 'TikTok' } }) as {
      enabled: boolean
      browser: string
      minRunSeconds: number
      target: { kind: 'app'; app: string }
    }
    expect(result.enabled).toBe(true)
    expect(result.browser).toBe('chrome')
    expect(result.minRunSeconds).toBe(2)
    expect(result.target).toEqual({ kind: 'app', app: 'TikTok' })
  })

  it('accepts a url target', () => {
    const result = parse({ target: { kind: 'url', url: 'https://example.com' } }) as {
      target: { kind: 'url'; url: string }
    }
    expect(result.target).toEqual({ kind: 'url', url: 'https://example.com' })
  })

  it('accepts an object scroll config', () => {
    const result = parse({
      target: { kind: 'url', url: 'https://example.com' },
      scroll: { intervalSeconds: 3 },
    }) as { scroll: { intervalSeconds: number } }
    expect(result.scroll).toEqual({ intervalSeconds: 3 })
  })
})

describe('validateConfig (fail-loud)', () => {
  it('throws on an empty app name', () => {
    expect(() => validateConfig({ target: { kind: 'app', app: '   ' }, minRunSeconds: 2 }))
      .toThrow(/target\.app must be a non-empty string/)
  })

  it('throws when app is missing for kind app', () => {
    expect(() => validateConfig({ target: { kind: 'app' }, minRunSeconds: 2 }))
      .toThrow(/target\.app must be a non-empty string/)
  })

  it('throws when target is missing entirely', () => {
    expect(() => validateConfig({ minRunSeconds: 2 })).toThrow(/target is required/)
  })

  it('throws when target.kind is unknown', () => {
    expect(() => validateConfig({ target: { kind: 'window', app: 'x' }, minRunSeconds: 2 }))
      .toThrow(/target\.kind must be "app" or "url"/)
  })

  it('throws when url is missing for kind url', () => {
    expect(() => validateConfig({ target: { kind: 'url' }, minRunSeconds: 2 }))
      .toThrow(/target\.url must be a string/)
  })

  it('throws on a non-URL string for the url kind', () => {
    expect(() => validateConfig({ target: { kind: 'url', url: 'not a url' }, minRunSeconds: 2 }))
      .toThrow(/not a valid URL/)
  })

  it('throws on a non-http(s) URL', () => {
    expect(() => validateConfig({ target: { kind: 'url', url: 'ftp://example.com' }, minRunSeconds: 2 }))
      .toThrow(/must be absolute http\(s\)/)
  })

  it('throws on a non-positive minRunSeconds', () => {
    expect(() => validateConfig({ target: { kind: 'app', app: 'X' }, minRunSeconds: 0 }))
      .toThrow(/minRunSeconds must be a positive/)
    expect(() => validateConfig({ target: { kind: 'app', app: 'X' }, minRunSeconds: -1 }))
      .toThrow(/minRunSeconds must be a positive/)
  })

  it('accepts a valid app config', () => {
    expect(() => validateConfig({ target: { kind: 'app', app: 'TikTok' }, minRunSeconds: 2 }))
      .not.toThrow()
  })

  it('accepts a valid url config', () => {
    expect(() => validateConfig({ target: { kind: 'url', url: 'https://example.com/a?b=1' }, minRunSeconds: 2 }))
      .not.toThrow()
  })
})
