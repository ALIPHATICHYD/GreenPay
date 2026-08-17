import { NextResponse, type NextRequest } from 'next/server'

const STELLAR_CONNECT = [
  'https://horizon-testnet.stellar.org',
  'https://horizon.stellar.org',
  'https://soroban-testnet.stellar.org',
  'https://soroban.stellar.org',
  'https://friendbot.stellar.org',
].join(' ')

function buildCsp(nonce: string, isWidget: boolean): string {
  // API origin: 'self' covers same-origin deploys. When the backend lives on
  // a different origin (local dev, or a separate API subdomain in
  // production), NEXT_PUBLIC_API_URL names it explicitly — allowlist that
  // origin too, in every environment, or every API call gets CSP-blocked.
  const apiOrigin = (() => {
    try {
      return process.env.NEXT_PUBLIC_API_URL ? new URL(process.env.NEXT_PUBLIC_API_URL).origin : null
    } catch {
      return null
    }
  })()

  const connectSrc = [
    "'self'",
    STELLAR_CONNECT,
    'https://api.coingecko.com',
    ...(apiOrigin ? [apiOrigin] : []),
  ].join(' ')

  const directives = [
    "default-src 'self'",
    // nonce tags the Next.js script injection; strict-dynamic propagates trust to bundles
    // it loads; unsafe-inline is a no-op in CSP3 but keeps CSP2 browsers working.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    `connect-src ${connectSrc}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    isWidget ? "frame-ancestors *" : "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ]

  return directives.join('; ')
}

export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID())
  const isWidget = request.nextUrl.pathname.startsWith('/widget/')
  const csp = buildCsp(nonce, isWidget)

  const requestHeaders = new Headers(request.headers)
  // x-nonce is read in pages/_document.tsx to stamp <Head> and <NextScript>
  requestHeaders.set('x-nonce', nonce)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)

  return response
}

export const config = {
  // Skip static assets — CSP is only meaningful on HTML responses.
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|ico|svg|webp)$).*)'],
}
