/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reusable Toast Notification System for The Glossy Looks Admin Portal.
 * Provides consistent success, error, warning, and info notifications
 * across desktop and mobile without blocking interactive controls.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastOptions {
  title?: string;
  duration?: number;
}

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  message: string;
  title?: string;
  duration: number;
}

export interface ToastApi {
  show: (variant: ToastVariant, message: string, options?: ToastOptions) => string;
  success: (message: string, options?: ToastOptions) => string;
  error: (message: string, options?: ToastOptions) => string;
  warning: (message: string, options?: ToastOptions) => string;
  info: (message: string, options?: ToastOptions) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const DEFAULT_DURATIONS: Record<ToastVariant, number> = {
  success: 5000,
  info: 5000,
  warning: 6500,
  error: 7500,
};

const MAX_VISIBLE_TOASTS = 4;

/**
 * Extracts a safe, human-readable error message from unknown errors,
 * fetch failures, timeouts, and API error objects without exposing internals.
 */
export function getSafeErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!err) return fallback;

  if (typeof err === 'string') {
    const trimmed = err.trim();
    if (!trimmed || trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) return fallback;
    return trimmed.slice(0, 220);
  }

  if (err instanceof DOMException && err.name === 'AbortError') {
    return 'Request timed out. Please check your connection and try again.';
  }

  const anyErr = err as { name?: string; message?: string; error?: string };
  if (anyErr.name === 'AbortError') {
    return 'Request timed out. Please check your connection and try again.';
  }

  const raw = typeof anyErr.message === 'string'
    ? anyErr.message.trim()
    : typeof anyErr.error === 'string'
      ? anyErr.error.trim()
      : '';

  if (!raw) return fallback;
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(raw)) {
    return 'Network error. Please check your internet connection and try again.';
  }
  if (raw.startsWith('<!DOCTYPE') || raw.startsWith('<html')) {
    return fallback;
  }
  return raw.slice(0, 220);
}

const noopToastApi: ToastApi = {
  show: () => '',
  success: () => '',
  error: () => '',
  warning: () => '',
  info: () => '',
  dismiss: () => {},
  clear: () => {},
};

const ToastContext = createContext<ToastApi>(noopToastApi);

export const useToast = (): ToastApi => useContext(ToastContext);

interface ToastCardProps {
  item: ToastItem;
  onDismiss: (id: string) => void;
}

const VARIANT_STYLES: Record<ToastVariant, {
  container: string;
  iconColor: string;
  titleColor: string;
  textColor: string;
  closeColor: string;
  Icon: React.FC<{ className?: string }>;
}> = {
  success: {
    container: 'bg-emerald-50/95 border-emerald-300 shadow-emerald-950/10',
    iconColor: 'text-emerald-600',
    titleColor: 'text-emerald-950',
    textColor: 'text-emerald-900',
    closeColor: 'text-emerald-600 hover:text-emerald-900 hover:bg-emerald-100',
    Icon: CheckCircle2,
  },
  error: {
    container: 'bg-rose-50/95 border-rose-300 shadow-rose-950/10',
    iconColor: 'text-rose-600',
    titleColor: 'text-rose-950',
    textColor: 'text-rose-900',
    closeColor: 'text-rose-600 hover:text-rose-900 hover:bg-rose-100',
    Icon: AlertCircle,
  },
  warning: {
    container: 'bg-amber-50/95 border-amber-300 shadow-amber-950/10',
    iconColor: 'text-amber-600',
    titleColor: 'text-amber-950',
    textColor: 'text-amber-900',
    closeColor: 'text-amber-600 hover:text-amber-900 hover:bg-amber-100',
    Icon: AlertTriangle,
  },
  info: {
    container: 'bg-sky-50/95 border-sky-300 shadow-sky-950/10',
    iconColor: 'text-sky-600',
    titleColor: 'text-sky-950',
    textColor: 'text-sky-900',
    closeColor: 'text-sky-600 hover:text-sky-900 hover:bg-sky-100',
    Icon: Info,
  },
};

const ToastCard: React.FC<ToastCardProps> = ({ item, onDismiss }) => {
  const pausedRef = useRef(false);
  const remainingRef = useRef(item.duration);
  const startedAtRef = useRef(Date.now());
  const timerRef = useRef<number | null>(null);

  const scheduleDismiss = useCallback((ms: number) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    startedAtRef.current = Date.now();
    timerRef.current = window.setTimeout(() => {
      onDismiss(item.id);
    }, Math.max(400, ms));
  }, [item.id, onDismiss]);

  useEffect(() => {
    scheduleDismiss(item.duration);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, [item.duration, scheduleDismiss]);

  const handleMouseEnter = () => {
    if (pausedRef.current) return;
    pausedRef.current = true;
    const elapsed = Date.now() - startedAtRef.current;
    remainingRef.current = Math.max(1200, remainingRef.current - elapsed);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleMouseLeave = () => {
    if (!pausedRef.current) return;
    pausedRef.current = false;
    scheduleDismiss(remainingRef.current);
  };

  const style = VARIANT_STYLES[item.variant];
  const Icon = style.Icon;

  return (
    <div
      role={item.variant === 'error' ? 'alert' : 'status'}
      aria-live={item.variant === 'error' ? 'assertive' : 'polite'}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`pointer-events-auto w-full rounded-2xl border px-3.5 py-3 shadow-lg backdrop-blur-md transition-all duration-200 flex items-start gap-2.5 ${style.container}`}
    >
      <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${style.iconColor}`} />
      <div className="flex-1 min-w-0 text-xs leading-relaxed">
        {item.title && (
          <p className={`font-bold mb-0.5 ${style.titleColor}`}>{item.title}</p>
        )}
        <p className={`font-medium break-words ${style.textColor}`}>{item.message}</p>
      </div>
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        aria-label="Dismiss notification"
        className={`p-1 rounded-lg transition-colors shrink-0 cursor-pointer ${style.closeColor}`}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const clear = useCallback(() => {
    setToasts([]);
  }, []);

  const show = useCallback((variant: ToastVariant, message: string, options?: ToastOptions): string => {
    const cleanMessage = (message || '').trim();
    if (!cleanMessage) return '';
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const duration = options?.duration ?? DEFAULT_DURATIONS[variant];
    const nextToast: ToastItem = {
      id,
      variant,
      message: cleanMessage,
      title: options?.title,
      duration,
    };
    setToasts(prev => {
      // Deduplicate identical consecutive toast messages so rapid triggers don't flood the screen
      const filtered = prev.filter(t => !(t.variant === variant && t.message === cleanMessage));
      return [...filtered, nextToast].slice(-MAX_VISIBLE_TOASTS);
    });
    return id;
  }, []);

  const api = useMemo<ToastApi>(() => ({
    show,
    success: (message, options) => show('success', message, options),
    error: (message, options) => show('error', message, options),
    warning: (message, options) => show('warning', message, options),
    info: (message, options) => show('info', message, options),
    dismiss,
    clear,
  }), [show, dismiss, clear]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Non-blocking floating notification stack (top-right on desktop, top-center on mobile) */}
      <div
        aria-label="Notifications"
        className="fixed z-[100] pointer-events-none top-3 left-3 right-3 sm:top-4 sm:right-4 sm:left-auto sm:w-full sm:max-w-sm flex flex-col gap-2"
      >
        {toasts.map(item => (
          <ToastCard key={item.id} item={item} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
};
