/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared Send WhatsApp Template Modal for Appointments and Payment Ledger tabs.
 * Enforces approved Meta WhatsApp templates only (no free-text), phone validation,
 * auto-populated variables with live preview, delivery status badges
 * (queued / sent / delivered / read / failed), and Retry ONLY for failed sends.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  MessageCircle,
  X,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  CheckCheck,
  RefreshCw,
  ShieldCheck,
  Send,
  Info,
  Loader2,
} from 'lucide-react';
import { api, ApprovedWhatsAppTemplateInfo, WhatsAppRecordContextResponse } from '../../lib/api';
import { WhatsAppMessageLog } from '../../types/salon';
import { ActionButton } from '../common/ActionButton';
import { useToast, getSafeErrorMessage } from '../common/ToastProvider';

export interface RecordWhatsAppTemplateModalProps {
  isOpen: boolean;
  recordType: 'appointment' | 'order';
  recordId: string;
  recordLabel: string;
  initialCustomerName?: string;
  initialCustomerPhone?: string;
  onClose: () => void;
  onSent?: () => void;
}

const FALLBACK_TEMPLATE_OPTIONS: Record<'appointment' | 'order', ApprovedWhatsAppTemplateInfo[]> = {
  appointment: [
    {
      name: 'gl_appointment_confirmation',
      status: 'APPROVED',
      language: 'en',
      category: 'UTILITY',
      components: [
        {
          type: 'BODY',
          text: 'Hi {{customer_name}}, your appointment at {{branch_name}} for {{service_name}} is confirmed on {{appointment_date}} at {{appointment_time}}. Booking Ref: {{booking_id}}. Address: {{branch_address}}.'
        }
      ]
    },
    {
      name: 'gl_appointment_reminder',
      status: 'APPROVED',
      language: 'en',
      category: 'UTILITY',
      components: [
        {
          type: 'BODY',
          text: 'Hi {{customer_name}}, reminder for your upcoming appointment at {{branch_name}} for {{service_name}} on {{appointment_date}} at {{appointment_time}}. Booking Ref: {{booking_id}}.'
        }
      ]
    },
    {
      name: 'glossylooks_customer_feedback',
      status: 'APPROVED',
      language: 'en',
      category: 'UTILITY',
      components: [
        {
          type: 'BODY',
          text: 'Hi {{1}}, thank you for visiting The Glossy Looks Salon! We would love to hear your feedback about your recent experience.'
        }
      ]
    }
  ],
  order: [
    {
      name: 'gl_bill_receipt',
      status: 'APPROVED',
      language: 'en',
      category: 'UTILITY',
      components: [
        {
          type: 'BODY',
          text: 'Hi {{customer_name}}, thank you for visiting {{branch_name}}! Bill {{bill_number}} dated {{bill_date}} for {{items_summary}} — Total ₹{{grand_total}} paid via {{payment_mode}}.'
        }
      ]
    },
    {
      name: 'gl_payment_reminder',
      status: 'APPROVED',
      language: 'en',
      category: 'UTILITY',
      components: [
        {
          type: 'BODY',
          text: 'Hi {{customer_name}}, payment follow-up for Bill {{bill_number}} at {{branch_name}} dated {{bill_date}}. Bill Total: ₹{{grand_total}}, Pending Due: ₹{{due_amount}}.'
        }
      ]
    },
    {
      name: 'glossylooks_customer_feedback',
      status: 'APPROVED',
      language: 'en',
      category: 'UTILITY',
      components: [
        {
          type: 'BODY',
          text: 'Hi {{1}}, thank you for visiting The Glossy Looks Salon! We would love to hear your feedback about your recent visit.'
        }
      ]
    }
  ]
};

function friendlyTemplateTitle(name: string): string {
  switch (name) {
    case 'gl_appointment_confirmation':
      return 'Appointment Confirmation (gl_appointment_confirmation)';
    case 'gl_appointment_reminder':
      return 'Appointment Reminder / Follow-up (gl_appointment_reminder)';
    case 'gl_bill_receipt':
      return 'Bill Receipt (gl_bill_receipt)';
    case 'gl_payment_reminder':
      return 'Payment Follow-up / Reminder (gl_payment_reminder)';
    case 'glossylooks_customer_feedback':
    case 'the_glossylooks_customer_feedback':
      return `Customer Feedback (${name})`;
    default:
      return name;
  }
}

function extractBodyPlaceholders(template?: ApprovedWhatsAppTemplateInfo): { bodyText: string; placeholders: string[] } {
  const bodyComp = template?.components?.find((c: any) => String(c.type || '').toUpperCase() === 'BODY');
  const bodyText = typeof bodyComp?.text === 'string' ? bodyComp.text : '';
  if (!bodyText) return { bodyText: '', placeholders: [] };
  const matches = [...bodyText.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)];
  const seen = new Set<string>();
  const placeholders: string[] = [];
  for (const m of matches) {
    const key = m[1];
    if (!seen.has(key)) {
      seen.add(key);
      placeholders.push(key);
    }
  }
  return { bodyText, placeholders };
}

function resolveDefaultForPlaceholder(
  token: string,
  defaults: Record<string, string>,
  recordType: 'appointment' | 'order'
): string {
  if (!/^\d+$/.test(token)) {
    return defaults[token] ?? '';
  }
  const idx = Number(token) - 1;
  const positional = recordType === 'appointment'
    ? [
        defaults.customer_name || '',
        defaults.branch_name || '',
        defaults.service_name || '',
        defaults.appointment_date || '',
        defaults.appointment_time || '',
        defaults.booking_id || '',
        defaults.branch_address || ''
      ]
    : [
        defaults.customer_name || '',
        defaults.bill_number || '',
        defaults.bill_date || '',
        defaults.items_summary || '',
        defaults.grand_total || '',
        defaults.payment_mode || '',
        defaults.branch_name || ''
      ];
  return positional[idx] ?? '';
}

function renderStatusBadge(status?: string) {
  const normalized = String(status || 'queued').toLowerCase();
  if (normalized === 'read') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-sky-100 text-sky-800 border border-sky-200">
        <CheckCheck size={11} /> read
      </span>
    );
  }
  if (normalized === 'delivered') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200">
        <CheckCheck size={11} /> delivered
      </span>
    );
  }
  if (normalized === 'sent') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-green-100 text-green-800 border border-green-200">
        <CheckCircle2 size={11} /> sent
      </span>
    );
  }
  if (normalized === 'failed' || normalized === 'pending_approval') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-700 border border-red-200">
        <AlertCircle size={11} /> failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200">
      <Clock size={11} /> queued
    </span>
  );
}

export const RecordWhatsAppTemplateModal: React.FC<RecordWhatsAppTemplateModalProps> = ({
  isOpen,
  recordType,
  recordId,
  recordLabel,
  initialCustomerName,
  initialCustomerPhone,
  onClose,
  onSent,
}) => {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [context, setContext] = useState<WhatsAppRecordContextResponse | null>(null);
  const [selectedTemplateName, setSelectedTemplateName] = useState<string>('');
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [retryingLogId, setRetryingLogId] = useState<string | null>(null);
  const [sendFeedback, setSendFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadContext = async () => {
    if (!recordId) return;
    setLoading(true);
    setContextError(null);
    try {
      const data = await api.getWhatsAppRecordContext(recordType, recordId);
      setContext(data);
      const available = data.approved_templates?.length
        ? data.approved_templates
        : (data.templates_source === 'unavailable' ? FALLBACK_TEMPLATE_OPTIONS[recordType] : []);

      setSelectedTemplateName(prev => {
        if (prev && available.some(t => t.name === prev)) return prev;
        return available[0]?.name || '';
      });
      setVariableValues(data.default_variables || {});
    } catch (err) {
      setContextError(getSafeErrorMessage(err, 'Unable to load WhatsApp template options for this record.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && recordId) {
      setSendFeedback(null);
      loadContext();
    }
  }, [isOpen, recordId, recordType]);

  const templateList: ApprovedWhatsAppTemplateInfo[] = useMemo(() => {
    if (!context) return FALLBACK_TEMPLATE_OPTIONS[recordType];
    if (context.approved_templates && context.approved_templates.length > 0) {
      return context.approved_templates;
    }
    if (context.templates_source === 'unavailable') {
      return FALLBACK_TEMPLATE_OPTIONS[recordType];
    }
    return [];
  }, [context, recordType]);

  const selectedTemplate = useMemo(
    () => templateList.find(t => t.name === selectedTemplateName) || templateList[0],
    [templateList, selectedTemplateName]
  );

  const { bodyText, placeholders } = useMemo(
    () => extractBodyPlaceholders(selectedTemplate),
    [selectedTemplate]
  );

  const resolvedVars = useMemo(() => {
    const defaults = context?.default_variables || {};
    const out: Record<string, string> = { ...defaults };
    for (const token of placeholders) {
      if (variableValues[token] !== undefined) {
        out[token] = variableValues[token];
      } else {
        out[token] = resolveDefaultForPlaceholder(token, defaults, recordType);
      }
    }
    return out;
  }, [context, placeholders, variableValues, recordType]);

  const livePreview = useMemo(() => {
    if (!bodyText) {
      return selectedTemplate
        ? `Approved template "${selectedTemplate.name}" will be sent with this record's details.`
        : 'Select an approved Meta template to preview.';
    }
    let text = bodyText;
    for (const token of placeholders) {
      const value = (resolvedVars[token] || '').trim() || `{{${token}}}`;
      text = text.replace(new RegExp(`\\{\\{\\s*${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`, 'g'), value);
    }
    return text;
  }, [bodyText, placeholders, resolvedVars, selectedTemplate]);

  if (!isOpen) return null;

  const phoneValid = context ? context.phone_validation.isValid : false;
  const canSubmit = !loading && !sending && phoneValid && Boolean(selectedTemplate?.name);

  const handleSend = async (retryLog?: WhatsAppMessageLog) => {
    if (!context) return;
    if (!phoneValid) {
      toast.error(context.phone_validation.error || 'Customer WhatsApp number is invalid.');
      return;
    }
    const targetTemplateName = retryLog ? retryLog.template_name : selectedTemplate?.name;
    if (!targetTemplateName) {
      toast.error('Please select an approved Meta WhatsApp template.');
      return;
    }

    setSendFeedback(null);
    if (retryLog) {
      setRetryingLogId(retryLog.id);
    } else {
      setSending(true);
    }

    try {
      const res = await api.sendRecordWhatsAppTemplate({
        record_type: recordType,
        record_id: context.record_id,
        template_name: targetTemplateName,
        template_language: selectedTemplate?.language,
        variables: resolvedVars,
        ...(retryLog ? { retry_log_id: retryLog.id } : {})
      });

      if (res.success) {
        const msg = res.status === 'queued'
          ? `WhatsApp template "${targetTemplateName}" queued for delivery.`
          : `WhatsApp template "${targetTemplateName}" submitted (${res.status}).`;
        setSendFeedback({ type: 'success', text: msg });
        toast.success(msg);
      } else {
        const errMsg = res.error || `WhatsApp template "${targetTemplateName}" failed to send.`;
        setSendFeedback({ type: 'error', text: errMsg });
        toast.error(errMsg);
      }

      await loadContext();
      onSent?.();
    } catch (err) {
      const msg = getSafeErrorMessage(err, 'Failed to send WhatsApp template.');
      setSendFeedback({ type: 'error', text: msg });
      toast.error(msg);
      await loadContext().catch(() => {});
    } finally {
      setSending(false);
      setRetryingLogId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl border border-[#EFE2D8] overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-[#075E54] to-[#128C7E] text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center">
              <MessageCircle size={20} />
            </div>
            <div>
              <h3 className="font-serif text-lg font-bold leading-tight">Send WhatsApp Template</h3>
              <p className="text-xs text-white/80">
                {recordType === 'appointment' ? 'Appointment Follow-Up' : 'Payment Ledger Follow-Up'} · {recordLabel}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-white/80 hover:text-white hover:bg-white/15 transition-colors"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {loading && !context ? (
            <div className="py-12 flex flex-col items-center justify-center text-[#7A6B63] gap-3">
              <Loader2 size={28} className="animate-spin text-[#128C7E]" />
              <p className="text-sm font-medium">Loading customer details & approved Meta templates…</p>
            </div>
          ) : contextError ? (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-start gap-2.5">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Unable to open WhatsApp template sender</p>
                <p className="text-xs mt-1">{contextError}</p>
              </div>
            </div>
          ) : (
            <>
              {/* Customer & Number Validation Card */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-[#FAF7F2] border border-[#EFE2D8] rounded-xl p-4">
                <div>
                  <span className="text-[10px] uppercase tracking-wider font-bold text-[#7A6B63]">Customer Name</span>
                  <p className="font-bold text-[#1A1614] text-sm mt-0.5">
                    {context?.customer_name || initialCustomerName || 'Unknown Customer'}
                  </p>
                  <p className="text-[11px] text-[#7A6B63] mt-0.5">{context?.branch_name}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-wider font-bold text-[#7A6B63]">WhatsApp Number</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="font-mono font-bold text-sm text-[#1A1614]">
                      {context?.phone_validation?.e164 || context?.customer_phone || initialCustomerPhone || 'Not provided'}
                    </p>
                    {phoneValid ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
                        <CheckCircle2 size={10} /> Valid
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">
                        <AlertCircle size={10} /> Invalid
                      </span>
                    )}
                  </div>
                  {!phoneValid && context?.phone_validation?.error && (
                    <p className="text-[11px] text-red-600 font-medium mt-1">{context.phone_validation.error}</p>
                  )}
                </div>
              </div>

              {/* 24-Hour Policy Notice */}
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-emerald-50/70 border border-emerald-200/80 text-xs text-emerald-900">
                <ShieldCheck size={16} className="text-emerald-700 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">Approved Meta Templates Only: </span>
                  {context?.customer_service_window?.window_open
                    ? '24-hour customer window is currently open, and this follow-up sends an approved Meta template recorded in the permanent WhatsApp Inbox.'
                    : 'Outside the 24-hour customer service window — free-text messages are blocked by Meta policy. Only approved templates can be dispatched.'}
                </div>
              </div>

              {/* Missing recommended templates alert if WABA API responded */}
              {context?.missing_recommended_templates && context.missing_recommended_templates.length > 0 && (
                <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  <AlertTriangle size={15} className="text-amber-700 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Meta Approval Note: </span>
                    The following recommended template(s) are not yet approved in Meta Business Manager:{' '}
                    <span className="font-mono font-bold">{context.missing_recommended_templates.join(', ')}</span>.
                  </div>
                </div>
              )}

              {context?.templates_source === 'unavailable' && context.templates_error && (
                <div className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700">
                  <Info size={15} className="text-slate-500 shrink-0 mt-0.5" />
                  <div>
                    Live Meta template catalog could not be queried ({context.templates_error}). Showing default Glossy Looks approved templates.
                  </div>
                </div>
              )}

              {/* Approved Template Selector */}
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-[#5A4E47]">
                  Select Approved Meta Template
                </label>
                {templateList.length === 0 ? (
                  <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium">
                    No approved Meta WhatsApp templates were found in this WABA. Approve templates in Meta Business Manager first.
                  </div>
                ) : (
                  <select
                    value={selectedTemplate?.name || ''}
                    onChange={(e) => {
                      setSelectedTemplateName(e.target.value);
                      setSendFeedback(null);
                    }}
                    className="w-full px-3.5 py-2.5 bg-white border border-[#E5D7CE] rounded-xl text-sm font-medium text-[#1A1614] focus:outline-none focus:border-[#128C7E]"
                  >
                    {templateList.map(tpl => (
                      <option key={`${tpl.name}_${tpl.language}`} value={tpl.name}>
                        {friendlyTemplateTitle(tpl.name)} [{tpl.language}]
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Editable Template Variables */}
              {placeholders.length > 0 && (
                <div className="space-y-2.5">
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#5A4E47]">
                    Template Variables (Auto-Populated)
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {placeholders.map(token => (
                      <div key={token}>
                        <label className="block text-[11px] font-semibold text-[#7A6B63] mb-1 capitalize">
                          {token.replace(/_/g, ' ')}
                        </label>
                        <input
                          type="text"
                          value={resolvedVars[token] ?? ''}
                          onChange={(e) =>
                            setVariableValues(prev => ({ ...prev, [token]: e.target.value }))
                          }
                          className="w-full px-3 py-2 text-xs bg-[#FAF7F2] border border-[#E5D7CE] rounded-lg text-[#1A1614] focus:outline-none focus:border-[#128C7E]"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Live Message Preview */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold uppercase tracking-wider text-[#5A4E47]">
                  Template Message Preview
                </label>
                <div className="rounded-xl bg-[#ECE5DD] p-4 border border-[#DED5C8]">
                  <div className="bg-[#DCF8C6] rounded-xl px-4 py-3 text-xs text-[#1A1614] leading-relaxed shadow-sm whitespace-pre-wrap">
                    {livePreview}
                  </div>
                </div>
              </div>

              {sendFeedback && (
                <div
                  className={`p-3 rounded-xl text-xs font-medium flex items-start gap-2 border ${
                    sendFeedback.type === 'success'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-red-50 border-red-200 text-red-700'
                  }`}
                >
                  {sendFeedback.type === 'success' ? (
                    <CheckCircle2 size={15} className="shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle size={15} className="shrink-0 mt-0.5" />
                  )}
                  <span>{sendFeedback.text}</span>
                </div>
              )}

              {/* Linked Template Delivery History */}
              <div className="space-y-2 pt-2 border-t border-[#EFE2D8]">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#5A4E47]">
                    WhatsApp Template History ({context?.logs?.length || 0})
                  </span>
                  <button
                    type="button"
                    onClick={() => loadContext()}
                    disabled={loading}
                    className="text-[11px] font-bold text-[#128C7E] hover:underline flex items-center gap-1"
                  >
                    <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
                  </button>
                </div>

                {!context?.logs || context.logs.length === 0 ? (
                  <p className="text-xs text-[#7A6B63] italic py-2">
                    No WhatsApp templates have been sent for this record yet.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {context.logs.map((log) => (
                      <div
                        key={log.id}
                        className="p-3 rounded-xl bg-[#FAF7F2] border border-[#EFE2D8] flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs font-bold text-[#1A1614]">{log.template_name}</span>
                            {renderStatusBadge(log.status)}
                          </div>
                          <div className="text-[11px] text-[#7A6B63] mt-1 flex items-center gap-2 flex-wrap">
                            <span>{new Date(log.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</span>
                            {log.sent_by_user_name && <span>· By {log.sent_by_user_name}</span>}
                            {log.meta_message_id && (
                              <span className="font-mono text-[10px] text-[#5A4E47]">· ID: {log.meta_message_id.slice(0, 18)}…</span>
                            )}
                          </div>
                          {log.status === 'failed' && log.error_message && (
                            <p className="text-[11px] text-red-600 mt-1">{log.error_message}</p>
                          )}
                        </div>
                        {/* Retry button strictly shown ONLY for failed sends */}
                        {log.status === 'failed' && (
                          <ActionButton
                            type="button"
                            onClick={() => handleSend(log)}
                            loading={retryingLogId === log.id}
                            loadingText="Retrying..."
                            disabled={!phoneValid || sending || (retryingLogId !== null && retryingLogId !== log.id)}
                            className="shrink-0 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold flex items-center gap-1"
                          >
                            <RefreshCw size={12} /> Retry
                          </ActionButton>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-[#FAF7F2] border-t border-[#EFE2D8] flex items-center justify-end gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-[#DFD2C8] text-xs font-bold text-[#5A4E47] hover:bg-white transition-colors"
          >
            Close
          </button>
          <ActionButton
            type="button"
            onClick={() => handleSend()}
            loading={sending}
            loadingText="Sending Template..."
            disabled={!canSubmit}
            className="px-5 py-2.5 rounded-xl bg-[#128C7E] hover:bg-[#075E54] disabled:opacity-50 text-white text-xs font-bold flex items-center gap-2 shadow-sm"
          >
            <Send size={14} /> Send Template
          </ActionButton>
        </div>
      </div>
    </div>
  );
};
