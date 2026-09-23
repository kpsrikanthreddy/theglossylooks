import React, { useState } from 'react';
import { MessageCircle, X, Send, Sparkles, PhoneCall } from 'lucide-react';
import { SALON_INFO } from '../data/initialData';
import { openWhatsApp } from '../utils/whatsapp';

export const WhatsAppWidget: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [customMsg, setCustomMsg] = useState('');

  const quickPrompts = [
    { title: 'Bridal Makeover Package', text: 'Hello! I would like to enquire about your Bridal Makeover packages, availability, and trial sessions.' },
    { title: 'Hair Balayage / Keratin', text: 'Hi Glossy Looks! I want to check prices and stylist availability for Hair Keratin / Balayage.' },
    { title: 'Check Today’s Free Slots', text: 'Hello! Are there any open slots available for hair styling or facial today?' },
    { title: 'Speak with Specialist', text: 'Hello! I need expert guidance for skin/hair treatments before booking an appointment.' },
  ];

  const handleSendPrompt = (text: string) => {
    openWhatsApp(SALON_INFO.whatsapp, text);
    setIsOpen(false);
  };

  const handleSendCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customMsg.trim()) return;
    openWhatsApp(SALON_INFO.whatsapp, customMsg.trim());
    setCustomMsg('');
    setIsOpen(false);
  };

  return (
    <div className="fixed bottom-5 right-5 z-40">
      {/* Floating Popup Drawer */}
      {isOpen && (
        <div className="bg-white rounded-2xl shadow-2xl border border-[#D9C4BE] w-80 sm:w-96 overflow-hidden mb-3 animate-in fade-in slide-in-from-bottom-5 duration-200">
          
          {/* Header */}
          <div className="bg-[#2D2424] text-white p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 rounded-full bg-[#25D366] text-white flex items-center justify-center">
                  <MessageCircle className="w-6 h-6" />
                </div>
                <span className="w-2.5 h-2.5 rounded-full bg-[#22C55E] border-2 border-[#2D2424] absolute bottom-0 right-0"></span>
              </div>
              <div>
                <h4 className="font-semibold text-sm">Glossy Looks Salon Concierge</h4>
                <p className="text-[11px] text-[#D8C7C7]">Typically replies within 10 mins</p>
              </div>
            </div>

            <button
              onClick={() => setIsOpen(false)}
              className="text-[#D8C7C7] hover:text-white p-1 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Quick FAQ / Prompt Chips */}
          <div className="p-4 bg-[#FAF7F5] space-y-3 border-b border-[#E8DDD8]">
            <p className="text-[11px] font-semibold text-[#665454] uppercase tracking-wide">
              How can we assist you today?
            </p>
            <div className="space-y-1.5">
              {quickPrompts.map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSendPrompt(q.text)}
                  className="w-full text-left p-2 rounded-xl text-xs bg-white hover:bg-[#FAF0F1] hover:border-[#E8C5C8] text-[#2D2424] border border-[#E3D6D2] transition-colors flex items-center justify-between"
                >
                  <span className="font-medium">{q.title}</span>
                  <span className="text-[#8C3A42] font-semibold">Chat →</span>
                </button>
              ))}
            </div>
          </div>

          {/* Custom Message Input */}
          <form onSubmit={handleSendCustom} className="p-3 bg-white flex items-center gap-2">
            <input
              type="text"
              placeholder="Type your question..."
              value={customMsg}
              onChange={(e) => setCustomMsg(e.target.value)}
              className="flex-1 bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl px-3 py-2 text-xs text-[#2D2424] focus:outline-none focus:ring-1 focus:ring-[#8C3A42]"
            />
            <button
              type="submit"
              disabled={!customMsg.trim()}
              className="bg-[#25D366] hover:bg-[#20bd5a] disabled:opacity-50 text-white p-2 rounded-xl transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>

        </div>
      )}

      {/* Floating Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        id="floating-whatsapp-trigger"
        aria-label="Open WhatsApp Salon Chat"
        className="w-14 h-14 rounded-full bg-[#25D366] hover:bg-[#20bd5a] text-white shadow-xl hover:shadow-2xl flex items-center justify-center transition-all hover:scale-105 active:scale-95 group relative"
      >
        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 border-2 border-white animate-pulse"></span>
        <MessageCircle className="w-7 h-7" />
      </button>
    </div>
  );
};
