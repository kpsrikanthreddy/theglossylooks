/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reusable ActionButton that immediately renders a loading spinner and
 * action text while disabling itself to prevent duplicate submissions.
 */

import React from 'react';
import { Loader2 } from 'lucide-react';

export interface ActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  loadingText?: string;
  icon?: React.ReactNode;
  spinnerClassName?: string;
}

export const ActionButton: React.FC<ActionButtonProps> = ({
  loading = false,
  loadingText,
  icon,
  spinnerClassName = 'w-3.5 h-3.5',
  disabled,
  children,
  className = '',
  type = 'button',
  ...rest
}) => {
  const isDisabled = Boolean(disabled || loading);

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={`${className} ${isDisabled ? 'disabled:opacity-60 disabled:cursor-not-allowed' : ''}`}
      {...rest}
    >
      {loading ? (
        <>
          <Loader2 className={`${spinnerClassName} animate-spin shrink-0`} />
          {loadingText !== undefined ? <span>{loadingText}</span> : children}
        </>
      ) : (
        <>
          {icon}
          {children}
        </>
      )}
    </button>
  );
};
