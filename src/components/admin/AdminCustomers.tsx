import React, { useState } from 'react';
import { 
  Users, 
  Search, 
  Phone, 
  Mail, 
  Calendar, 
  Receipt, 
  MessageSquareHeart, 
  Edit3, 
  Eye, 
  ArrowLeft, 
  ExternalLink,
  MessageCircle,
  Clock,
  Sparkles,
  Save,
  CheckCircle2
} from 'lucide-react';
import { CustomerProfile, CustomerFeedback, WhatsAppMessageLog } from '../../types/admin';
import { Appointment, BillOrder } from '../../types/salon';
import { openWhatsApp } from '../../utils/whatsapp';

interface AdminCustomersProps {
  customers: CustomerProfile[];
  appointments: Appointment[];
  bills: BillOrder[];
  feedback: CustomerFeedback[];
  whatsappLogs: WhatsAppMessageLog[];
  selectedCustomerId?: string;
  onSelectCustomer: (id?: string) => void;
  onUpdateCustomer: (phone: string, updates: Partial<CustomerProfile>) => void;
}

export const AdminCustomers: React.FC<AdminCustomersProps> = ({
  customers,
  appointments,
  bills,
  feedback,
  whatsappLogs,
  selectedCustomerId,
  onSelectCustomer,
  onUpdateCustomer,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  // Edit fields
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Find active customer if ID selected
  const activeCustomer = customers.find(c => c.id === selectedCustomerId || c.phone.replace(/[^0-9]/g, '') === selectedCustomerId);

  const handleStartEdit = (customer: CustomerProfile) => {
    setIsEditing(true);
    setEditName(customer.name);
    setEditEmail(customer.email || '');
    setEditNotes(customer.notes || '');
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCustomer) return;

    onUpdateCustomer(activeCustomer.phone, {
      name: editName.trim(),
      email: editEmail.trim(),
      notes: editNotes.trim(),
    });

    setIsEditing(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  // Filter list
  const filteredCustomers = customers.filter(c => {
    const q = searchTerm.toLowerCase().trim();
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || c.phone.includes(q) || (c.email && c.email.toLowerCase().includes(q));
  });

  // If viewing single customer details
  if (activeCustomer) {
    const customerApts = appointments.filter(a => a.customerPhone.trim() === activeCustomer.phone.trim());
    const customerBills = bills.filter(b => b.customerPhone.trim() === activeCustomer.phone.trim());
    const customerFeedback = feedback.filter(f => f.customerPhone.trim() === activeCustomer.phone.trim());
    const customerLogs = whatsappLogs.filter(l => l.customerPhone.trim() === activeCustomer.phone.trim());

    return (
      <div className="space-y-6">
        
        {/* Back header */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              onSelectCustomer(undefined);
              setIsEditing(false);
            }}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-600 hover:text-[#8C3A42] cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to All Customers</span>
          </button>

          <button
            type="button"
            onClick={() => handleStartEdit(activeCustomer)}
            className="px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-semibold flex items-center gap-1.5"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>Edit Profile</span>
          </button>
        </div>

        {/* Profile Header Card */}
        <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-xs">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-[#8C3A42]/10 text-[#8C3A42] border border-[#8C3A42]/20 flex items-center justify-center font-serif text-2xl font-bold">
                {activeCustomer.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h2 className="font-serif text-2xl font-bold text-[#2D2424]">{activeCustomer.name}</h2>
                <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500 mt-1">
                  <span className="flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5 text-stone-400" />
                    <span>{activeCustomer.phone}</span>
                  </span>
                  {activeCustomer.email && (
                    <span className="flex items-center gap-1">
                      <Mail className="w-3.5 h-3.5 text-stone-400" />
                      <span>{activeCustomer.email}</span>
                    </span>
                  )}
                  <span className="text-stone-400">•</span>
                  <span>Client since {new Date(activeCustomer.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => openWhatsApp(activeCustomer.phone, `Hi ${activeCustomer.name}, this is The Glossy Looks salon concierge in Gachibowli. How may we assist you today?`)}
                className="px-3.5 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs"
              >
                <MessageCircle className="w-4 h-4" />
                <span>WhatsApp Concierge</span>
              </button>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-stone-100 text-xs">
            <div className="p-3 rounded-xl bg-stone-50 border border-stone-200">
              <span className="text-stone-400 text-[10px] uppercase font-semibold block">Total Visits</span>
              <span className="text-xl font-bold text-[#2D2424] font-serif">{activeCustomer.totalVisits}</span>
            </div>
            <div className="p-3 rounded-xl bg-stone-50 border border-stone-200">
              <span className="text-stone-400 text-[10px] uppercase font-semibold block">Total Spend</span>
              <span className="text-xl font-bold text-emerald-700 font-serif">₹{activeCustomer.totalSpend.toLocaleString('en-IN')}</span>
            </div>
            <div className="p-3 rounded-xl bg-stone-50 border border-stone-200">
              <span className="text-stone-400 text-[10px] uppercase font-semibold block">Last Visit</span>
              <span className="text-sm font-semibold text-[#2D2424]">{activeCustomer.lastVisit || 'N/A'}</span>
            </div>
            <div className="p-3 rounded-xl bg-stone-50 border border-stone-200">
              <span className="text-stone-400 text-[10px] uppercase font-semibold block">Last Service</span>
              <span className="text-sm font-medium text-stone-700 truncate block">{activeCustomer.lastService || 'None'}</span>
            </div>
          </div>

          {/* Customer notes */}
          {activeCustomer.notes && (
            <div className="mt-4 p-3 rounded-xl bg-amber-50/60 border border-amber-200/80 text-xs text-amber-900">
              <span className="font-semibold block text-[10px] uppercase tracking-wider text-amber-800 mb-0.5">
                Client Preferences & Beauty Notes:
              </span>
              <p className="italic">"{activeCustomer.notes}"</p>
            </div>
          )}
        </div>

        {/* EDIT CUSTOMER MODAL */}
        {isEditing && (
          <div className="bg-white rounded-2xl border border-[#8C3A42]/30 p-6 shadow-md space-y-4">
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <h3 className="font-serif font-bold text-lg text-[#2D2424]">Edit Customer Information</h3>
              <button 
                type="button"
                onClick={() => setIsEditing(false)}
                className="text-stone-400 hover:text-stone-600 text-xs"
              >
                Cancel
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-[#8C3A42] bg-white"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Email Address</label>
                  <input
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    placeholder="client@gmail.com"
                    className="w-full p-2.5 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-[#8C3A42] bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">Styling Notes & Allergies</label>
                <textarea
                  rows={2}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="e.g. Sensitive scalp, prefers ammonia-free color, likes medium pressure during massage..."
                  className="w-full p-2.5 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-[#8C3A42] bg-white"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2 rounded-lg bg-stone-100 text-stone-700 hover:bg-stone-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#8C3A42] text-white hover:bg-[#722F36] font-medium flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Update Profile</span>
                </button>
              </div>
            </form>
          </div>
        )}

        {/* TABS GRID: Appointment History & Invoices */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* APPOINTMENT HISTORY */}
          <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs">
            <h3 className="font-serif font-bold text-base text-[#2D2424] mb-3 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[#8C3A42]" />
              <span>Appointment History ({customerApts.length})</span>
            </h3>

            {customerApts.length === 0 ? (
              <p className="text-xs text-stone-400 italic py-4">No appointment records found for this number.</p>
            ) : (
              <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                {customerApts.map(apt => (
                  <div key={apt.id} className="p-3 rounded-xl bg-stone-50 border border-stone-200 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-[#2D2424]">{apt.date} • {apt.timeSlot}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        apt.status === 'completed' ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        {apt.status.toUpperCase()}
                      </span>
                    </div>
                    <div className="text-stone-600 truncate">{apt.serviceNames?.join(', ')}</div>
                    <div className="flex items-center justify-between text-[11px] text-stone-500 mt-1.5 pt-1.5 border-t border-stone-200/60">
                      <span>Artist: {apt.artistName || 'Salon Team'}</span>
                      <span className="font-semibold text-emerald-700">₹{apt.totalAmount}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* BILLING & INVOICES */}
          <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs">
            <h3 className="font-serif font-bold text-base text-[#2D2424] mb-3 flex items-center gap-2">
              <Receipt className="w-4 h-4 text-[#8C3A42]" />
              <span>Invoices & Payments ({customerBills.length})</span>
            </h3>

            {customerBills.length === 0 ? (
              <p className="text-xs text-stone-400 italic py-4">No direct invoices billed yet.</p>
            ) : (
              <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                {customerBills.map(bill => (
                  <div key={bill.id} className="p-3 rounded-xl bg-stone-50 border border-stone-200 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono font-semibold text-[#2D2424]">{bill.invoiceNumber}</span>
                      <span className="font-bold text-emerald-700">₹{bill.grandTotal}</span>
                    </div>
                    <div className="text-stone-500 text-[11px]">
                      {new Date(bill.createdAt).toLocaleDateString()} • {bill.paymentMode} ({bill.paymentStatus})
                    </div>
                    <div className="text-stone-600 mt-1 truncate">
                      {bill.items?.map(i => i.name).join(', ')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* CUSTOMER FEEDBACK HISTORY */}
          <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs">
            <h3 className="font-serif font-bold text-base text-[#2D2424] mb-3 flex items-center gap-2">
              <MessageSquareHeart className="w-4 h-4 text-[#8C3A42]" />
              <span>Customer Feedback ({customerFeedback.length})</span>
            </h3>

            {customerFeedback.length === 0 ? (
              <p className="text-xs text-stone-400 italic py-4">No reviews recorded yet.</p>
            ) : (
              <div className="space-y-2.5">
                {customerFeedback.map(fb => (
                  <div key={fb.id} className="p-3 rounded-xl bg-stone-50 border border-stone-200 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-stone-700">{fb.serviceName}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        fb.rating === 'GOOD' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                      }`}>
                        {fb.rating}
                      </span>
                    </div>
                    <p className="text-stone-600 italic">"{fb.comment}"</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* WHATSAPP COMMUNICATION STATUS */}
          <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs">
            <h3 className="font-serif font-bold text-base text-[#2D2424] mb-3 flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-green-600" />
              <span>WhatsApp Communication Logs</span>
            </h3>

            {customerLogs.length === 0 ? (
              <p className="text-xs text-stone-400 italic py-4">No automated messages recorded for this number.</p>
            ) : (
              <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                {customerLogs.map(log => (
                  <div key={log.id} className="p-3 rounded-xl bg-green-50/50 border border-green-200/70 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-green-900">{(log.type || log.templateName || 'MESSAGE').replace('_', ' ')}</span>
                      <span className="text-[10px] text-green-700">{log.status}</span>
                    </div>
                    <p className="text-stone-600 text-[11px] line-clamp-2">{log.messagePreview}</p>
                    <span className="text-[10px] text-stone-400 mt-1 block">
                      {new Date(log.timestamp).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

      </div>
    );
  }

  // Customers Directory Table View
  return (
    <div className="space-y-6">

      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-serif font-bold text-[#2D2424]">Customer Relationship Directory</h2>
          <p className="text-xs text-stone-500">
            {customers.length} registered clients with complete visit & billing intelligence
          </p>
        </div>
      </div>

      {/* SEARCH */}
      <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-xs">
        <div className="relative">
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Search clients by name, phone number (+91), or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-stone-200 text-xs focus:outline-none focus:ring-2 focus:ring-[#8C3A42] bg-[#FAF7F5]"
          />
        </div>
      </div>

      {/* CUSTOMERS TABLE */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-xs overflow-hidden">
        {filteredCustomers.length === 0 ? (
          <div className="p-12 text-center text-stone-500">
            <Users className="w-10 h-10 text-stone-300 mx-auto mb-2" />
            <p className="text-sm font-medium">No customers found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#FAF7F5] text-stone-600 uppercase text-[10px] tracking-wider border-b border-stone-200 font-semibold">
                <tr>
                  <th className="py-3 px-4">Customer Name</th>
                  <th className="py-3 px-4">Mobile</th>
                  <th className="py-3 px-4">Email</th>
                  <th className="py-3 px-4">Last Visit</th>
                  <th className="py-3 px-4">Total Visits</th>
                  <th className="py-3 px-4">Total Spend</th>
                  <th className="py-3 px-4">Last Service</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredCustomers.map(c => (
                  <tr key={c.id} className="hover:bg-stone-50/80 transition-colors">
                    
                    <td className="py-3 px-4 font-semibold text-[#2D2424] whitespace-nowrap">
                      {c.name}
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap">
                      <a href={`tel:${c.phone}`} className="text-stone-600 hover:text-[#8C3A42] flex items-center gap-1">
                        <Phone className="w-3 h-3 text-stone-400" />
                        <span>{c.phone}</span>
                      </a>
                    </td>

                    <td className="py-3 px-4 text-stone-500 whitespace-nowrap">
                      {c.email || '—'}
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap text-stone-600">
                      {c.lastVisit || '—'}
                    </td>

                    <td className="py-3 px-4 font-semibold text-stone-700 whitespace-nowrap">
                      {c.totalVisits}
                    </td>

                    <td className="py-3 px-4 font-bold text-emerald-700 whitespace-nowrap">
                      ₹{c.totalSpend.toLocaleString('en-IN')}
                    </td>

                    <td className="py-3 px-4 text-stone-600 max-w-[160px] truncate">
                      {c.lastService || '—'}
                    </td>

                    <td className="py-3 px-4 text-right whitespace-nowrap space-x-1.5">
                      <button
                        type="button"
                        onClick={() => openWhatsApp(c.phone, `Hello ${c.name}, greetings from The Glossy Looks Women's Salon, Gachibowli!`)}
                        title="Chat on WhatsApp"
                        className="p-1.5 rounded hover:bg-green-50 text-green-600 cursor-pointer"
                      >
                        <MessageCircle className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => onSelectCustomer(c.id)}
                        className="px-2.5 py-1 rounded bg-[#8C3A42]/10 hover:bg-[#8C3A42] text-[#8C3A42] hover:text-white font-medium text-xs transition-colors cursor-pointer"
                      >
                        View Profile
                      </button>
                    </td>

                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
};
