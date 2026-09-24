import React, { useState } from 'react';
import { 
  HelpCircle, 
  Search, 
  Phone, 
  MessageCircle, 
  CheckCircle2, 
  Clock, 
  X,
  Mail,
  Filter
} from 'lucide-react';
import { CustomerEnquiry } from '../../types/salon';
import { openWhatsApp } from '../../utils/whatsapp';

interface AdminEnquiriesProps {
  enquiries: CustomerEnquiry[];
  onUpdateStatus: (id: string, status: CustomerEnquiry['status']) => void;
}

export const AdminEnquiries: React.FC<AdminEnquiriesProps> = ({
  enquiries,
  onUpdateStatus,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'New' | 'Contacted' | 'Closed'>('ALL');

  const totalCount = enquiries.length;
  const newCount = enquiries.filter(e => e.status === 'New').length;
  const contactedCount = enquiries.filter(e => e.status === 'Contacted').length;
  const closedCount = enquiries.filter(e => e.status === 'Closed').length;

  const filteredEnquiries = enquiries.filter(e => {
    if (filterStatus !== 'ALL' && e.status !== filterStatus) return false;
    const name = e.customerName || e.name || '';
    const phone = e.customerPhone || e.phone || '';
    const srv = e.serviceOfInterest || e.serviceInterested || '';
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const matchName = name.toLowerCase().includes(q);
      const matchPhone = phone.includes(q);
      const matchMsg = (e.message || '').toLowerCase().includes(q);
      const matchSrv = srv.toLowerCase().includes(q);
      if (!matchName && !matchPhone && !matchMsg && !matchSrv) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">

      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-serif font-bold text-[#2D2424]">Customer Enquiries & Consultations</h2>
          <p className="text-xs text-stone-500">
            Incoming web leads, bridal consultations, and inquiries submitted through the contact form.
          </p>
        </div>
      </div>

      {/* METRIC STRIP */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white p-4 rounded-xl border border-stone-200">
          <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider block">Total Leads</span>
          <span className="text-2xl font-bold font-serif text-[#2D2424]">{totalCount}</span>
        </div>
        <div className={`p-4 rounded-xl border ${newCount > 0 ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-white border-stone-200'}`}>
          <span className="text-[10px] font-semibold uppercase tracking-wider block">New Leads</span>
          <span className="text-2xl font-bold font-serif">{newCount}</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-stone-200">
          <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider block">Contacted</span>
          <span className="text-2xl font-bold font-serif text-blue-700">{contactedCount}</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-stone-200">
          <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider block">Closed / Converted</span>
          <span className="text-2xl font-bold font-serif text-emerald-700">{closedCount}</span>
        </div>
      </div>

      {/* SEARCH AND FILTERS */}
      <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-xs space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Search enquiries by name, phone (+91), or message..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-stone-200 text-xs focus:outline-none focus:ring-2 focus:ring-[#8C3A42] bg-[#FAF7F5]"
          />
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          <span className="text-[11px] font-semibold text-stone-400 uppercase mr-1">Status:</span>
          {[
            { id: 'ALL', label: 'All Enquiries' },
            { id: 'New', label: 'New Leads' },
            { id: 'Contacted', label: 'Contacted' },
            { id: 'Closed', label: 'Closed' },
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterStatus(tab.id as any)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
                filterStatus === tab.id ? 'bg-[#8C3A42] text-white font-semibold' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ENQUIRIES TABLE */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-xs overflow-hidden">
        {filteredEnquiries.length === 0 ? (
          <div className="p-12 text-center text-stone-500">
            <HelpCircle className="w-10 h-10 text-stone-300 mx-auto mb-2" />
            <p className="text-sm font-medium">No enquiries match your selection.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#FAF7F5] text-stone-600 uppercase text-[10px] tracking-wider border-b border-stone-200 font-semibold">
                <tr>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Customer Name</th>
                  <th className="py-3 px-4">Mobile</th>
                  <th className="py-3 px-4">Service of Interest</th>
                  <th className="py-3 px-4">Customer Message</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredEnquiries.map(enq => {
                  const custName = enq.customerName || enq.name || 'Anonymous';
                  const custPhone = enq.customerPhone || enq.phone || '';
                  const srvInterest = enq.serviceOfInterest || enq.serviceInterested || 'General Enquiry';

                  return (
                    <tr key={enq.id} className="hover:bg-stone-50/80 transition-colors">
                      <td className="py-3.5 px-4 text-stone-500 whitespace-nowrap">
                        {new Date(enq.createdAt).toLocaleDateString()}
                      </td>

                      <td className="py-3.5 px-4 font-semibold text-[#2D2424] whitespace-nowrap">
                        {custName}
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <a href={`tel:${custPhone}`} className="text-stone-600 hover:text-[#8C3A42] flex items-center gap-1">
                          <Phone className="w-3 h-3 text-stone-400" />
                          <span>{custPhone}</span>
                        </a>
                      </td>

                      <td className="py-3.5 px-4 text-stone-700 whitespace-nowrap">
                        {srvInterest}
                      </td>

                      <td className="py-3.5 px-4 text-stone-600 max-w-[260px]">
                        <span className="italic line-clamp-2">"{enq.message}"</span>
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <select
                          value={enq.status}
                          onChange={(e) => onUpdateStatus(enq.id, e.target.value as any)}
                          className={`text-[10px] font-bold px-2 py-1 rounded border ${
                            enq.status === 'New' 
                              ? 'bg-amber-50 text-amber-800 border-amber-200' 
                              : enq.status === 'Contacted' 
                                ? 'bg-blue-50 text-blue-800 border-blue-200' 
                                : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          }`}
                        >
                          <option value="New">NEW</option>
                          <option value="Contacted">CONTACTED</option>
                          <option value="Closed">CLOSED</option>
                        </select>
                      </td>

                      <td className="py-3.5 px-4 text-right whitespace-nowrap space-x-1.5">
                        <a
                          href={`tel:${custPhone}`}
                          title="Direct Call"
                          className="inline-flex p-1.5 rounded hover:bg-stone-100 text-stone-600"
                        >
                          <Phone className="w-4 h-4" />
                        </a>

                        <button
                          type="button"
                          onClick={() => openWhatsApp(custPhone, `Hi ${custName}, thank you for reaching out to The Glossy Looks Women's Salon, Gachibowli regarding your enquiry for "${srvInterest}". How may we assist you with scheduling or package details?`)}
                          title="Direct WhatsApp"
                          className="inline-flex p-1.5 rounded hover:bg-green-50 text-green-600 cursor-pointer"
                        >
                          <MessageCircle className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
};
