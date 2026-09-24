import React, { useState } from 'react';
import { 
  Receipt, 
  Plus, 
  Search, 
  Filter, 
  Printer, 
  Eye, 
  IndianRupee, 
  CreditCard, 
  Smartphone, 
  Banknote, 
  Calendar, 
  User, 
  Trash2, 
  X,
  CheckCircle2,
  Clock
} from 'lucide-react';
import { BillOrder, SalonService } from '../../types/salon';
import { CustomerProfile } from '../../types/admin';
import { InvoiceModal } from '../InvoiceModal';

interface AdminBillingProps {
  bills: BillOrder[];
  services: SalonService[];
  customers: CustomerProfile[];
  onCreateBill: (bill: BillOrder) => void;
}

export const AdminBilling: React.FC<AdminBillingProps> = ({
  bills,
  services,
  customers,
  onCreateBill,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [timeFilter, setTimeFilter] = useState<'today' | 'week' | 'month' | 'all'>('all');
  const [isCreatingBill, setIsCreatingBill] = useState(false);
  const [activeInvoiceToView, setActiveInvoiceToView] = useState<BillOrder | null>(null);

  // Bill creation form state
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [billItems, setBillItems] = useState<{ id: string; name: string; price: number; quantity: number; type?: 'service' | 'product' | 'custom' }[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [customItemName, setCustomItemName] = useState('');
  const [customItemPrice, setCustomItemPrice] = useState<number>(0);

  const [discountType, setDiscountType] = useState<'percent' | 'flat'>('percent');
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [taxPercent, setTaxPercent] = useState<number>(18);
  const [paymentMode, setPaymentMode] = useState<'Cash' | 'UPI' | 'Credit/Debit Card' | 'Net Banking'>('UPI');
  const [paymentStatus, setPaymentStatus] = useState<'Paid' | 'Pending' | 'Partial'>('Paid');
  const [notes, setNotes] = useState('');

  const todayStr = new Date().toISOString().split('T')[0];

  // Helper for customer autofill
  const handleSelectExistingCustomer = (phone: string) => {
    const cust = customers.find(c => c.phone === phone);
    if (cust) {
      setCustomerName(cust.name);
      setCustomerPhone(cust.phone);
      setCustomerEmail(cust.email || '');
    }
  };

  const handleAddServiceItem = () => {
    if (!selectedServiceId) return;
    const srv = services.find(s => s.id === selectedServiceId);
    if (!srv) return;

    setBillItems(prev => [
      ...prev,
      {
        id: 'item-' + Date.now(),
        name: srv.name,
        type: 'service',
        price: srv.price,
        quantity: 1,
      },
    ]);
    setSelectedServiceId('');
  };

  const handleAddCustomItem = () => {
    if (!customItemName.trim() || customItemPrice <= 0) return;
    setBillItems(prev => [
      ...prev,
      {
        id: 'item-' + Date.now(),
        name: customItemName.trim(),
        type: 'custom',
        price: Number(customItemPrice),
        quantity: 1,
      },
    ]);
    setCustomItemName('');
    setCustomItemPrice(0);
  };

  const handleRemoveItem = (id: string) => {
    setBillItems(prev => prev.filter(i => i.id !== id));
  };

  // Calculations
  const subTotal = billItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const discountAmount = discountType === 'percent'
    ? Math.round((subTotal * discountValue) / 100)
    : Math.min(discountValue, subTotal);
  const taxableAmount = Math.max(0, subTotal - discountAmount);
  const taxAmount = Math.round((taxableAmount * taxPercent) / 100);
  const grandTotal = taxableAmount + taxAmount;

  const handleSubmitBill = (e: React.FormEvent) => {
    e.preventDefault();
    if (billItems.length === 0) {
      alert('Please add at least one service or item to invoice.');
      return;
    }

    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const dateCode = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    const invoiceNumber = `GL-${dateCode}-${randomSuffix}`;

    const newBill: BillOrder = {
      id: 'bill-' + Date.now(),
      invoiceNumber,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      customerEmail: customerEmail.trim() || undefined,
      items: billItems,
      subtotal: subTotal,
      subTotal,
      discountAmount,
      taxAmount,
      grandTotal,
      paymentMode,
      paymentStatus,
      staffName: 'Reception Desk',
      createdAt: new Date().toISOString(),
      notes: notes.trim() || undefined,
    };

    onCreateBill(newBill);
    setIsCreatingBill(false);
    setActiveInvoiceToView(newBill); // Open print preview immediately

    // Reset form
    setCustomerName('');
    setCustomerPhone('');
    setCustomerEmail('');
    setBillItems([]);
    setDiscountValue(0);
    setNotes('');
  };

  // Filter bills
  const filteredBills = bills.filter(b => {
    // Search
    if (searchTerm) {
      const q = searchTerm.toLowerCase().trim();
      const matchInv = b.invoiceNumber.toLowerCase().includes(q);
      const matchName = b.customerName.toLowerCase().includes(q);
      const matchPhone = b.customerPhone.includes(q);
      if (!matchInv && !matchName && !matchPhone) return false;
    }

    // Time filter
    if (timeFilter === 'today') {
      return b.createdAt.startsWith(todayStr);
    }
    if (timeFilter === 'week') {
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      return new Date(b.createdAt) >= oneWeekAgo;
    }
    if (timeFilter === 'month') {
      const thisMonth = todayStr.substring(0, 7);
      return b.createdAt.startsWith(thisMonth);
    }

    return true;
  });

  const totalFilteredRevenue = filteredBills.reduce((sum, b) => sum + (b.grandTotal || 0), 0);

  return (
    <div className="space-y-6">

      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-serif font-bold text-[#2D2424]">Billing & POS Terminal</h2>
          <p className="text-xs text-stone-500">
            Create GST tax invoices, manage payments (Cash, UPI, Card), and print receipts.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsCreatingBill(true)}
          className="px-4 py-2 rounded-xl bg-[#8C3A42] hover:bg-[#722F36] text-white text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Create New Bill</span>
        </button>
      </div>

      {/* REVENUE KPI STRIP */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white p-4 rounded-xl border border-stone-200">
          <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider block">Invoices Billed</span>
          <span className="text-2xl font-bold font-serif text-[#2D2424]">{filteredBills.length}</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-stone-200">
          <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider block">Total Billed Amount</span>
          <span className="text-2xl font-bold font-serif text-emerald-700">₹{totalFilteredRevenue.toLocaleString('en-IN')}</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-stone-200">
          <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider block">UPI / Digital</span>
          <span className="text-sm font-semibold text-stone-700">
            {filteredBills.filter(b => b.paymentMode === 'UPI' || b.paymentMode === 'Credit/Debit Card' || (b.paymentMode as any) === 'Card').length} orders
          </span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-stone-200">
          <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider block">Cash Collections</span>
          <span className="text-sm font-semibold text-stone-700">
            {filteredBills.filter(b => b.paymentMode === 'Cash').length} orders
          </span>
        </div>
      </div>

      {/* SEARCH AND TIME FILTERS */}
      <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-xs space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Search invoices by invoice number, customer name, or mobile (+91)..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-stone-200 text-xs focus:outline-none focus:ring-2 focus:ring-[#8C3A42] bg-[#FAF7F5]"
          />
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          <span className="text-[11px] font-semibold text-stone-400 uppercase mr-1">Period:</span>
          {[
            { id: 'all', label: 'All Invoices' },
            { id: 'today', label: 'Today' },
            { id: 'week', label: 'This Week' },
            { id: 'month', label: 'This Month' },
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTimeFilter(tab.id as any)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
                timeFilter === tab.id ? 'bg-[#8C3A42] text-white font-semibold' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* BILLS TABLE */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-xs overflow-hidden">
        {filteredBills.length === 0 ? (
          <div className="p-12 text-center text-stone-500">
            <Receipt className="w-10 h-10 text-stone-300 mx-auto mb-2" />
            <p className="text-sm font-medium">No invoices match your selection.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#FAF7F5] text-stone-600 uppercase text-[10px] tracking-wider border-b border-stone-200 font-semibold">
                <tr>
                  <th className="py-3 px-4">Invoice #</th>
                  <th className="py-3 px-4">Date & Time</th>
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Mobile</th>
                  <th className="py-3 px-4">Items</th>
                  <th className="py-3 px-4">Payment</th>
                  <th className="py-3 px-4">Grand Total</th>
                  <th className="py-3 px-4 text-right">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredBills.map(bill => (
                  <tr key={bill.id} className="hover:bg-stone-50/80 transition-colors">
                    <td className="py-3 px-4 font-mono font-semibold text-[#8C3A42] whitespace-nowrap">
                      {bill.invoiceNumber}
                    </td>

                    <td className="py-3 px-4 text-stone-500 whitespace-nowrap">
                      {new Date(bill.createdAt).toLocaleDateString()} {new Date(bill.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>

                    <td className="py-3 px-4 font-medium text-[#2D2424] whitespace-nowrap">
                      {bill.customerName}
                    </td>

                    <td className="py-3 px-4 text-stone-600 whitespace-nowrap">
                      {bill.customerPhone}
                    </td>

                    <td className="py-3 px-4 text-stone-700 max-w-[200px] truncate">
                      {bill.items?.map(i => i.name).join(', ')}
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="font-medium text-stone-700">{bill.paymentMode}</span>
                      <span className={`ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        bill.paymentStatus === 'Paid' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {bill.paymentStatus}
                      </span>
                    </td>

                    <td className="py-3 px-4 font-bold text-emerald-700 whitespace-nowrap">
                      ₹{bill.grandTotal}
                    </td>

                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setActiveInvoiceToView(bill)}
                        className="px-2.5 py-1 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 font-medium text-xs flex items-center gap-1 ml-auto cursor-pointer"
                      >
                        <Printer className="w-3.5 h-3.5 text-[#8C3A42]" />
                        <span>Print</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* CREATE INVOICE MODAL */}
      {isCreatingBill && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <div>
                <h3 className="font-serif font-bold text-lg text-[#2D2424]">Create Salon Invoice</h3>
                <p className="text-xs text-stone-500">The Glossy Looks POS • Gachibowli, Hyderabad</p>
              </div>
              <button 
                type="button"
                onClick={() => setIsCreatingBill(false)}
                className="text-stone-400 hover:text-stone-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitBill} className="space-y-4 text-xs">
              
              {/* Customer selection */}
              <div className="bg-stone-50 p-3.5 rounded-xl border border-stone-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-stone-700 text-[11px] uppercase tracking-wider">
                    Customer Information
                  </span>
                  {customers.length > 0 && (
                    <select
                      onChange={(e) => handleSelectExistingCustomer(e.target.value)}
                      className="text-xs p-1 rounded border border-stone-300 bg-white"
                      defaultValue=""
                    >
                      <option value="" disabled>Autofill Existing Client...</option>
                      {customers.map(c => (
                        <option key={c.id} value={c.phone}>
                          {c.name} ({c.phone})
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-stone-600 mb-0.5 font-medium">Customer Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Radhika Sharma"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="w-full p-2 rounded-lg border border-stone-300 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-stone-600 mb-0.5 font-medium">Mobile Number *</label>
                    <input
                      type="tel"
                      required
                      placeholder="+91 98765 43210"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      className="w-full p-2 rounded-lg border border-stone-300 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-stone-600 mb-0.5 font-medium">Email (Optional)</label>
                    <input
                      type="email"
                      placeholder="client@gmail.com"
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      className="w-full p-2 rounded-lg border border-stone-300 bg-white"
                    />
                  </div>
                </div>
              </div>

              {/* Service Line Items */}
              <div>
                <span className="font-semibold text-stone-700 text-[11px] uppercase tracking-wider block mb-2">
                  Invoice Items & Treatments
                </span>

                <div className="flex gap-2 mb-2">
                  <select
                    value={selectedServiceId}
                    onChange={(e) => setSelectedServiceId(e.target.value)}
                    className="flex-1 p-2 rounded-lg border border-stone-300 bg-white"
                  >
                    <option value="">Select Salon Service from Menu...</option>
                    {services.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name} — ₹{s.price} ({s.category})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleAddServiceItem}
                    className="px-3 py-2 rounded-lg bg-[#8C3A42] text-white font-medium shrink-0 cursor-pointer"
                  >
                    Add Service
                  </button>
                </div>

                {/* Custom Line Item */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Custom product or touchup service name..."
                    value={customItemName}
                    onChange={(e) => setCustomItemName(e.target.value)}
                    className="flex-1 p-2 rounded-lg border border-stone-300 bg-white"
                  />
                  <input
                    type="number"
                    placeholder="Price ₹"
                    value={customItemPrice || ''}
                    onChange={(e) => setCustomItemPrice(Number(e.target.value))}
                    className="w-24 p-2 rounded-lg border border-stone-300 bg-white"
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomItem}
                    className="px-3 py-2 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 font-medium shrink-0"
                  >
                    + Custom Item
                  </button>
                </div>

                {/* Added Items List */}
                <div className="mt-3 border rounded-xl divide-y divide-stone-100 bg-white overflow-hidden">
                  {billItems.length === 0 ? (
                    <div className="p-4 text-center text-stone-400 italic">No items added to invoice yet.</div>
                  ) : (
                    billItems.map(item => (
                      <div key={item.id} className="p-2.5 flex items-center justify-between">
                        <div>
                          <div className="font-semibold text-[#2D2424]">{item.name}</div>
                          <div className="text-[11px] text-stone-500">₹{item.price} × {item.quantity}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-bold text-stone-800">₹{item.price * item.quantity}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(item.id)}
                            className="text-stone-400 hover:text-rose-500 p-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Discounts & Tax */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2">
                <div>
                  <label className="block text-stone-600 mb-1">Discount Type</label>
                  <select
                    value={discountType}
                    onChange={(e) => setDiscountType(e.target.value as any)}
                    className="w-full p-2 rounded-lg border border-stone-300 bg-white"
                  >
                    <option value="percent">Percentage (%)</option>
                    <option value="flat">Flat Amount (₹)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-stone-600 mb-1">Discount Value</label>
                  <input
                    type="number"
                    min={0}
                    value={discountValue}
                    onChange={(e) => setDiscountValue(Number(e.target.value))}
                    className="w-full p-2 rounded-lg border border-stone-300 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-stone-600 mb-1">GST Tax (%)</label>
                  <select
                    value={taxPercent}
                    onChange={(e) => setTaxPercent(Number(e.target.value))}
                    className="w-full p-2 rounded-lg border border-stone-300 bg-white"
                  >
                    <option value={0}>0% (Tax Exempt)</option>
                    <option value={5}>5% (Basic)</option>
                    <option value={18}>18% (Standard GST)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-stone-600 mb-1">Payment Mode</label>
                  <select
                    value={paymentMode}
                    onChange={(e) => setPaymentMode(e.target.value as any)}
                    className="w-full p-2 rounded-lg border border-stone-300 bg-white"
                  >
                    <option value="UPI">UPI / GPay / PhonePe</option>
                    <option value="Cash">Cash Counter</option>
                    <option value="Credit/Debit Card">Debit / Credit Card</option>
                    <option value="Net Banking">Net Banking</option>
                  </select>
                </div>
              </div>

              {/* Bill Totals Summary */}
              <div className="bg-[#FAF7F5] p-3.5 rounded-xl border border-stone-200 text-xs space-y-1.5">
                <div className="flex justify-between text-stone-600">
                  <span>Items Subtotal:</span>
                  <span>₹{subTotal}</span>
                </div>
                {discountAmount > 0 && (
                  <div className="flex justify-between text-emerald-700">
                    <span>Discount Applied:</span>
                    <span>-₹{discountAmount}</span>
                  </div>
                )}
                {taxAmount > 0 && (
                  <div className="flex justify-between text-stone-600">
                    <span>GST ({taxPercent}%):</span>
                    <span>₹{taxAmount}</span>
                  </div>
                )}
                <div className="flex justify-between text-base font-bold text-[#8C3A42] pt-1.5 border-t border-stone-200 font-serif">
                  <span>Grand Total Payable:</span>
                  <span>₹{grandTotal}</span>
                </div>
              </div>

              <div className="pt-3 border-t border-stone-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreatingBill(false)}
                  className="px-4 py-2 rounded-lg bg-stone-100 text-stone-700 hover:bg-stone-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-[#8C3A42] text-white hover:bg-[#722F36] font-medium"
                >
                  Generate Invoice & Receipt
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIEW / PRINT INVOICE MODAL */}
      {activeInvoiceToView && (
        <InvoiceModal
          bill={activeInvoiceToView}
          onClose={() => setActiveInvoiceToView(null)}
        />
      )}

    </div>
  );
};
