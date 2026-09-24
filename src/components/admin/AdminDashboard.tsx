import React from 'react';
import { 
  Calendar, 
  TrendingUp, 
  CheckCircle2, 
  XCircle, 
  Users, 
  MessageSquare, 
  AlertTriangle, 
  Clock, 
  Receipt,
  Phone,
  Sparkles,
  ArrowRight,
  ExternalLink,
  Smile,
  Meh,
  Frown
} from 'lucide-react';
import { Appointment, BillOrder, CustomerEnquiry } from '../../types/salon';
import { CustomerFeedback, CustomerProfile } from '../../types/admin';
import { AdminRoute } from '../../hooks/useAdminRouter';

interface AdminDashboardProps {
  appointments: Appointment[];
  bills: BillOrder[];
  enquiries: CustomerEnquiry[];
  feedback: CustomerFeedback[];
  customers: CustomerProfile[];
  onNavigate: (route: AdminRoute) => void;
  onUpdateAppointmentStatus: (id: string, status: Appointment['status']) => void;
  onSelectCustomerDetail?: (customerId: string) => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  appointments,
  bills,
  enquiries,
  feedback,
  customers,
  onNavigate,
  onUpdateAppointmentStatus,
  onSelectCustomerDetail,
}) => {
  const todayStr = new Date().toISOString().split('T')[0];
  const currentMonthStr = todayStr.substring(0, 7); // 'YYYY-MM'

  // Calculations from actual data
  const todayAppointments = appointments.filter(a => a.date === todayStr);
  const upcomingAppointments = appointments.filter(a => {
    return a.date >= todayStr && (a.status === 'confirmed' || a.status === 'pending');
  });
  const completedToday = appointments.filter(a => a.date === todayStr && a.status === 'completed');
  const cancelledCount = appointments.filter(a => a.status === 'cancelled').length;

  // Real revenue calculated from bills & completed appointments
  const todayRevenue = bills
    .filter(b => b.createdAt.startsWith(todayStr))
    .reduce((sum, b) => sum + (b.grandTotal || 0), 0) ||
    completedToday.reduce((sum, a) => sum + (a.totalAmount || 0), 0);

  const monthlyRevenue = bills
    .filter(b => b.createdAt.startsWith(currentMonthStr))
    .reduce((sum, b) => sum + (b.grandTotal || 0), 0) ||
    appointments
      .filter(a => a.date.startsWith(currentMonthStr) && a.status === 'completed')
      .reduce((sum, a) => sum + (a.totalAmount || 0), 0);

  const totalCustomersCount = customers.length;
  const pendingEnquiriesCount = enquiries.filter(e => e.status === 'New').length;
  const feedbackPendingCount = feedback.filter(f => f.requiresFollowUp && f.followUpStatus === 'PENDING').length;
  const badFeedbackFollowups = feedback.filter(f => f.rating === 'BAD' && f.followUpStatus === 'PENDING').length;

  const getStatusBadge = (status: Appointment['status']) => {
    switch (status) {
      case 'confirmed':
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 text-emerald-800">Confirmed</span>;
      case 'pending':
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-800">Booked</span>;
      case 'completed':
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-100 text-blue-800">Completed</span>;
      case 'cancelled':
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-100 text-rose-800">Cancelled</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-stone-100 text-stone-700">{status}</span>;
    }
  };

  const getRatingIcon = (rating: CustomerFeedback['rating']) => {
    switch (rating) {
      case 'GOOD':
        return <Smile className="w-4 h-4 text-emerald-600" />;
      case 'AVERAGE':
        return <Meh className="w-4 h-4 text-amber-600" />;
      case 'BAD':
        return <Frown className="w-4 h-4 text-rose-600" />;
    }
  };

  return (
    <div className="space-y-8">

      {/* WELCOME BANNER */}
      <div className="bg-gradient-to-r from-[#2D2424] to-[#453636] rounded-2xl p-6 text-white shadow-md relative overflow-hidden flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="relative z-10">
          <div className="flex items-center gap-2 text-[#E8C5C8] text-xs font-semibold uppercase tracking-wider mb-1">
            <Sparkles className="w-4 h-4" />
            <span>Salon Operations Control Center</span>
          </div>
          <h2 className="text-2xl font-serif font-bold text-white">Daily Salon Performance</h2>
          <p className="text-xs text-stone-300 mt-1">
            Real-time appointments, revenue metrics, customer satisfaction, and staff assignments.
          </p>
        </div>

        <div className="flex items-center gap-3 relative z-10 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('appointments')}
            className="px-4 py-2 rounded-xl bg-[#8C3A42] hover:bg-[#722F36] text-white text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5"
          >
            <span>+ New Appointment</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('billing')}
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-all flex items-center gap-1.5 border border-white/15"
          >
            <Receipt className="w-3.5 h-3.5" />
            <span>Open POS Desk</span>
          </button>
        </div>
      </div>

      {/* SUMMARY METRICS GRID */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4">
        
        {/* Today's Appointments */}
        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Today's Appts</span>
            <Calendar className="w-4 h-4 text-[#8C3A42]" />
          </div>
          <div className="text-2xl font-serif font-bold text-[#2D2424]">{todayAppointments.length}</div>
          <div className="text-[11px] text-stone-500 mt-1 flex items-center gap-1">
            <span className="text-emerald-600 font-semibold">{completedToday.length} completed</span>
          </div>
        </div>

        {/* Upcoming Appointments */}
        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Upcoming</span>
            <Clock className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl font-serif font-bold text-[#2D2424]">{upcomingAppointments.length}</div>
          <div className="text-[11px] text-stone-500 mt-1">Confirmed / Booked</div>
        </div>

        {/* Today's Revenue */}
        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Today's Revenue</span>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-serif font-bold text-emerald-700">₹{todayRevenue.toLocaleString('en-IN')}</div>
          <div className="text-[11px] text-stone-500 mt-1">From bills & services</div>
        </div>

        {/* Monthly Revenue */}
        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Monthly Revenue</span>
            <Receipt className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-2xl font-serif font-bold text-[#2D2424]">₹{monthlyRevenue.toLocaleString('en-IN')}</div>
          <div className="text-[11px] text-stone-500 mt-1">{new Date().toLocaleString('default', { month: 'long' })}</div>
        </div>

        {/* Total Customers */}
        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Total Customers</span>
            <Users className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-serif font-bold text-[#2D2424]">{totalCustomersCount}</div>
          <div className="text-[11px] text-stone-500 mt-1">Unique client profiles</div>
        </div>

        {/* Cancelled Appointments */}
        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Cancelled</span>
            <XCircle className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-2xl font-serif font-bold text-[#2D2424]">{cancelledCount}</div>
          <div className="text-[11px] text-stone-500 mt-1">Requires re-booking</div>
        </div>

        {/* Pending Enquiries */}
        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Pending Enquiries</span>
            <MessageSquare className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-serif font-bold text-[#2D2424]">{pendingEnquiriesCount}</div>
          <div className="text-[11px] text-amber-600 mt-1 font-medium">New consultations</div>
        </div>

        {/* Feedback Pending */}
        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs">
          <div className="flex items-center justify-between text-stone-500 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Feedback Pending</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-serif font-bold text-[#2D2424]">{feedbackPendingCount}</div>
          <div className="text-[11px] text-stone-500 mt-1">Follow-ups queued</div>
        </div>

        {/* Negative Follow-ups (Alert Card) */}
        <div className={`p-4 rounded-xl border shadow-xs col-span-2 md:col-span-1 lg:col-span-2 ${
          badFeedbackFollowups > 0 ? 'bg-rose-50 border-rose-200 text-rose-900' : 'bg-white border-stone-200'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Negative Follow-ups</span>
            <AlertTriangle className={`w-4 h-4 ${badFeedbackFollowups > 0 ? 'text-rose-600' : 'text-stone-400'}`} />
          </div>
          <div className="text-2xl font-serif font-bold">{badFeedbackFollowups}</div>
          <div className="text-[11px] mt-1">
            {badFeedbackFollowups > 0 
              ? 'Urgent client callback required!' 
              : 'All negative feedbacks resolved.'}
          </div>
        </div>

      </div>

      {/* TODAY'S APPOINTMENT SCHEDULE TABLE */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-serif font-bold text-lg text-[#2D2424]">Today's Appointment Schedule</h3>
            <p className="text-xs text-stone-500">
              {todayAppointments.length} appointment(s) scheduled for today ({todayStr})
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('appointments')}
            className="text-xs text-[#8C3A42] hover:text-[#722F36] font-semibold flex items-center gap-1 cursor-pointer"
          >
            <span>View All Appointments</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {todayAppointments.length === 0 ? (
          <div className="p-12 text-center text-stone-500">
            <Calendar className="w-10 h-10 text-stone-300 mx-auto mb-2" />
            <p className="text-sm font-medium">No appointments scheduled for today yet.</p>
            <p className="text-xs text-stone-400 mt-1">Click "New Appointment" to book a client visit.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#FAF7F5] text-stone-600 uppercase text-[10px] tracking-wider border-b border-stone-200 font-semibold">
                <tr>
                  <th className="py-3 px-4">Time</th>
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Mobile</th>
                  <th className="py-3 px-4">Service</th>
                  <th className="py-3 px-4">Artist</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Payment</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {todayAppointments.map((apt) => (
                  <tr key={apt.id} className="hover:bg-stone-50/70 transition-colors">
                    <td className="py-3.5 px-4 font-semibold text-[#2D2424] whitespace-nowrap">
                      {apt.timeSlot}
                    </td>
                    <td className="py-3.5 px-4 font-medium text-[#2D2424]">
                      {apt.customerName}
                    </td>
                    <td className="py-3.5 px-4 text-stone-600 whitespace-nowrap">
                      <a href={`tel:${apt.customerPhone}`} className="hover:text-[#8C3A42] flex items-center gap-1">
                        <Phone className="w-3 h-3 text-stone-400" />
                        <span>{apt.customerPhone}</span>
                      </a>
                    </td>
                    <td className="py-3.5 px-4 text-stone-700 max-w-[200px] truncate">
                      {apt.serviceNames?.join(', ') || 'Custom Treatment'}
                    </td>
                    <td className="py-3.5 px-4 text-stone-600 whitespace-nowrap">
                      {apt.artistName || 'Unassigned'}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {getStatusBadge(apt.status)}
                    </td>
                    <td className="py-3.5 px-4 font-medium whitespace-nowrap">
                      <span className={`text-[11px] ${apt.paymentStatus === 'PAID' ? 'text-emerald-700 font-semibold' : 'text-amber-700'}`}>
                        ₹{apt.totalAmount} ({apt.paymentStatus || 'Pending'})
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap space-x-1.5">
                      {apt.status !== 'completed' && (
                        <button
                          type="button"
                          onClick={() => onUpdateAppointmentStatus(apt.id, 'completed')}
                          title="Mark Completed & Trigger Feedback"
                          className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-medium text-[11px] border border-emerald-200"
                        >
                          Complete
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onNavigate('appointments')}
                        className="px-2 py-1 rounded bg-stone-100 text-stone-700 hover:bg-stone-200 text-[11px]"
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* RECENT FEEDBACK FEED */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-xs p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-serif font-bold text-lg text-[#2D2424]">Recent Customer Feedback</h3>
            <p className="text-xs text-stone-500">Live responses via WhatsApp automation</p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('feedback')}
            className="text-xs text-[#8C3A42] hover:text-[#722F36] font-semibold flex items-center gap-1 cursor-pointer"
          >
            <span>Manage All Feedback</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {feedback.slice(0, 4).map((fb) => (
            <div 
              key={fb.id} 
              className={`p-4 rounded-xl border text-xs ${
                fb.rating === 'BAD' 
                  ? 'bg-rose-50/50 border-rose-200' 
                  : fb.rating === 'AVERAGE' 
                    ? 'bg-amber-50/40 border-amber-200' 
                    : 'bg-stone-50/60 border-stone-200'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {getRatingIcon(fb.rating)}
                  <span className="font-semibold text-[#2D2424]">{fb.customerName}</span>
                </div>
                <span className="text-[10px] text-stone-400">
                  {new Date(fb.createdAt).toLocaleDateString()}
                </span>
              </div>
              <p className="text-stone-700 line-clamp-2 italic mb-2">"{fb.comment}"</p>
              <div className="flex items-center justify-between text-[11px] text-stone-500 pt-1 border-t border-stone-200/60">
                <span>{fb.serviceName} • {fb.artistName || 'Stylist'}</span>
                {fb.requiresFollowUp && fb.followUpStatus === 'PENDING' && (
                  <span className="text-rose-600 font-bold uppercase text-[10px] bg-rose-100 px-1.5 py-0.5 rounded">
                    Action Needed
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};
