/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reusable async action hooks with synchronous duplicate-submission protection
 * and guaranteed try/catch/finally state restoration.
 */

import { useCallback, useRef, useState } from 'react';
import { useToast, getSafeErrorMessage } from '../components/common/ToastProvider';

export interface RunActionOptions<TResult> {
  successMessage?: string | ((result: TResult) => string | null | undefined);
  errorFallback?: string;
  showErrorToast?: boolean;
  onSuccess?: (result: TResult) => void | Promise<void>;
  onError?: (message: string, err: unknown) => void;
}

/**
 * Manages a single asynchronous button/form action with:
 * - Immediate synchronous ref lock (prevents rapid double-click duplicates)
 * - React loading state (`isLoading`)
 * - Guaranteed cleanup in `finally`
 * - Optional automatic toast notifications
 */
export function useAsyncAction() {
  const toast = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const inFlightRef = useRef(false);

  const run = useCallback(
    async <TResult,>(
      action: () => Promise<TResult>,
      options?: RunActionOptions<TResult>
    ): Promise<{ ok: true; data: TResult } | { ok: false; error: string; skipped?: boolean }> => {
      if (inFlightRef.current) {
        return { ok: false, error: 'Action already in progress', skipped: true };
      }
      inFlightRef.current = true;
      setIsLoading(true);
      try {
        const data = await action();
        if (options?.onSuccess) {
          await options.onSuccess(data);
        }
        if (options?.successMessage) {
          const msg =
            typeof options.successMessage === 'function'
              ? options.successMessage(data)
              : options.successMessage;
          if (msg) toast.success(msg);
        }
        return { ok: true, data };
      } catch (err) {
        const msg = getSafeErrorMessage(err, options?.errorFallback);
        if (options?.showErrorToast !== false) {
          toast.error(msg);
        }
        if (options?.onError) {
          options.onError(msg, err);
        }
        return { ok: false, error: msg };
      } finally {
        inFlightRef.current = false;
        setIsLoading(false);
      }
    },
    [toast]
  );

  return { isLoading, run };
}

/**
 * Manages keyed per-row / per-item asynchronous actions (e.g. Confirm Appointment,
 * Delete Customer, Approve Gallery Item, Mark Feedback Resolved) so each row
 * shows independent immediate feedback while preventing duplicate clicks per key.
 */
export function useKeyedAsyncAction() {
  const toast = useToast();
  const [pendingKeys, setPendingKeys] = useState<Record<string, boolean>>({});
  const inFlightKeysRef = useRef<Set<string>>(new Set());

  const isPending = useCallback((key: string) => Boolean(pendingKeys[key]), [pendingKeys]);

  const runForKey = useCallback(
    async <TResult,>(
      key: string,
      action: () => Promise<TResult>,
      options?: RunActionOptions<TResult>
    ): Promise<{ ok: true; data: TResult } | { ok: false; error: string; skipped?: boolean }> => {
      if (inFlightKeysRef.current.has(key)) {
        return { ok: false, error: 'Action already in progress', skipped: true };
      }
      inFlightKeysRef.current.add(key);
      setPendingKeys(prev => ({ ...prev, [key]: true }));
      try {
        const data = await action();
        if (options?.onSuccess) {
          await options.onSuccess(data);
        }
        if (options?.successMessage) {
          const msg =
            typeof options.successMessage === 'function'
              ? options.successMessage(data)
              : options.successMessage;
          if (msg) toast.success(msg);
        }
        return { ok: true, data };
      } catch (err) {
        const msg = getSafeErrorMessage(err, options?.errorFallback);
        if (options?.showErrorToast !== false) {
          toast.error(msg);
        }
        if (options?.onError) {
          options.onError(msg, err);
        }
        return { ok: false, error: msg };
      } finally {
        inFlightKeysRef.current.delete(key);
        setPendingKeys(prev => {
          if (!prev[key]) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    },
    [toast]
  );

  return { isPending, runForKey, hasAnyPending: Object.keys(pendingKeys).length > 0 };
}
