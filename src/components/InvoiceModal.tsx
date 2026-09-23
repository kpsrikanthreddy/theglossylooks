import React from 'react';
import { 
  X, 
  Printer, 
  Share2, 
  MessageCircle, 
  CheckCircle2, 
  Sparkles, 
  QrCode, 
  Download 
} from 'lucide-react';
import { BillOrder } from '../types/salon';
import { SALON_INFO } from '../data/initialData';
import { getInvoiceWhatsAppMessage, openWhatsApp } from '../utils/whatsapp';

interface InvoiceModalProps {
  bill: BillOrder | null;
  onClose: () => void;
}

export const InvoiceModal: React.FC<InvoiceModalProps> = ({ bill, onClose }) => {
  if (!bill) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleWhatsAppShare = () => {
    const msg = getInvoiceWhatsAppMessage(bill);
    openWhatsApp(bill.customerPhone, msg);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-xl w-full overflow-hidden shadow-2xl border border-[#D9C4BE] my-8 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Top Control Bar */}
        <div className="bg-[#FAF7F5] px-6 py-3.5 border-b border-[#E8DDD8] flex items-center justify-between no-print">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#8C3A42]">
            <Sparkles className="w-4 h-4" />
            <span>Digital Tax Invoice</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleWhatsAppShare}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#25D366] text-white hover:bg-[#20bd5a] transition-colors"
              title="Share invoice on WhatsApp"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              <span>Send WhatsApp</span>
            </button>

            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-[#D9C4BE] text-[#2D2424] hover:bg-[#F3ECE8] transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#7A6B6B] hover:text-[#2D2424] hover:bg-[#EFE8E5]"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Invoice Container */}
        <div className="p-6 sm:p-8 space-y-6 printable-invoice text-[#2D2424]">
          
          {/* Header */}
          <div className="text-center pb-4 border-b border-[#E8DDD8]">
            <h3 className="font-serif-luxury text-2xl font-bold tracking-tight text-[#2D2424]">
              {SALON_INFO.name}
            </h3>
            <p className="text-xs text-[#7A6B6B] mt-0.5">{SALON_INFO.tagline}</p>
            <p className="text-[11px] text-[#7A6B6B] mt-1 max-w-sm mx-auto">{SALON_INFO.address}</p>
            <p className="text-[11px] text-[#7A6B6B]">GSTIN: 36AAAAA1234A1Z5 • Phone: {SALON_INFO.phone}</p>
          </div>

          {/* Invoice Meta Grid */}
          <div className="grid grid-cols-2 gap-4 text-xs bg-[#FAF7F5] p-3.5 rounded-xl border border-[#EDE1DD]">
            <div>
              <span className="text-[10px] uppercase font-bold text-[#8C3A42] tracking-wider">Billed To</span>
              <p className="font-bold text-sm text-[#2D2424] mt-0.5">{bill.customerName}</p>
              <p className="text-[#665454]">{bill.customerPhone}</p>
              {bill.customerEmail && <p className="text-[#665454]">{bill.customerEmail}</p>}
            </div>

            <div className="text-right">
              <span className="text-[10px] uppercase font-bold text-[#8C3A42] tracking-wider">Invoice Details</span>
              <p className="font-mono font-bold text-[#2D2424] mt-0.5">{bill.invoiceNumber}</p>
              <p className="text-[#665454]">{bill.createdAt}</p>
              <p className="text-[11px] text-[#7A6B6B]">Handled by: {bill.staffName}</p>
            </div>
          </div>

          {/* Itemized Table */}
          <div className="space-y-2">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#D9C4BE] text-[#8C3A42] font-semibold">
                  <th className="py-2">Item / Service</th>
                  <th className="py-2 text-center">Qty</th>
                  <th className="py-2 text-right">Price</th>
                  <th className="py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F2EAE7]">
                {bill.items.map((item, idx) => (
                  <tr key={idx} className="py-2">
                    <td className="py-2.5">
                      <p className="font-semibold text-[#2D2424]">{item.name}</p>
                      {item.stylistName && (
                        <p className="text-[10px] text-[#8C3A42]">Stylist: {item.stylistName}</p>
                      )}
                      <span className="text-[10px] uppercase text-[#7A6B6B]">{item.type}</span>
                    </td>
                    <td className="py-2.5 text-center">{item.quantity}</td>
                    <td className="py-2.5 text-right font-mono">
                      {SALON_INFO.currency}{item.price.toLocaleString('en-IN')}
                    </td>
                    <td className="py-2.5 text-right font-mono font-semibold">
                      {SALON_INFO.currency}{(item.price * item.quantity).toLocaleString('en-IN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals & Calculations */}
          <div className="pt-3 border-t border-[#D9C4BE] space-y-1.5 text-xs">
            <div className="flex justify-between text-[#665454]">
              <span>Subtotal:</span>
              <span className="font-mono">{SALON_INFO.currency}{bill.subtotal.toLocaleString('en-IN')}</span>
            </div>

            {bill.discountAmount > 0 && (
              <div className="flex justify-between text-emerald-700 font-medium">
                <span>Discount / Promo:</span>
                <span className="font-mono">-{SALON_INFO.currency}{bill.discountAmount.toLocaleString('en-IN')}</span>
              </div>
            )}

            <div className="flex justify-between text-[#665454]">
              <span>GST / Taxes (5%):</span>
              <span className="font-mono">{SALON_INFO.currency}{bill.taxAmount.toLocaleString('en-IN')}</span>
            </div>

            {bill.tipAmount > 0 && (
              <div className="flex justify-between text-[#665454]">
                <span>Stylist Gratuity (Tip):</span>
                <span className="font-mono">{SALON_INFO.currency}{bill.tipAmount.toLocaleString('en-IN')}</span>
              </div>
            )}

            <div className="flex justify-between text-base font-bold pt-2 border-t border-[#2D2424] text-[#2D2424]">
              <span>Grand Total:</span>
              <span className="font-serif-luxury text-xl text-[#8C3A42] font-bold">
                {SALON_INFO.currency}{bill.grandTotal.toLocaleString('en-IN')}
              </span>
            </div>
          </div>

          {/* Payment Status & Footer */}
          <div className="flex items-center justify-between pt-3 border-t border-[#E8DDD8] text-xs">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 font-semibold text-[11px] flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{bill.paymentStatus} via {bill.paymentMode}</span>
              </span>
            </div>

            <div className="text-right text-[11px] text-[#7A6B6B]">
              <p>Thank you for visiting Glossy Looks!</p>
              <p>Show this bill for 10% off on your next retail purchase.</p>
            </div>
          </div>

          {bill.notes && (
            <div className="p-2.5 bg-[#FAF7F5] rounded-lg border border-[#EDE1DD] text-[11px] text-[#665454]">
              <span className="font-semibold">Notes:</span> {bill.notes}
            </div>
          )}

        </div>

      </div>
    </div>
  );
};
