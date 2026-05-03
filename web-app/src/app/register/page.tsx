'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { registerSchema, type RegisterFormData } from '../../lib/validations';
import { api, ApiRequestError } from '../../lib/api-client';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';

export default function RegisterPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = async (data: RegisterFormData) => {
    setServerError('');
    try {
      await api.post('/api/v1/auth/register', data);
      router.push('/login?registered=1');
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setServerError(err.errorBody.error || 'Registration failed');
      } else {
        setServerError('Network error. Please try again.');
      }
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10 sm:px-6">
      <div className="mobile-screen grid w-full max-w-5xl gap-6 lg:grid-cols-[1fr_1fr]">
        <section className="surface-elevated rounded-[34px] p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-200/70">Create account</p>
          <h1 className="mt-3 text-3xl font-black text-white sm:text-4xl">Start with a secure logistics identity.</h1>
          <p className="mt-4 text-sm leading-7 text-slate-300">
            Accounts work across shipper, carrier, driver, and admin workflows, with one mobile shell and role-aware navigation once you sign in.
          </p>

          <div className="mt-8 grid gap-3">
            <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
              <p className="text-sm font-semibold text-white">One account, multiple organizations</p>
              <p className="mt-1 text-sm text-slate-400">Switch between tenants and roles from the in-app account sheet.</p>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
              <p className="text-sm font-semibold text-white">Production-ready auth</p>
              <p className="mt-1 text-sm text-slate-400">Backed by rotating JWTs and native-safe refresh token support.</p>
            </div>
          </div>
        </section>

        <section className="surface-elevated rounded-[34px] p-6 sm:p-8">
          <form data-testid="register-form" onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {serverError && (
              <div data-testid="register-error" className="rounded-[22px] border border-red-400/20 bg-red-500/12 px-4 py-3 text-sm text-red-100">
                {serverError}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="First name"
                placeholder="John"
                error={errors.firstName?.message}
                {...register('firstName')}
              />
              <Input
                label="Last name"
                placeholder="Doe"
                error={errors.lastName?.message}
                {...register('lastName')}
              />
            </div>

            <Input
              label="Email"
              type="email"
              placeholder="you@company.com"
              autoComplete="email"
              error={errors.email?.message}
              {...register('email')}
            />

            <Input
              label="Phone (optional)"
              type="tel"
              placeholder="+1 (555) 000-0000"
              error={errors.phone?.message}
              {...register('phone')}
            />

            <Input
              label="Password"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              error={errors.password?.message}
              hint="8+ chars with uppercase, lowercase, digit, and special character"
              {...register('password')}
            />

            <Button data-testid="register-submit" type="submit" loading={isSubmitting} className="w-full" size="lg">
              Create account
            </Button>
          </form>

          <div className="mt-6 rounded-[24px] border border-white/10 bg-white/5 px-4 py-4 text-sm text-slate-300">
            Already have an account?{' '}
            <Link data-testid="login-link" href="/login" className="font-semibold text-sky-300 hover:text-sky-200">
              Sign in
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
