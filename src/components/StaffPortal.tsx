import React, { useState } from 'react';
import { 
  Sparkles, 
  Calendar, 
  Receipt, 
  LogOut, 
  Printer, 
  Search, 
  Plus, 
  CheckCircle2, 
  Clock, 
  Phone, 
  User, 
  CreditCard, 
  Trash2,
  X,
  Store
} from 'lucide-react';
import { AdminUser, AdminSession, PrinterSettings } from '../types/admin';
import { Appointment, BillOrder, SalonService } from '../types/salon';
import { InvoiceModal } from './InvoiceModal';

interface StaffPortalProps {
  currentUser: AdminUser;
  appointments: Appointment[];
  services: SalonService[];
  printerSettings: PrinterSettings;
  onLogout: () => void;
  onViewPublicSite: () => void;
  onCreateBill: (bill: BillOrder) => void;
}

export const StaffPortal: React.FC<StaffPortalProps> = ({
  currentUser,
  appointments,
  services,
  printerSettings,
  onLogout,
  onViewPublicSite,
  onCreateBill,
}) => {
  const [activeTab, setActiveTab] = useState<'pos' | 'today_appointments'>('pos');
  const [activeInvoiceToView, setActiveInvoiceToView] = useState<BillOrder | null>(null);

  // Walk-In POS state
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [billItems, setBillItems] = useState<{ id: string; name: string; price: number; quantity: number }[]>([]);
  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [taxPercent, setTaxPercent] = useState<number>(18);
  const [paymentMode, setPaymentMode] = useState<BillOrder['paymentMode']>('UPI');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [posSuccessMsg, setPosSuccessMsg] = useState('');

  const activeServices = services.filter(s => s.active !== false);

  const filteredServices = activeServices.filter(s => {
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    return s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q);
  });

  const subtotal = billItems.reduce((acc, curr) => acc + curr.price * curr.quantity, 0);
  const calculatedTax = Math.round(((subtotal - discountAmount) * taxPercent) / 100);
  const grandTotal = Math.max(0, subtotal - discountAmount + (calculatedTax > 0 ? calculatedTax : 0));

  const handleAddItem = (srv: SalonService) => {
    setBillItems(prev => {
      const existing = prev.find(i => i.id === srv.id);
      if (existing) {
        return prev.map(i => i.id === srv.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { id: srv.id, name: srv.name, price: srv.price, quantity: 1 }];
    });
  };

  const handleRemoveItem = (id: string) => {
    setBillItems(prev => prev.filter(i => i.id !== id));
  };

  const handleQuantityChange = (id: string, delta: number) => {
    setBillItems(prev => prev.map(i => {
      if (i.id === id) {
        const newQty = Math.max(1, i.quantity + delta);
        return { ...i, quantity: newQty };
      }
      return i;
    }));
  };

  const handleCompleteWalkInBill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (billItems.length === 0) {
      alert('Please select at least one salon service for billing.');
      return;
    }
    if (!customerName.trim() || !customerPhone.trim()) {
      alert('Customer Name and WhatsApp Phone Number are required for POS billing.');
      return;
    }

    setIsSubmitting(true);
    const invoiceNum = `GL-POS-${Date.now().toString().slice(-6)}`;

    const newBill: BillOrder = {
      id: 'bill-' + Date.now(),
      invoiceNumber: invoiceNum,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      items: billItems.map(i => ({
        id: i.id,
        name: i.name,
        price: i.price,
        quantity: i.quantity,
        type: 'service',
      })),
      subtotal: subtotal,
      subTotal: subtotal,
      discountAmount: Number(discountAmount) || 0,
      taxAmount: calculatedTax,
      grandTotal: grandTotal,
      paymentMode: paymentMode,
      paymentStatus: 'Paid',
      staffName: currentUser.name,
      createdAt: new Date().toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    };

    try {
      onCreateBill(newBill);

      // Trigger server walk-in endpoint with automatic thermal print job creation
      const res = await fetch('/api/billing/walk-in', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('glossy_staff_session_v1') ? JSON.parse(localStorage.getItem('glossy_staff_session_v1')!).token : 'staff-token'}`,
        },
        body: JSON.stringify(newBill),
      });

      setPosSuccessMsg(`Payment completed! Invoice ${invoiceNum} generated.`);
      setActiveInvoiceToView(newBill);

      // Reset form
      setBillItems([]);
      setCustomerName('');
      setCustomerPhone('');
      setDiscountAmount(0);
      setTimeout(() => setPosSuccessMsg(''), 4000);
    } catch (err: any) {
      alert(err.message || 'Billing error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filter today's appointments
  const todayDateStr = new Date().toISOString().split('T')[0];
  const todayAppointments = appointments.filter(a => a.date === todayDateStr || a.status === 'confirmed');

  return (
    <div className="min-h-screen bg-[#FAF7F5] flex flex-col selection:bg-[#E8C5C8] selection:text-[#3B1E22]">
      
      {/* Top Staff Navigation Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-[#E8DDD8] px-4 sm:px-6 lg:px-8 shadow-xs">
        <div className="flex items-center justify-between h-16 max-w-7xl mx-auto">
          
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#E8C5C8] to-[#D99B9F] flex items-center justify-center shadow-xs">
              <Sparkles className="w-5 h-5 text-[#2D2424]" />
            </div>
            <div>
              <span className="font-serif-luxury text-lg font-bold text-[#2D2424] block leading-tight">
                The Glossy Looks
              </span>
              <span className="text-[10px] text-[#8C3A42] font-bold uppercase tracking-wider">
                Staff Operations Portal (POS)
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <div className="hidden sm:flex flex-col text-right">
              <span className="text-xs font-bold text-[#2D2424]">{currentUser.name}</span>
              <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded-full inline-block">
                Staff Active
              </span>
            </div>

            <button
              onClick={onViewPublicSite}
              className="text-xs font-semibold text-stone-600 hover:text-[#8C3A42] px-3 py-1.5 rounded-lg border border-stone-200 bg-stone-50 hover:bg-stone-100 transition-colors"
            >
              Public Site
            </button>

            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 font-semibold text-xs transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Logout</span>
            </button>
          </div>

        </div>
      </header>

      {/* Main Staff Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-6">
        
        {/* Navigation Tabs: Walk-In POS vs Today's Appointments */}
        <div className="flex border-b border-stone-200 gap-4 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('pos')}
            className={`pb-3 flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'pos'
                ? 'border-[#8C3A42] text-[#8C3A42]'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <Receipt className="w-4 h-4" />
            <span>Walk-In Billing / POS</span>
          </button>

          <button
            onClick={() => setActiveTab('today_appointments')}
            className={`pb-3 flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'today_appointments'
                ? 'border-[#8C3A42] text-[#8C3A42]'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>Scheduled Appointments ({todayAppointments.length})</span>
          </button>
        </div>

        {posSuccessMsg && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-medium flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>{posSuccessMsg}</span>
            </div>
            {printerSettings.autoPrint && (
              <span className="text-[11px] font-mono text-emerald-900 bg-emerald-100 px-2 py-0.5 rounded">
                Thermal Print Job Created ({printerSettings.paperWidth})
              </span>
            )}
          </div>
        )}

        {/* VIEW 1: WALK-IN POS BILLING */}
        {activeTab === 'pos' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Left Column: Services Catalog Picker */}
            <div className="lg:col-span-7 bg-white rounded-2xl p-5 border border-stone-200 shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-stone-100">
                <h3 className="font-serif font-bold text-lg text-[#2D2424]">
                  Salon Services Menu
                </h3>
                <span className="text-xs text-stone-500">
                  Click service to add to invoice
                </span>
              </div>

              {/* Service Search */}
              <div className="relative">
                <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Quick search by service name or category..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs focus:ring-2 focus:ring-[#8C3A42]"
                />
              </div>

              {/* Services List Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[500px] overflow-y-auto pr-1">
                {filteredServices.map((srv) => (
                  <div
                    key={srv.id}
                    onClick={() => handleAddItem(srv)}
                    className="p-3 rounded-xl border border-stone-200 bg-white hover:border-[#8C3A42] hover:bg-[#FAF0F1]/40 transition-all cursor-pointer flex gap-3 items-center group"
                  >
                    <img
                      src={srv.image || 'https://images.unsplash.com/photo-1560869713-7d0a29430803?auto=format&fit=crop&w=120&q=80'}
                      alt={srv.name}
                      className="w-12 h-12 rounded-lg object-cover bg-stone-100 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-stone-400 font-bold uppercase truncate">{srv.category}</p>
                      <h4 className="font-semibold text-xs text-stone-800 truncate group-hover:text-[#8C3A42]">
                        {srv.name}
                      </h4>
                      <p className="font-bold text-xs text-[#8C3A42] mt-0.5">
                        ₹{srv.price.toLocaleString('en-IN')}
                      </p>
                    </div>
                    <div className="w-7 h-7 rounded-lg bg-stone-100 group-hover:bg-[#8C3A42] group-hover:text-white flex items-center justify-center text-stone-600 transition-colors shrink-0">
                      <Plus className="w-4 h-4" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Column: Active Bill & Checkout */}
            <div className="lg:col-span-5 bg-white rounded-2xl p-5 border border-stone-200 shadow-xs flex flex-col justify-between space-y-4">
              <form onSubmit={handleCompleteWalkInBill} className="space-y-4">
                <div className="pb-3 border-b border-stone-100 flex justify-between items-center">
                  <h3 className="font-serif font-bold text-lg text-[#2D2424]">
                    Current Bill / Order
                  </h3>
                  <span className="text-xs font-semibold text-[#8C3A42]">
                    {billItems.length} Items Selected
                  </span>
                </div>

                {/* Customer Details */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                      Customer Name <span className="text-[#8C3A42]">*</span>
                    </label>
                    <div className="relative">
                      <User className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        required
                        placeholder="Guest Name"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-stone-200 text-xs bg-stone-50"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                      WhatsApp Mobile Number <span className="text-[#8C3A42]">*</span>
                    </label>
                    <div className="relative">
                      <Phone className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-2.5" />
                      <input
                        type="tel"
                        required
                        placeholder="+91 98765 43210"
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-stone-200 text-xs bg-stone-50"
                      />
                    </div>
                  </div>
                </div>

                {/* Selected Items List */}
                <div className="border border-stone-200 rounded-xl p-3 bg-stone-50 max-h-48 overflow-y-auto space-y-2">
                  {billItems.length === 0 ? (
                    <div className="py-6 text-center text-xs text-stone-400">
                      No services added yet. Click items from the catalog.
                    </div>
                  ) : (
                    billItems.map((item) => (
                      <div key={item.id} className="flex items-center justify-between text-xs bg-white p-2 rounded-lg border border-stone-200">
                        <div className="flex-1 min-w-0 pr-2">
                          <p className="font-semibold text-stone-800 truncate">{item.name}</p>
                          <p className="text-[10px] text-[#8C3A42]">₹{item.price} each</p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <div className="flex items-center border border-stone-200 rounded-lg overflow-hidden bg-stone-50">
                            <button
                              type="button"
                              onClick={() => handleQuantityChange(item.id, -1)}
                              className="px-2 py-0.5 text-stone-600 hover:bg-stone-200 font-bold"
                            >
                              -
                            </button>
                            <span className="px-2 text-xs font-semibold">{item.quantity}</span>
                            <button
                              type="button"
                              onClick={() => handleQuantityChange(item.id, 1)}
                              className="px-2 py-0.5 text-stone-600 hover:bg-stone-200 font-bold"
                            >
                              +
                            </button>
                          </div>

                          <span className="font-bold text-stone-800 w-16 text-right">
                            ₹{(item.price * item.quantity).toLocaleString('en-IN')}
                          </span>

                          <button
                            type="button"
                            onClick={() => handleRemoveItem(item.id)}
                            className="p-1 text-stone-400 hover:text-rose-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Payment & Calculation Breakdown */}
                <div className="space-y-2 pt-2 border-t border-stone-100 text-xs">
                  <div className="flex justify-between text-stone-600">
                    <span>Subtotal:</span>
                    <span className="font-semibold">₹{subtotal.toLocaleString('en-IN')}</span>
                  </div>

                  <div className="flex justify-between items-center text-stone-600">
                    <span>Discount (₹):</span>
                    <input
                      type="number"
                      min={0}
                      value={discountAmount}
                      onChange={(e) => setDiscountAmount(Number(e.target.value))}
                      className="w-24 text-right px-2 py-1 rounded border border-stone-200 text-xs"
                    />
                  </div>

                  <div className="flex justify-between text-stone-600">
                    <span>GST (18%):</span>
                    <span className="font-semibold">₹{calculatedTax.toLocaleString('en-IN')}</span>
                  </div>

                  <div className="flex justify-between items-center text-sm font-bold text-[#8C3A42] pt-2 border-t border-stone-200">
                    <span>Grand Total:</span>
                    <span className="text-xl font-serif">₹{grandTotal.toLocaleString('en-IN')}</span>
                  </div>
                </div>

                {/* Payment Mode Selector */}
                <div>
                  <label className="block text-[11px] font-semibold text-stone-600 mb-1.5">
                    Payment Method
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {(['UPI', 'Cash', 'Card', 'Other'] as const).map((mode) => (
                      <button
                        type="button"
                        key={mode}
                        onClick={() => setPaymentMode(mode)}
                        className={`py-2 text-xs font-semibold rounded-xl border text-center transition-all ${
                          paymentMode === mode
                            ? 'bg-[#8C3A42] text-white border-[#8C3A42] shadow-xs'
                            : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100'
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Submit / Complete Payment */}
                <button
                  type="submit"
                  disabled={isSubmitting || billItems.length === 0}
                  className="w-full py-3.5 rounded-xl bg-[#8C3A42] hover:bg-[#742F36] text-white font-semibold text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <CreditCard className="w-4 h-4" />
                  <span>
                    {isSubmitting ? 'Processing Payment...' : `Complete Payment & Print (₹${grandTotal.toLocaleString('en-IN')})`}
                  </span>
                </button>
              </form>
            </div>
          </div>
        )}

        {/* VIEW 2: SCHEDULED APPOINTMENTS */}
        {activeTab === 'today_appointments' && (
          <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-stone-100">
              <h3 className="font-serif font-bold text-lg text-[#2D2424]">
                Today & Upcoming Salon Appointments
              </h3>
              <span className="text-xs text-stone-500 font-medium">
                Operational schedule for guests
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-semibold">
                  <tr>
                    <th className="py-3 px-4">Ref Code</th>
                    <th className="py-3 px-4">Customer</th>
                    <th className="py-3 px-4">Phone</th>
                    <th className="py-3 px-4">Time Slot</th>
                    <th className="py-3 px-4">Services</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Estimated Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {todayAppointments.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-stone-400">
                        No appointments scheduled for today.
                      </td>
                    </tr>
                  ) : (
                    todayAppointments.map((apt) => (
                      <tr key={apt.id} className="hover:bg-stone-50/70">
                        <td className="py-3 px-4 font-mono font-bold text-[#8C3A42]">
                          {apt.referenceCode}
                        </td>
                        <td className="py-3 px-4 font-semibold text-stone-800">
                          {apt.customerName}
                        </td>
                        <td className="py-3 px-4 font-mono text-stone-600">
                          {apt.customerPhone}
                        </td>
                        <td className="py-3 px-4 font-medium text-stone-700">
                          {apt.date} at {apt.timeSlot}
                        </td>
                        <td className="py-3 px-4 max-w-xs">
                          {apt.serviceNames.join(', ')}
                        </td>
                        <td className="py-3 px-4">
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-50 text-emerald-800 border border-emerald-200">
                            {apt.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-stone-800">
                          ₹{apt.totalAmount.toLocaleString('en-IN')}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </main>

      {/* Invoice Modal for Printing and Sharing */}
      {activeInvoiceToView && (
        <InvoiceModal
          bill={activeInvoiceToView}
          onClose={() => setActiveInvoiceToView(null)}
        />
      )}

    </div>
  );
};
