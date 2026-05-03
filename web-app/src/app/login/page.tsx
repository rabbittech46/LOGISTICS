'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { loginSchema, type LoginFormData } from '../../lib/validations';
import { api, ApiRequestError } from '../../lib/api-client';
import { useAuthStore } from '../../stores/auth-store';
import type { LoginResponse } from '../../lib/types';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';

export default function LoginPage() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const [serverError, setServerError] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    setServerError('');
    try {
      const res = await api.post<LoginResponse>('/api/v1/auth/login', data);
      login(res.data.user, res.data.accessToken, res.data.refreshToken);
      router.push('/');
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setServerError(err.errorBody.error || 'Login failed');
      } else {
        setServerError('Network error. Please try again.');
      }
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10 sm:px-6">
      <div className="mobile-screen grid w-full max-w-5xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="surface-elevated rounded-[34px] p-6 sm:p-8">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-[24px] bg-gradient-to-br from-sky-400 to-blue-600 text-2xl font-black text-white shadow-[0_18px_40px_rgba(31,134,255,0.4)]">
            RT
          </div>
          <div className="mt-6 max-w-lg">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-200/70">RabbitTech Logistics</p>
            <h1 className="mt-3 text-4xl font-black tracking-tight text-white sm:text-5xl">
              Dispatch operations designed like a real Android app.
            </h1>
            <p className="mt-4 text-base leading-7 text-slate-300">
              Move between loads, trips, payments, and live tracking with phone-first navigation, fast-touch actions, and field-ready workflows.
            </p>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Realtime</p>
              <p className="mt-2 text-lg font-bold text-white">Tracking</p>
              <p className="mt-1 text-sm text-slate-400">Shared GPS telemetry and dispatch visibility.</p>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Secure</p>
              <p className="mt-2 text-lg font-bold text-white">Escrow</p>
              <p className="mt-1 text-sm text-slate-400">Browser and native-safe payment authorization flows.</p>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Field Ops</p>
              <p className="mt-2 text-lg font-bold text-white">POD</p>
              <p className="mt-1 text-sm text-slate-400">Capture delivery proof with driver-friendly task flows.</p>
            </div>
          </div>
        </section>

        <section className="surface-elevated rounded-[34px] p-6 sm:p-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-200/70">Welcome back</p>
            <h2 className="mt-3 text-2xl font-black text-white">Sign in to continue</h2>
            <p className="mt-2 text-sm text-slate-400">Use your shipper, carrier, driver, or admin account.</p>
          </div>

          <form data-testid="login-form" onSubmit={handleSubmit(onSubmit)} className="mt-7 space-y-5">
            {serverError && (
              <div data-testid="login-error" className="rounded-[22px] border border-red-400/20 bg-red-500/12 px-4 py-3 text-sm text-red-100">
                {serverError}
              </div>
            )}

            <Input
              label="Email"
              type="email"
              placeholder="you@company.com"
              autoComplete="email"
              error={errors.email?.message}
              {...register('email')}
            />

            <Input
              label="Password"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              error={errors.password?.message}
              {...register('password')}
            />

            <Button
              data-testid="login-submit"
              type="submit"
              loading={isSubmitting}
              className="w-full"
              size="lg"
            >
              Sign in
            </Button>
          </form>

          <div className="mt-6 rounded-[24px] border border-white/10 bg-white/5 px-4 py-4 text-sm text-slate-300">
            New to the platform?{' '}
            <Link data-testid="register-link" href="/register" className="font-semibold text-sky-300 hover:text-sky-200">
              Create your account
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
