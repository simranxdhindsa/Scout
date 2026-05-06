import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Routes that do not require authentication
const PUBLIC_ROUTES = [
  '/login',
  '/auth/callback',
  '/api/v1/auth/google',
  '/api/v1/auth/google/callback',
]

// Routes only accessible by platform admins
const ADMIN_ROUTES = ['/admin']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Always allow public routes and Next.js internals
  if (
    PUBLIC_ROUTES.some((r) => pathname.startsWith(r)) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next()
  }

  // Read JWT from httpOnly cookie set on callback
  const token = request.cookies.get('scout_token')?.value

  if (!token) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Decode JWT payload (no verification — verification happens server-side)
  // We only use this for client-side route guards, not for security
  try {
    const parts = token.split('.')
    if (parts.length !== 3) throw new Error('invalid jwt')

    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8')
    )

    // Check platform admin routes
    if (ADMIN_ROUTES.some((r) => pathname.startsWith(r))) {
      if (!payload.is_plat_admin) {
        return NextResponse.redirect(new URL('/', request.url))
      }
    }

    // Attach user info to request headers for server components
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-user-id', payload.uid ?? '')
    requestHeaders.set('x-user-email', payload.email ?? '')
    requestHeaders.set('x-is-plat-admin', payload.is_plat_admin ? 'true' : 'false')
    requestHeaders.set('authorization', `Bearer ${token}`)

    return NextResponse.next({ request: { headers: requestHeaders } })
  } catch {
    // Malformed token — clear cookie and redirect to login
    const response = NextResponse.redirect(new URL('/login', request.url))
    response.cookies.delete('scout_token')
    return response
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - public folder files
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
