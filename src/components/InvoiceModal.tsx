import React from 'react';
import { 
  X, 
  Printer, 
  MessageCircle, 
  Sparkles, 
  CheckCircle2,
  FileText
} from 'lucide-react';
import { BillOrder } from '../types/salon';
import { SALON_INFO } from '../data/initialData';
import { getInvoiceWhatsAppMessage, openWhatsApp } from '../utils/whatsapp';

interface InvoiceModalProps {
  bill: BillOrder | null;
  paperWidth?: '3inch' | '4inch';
  onClose: () => void;
}

export const InvoiceModal: React.FC<InvoiceModalProps> = ({ 
  bill, 
  paperWidth = '3inch',
  onClose 
}) => {
  if (!bill) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleWhatsAppShare = () => {
    const msg = getInvoiceWhatsAppMessage(bill);
    openWhatsApp(bill.customerPhone, msg);
  };

  const subTotal = bill.subtotal || bill.subTotal || bill.grandTotal;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-lg w-full overflow-hidden shadow-2xl border border-[#D9C4BE] my-8 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Top Control Bar (Hidden during printing) */}
        <div className="bg-[#FAF7F5] px-6 py-4 border-b border-[#E8DDD8] flex items-center justify-between no-print">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#8C3A42]">
            <Sparkles className="w-4 h-4" />
            <span>Digital & Thermal Tax Invoice</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleWhatsAppShare}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#25D366] text-white hover:bg-[#20bd5a] transition-colors cursor-pointer"
              title="Share invoice on WhatsApp"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              <span>WhatsApp</span>
            </button>

            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-[#8C3A42] text-white hover:bg-[#742F36] transition-colors cursor-pointer shadow-xs"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Bill</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-full text-[#7A6B6B] hover:text-[#2D2424] hover:bg-[#EFE8E5] cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Invoice Container (Formatted for 3-inch 80mm / 4-inch 104mm thermal rolls) */}
        <div className="p-6 sm:p-8 space-y-5 text-[#2D2424] printable-thermal-invoice font-sans">
          
          {/* Salon Header */}
          <div className="text-center pb-4 border-b border-dashed border-stone-300 space-y-1">
            <h2 className="font-serif-luxury text-2xl font-bold tracking-tight text-[#2D2424]">
              The Glossy Looks
            </h2>
            <p className="text-xs uppercase tracking-wider font-semibold text-[#8C3A42]">
              Professional Women Salon
            </p>
            <p className="text-[11px] text-stone-600 max-w-xs mx-auto leading-tight">
              31, Vinayak Nagar, Gachibowli, Hyderabad, Telangana 500032
            </p>
            <p className="text-[11px] text-stone-600 font-mono">
              Phone: +91 98765 43210 • GSTIN: 36AAAAA1234A1Z5
            </p>
          </div>

          {/* Invoice Meta Grid */}
          <div className="grid grid-cols-2 gap-2 text-xs py-2 border-b border-dashed border-stone-300">
            <div>
              <span className="text-[10px] uppercase font-bold text-stone-400 tracking-wider">Invoice No</span>
              <p className="font-mono font-bold text-stone-900">{bill.invoiceNumber}</p>
              <p className="text-[11px] text-stone-500 mt-0.5">{bill.createdAt}</p>
            </div>
            <div className="text-right">
              <span className="text-[10px] uppercase font-bold text-stone-400 tracking-wider">Customer</span>
              <p className="font-bold text-stone-900">{bill.customerName}</p>
              <p className="font-mono text-[11px] text-stone-600">{bill.customerPhone}</p>
            </div>
          </div>

          {/* Line Items Table */}
          <div className="space-y-2 py-1 border-b border-dashed border-stone-300">
            <div className="flex justify-between text-[11px] font-bold uppercase text-stone-500 pb-1 border-b border-stone-200">
              <span>Item / Service</span>
              <span className="text-right">Qty × Rate = Amount</span>
            </div>

            <div className="space-y-1.5 text-xs">
              {bill.items.map((item, idx) => (
                <div key={idx} className="flex justify-between items-start">
                  <div className="pr-2 flex-1">
                    <p className="font-semibold text-stone-800">{item.name}</p>
                  </div>
                  <div className="font-mono text-right whitespace-nowrap text-stone-700">
                    {item.quantity} × ₹{item.price} = <strong className="text-stone-900">₹{(item.price * item.quantity).toLocaleString('en-IN')}</strong>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Calculation Breakdown */}
          <div className="space-y-1.5 text-xs py-1 border-b border-dashed border-stone-300">
            <div className="flex justify-between text-stone-600">
              <span>Subtotal:</span>
              <span className="font-mono">₹{subTotal.toLocaleString('en-IN')}</span>
            </div>

            {bill.discountAmount > 0 && (
              <div className="flex justify-between text-stone-600">
                <span>Discount:</span>
                <span className="font-mono text-emerald-700">-₹{bill.discountAmount.toLocaleString('en-IN')}</span>
              </div>
            )}

            <div className="flex justify-between text-stone-600">
              <span>GST (18%):</span>
              <span className="font-mono">₹{bill.taxAmount.toLocaleString('en-IN')}</span>
            </div>

            <div className="flex justify-between items-center text-sm font-bold text-[#8C3A42] pt-1.5 border-t border-stone-200">
              <span className="uppercase tracking-wider">Grand Total:</span>
              <span className="font-serif-luxury text-xl font-bold">
                ₹{bill.grandTotal.toLocaleString('en-IN')}
              </span>
            </div>
          </div>

          {/* Payment & Staff Footer */}
          <div className="flex justify-between items-center text-xs py-1 text-stone-600">
            <div>
              <span>Payment Mode: </span>
              <strong className="text-stone-900 uppercase font-mono">{bill.paymentMode}</strong>
            </div>
            <div>
              <span>Status: </span>
              <strong className="text-emerald-700 uppercase font-semibold">PAID</strong>
            </div>
          </div>

          {bill.staffName && (
            <p className="text-[11px] text-stone-500 text-center">
              Handled by: <span className="font-semibold text-stone-700">{bill.staffName}</span>
            </p>
          )}

          {/* Thermal Receipt Bottom Greeting */}
          <div className="text-center pt-2 text-[11px] text-stone-500 border-t border-dashed border-stone-300 space-y-0.5">
            <p className="font-semibold text-[#8C3A42]">Thank you for visiting The Glossy Looks!</p>
            <p>Keep Glowing & Radiant • All 7 Days Open 9:30 AM – 8:30 PM</p>
            <p className="text-[9px] font-mono text-stone-400 pt-1">*** END OF BILL / ESC-POS CUT ***</p>
          </div>

        </div>

      </div>
    </div>
  );
};
