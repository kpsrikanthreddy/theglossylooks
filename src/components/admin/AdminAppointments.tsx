import React, { useState } from 'react';
import { 
  Calendar, 
  Search, 
  Filter, 
  Plus, 
  Edit3, 
  Eye, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Phone, 
  User, 
  Scissors, 
  AlertCircle,
  MessageCircle,
  X
} from 'lucide-react';
import { Appointment, Artist, SalonService } from '../../types/salon';
import { openWhatsApp, getAppointmentWhatsAppMessage } from '../../utils/whatsapp';

interface AdminAppointmentsProps {
  appointments: Appointment[];
  services: SalonService[];
  artists: Artist[];
  onCreateAppointment: () => void;
  onUpdateStatus: (id: string, status: Appointment['status']) => void;
  onUpdateAppointment: (updated: Appointment) => void;
}

export const AdminAppointments: React.FC<AdminAppointmentsProps> = ({
  appointments,
  services,
  artists,
  onCreateAppointment,
  onUpdateStatus,
  onUpdateAppointment,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState<'today' | 'tomorrow' | 'upcoming' | 'completed' | 'cancelled' | 'all' | 'custom'>('all');
  const [customDate, setCustomDate] = useState('');

  // Modals state
  const [viewingApt, setViewingApt] = useState<Appointment | null>(null);
  const [editingApt, setEditingApt] = useState<Appointment | null>(null);

  // Edit form state
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editArtistId, setEditArtistId] = useState('');
  const [editServiceId, setEditServiceId] = useState('');
  const [editStatus, setEditStatus] = useState<Appointment['status']>('confirmed');
  const [editPaymentStatus, setEditPaymentStatus] = useState<'PAID' | 'PENDING' | 'PARTIAL'>('PENDING');

  const todayStr = new Date().toISOString().split('T')[0];
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowStr = tomorrowDate.toISOString().split('T')[0];

  // Open Edit Modal
  const handleOpenEdit = (apt: Appointment) => {
    setEditingApt(apt);
    setEditDate(apt.date);
    setEditTime(apt.timeSlot);
    setEditArtistId(apt.artistId || '');
    setEditServiceId(apt.serviceIds?.[0] || '');
    setEditStatus(apt.status);
    setEditPaymentStatus(apt.paymentStatus || 'PENDING');
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingApt) return;

    const matchedArtist = artists.find(a => a.id === editArtistId);
    const matchedService = services.find(s => s.id === editServiceId);

    const updated: Appointment = {
      ...editingApt,
      date: editDate,
      timeSlot: editTime,
      artistId: editArtistId,
      artistName: matchedArtist ? matchedArtist.name : editingApt.artistName,
      serviceIds: matchedService ? [matchedService.id] : editingApt.serviceIds,
      serviceNames: matchedService ? [matchedService.name] : editingApt.serviceNames,
      totalAmount: matchedService ? matchedService.price : editingApt.totalAmount,
      status: editStatus,
      paymentStatus: editPaymentStatus,
    };

    onUpdateAppointment(updated);
    setEditingApt(null);
  };

  // Filtered appointments
  const filteredAppointments = appointments.filter(apt => {
    // Search
    const searchLower = searchTerm.toLowerCase().trim();
    if (searchLower) {
      const matchName = apt.customerName.toLowerCase().includes(searchLower);
      const matchPhone = apt.customerPhone.includes(searchLower);
      const matchCode = (apt.referenceCode || apt.id).toLowerCase().includes(searchLower);
      if (!matchName && !matchPhone && !matchCode) return false;
    }

    // Date Filter
    if (filterMode === 'today') {
      return apt.date === todayStr;
    }
    if (filterMode === 'tomorrow') {
      return apt.date === tomorrowStr;
    }
    if (filterMode === 'upcoming') {
      return apt.date >= todayStr && (apt.status === 'confirmed' || apt.status === 'pending');
    }
    if (filterMode === 'completed') {
      return apt.status === 'completed';
    }
    if (filterMode === 'cancelled') {
      return apt.status === 'cancelled';
    }
    if (filterMode === 'custom' && customDate) {
      return apt.date === customDate;
    }

    return true;
  });

  const getStatusBadge = (status: Appointment['status']) => {
    switch (status) {
      case 'confirmed':
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 text-emerald-800">CONFIRMED</span>;
      case 'pending':
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-800">BOOKED</span>;
      case 'completed':
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-100 text-blue-800">COMPLETED</span>;
      case 'cancelled':
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-100 text-rose-800">CANCELLED</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-stone-100 text-stone-700">{status}</span>;
    }
  };

  return (
    <div className="space-y-6">

      {/* HEADER WITH ACTIONS */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-serif font-bold text-[#2D2424]">Salon Appointments</h2>
          <p className="text-xs text-stone-500">
            Total {appointments.length} appointment records ({filteredAppointments.length} matching filter)
          </p>
        </div>

        <button
          type="button"
          onClick={onCreateAppointment}
          className="px-4 py-2 rounded-xl bg-[#8C3A42] hover:bg-[#722F36] text-white text-xs font-semibold shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>New Appointment</span>
        </button>
      </div>

      {/* SEARCH AND FILTERS */}
      <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row gap-3">
          
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Search by customer name, mobile (+91), or appointment ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-xl border border-stone-200 text-xs focus:outline-none focus:ring-2 focus:ring-[#8C3A42] bg-[#FAF7F5]"
            />
            {searchTerm && (
              <button 
                type="button"
                onClick={() => setSearchTerm('')} 
                className="absolute right-3 top-2.5 text-stone-400 hover:text-stone-600 text-xs"
              >
                ✕
              </button>
            )}
          </div>

          {/* Custom Date Input (if selected) */}
          {filterMode === 'custom' && (
            <input
              type="date"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              className="py-2 px-3 rounded-xl border border-stone-200 text-xs focus:outline-none focus:ring-2 focus:ring-[#8C3A42]"
            />
          )}

        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          <span className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider mr-1 flex items-center gap-1">
            <Filter className="w-3 h-3" /> Filter:
          </span>

          {[
            { id: 'all', label: 'All' },
            { id: 'today', label: "Today's" },
            { id: 'tomorrow', label: 'Tomorrow' },
            { id: 'upcoming', label: 'Upcoming' },
            { id: 'completed', label: 'Completed' },
            { id: 'cancelled', label: 'Cancelled' },
            { id: 'custom', label: 'Custom Date' },
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterMode(tab.id as any)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
                filterMode === tab.id
                  ? 'bg-[#8C3A42] text-white font-semibold shadow-xs'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* APPOINTMENTS TABLE */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-xs overflow-hidden">
        {filteredAppointments.length === 0 ? (
          <div className="p-12 text-center text-stone-500">
            <Calendar className="w-10 h-10 text-stone-300 mx-auto mb-2" />
            <p className="text-sm font-medium">No appointments found matching your filter criteria.</p>
            <p className="text-xs text-stone-400 mt-1">Try resetting the filter or search keyword.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#FAF7F5] text-stone-600 uppercase text-[10px] tracking-wider border-b border-stone-200 font-semibold">
                <tr>
                  <th className="py-3 px-4">Appt ID</th>
                  <th className="py-3 px-4">Date & Time</th>
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Mobile</th>
                  <th className="py-3 px-4">Service</th>
                  <th className="py-3 px-4">Staff / Artist</th>
                  <th className="py-3 px-4">Amount</th>
                  <th className="py-3 px-4">Payment</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Feedback</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredAppointments.map(apt => (
                  <tr key={apt.id} className="hover:bg-stone-50/80 transition-colors">
                    
                    {/* ID */}
                    <td className="py-3 px-4 font-mono font-medium text-stone-600 whitespace-nowrap">
                      {apt.referenceCode || apt.id.slice(-6).toUpperCase()}
                    </td>

                    {/* Date & Time */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="font-semibold text-[#2D2424]">{apt.timeSlot}</div>
                      <div className="text-[11px] text-stone-500">{apt.date}</div>
                    </td>

                    {/* Customer */}
                    <td className="py-3 px-4 font-medium text-[#2D2424] whitespace-nowrap">
                      {apt.customerName}
                    </td>

                    {/* Mobile */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      <a href={`tel:${apt.customerPhone}`} className="text-stone-600 hover:text-[#8C3A42] flex items-center gap-1">
                        <Phone className="w-3 h-3 text-stone-400" />
                        <span>{apt.customerPhone}</span>
                      </a>
                    </td>

                    {/* Service */}
                    <td className="py-3 px-4 text-stone-700 max-w-[180px] truncate">
                      {apt.serviceNames?.join(', ') || 'Custom Treatment'}
                    </td>

                    {/* Artist */}
                    <td className="py-3 px-4 text-stone-600 whitespace-nowrap">
                      {apt.artistName || <span className="text-stone-400 italic">Unassigned</span>}
                    </td>

                    {/* Amount */}
                    <td className="py-3 px-4 font-medium text-[#2D2424] whitespace-nowrap">
                      ₹{apt.totalAmount}
                    </td>

                    {/* Payment Status */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        apt.paymentStatus === 'PAID' 
                          ? 'bg-emerald-100 text-emerald-800' 
                          : 'bg-amber-100 text-amber-800'
                      }`}>
                        {apt.paymentStatus || 'PENDING'}
                      </span>
                    </td>

                    {/* Appointment Status */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      {getStatusBadge(apt.status)}
                    </td>

                    {/* Feedback Status */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="text-[10px] text-stone-500">
                        {apt.feedbackStatus === 'RECEIVED' ? '⭐ Received' : apt.feedbackStatus === 'SENT' ? '💬 Sent' : 'Queued'}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 text-right whitespace-nowrap space-x-1">
                      {apt.status !== 'completed' && apt.status !== 'cancelled' && (
                        <button
                          type="button"
                          onClick={() => onUpdateStatus(apt.id, 'completed')}
                          title="Mark Completed (triggers automated WhatsApp feedback)"
                          className="p-1.5 rounded hover:bg-emerald-50 text-emerald-600 cursor-pointer"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => openWhatsApp(apt.customerPhone, getAppointmentWhatsAppMessage(apt))}
                        title="Direct WhatsApp Reminder"
                        className="p-1.5 rounded hover:bg-green-50 text-green-600 cursor-pointer"
                      >
                        <MessageCircle className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOpenEdit(apt)}
                        title="Edit Appointment"
                        className="p-1.5 rounded hover:bg-stone-100 text-stone-600 cursor-pointer"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => setViewingApt(apt)}
                        title="View Full Details"
                        className="p-1.5 rounded hover:bg-stone-100 text-stone-600 cursor-pointer"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>

                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* VIEW DETAILS MODAL */}
      {viewingApt && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <div>
                <h3 className="font-serif font-bold text-lg text-[#2D2424]">Appointment Details</h3>
                <p className="text-xs text-stone-500">Ref: {viewingApt.referenceCode || viewingApt.id}</p>
              </div>
              <button 
                type="button"
                onClick={() => setViewingApt(null)}
                className="text-stone-400 hover:text-stone-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="bg-[#FAF7F5] p-3 rounded-xl space-y-1.5">
                <div className="font-semibold text-sm text-[#2D2424]">{viewingApt.customerName}</div>
                <div className="text-stone-600 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-stone-400" />
                  <span>{viewingApt.customerPhone}</span>
                </div>
                {viewingApt.customerEmail && (
                  <div className="text-stone-500">{viewingApt.customerEmail}</div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 text-stone-600">
                <div className="p-2.5 rounded-lg border border-stone-200">
                  <span className="text-[10px] uppercase text-stone-400 block">Date & Time</span>
                  <span className="font-semibold text-[#2D2424]">{viewingApt.date} • {viewingApt.timeSlot}</span>
                </div>
                <div className="p-2.5 rounded-lg border border-stone-200">
                  <span className="text-[10px] uppercase text-stone-400 block">Status</span>
                  <span className="font-semibold">{getStatusBadge(viewingApt.status)}</span>
                </div>
                <div className="p-2.5 rounded-lg border border-stone-200">
                  <span className="text-[10px] uppercase text-stone-400 block">Stylist / Artist</span>
                  <span className="font-semibold text-[#2D2424]">{viewingApt.artistName || 'Unassigned'}</span>
                </div>
                <div className="p-2.5 rounded-lg border border-stone-200">
                  <span className="text-[10px] uppercase text-stone-400 block">Amount</span>
                  <span className="font-semibold text-emerald-700">₹{viewingApt.totalAmount}</span>
                </div>
              </div>

              <div>
                <span className="text-[10px] uppercase text-stone-400 block mb-1">Services Booked</span>
                <div className="p-2.5 rounded-lg bg-stone-50 border border-stone-200 font-medium">
                  {viewingApt.serviceNames?.join(', ') || 'Custom Salon Service'}
                </div>
              </div>

              {viewingApt.notes && (
                <div>
                  <span className="text-[10px] uppercase text-stone-400 block mb-1">Special Notes</span>
                  <p className="p-2.5 rounded-lg bg-stone-50 border border-stone-200 text-stone-600 italic">
                    "{viewingApt.notes}"
                  </p>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-stone-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setViewingApt(null)}
                className="px-4 py-2 rounded-lg bg-stone-100 text-stone-700 text-xs font-medium hover:bg-stone-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT APPOINTMENT MODAL */}
      {editingApt && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <div>
                <h3 className="font-serif font-bold text-lg text-[#2D2424]">Edit Appointment</h3>
                <p className="text-xs text-stone-500">Customer: {editingApt.customerName}</p>
              </div>
              <button 
                type="button"
                onClick={() => setEditingApt(null)}
                className="text-stone-400 hover:text-stone-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-stone-700 mb-1">Appointment Date</label>
                  <input
                    type="date"
                    required
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-[#8C3A42] bg-white"
                  />
                </div>
                <div>
                  <label className="block font-medium text-stone-700 mb-1">Time Slot</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 11:30 AM"
                    value={editTime}
                    onChange={(e) => setEditTime(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-[#8C3A42] bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Change Service</label>
                <select
                  value={editServiceId}
                  onChange={(e) => setEditServiceId(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-[#8C3A42] bg-white"
                >
                  {services.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} (₹{s.price})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Assign Staff / Makeup Artist</label>
                <select
                  value={editArtistId}
                  onChange={(e) => setEditArtistId(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-[#8C3A42] bg-white"
                >
                  <option value="">Any Available Specialist</option>
                  {artists.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.name} — {a.specialty}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-stone-700 mb-1">Appointment Status</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as any)}
                    className="w-full p-2.5 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-[#8C3A42] bg-white"
                  >
                    <option value="pending">BOOKED</option>
                    <option value="confirmed">CONFIRMED</option>
                    <option value="completed">COMPLETED</option>
                    <option value="cancelled">CANCELLED</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-stone-700 mb-1">Payment Status</label>
                  <select
                    value={editPaymentStatus}
                    onChange={(e) => setEditPaymentStatus(e.target.value as any)}
                    className="w-full p-2.5 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-[#8C3A42] bg-white"
                  >
                    <option value="PENDING">PENDING</option>
                    <option value="PARTIAL">PARTIAL</option>
                    <option value="PAID">PAID</option>
                  </select>
                </div>
              </div>

              <div className="pt-3 border-t border-stone-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingApt(null)}
                  className="px-4 py-2 rounded-lg bg-stone-100 text-stone-700 hover:bg-stone-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#8C3A42] text-white hover:bg-[#722F36] font-medium"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
