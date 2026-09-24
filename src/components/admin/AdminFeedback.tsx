import React, { useState } from 'react';
import { 
  MessageSquareHeart, 
  Smile, 
  Meh, 
  Frown, 
  AlertTriangle, 
  CheckCircle2, 
  Phone, 
  Search, 
  Filter, 
  MessageCircle, 
  Eye, 
  Send,
  X,
  Clock,
  Sparkles,
  User,
  Plus
} from 'lucide-react';
import { CustomerFeedback, FeedbackRating, WhatsAppSettings } from '../../types/admin';
import { Appointment } from '../../types/salon';
import { openWhatsApp } from '../../utils/whatsapp';

interface AdminFeedbackProps {
  feedback: CustomerFeedback[];
  appointments: Appointment[];
  whatsappSettings: WhatsAppSettings;
  onUpdateFeedback: (updated: CustomerFeedback) => void;
  onSendFeedbackRequest: (appointment: Appointment) => void;
}

export const AdminFeedback: React.FC<AdminFeedbackProps> = ({
  feedback,
  appointments,
  whatsappSettings,
  onUpdateFeedback,
  onSendFeedbackRequest,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRating, setFilterRating] = useState<'ALL' | 'GOOD' | 'AVERAGE' | 'BAD' | 'NEEDS_FOLLOW_UP'>('ALL');
  const [selectedFeedback, setSelectedFeedback] = useState<CustomerFeedback | null>(null);
  
  // Modal state
  const [isSendModalOpen, setIsSendModalOpen] = useState(false);
  const [sendMode, setSendMode] = useState<'appointment' | 'manual'>('appointment');
  const [selectedAppointmentIdForSend, setSelectedAppointmentIdForSend] = useState('');
  const [confirmResendPrompt, setConfirmResendPrompt] = useState(false);
  const [followUpNotesInput, setFollowUpNotesInput] = useState('');

  // Manual new customer phone feedback state
  const [manualCustomerName, setManualCustomerName] = useState('');
  const [manualCustomerPhone, setManualCustomerPhone] = useState('');
  const [manualServiceName, setManualServiceName] = useState('Salon Service');
  const [manualSending, setManualSending] = useState(false);
  const [manualStatusMessage, setManualStatusMessage] = useState<{ text: string; success: boolean } | null>(null);

  // Summary counts
  const totalCount = feedback.length;
  const goodCount = feedback.filter(f => f.rating === 'GOOD').length;
  const averageCount = feedback.filter(f => f.rating === 'AVERAGE').length;
  const badCount = feedback.filter(f => f.rating === 'BAD').length;
  const pendingFollowups = feedback.filter(f => f.requiresFollowUp && f.followUpStatus === 'PENDING').length;

  const handleMarkContacted = async (fb: CustomerFeedback) => {
    const updated: CustomerFeedback = {
      ...fb,
      followUpStatus: 'CONTACTED',
      followUpNotes: fb.followUpNotes || 'Salon manager contacted client via phone.',
    };
    onUpdateFeedback(updated);
    try {
      await fetch(`/api/whatsapp/feedback/${fb.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ followUpStatus: 'CONTACTED', followUpNotes: updated.followUpNotes }),
      });
    } catch (err) {
      console.warn('Backend feedback sync warning:', err);
    }
  };

  const handleMarkResolved = async (fb: CustomerFeedback, notes?: string) => {
    const updated: CustomerFeedback = {
      ...fb,
      followUpStatus: 'RESOLVED',
      requiresFollowUp: false,
      followUpNotes: notes || fb.followUpNotes || 'Issue amicably addressed with client satisfaction.',
    };
    onUpdateFeedback(updated);
    setSelectedFeedback(null);
    try {
      await fetch(`/api/whatsapp/feedback/${fb.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          followUpStatus: 'RESOLVED',
          requiresFollowUp: false,
          followUpNotes: updated.followUpNotes,
        }),
      });
    } catch (err) {
      console.warn('Backend feedback sync warning:', err);
    }
  };

  const normalizePhone = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 10) return '91' + digits;
    if (digits.length === 12 && digits.startsWith('91')) return digits;
    if (digits.length === 13 && digits.startsWith('910')) return '91' + digits.substring(3);
    return digits;
  };

  const handleTriggerSendFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    setManualStatusMessage(null);

    if (sendMode === 'appointment') {
      const apt = appointments.find(a => a.id === selectedAppointmentIdForSend);
      if (!apt) return;

      const alreadyHasFeedback = feedback.some(f => f.appointmentId === selectedAppointmentIdForSend);
      if (alreadyHasFeedback && !confirmResendPrompt) {
        setConfirmResendPrompt(true);
        return;
      }

      onSendFeedbackRequest(apt);
      setIsSendModalOpen(false);
      setConfirmResendPrompt(false);
      setSelectedAppointmentIdForSend('');
    } else {
      // Manual Mobile Number Mode
      if (!manualCustomerName.trim() || !manualCustomerPhone.trim()) {
        setManualStatusMessage({ text: 'Please enter both customer name and mobile number.', success: false });
        return;
      }

      const normalized = normalizePhone(manualCustomerPhone);
      if (normalized.length < 12) {
        setManualStatusMessage({ text: 'Please enter a valid 10-digit Indian WhatsApp mobile number.', success: false });
        return;
      }

      setManualSending(true);
      try {
        const res = await fetch('/api/whatsapp/send-manual-feedback', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer admin-secure-token-2026',
          },
          body: JSON.stringify({
            customerName: manualCustomerName.trim(),
            customerPhone: manualCustomerPhone.trim(),
            serviceName: manualServiceName.trim() || 'Salon Service',
          }),
        });

        const data = await res.json();
        if (res.ok && data.success) {
          setManualStatusMessage({ 
            text: `Feedback template dispatched to ${normalized} (WAMID: ${data.messageId || 'Queued'}). Status: SENT.`, 
            success: true 
          });
          setTimeout(() => {
            setIsSendModalOpen(false);
            setManualCustomerName('');
            setManualCustomerPhone('');
            setManualStatusMessage(null);
          }, 2500);
        } else {
          setManualStatusMessage({ 
            text: data.message || data.error?.message || 'Meta API returned error. Check WhatsApp configuration.', 
            success: false 
          });
        }
      } catch (err: any) {
        setManualStatusMessage({ text: err.message || 'Failed to dispatch WhatsApp request.', success: false });
      } finally {
        setManualSending(false);
      }
    }
  };

  const filteredList = feedback.filter(fb => {
    const matchesSearch = 
      fb.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      fb.customerPhone.includes(searchTerm) ||
      (fb.serviceName && fb.serviceName.toLowerCase().includes(searchTerm.toLowerCase()));

    if (!matchesSearch) return false;

    if (filterRating === 'GOOD') return fb.rating === 'GOOD';
    if (filterRating === 'AVERAGE') return fb.rating === 'AVERAGE';
    if (filterRating === 'BAD') return fb.rating === 'BAD';
    if (filterRating === 'NEEDS_FOLLOW_UP') return fb.requiresFollowUp && fb.followUpStatus !== 'RESOLVED';
    return true;
  });

  return (
    <div className="space-y-6">
      
      {/* Top Banner and Quick Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-serif font-bold text-2xl text-[#2D2424]">Customer Feedback & Reviews</h2>
          <p className="text-xs text-stone-500">
            Real-time Meta WhatsApp feedback automation engine (Good ➔ Review, Average ➔ Improve, Bad ➔ Follow-up)
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setIsSendModalOpen(true);
            setSendMode('appointment');
            setManualStatusMessage(null);
          }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#8C3A42] hover:bg-[#722F36] text-white font-medium text-xs shadow-xs transition-colors cursor-pointer self-start sm:self-auto"
        >
          <Send className="w-4 h-4" />
          <span>Send Feedback Prompt</span>
        </button>
      </div>

      {/* Analytics KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="p-4 rounded-xl bg-white border border-stone-200 shadow-xs">
          <span className="text-[11px] text-stone-500 font-medium block">Total Responses</span>
          <p className="font-serif font-bold text-2xl text-[#2D2424] mt-1">{totalCount}</p>
        </div>

        <div className="p-4 rounded-xl bg-white border border-stone-200 shadow-xs">
          <span className="text-[11px] text-emerald-600 font-medium flex items-center gap-1">
            <Smile className="w-3.5 h-3.5" />
            <span>Good (Google Review)</span>
          </span>
          <p className="font-serif font-bold text-2xl text-emerald-700 mt-1">{goodCount}</p>
        </div>

        <div className="p-4 rounded-xl bg-white border border-stone-200 shadow-xs">
          <span className="text-[11px] text-amber-600 font-medium flex items-center gap-1">
            <Meh className="w-3.5 h-3.5" />
            <span>Average (Improvements)</span>
          </span>
          <p className="font-serif font-bold text-2xl text-amber-700 mt-1">{averageCount}</p>
        </div>

        <div className="p-4 rounded-xl bg-white border border-stone-200 shadow-xs">
          <span className="text-[11px] text-rose-600 font-medium flex items-center gap-1">
            <Frown className="w-3.5 h-3.5" />
            <span>Bad (Urgent Attention)</span>
          </span>
          <div className="flex items-center justify-between mt-1">
            <p className="font-serif font-bold text-2xl text-rose-700">{badCount}</p>
            {pendingFollowups > 0 && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">
                {pendingFollowups} Pending
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-white p-3.5 rounded-xl border border-stone-200">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search by customer name, phone, service..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-stone-200 text-xs focus:outline-none focus:ring-2 focus:ring-[#8C3A42]/20"
          />
        </div>

        <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          <button
            type="button"
            onClick={() => setFilterRating('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              filterRating === 'ALL' ? 'bg-[#8C3A42] text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            All ({totalCount})
          </button>
          <button
            type="button"
            onClick={() => setFilterRating('GOOD')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              filterRating === 'GOOD' ? 'bg-emerald-700 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            Good ({goodCount})
          </button>
          <button
            type="button"
            onClick={() => setFilterRating('AVERAGE')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              filterRating === 'AVERAGE' ? 'bg-amber-700 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            Average ({averageCount})
          </button>
          <button
            type="button"
            onClick={() => setFilterRating('BAD')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              filterRating === 'BAD' ? 'bg-rose-700 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            Bad ({badCount})
          </button>
          <button
            type="button"
            onClick={() => setFilterRating('NEEDS_FOLLOW_UP')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              filterRating === 'NEEDS_FOLLOW_UP' ? 'bg-red-800 text-white' : 'bg-rose-50 text-rose-800 hover:bg-rose-100'
            }`}
          >
            Needs Follow-up ({pendingFollowups})
          </button>
        </div>
      </div>

      {/* Feedback Records Table */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-semibold">
              <tr>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Service</th>
                <th className="py-3 px-4">Rating</th>
                <th className="py-3 px-4">Customer Feedback</th>
                <th className="py-3 px-4">Automated Action</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {filteredList.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-stone-400">
                    No customer feedback records found matching your filter.
                  </td>
                </tr>
              ) : (
                filteredList.map((fb) => (
                  <tr key={fb.id} className="hover:bg-stone-50/70 transition-colors">
                    <td className="py-3 px-4">
                      <p className="font-semibold text-stone-800">{fb.customerName}</p>
                      <p className="text-[11px] text-stone-500 font-mono">{fb.customerPhone}</p>
                    </td>

                    <td className="py-3 px-4">
                      <p className="font-medium text-stone-700">{fb.serviceName}</p>
                      <p className="text-[10px] text-stone-400">{fb.artistName || 'Staff Specialist'}</p>
                    </td>

                    <td className="py-3 px-4">
                      {fb.rating === 'GOOD' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-semibold text-[11px] border border-emerald-200">
                          <Smile className="w-3.5 h-3.5" />
                          <span>Good</span>
                        </span>
                      )}
                      {fb.rating === 'AVERAGE' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 font-semibold text-[11px] border border-amber-200">
                          <Meh className="w-3.5 h-3.5" />
                          <span>Average</span>
                        </span>
                      )}
                      {fb.rating === 'BAD' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 font-semibold text-[11px] border border-rose-200">
                          <Frown className="w-3.5 h-3.5" />
                          <span>Bad</span>
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 max-w-xs">
                      {fb.comment ? (
                        <p className="text-stone-700 italic truncate" title={fb.comment}>
                          "{fb.comment}"
                        </p>
                      ) : (
                        <span className="text-stone-400 italic">No text provided</span>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      {fb.googleReviewSent && (
                        <span className="text-emerald-700 flex items-center gap-1 font-medium text-[11px]">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Google Review Sent</span>
                        </span>
                      )}
                      {fb.requiresFollowUp && (
                        <span className="text-rose-700 flex items-center gap-1 font-medium text-[11px]">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>Manager Follow-Up</span>
                        </span>
                      )}
                      {!fb.googleReviewSent && !fb.requiresFollowUp && (
                        <span className="text-stone-400 text-[11px]">Logged</span>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      {fb.followUpStatus === 'PENDING' && (
                        <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-[10px] font-bold">
                          PENDING
                        </span>
                      )}
                      {fb.followUpStatus === 'CONTACTED' && (
                        <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
                          CONTACTED
                        </span>
                      )}
                      {fb.followUpStatus === 'RESOLVED' && (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                          RESOLVED
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-right space-x-1">
                      <button
                        type="button"
                        onClick={() => setSelectedFeedback(fb)}
                        className="p-1.5 text-stone-500 hover:text-[#8C3A42] hover:bg-stone-100 rounded-lg transition-colors cursor-pointer"
                        title="View details"
                      >
                        <Eye className="w-4 h-4" />
                      </button>

                      {fb.requiresFollowUp && fb.followUpStatus === 'PENDING' && (
                        <button
                          type="button"
                          onClick={() => handleMarkContacted(fb)}
                          className="px-2 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-medium transition-colors"
                        >
                          Mark Contacted
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* DETAIL MODAL */}
      {selectedFeedback && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <h3 className="font-serif font-bold text-lg text-[#2D2424]">Customer Feedback Inspection</h3>
              <button 
                type="button"
                onClick={() => setSelectedFeedback(null)}
                className="text-stone-400 hover:text-stone-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3 bg-stone-50 p-3 rounded-xl border border-stone-200">
                <div>
                  <span className="text-[10px] uppercase text-stone-400 font-semibold block">Customer</span>
                  <p className="font-bold text-stone-800 text-sm">{selectedFeedback.customerName}</p>
                  <p className="text-stone-500 font-mono">{selectedFeedback.customerPhone}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase text-stone-400 font-semibold block">Rating</span>
                  <span className="font-bold text-sm text-[#8C3A42]">{selectedFeedback.rating}</span>
                </div>
              </div>

              <div>
                <span className="text-[10px] uppercase text-stone-400 font-semibold block mb-1">Service & Artist</span>
                <div className="p-2.5 rounded-lg border border-stone-200 text-stone-700">
                  {selectedFeedback.serviceName} • {selectedFeedback.artistName || 'Staff Specialist'}
                </div>
              </div>

              <div>
                <span className="text-[10px] uppercase text-stone-400 font-semibold block mb-1">Customer Comment</span>
                <p className="p-3 rounded-lg bg-stone-50 border border-stone-200 text-stone-800 italic">
                  "{selectedFeedback.comment || 'No text comment provided'}"
                </p>
              </div>

              {selectedFeedback.googleReviewSent && (
                <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Google Review invitation link was dispatched to client.</span>
                </div>
              )}

              {selectedFeedback.requiresFollowUp && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 space-y-2">
                  <span className="font-semibold text-rose-800 text-[11px] block">
                    Manager Resolution Notes:
                  </span>
                  <textarea
                    rows={2}
                    value={followUpNotesInput || selectedFeedback.followUpNotes || ''}
                    onChange={(e) => setFollowUpNotesInput(e.target.value)}
                    placeholder="Enter resolution notes, complimentary offer provided..."
                    className="w-full p-2 rounded-lg border border-rose-200 bg-white text-xs"
                  />
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleMarkResolved(selectedFeedback, followUpNotesInput)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs cursor-pointer"
                    >
                      Save & Mark Resolved
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-stone-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSelectedFeedback(null)}
                className="px-4 py-2 rounded-lg bg-stone-100 text-stone-700 text-xs font-medium hover:bg-stone-200 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ENHANCED SEND FEEDBACK REQUEST MODAL (COMPLETED APPOINTMENT OR ENTER MOBILE NUMBER) */}
      {isSendModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <div>
                <h3 className="font-serif font-bold text-lg text-[#2D2424]">Send WhatsApp Feedback Prompt</h3>
                <p className="text-xs text-stone-500">Dispatch rating request to customer via WhatsApp Cloud API</p>
              </div>
              <button 
                type="button"
                onClick={() => setIsSendModalOpen(false)}
                className="text-stone-400 hover:text-stone-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Destination Selection Tabs: Completed Appointment OR Enter Mobile Number */}
            <div className="flex rounded-xl bg-stone-100 p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setSendMode('appointment')}
                className={`flex-1 py-2 text-center rounded-lg transition-all cursor-pointer ${
                  sendMode === 'appointment' ? 'bg-white text-[#8C3A42] shadow-xs' : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                Completed Appointment
              </button>
              <button
                type="button"
                onClick={() => setSendMode('manual')}
                className={`flex-1 py-2 text-center rounded-lg transition-all cursor-pointer ${
                  sendMode === 'manual' ? 'bg-white text-[#8C3A42] shadow-xs' : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                Enter Mobile Number
              </button>
            </div>

            <form onSubmit={handleTriggerSendFeedback} className="space-y-4 text-xs">
              
              {/* MODE A: COMPLETED APPOINTMENT */}
              {sendMode === 'appointment' && (
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    Select Completed Appointment <span className="text-[#8C3A42]">*</span>
                  </label>
                  <select
                    required={sendMode === 'appointment'}
                    value={selectedAppointmentIdForSend}
                    onChange={(e) => setSelectedAppointmentIdForSend(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-[#8C3A42] bg-white"
                  >
                    <option value="">Choose an appointment...</option>
                    {appointments.map(apt => (
                      <option key={apt.id} value={apt.id}>
                        {apt.customerName} ({apt.customerPhone}) — {apt.date} • {apt.serviceNames?.[0] || 'Service'}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* MODE B: ENTER MOBILE NUMBER (NEW / WALK-IN CUSTOMER) */}
              {sendMode === 'manual' && (
                <div className="space-y-3">
                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">
                      Customer Name <span className="text-[#8C3A42]">*</span>
                    </label>
                    <div className="relative">
                      <User className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        placeholder="e.g. Shalini Roy"
                        value={manualCustomerName}
                        onChange={(e) => setManualCustomerName(e.target.value)}
                        required={sendMode === 'manual'}
                        className="w-full pl-9 pr-3 py-2 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-[#8C3A42]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">
                      WhatsApp Mobile Number <span className="text-[#8C3A42]">*</span>
                    </label>
                    <div className="relative">
                      <Phone className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-2.5" />
                      <input
                        type="tel"
                        placeholder="+91 9440123456 or 9876543210"
                        value={manualCustomerPhone}
                        onChange={(e) => setManualCustomerPhone(e.target.value)}
                        required={sendMode === 'manual'}
                        className="w-full pl-9 pr-3 py-2 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-[#8C3A42]"
                      />
                    </div>
                    {manualCustomerPhone && (
                      <p className="text-[10px] text-stone-500 font-mono mt-1">
                        Normalized Meta Recipient: <strong className="text-[#8C3A42]">{normalizePhone(manualCustomerPhone)}</strong>
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">
                      Service Rendered (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Parisian Balayage, Hydra Facial"
                      value={manualServiceName}
                      onChange={(e) => setManualServiceName(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-[#8C3A42]"
                    />
                  </div>
                </div>
              )}

              {/* Duplicate check warning */}
              {confirmResendPrompt && sendMode === 'appointment' && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs space-y-1.5 animate-fadeIn">
                  <div className="flex items-center gap-1.5 font-bold text-amber-950">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Duplicate Request Confirmation</span>
                  </div>
                  <p className="text-[11px] text-amber-800 leading-relaxed">
                    A feedback request was already scheduled or sent for this appointment. Are you sure you want to resend now?
                  </p>
                </div>
              )}

              {/* Status feedback message */}
              {manualStatusMessage && (
                <div className={`p-3 rounded-xl border text-xs ${
                  manualStatusMessage.success 
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-900' 
                    : 'bg-rose-50 border-rose-300 text-rose-900'
                }`}>
                  {manualStatusMessage.text}
                </div>
              )}

              {/* Template Configuration Info */}
              <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 text-stone-600 text-[11px] space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-stone-700">Approved Meta Template:</span>
                  <span className="font-mono text-xs bg-stone-200 text-stone-800 px-2 py-0.5 rounded font-bold">
                    {whatsappSettings.templateName || 'glossylooks_feedback'}
                  </span>
                </div>
                <p className="text-stone-500">
                  Dispatched via Meta Cloud API using <code className="bg-stone-200 px-1 py-0.5 rounded font-mono text-[10px]">type: "template"</code>.
                  Reaches brand-new customers who have never previously messaged the salon. Initial delivery status tracks as <strong>SENT</strong> until confirmed by Meta webhook.
                </p>
              </div>

              {/* Footer Buttons */}
              <div className="pt-2 border-t border-stone-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setIsSendModalOpen(false); setConfirmResendPrompt(false); setManualStatusMessage(null); }}
                  className="px-4 py-2 rounded-lg bg-stone-100 text-stone-700 hover:bg-stone-200 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={manualSending || (sendMode === 'appointment' && !selectedAppointmentIdForSend)}
                  className={`px-4 py-2 rounded-lg text-white font-medium disabled:opacity-50 flex items-center gap-1.5 cursor-pointer ${
                    confirmResendPrompt ? 'bg-amber-600 hover:bg-amber-700' : 'bg-[#8C3A42] hover:bg-[#722F36]'
                  }`}
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>
                    {manualSending 
                      ? 'Dispatching Template...' 
                      : (confirmResendPrompt ? 'Confirm & Resend Now' : 'Send WhatsApp Request')}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
