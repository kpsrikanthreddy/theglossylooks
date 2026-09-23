import React, { useState } from 'react';
import { 
  MessageCircle, 
  Send, 
  Sparkles, 
  CheckCircle2, 
  Calendar, 
  Phone, 
  Mail, 
  User, 
  Clock 
} from 'lucide-react';
import { CustomerEnquiry } from '../types/salon';
import { openWhatsApp, getSalonWhatsAppUrl } from '../utils/whatsapp';
import { SALON_INFO } from '../data/initialData';

interface EnquirySectionProps {
  onEnquirySubmitted: (enquiry: CustomerEnquiry) => void;
}

export const EnquirySection: React.FC<EnquirySectionProps> = ({ onEnquirySubmitted }) => {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [serviceOfInterest, setServiceOfInterest] = useState('Bridal & Makeup');
  const [preferredDate, setPreferredDate] = useState('');
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim() || !customerPhone.trim() || !message.trim()) {
      setErrorMsg('Please fill in name, mobile number, and your question.');
      return;
    }

    const newEnquiry: CustomerEnquiry = {
      id: `enq-${Date.now()}`,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      customerEmail: customerEmail.trim() || undefined,
      serviceOfInterest,
      preferredDate: preferredDate || undefined,
      message: message.trim(),
      status: 'New',
      createdAt: new Date().toISOString().split('T')[0],
    };

    onEnquirySubmitted(newEnquiry);
    setSubmitted(true);
    setErrorMsg('');
  };

  const handleWhatsAppEnquiry = () => {
    const msg = `Hello Glossy Looks Women Salon! 🌸
I would like to enquire about:
📌 Service: ${serviceOfInterest}
${customerName ? `👤 Name: ${customerName}\n` : ''}${preferredDate ? `🗓️ Tentative Date: ${preferredDate}\n` : ''}${message ? `💬 Note: ${message}\n` : ''}
Could you please share package details and availability?`;
    openWhatsApp(SALON_INFO.whatsapp, msg);
  };

  return (
    <section id="enquiry" className="py-16 bg-[#FAF7F5] border-b border-[#EBE1DC]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          
          {/* Left Info Column */}
          <div className="lg:col-span-5 space-y-5">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#FAF0F1] border border-[#EAC9CB] text-[#8C3A42] text-xs font-semibold uppercase tracking-wider">
              <MessageCircle className="w-3.5 h-3.5" />
              <span>Personalized Consultations</span>
            </div>

            <h2 className="font-serif-luxury text-3xl sm:text-4xl font-bold text-[#2D2424] leading-tight">
              Have Questions? <br />
              <span className="italic font-normal text-[#8C3A42]">We Are Here to Guide You</span>
            </h2>

            <p className="text-sm text-[#665555] leading-relaxed font-light">
              Whether you are planning bridal trousseau prep, curious about hair smoothing formulas, 
              or seeking custom makeover packages, our master stylists reply promptly.
            </p>

            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-3 p-3 bg-white rounded-xl border border-[#E6DDD8]">
                <div className="w-9 h-9 rounded-full bg-[#FAF0F1] text-[#8C3A42] flex items-center justify-center shrink-0">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs font-bold text-[#2D2424]">Fast Turnaround Time</p>
                  <p className="text-[11px] text-[#7A6B6B]">Typically responds within 15–30 minutes on WhatsApp</p>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 bg-white rounded-xl border border-[#E6DDD8]">
                <div className="w-9 h-9 rounded-full bg-[#EBF7EE] text-[#22C55E] flex items-center justify-center shrink-0">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs font-bold text-[#2D2424]">Free Skin & Hair Analysis</p>
                  <p className="text-[11px] text-[#7A6B6B]">Complimentary 10-minute diagnostic session with every visit</p>
                </div>
              </div>
            </div>

            {/* Quick WhatsApp Direct link */}
            <div className="pt-2">
              <button
                type="button"
                onClick={handleWhatsAppEnquiry}
                id="direct-whatsapp-enquiry-btn"
                className="inline-flex items-center gap-2 bg-[#25D366] hover:bg-[#20bd5a] text-white px-5 py-3 rounded-xl text-xs sm:text-sm font-semibold shadow-xs transition-colors"
              >
                <MessageCircle className="w-4 h-4" />
                <span>Chat Directly on WhatsApp Now</span>
              </button>
            </div>
          </div>

          {/* Right Form Column */}
          <div className="lg:col-span-7">
            <div className="bg-white rounded-2xl p-6 sm:p-8 border border-[#E3D6D2] shadow-sm">
              {submitted ? (
                <div className="text-center py-8 space-y-4">
                  <div className="w-14 h-14 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>
                  <h3 className="font-serif-luxury text-2xl font-bold text-[#2D2424]">
                    Thank You, {customerName}!
                  </h3>
                  <p className="text-xs sm:text-sm text-[#6B5A5A] max-w-md mx-auto">
                    Your enquiry has been received by our salon coordinators. 
                    We will get in touch with you shortly on WhatsApp at <strong>{customerPhone}</strong>.
                  </p>
                  <div className="pt-2 flex flex-col sm:flex-row justify-center gap-2">
                    <button
                      onClick={handleWhatsAppEnquiry}
                      className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-[#25D366] text-white hover:bg-[#20bd5a] flex items-center justify-center gap-1.5"
                    >
                      <MessageCircle className="w-4 h-4" />
                      <span>Speed Up: Message on WhatsApp</span>
                    </button>
                    <button
                      onClick={() => {
                        setSubmitted(false);
                        setMessage('');
                      }}
                      className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-[#FAF7F5] border border-[#D9C4BE] text-[#2D2424] hover:bg-[#F0EAE6]"
                    >
                      Send Another Question
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <h3 className="font-serif-luxury text-xl font-bold text-[#2D2424]">
                    Send a Customer Enquiry
                  </h3>

                  {errorMsg && (
                    <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">
                      {errorMsg}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-[#544646]">Your Name *</label>
                      <div className="relative">
                        <User className="w-3.5 h-3.5 text-[#9C8B8B] absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          required
                          placeholder="e.g. Sneha Roy"
                          value={customerName}
                          onChange={(e) => setCustomerName(e.target.value)}
                          className="w-full pl-9 pr-3 py-2 bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl text-xs sm:text-sm text-[#2D2424] focus:outline-none focus:ring-1 focus:ring-[#8C3A42]"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-[#544646]">WhatsApp Mobile Number *</label>
                      <div className="relative">
                        <Phone className="w-3.5 h-3.5 text-[#9C8B8B] absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="tel"
                          required
                          placeholder="e.g. +91 98765 43210"
                          value={customerPhone}
                          onChange={(e) => setCustomerPhone(e.target.value)}
                          className="w-full pl-9 pr-3 py-2 bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl text-xs sm:text-sm text-[#2D2424] focus:outline-none focus:ring-1 focus:ring-[#8C3A42]"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-[#544646]">Service of Interest</label>
                      <select
                        value={serviceOfInterest}
                        onChange={(e) => setServiceOfInterest(e.target.value)}
                        className="w-full bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl px-3 py-2 text-xs sm:text-sm text-[#2D2424] focus:outline-none focus:ring-1 focus:ring-[#8C3A42]"
                      >
                        <option value="Bridal & Makeup">Bridal & Makeup Consultation</option>
                        <option value="Hair Styling & Care">Hair Balayage / Keratin / Botox</option>
                        <option value="Skin & Facials">24K Gold / Hydra Facial</option>
                        <option value="Nails & Feet">Chrome / Gel Nail Extensions</option>
                        <option value="Spa & Body">Full Body Aromatherapy Spa</option>
                        <option value="Other Query">Other Custom Request</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-[#544646]">Tentative Event / Visit Date</label>
                      <div className="relative">
                        <Calendar className="w-3.5 h-3.5 text-[#9C8B8B] absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="date"
                          value={preferredDate}
                          onChange={(e) => setPreferredDate(e.target.value)}
                          className="w-full pl-9 pr-3 py-2 bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl text-xs sm:text-sm text-[#2D2424] focus:outline-none focus:ring-1 focus:ring-[#8C3A42]"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-[#544646]">Email (Optional)</label>
                    <div className="relative">
                      <Mail className="w-3.5 h-3.5 text-[#9C8B8B] absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="email"
                        placeholder="e.g. sneha@example.com"
                        value={customerEmail}
                        onChange={(e) => setCustomerEmail(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl text-xs sm:text-sm text-[#2D2424] focus:outline-none focus:ring-1 focus:ring-[#8C3A42]"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-[#544646]">Your Question or Details *</label>
                    <textarea
                      rows={3}
                      required
                      placeholder="Tell us what you're looking for, hair length, occasion date, or specific skin questions..."
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      className="w-full p-2.5 bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl text-xs text-[#2D2424] focus:outline-none focus:ring-1 focus:ring-[#8C3A42]"
                    />
                  </div>

                  <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3">
                    <span className="text-[11px] text-[#7A6B6B]">
                      Staff will follow up on WhatsApp & email.
                    </span>

                    <button
                      type="submit"
                      id="submit-enquiry-form-btn"
                      className="w-full sm:w-auto flex items-center justify-center gap-2 bg-[#8C3A42] hover:bg-[#742F36] text-white py-2.5 px-6 rounded-xl text-xs sm:text-sm font-semibold shadow-xs transition-colors"
                    >
                      <Send className="w-4 h-4" />
                      <span>Submit Enquiry</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>

        </div>

      </div>
    </section>
  );
};
