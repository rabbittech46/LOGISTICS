// ─────────────────────────────────────────────────────────────────────────────
// Auth Routes — Registration, login, token refresh, logout
// ─────────────────────────────────────────────────────────────────────────────
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as authService from '../services/auth.service.js';

const router = Router();

// ── Validation Schemas ──────────────────────────────────────────────────────

const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128)
    .regex(/[A-Z]/, 'Must contain uppercase letter')
    .regex(/[a-z]/, 'Must contain lowercase letter')
    .regex(/[0-9]/, 'Must contain digit')
    .regex(/[^A-Za-z0-9]/, 'Must contain special character'),
  firstName: z.string().min(1).max(100).trim(),
  lastName: z.string().min(1).max(100).trim(),
  phone: z.string().max(20).optional(),
});

const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(128),
  orgId: z.string().uuid().optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

function isNativeClient(req: Request): boolean {
  return req.get('x-client-platform') === 'native';
}

// ── POST /auth/register ─────────────────────────────────────────────────────
router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = registerSchema.parse(req.body);
    const result = await authService.register(body);
    res.status(201).json({ data: result });
  } catch (err) { next(err); }
});

// ── POST /auth/login ────────────────────────────────────────────────────────
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = loginSchema.parse(req.body);
    const result = await authService.login(body);
    const nativeClient = isNativeClient(req);

    // Set refresh token as httpOnly secure cookie
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      path: '/api/v1/auth/refresh',
    });

    res.json({
      data: {
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
        ...(nativeClient ? { refreshToken: result.refreshToken } : {}),
        user: result.user,
      },
    });
  } catch (err) { next(err); }
});

// ── POST /auth/refresh ──────────────────────────────────────────────────────
router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Accept from cookie or body
    const refreshToken = req.cookies?.refreshToken ?? refreshSchema.parse(req.body).refreshToken;
    const tokens = await authService.refreshAccessToken(refreshToken);
    const nativeClient = isNativeClient(req);

    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/api/v1/auth/refresh',
    });

    res.json({
      data: {
        accessToken: tokens.accessToken,
        expiresIn: tokens.expiresIn,
        ...(nativeClient ? { refreshToken: tokens.refreshToken } : {}),
      },
    });
  } catch (err) { next(err); }
});

// ── POST /auth/logout ───────────────────────────────────────────────────────
router.post('/logout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const refreshToken = req.cookies?.refreshToken ?? req.body?.refreshToken;
    if (refreshToken) {
      await authService.logout(refreshToken);
    }
    res.clearCookie('refreshToken', { path: '/api/v1/auth/refresh' });
    res.json({ data: { message: 'Logged out' } });
  } catch (err) { next(err); }
});

export { router as authRoutes };
