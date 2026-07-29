import type { FastifyReply, FastifyRequest } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import { OAuth2Client } from 'google-auth-library';
import type { Env } from '../config/env.js';
import { parseAllowlist } from '../config/env.js';
import type { Db } from '../db/index.js';
import { ensureUserDefaults, newId } from '../db/index.js';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  picture: string;
};

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export function createAuthHelpers(env: Env, db: Db) {
  const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);
  const secret = new TextEncoder().encode(env.JWT_SECRET);
  const allowlist = parseAllowlist(env.ALLOWED_GOOGLE_EMAILS);
  const isProd = env.NODE_ENV === 'production';
  const defaultLlm = env.LLM_PROVIDER;

  async function issueSession(reply: FastifyReply, user: AuthUser): Promise<void> {
    const token = await new SignJWT({
      sub: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(secret);

    reply.setCookie(env.COOKIE_NAME, token, {
      httpOnly: true,
      secure: isProd || env.PUBLIC_ORIGIN.startsWith('https'),
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });
  }

  function clearSession(reply: FastifyReply): void {
    reply.clearCookie(env.COOKIE_NAME, { path: '/' });
  }

  async function verifyGoogleIdToken(credential: string) {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      throw new Error('Invalid Google token payload');
    }
    return {
      googleSub: payload.sub,
      email: payload.email.toLowerCase(),
      name: payload.name ?? payload.email,
      picture: payload.picture ?? '',
      emailVerified: payload.email_verified === true,
    };
  }

  function isAllowed(email: string): boolean {
    if (allowlist === '*') {
      if (isProd) return false;
      return true;
    }
    return allowlist.includes(email.toLowerCase());
  }

  function upsertUser(profile: {
    googleSub: string;
    email: string;
    name: string;
    picture: string;
  }): AuthUser {
    const existing = db
      .prepare('SELECT id, email, name, picture FROM users WHERE google_sub = ? OR email = ?')
      .get(profile.googleSub, profile.email) as
      | { id: string; email: string; name: string; picture: string }
      | undefined;

    if (existing) {
      db.prepare(
        `UPDATE users SET google_sub = ?, email = ?, name = ?, picture = ?, updated_at = datetime('now')
         WHERE id = ?`,
      ).run(profile.googleSub, profile.email, profile.name, profile.picture, existing.id);
      ensureUserDefaults(db, existing.id, defaultLlm);
      return {
        id: existing.id,
        email: profile.email,
        name: profile.name,
        picture: profile.picture,
      };
    }

    const id = newId();
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO users (id, google_sub, email, name, picture) VALUES (?, ?, ?, ?, ?)`,
      ).run(id, profile.googleSub, profile.email, profile.name, profile.picture);
      ensureUserDefaults(db, id, defaultLlm);
    });
    tx();
    return { id, email: profile.email, name: profile.name, picture: profile.picture };
  }

  async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = request.cookies[env.COOKIE_NAME];
    if (!token) {
      return reply.unauthorized('Not authenticated');
    }
    try {
      const { payload } = await jwtVerify(token, secret);
      const id = String(payload.sub ?? '');
      const email = String(payload.email ?? '');
      if (!id || !email) {
        return reply.unauthorized('Invalid session');
      }
      const row = db.prepare('SELECT id, email, name, picture FROM users WHERE id = ?').get(id) as
        | AuthUser
        | undefined;
      if (!row) {
        clearSession(reply);
        return reply.unauthorized('User not found');
      }
      request.user = row;
    } catch {
      clearSession(reply);
      return reply.unauthorized('Invalid session');
    }
  }

  return {
    issueSession,
    clearSession,
    verifyGoogleIdToken,
    isAllowed,
    upsertUser,
    requireAuth,
  };
}

export type AuthHelpers = ReturnType<typeof createAuthHelpers>;
