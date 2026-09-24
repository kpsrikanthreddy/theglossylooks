import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, 
  Calendar as CalendarIcon, 
  Clock, 
  User, 
  Phone, 
  Mail, 
  Check, 
  Sparkles, 
  ShieldCheck, 
  MessageCircle, 
  CheckCircle2,
  FileText,
  Search
} from 'lucide-react';
import { SalonService, Artist, Appointment } from '../types/salon';
import { SALON_INFO } from '../data/initialData';
import { getAppointmentWhatsAppMessage, openWhatsApp } from '../utils/whatsapp';

interface AppointmentBookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  services: SalonService[];
  artists?: Artist[];
  initialSelectedService?: SalonService | null;
  initialSelectedArtist?: Artist | null;
  onAppointmentCreated: (appointment: Appointment) => void;
  defaultRole?: 'customer' | 'staff';
}

const TIME_SLOTS = [
  '09:30 AM', '10:15 AM', '11:00 AM', '11:45 AM',
  '12:30 PM', '01:30 PM', '02:15 PM', '03:00 PM',
  '03:45 PM', '04:30 PM', '05:15 PM', '06:00 PM',
  '06:45 PM', '07:30 PM'
];

export const AppointmentBookingModal: React.FC<AppointmentBookingModalProps> = ({
  isOpen,
  onClose,
  services,
  initialSelectedService,
  onAppointmentCreated,
  defaultRole = 'customer',
}) => {
  const activeServices = useMemo(() => services.filter(s => s.active !== false), [services]);
  const [searchTerm, setSearchTerm] = useState('');
  const [bookedBy] = useState<'customer' | 'staff'>(defaultRole);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  
  const todayStr = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<string>('11:00 AM');

  const [customerName, setCustomerName] = useState<string>('');
  const [customerPhone, setCustomerPhone] = useState<string>('');
  const [customerEmail, setCustomerEmail] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [createdAppointment, setCreatedAppointment] = useState<Appointment | null>(null);

  useEffect(() => {
    if (initialSelectedService) {
      setSelectedServiceIds([initialSelectedService.id]);
    } else if (activeServices.length > 0) {
      setSelectedServiceIds([activeServices[0].id]);
    }
  }, [initialSelectedService, activeServices]);

  if (!isOpen) return null;

  const filteredServices = activeServices.filter(s => {
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    return s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q);
  });

  const selectedServices = activeServices.filter((s) => selectedServiceIds.includes(s.id));
  const totalAmount = selectedServices.reduce((sum, s) => sum + s.price, 0);
  const totalDuration = selectedServices.reduce((sum, s) => sum + s.durationMinutes, 0);

  const toggleService = (serviceId: string) => {
    if (selectedServiceIds.includes(serviceId)) {
      if (selectedServiceIds.length === 1) {
        setErrorMsg('Please select at least one salon service.');
        return;
      }
      setSelectedServiceIds(selectedServiceIds.filter((id) => id !== serviceId));
      setErrorMsg('');
    } else {
      setSelectedServiceIds([...selectedServiceIds, serviceId]);
      setErrorMsg('');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (selectedServiceIds.length === 0) {
      setErrorMsg('Please select at least one service.');
      return;
    }

    if (!customerName.trim()) {
      setErrorMsg('Please enter customer full name.');
      return;
    }
    const cleanPhone = customerPhone.replace(/\D/g, '');
    if (!customerPhone.trim() || cleanPhone.length < 10) {
      setErrorMsg('Please enter a valid 10-digit WhatsApp mobile number.');
      return;
    }

    const refCode = `GLS-${Math.floor(1000 + Math.random() * 9000)}`;

    const newAppointment: Appointment = {
      id: `apt-${Date.now()}`,
      referenceCode: refCode,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      customerEmail: customerEmail.trim() || undefined,
      serviceIds: selectedServiceIds,
      serviceNames: selectedServices.map((s) => s.name),
      date: selectedDate,
      timeSlot: selectedTimeSlot,
      notes: notes.trim() || undefined,
      status: 'confirmed',
      bookedBy: bookedBy,
      totalAmount: totalAmount,
      durationMinutes: totalDuration,
      createdAt: new Date().toISOString().split('T')[0],
    };

    onAppointmentCreated(newAppointment);
    setCreatedAppointment(newAppointment);
  };

  const handleWhatsAppSend = () => {
    if (!createdAppointment) return;
    const msg = getAppointmentWhatsAppMessage(createdAppointment);
    openWhatsApp(createdAppointment.customerPhone, msg);
  };

  const handleModalClose = () => {
    setCreatedAppointment(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-xl w-full overflow-hidden shadow-2xl border border-[#D9C4BE] my-6 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Top Header */}
        <div className="bg-[#FAF7F5] px-6 py-4 border-b border-[#E8DDD8] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[#FAF0F1] flex items-center justify-center text-[#8C3A42]">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-serif-luxury text-lg font-bold text-[#2D2424]">
                Book Salon Appointment
              </h3>
              <p className="text-[11px] text-[#7A6B6B]">
                The Glossy Looks Professional Women Salon
              </p>
            </div>
          </div>

          <button
            onClick={handleModalClose}
            className="p-1.5 rounded-full text-[#7A6B6B] hover:text-[#2D2424] hover:bg-[#EFE8E5] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        {createdAppointment ? (
          /* Success Screen */
          <div className="p-6 sm:p-8 space-y-6">
            <div className="text-center space-y-2">
              <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-9 h-9" />
              </div>
              <h4 className="font-serif-luxury text-2xl font-bold text-[#2D2424]">
                Booking Confirmed!
              </h4>
              <p className="text-xs text-[#6B5A5A] max-w-md mx-auto">
                Appointment scheduled at The Glossy Looks Women Salon.
              </p>
            </div>

            <div className="bg-[#FAF7F5] rounded-xl p-5 border border-[#E3D6D2] space-y-3">
              <div className="flex justify-between items-center pb-3 border-b border-[#E8DDD8]">
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#8C3A42] tracking-wider">Ref Code</span>
                  <p className="font-mono text-base font-bold text-[#2D2424]">{createdAppointment.referenceCode}</p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-[#7A6B6B] tracking-wider">Slot</span>
                  <p className="text-xs font-semibold text-[#2D2424]">{createdAppointment.date} at {createdAppointment.timeSlot}</p>
                </div>
              </div>

              <div>
                <span className="text-[11px] font-semibold text-[#665454]">Services:</span>
                <ul className="text-xs text-[#2D2424] list-disc list-inside mt-1 space-y-0.5">
                  {createdAppointment.serviceNames.map((s, idx) => (
                    <li key={idx}>{s}</li>
                  ))}
                </ul>
              </div>

              <div className="flex justify-between items-center pt-2 border-t border-[#E8DDD8] text-xs">
                <span className="text-[#6B5A5A]">Total:</span>
                <span className="font-serif-luxury text-lg font-bold text-[#8C3A42]">
                  ₹{createdAppointment.totalAmount.toLocaleString('en-IN')}
                </span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleWhatsAppSend}
                className="flex-1 flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20bd5a] text-white py-3 px-4 rounded-xl text-xs sm:text-sm font-semibold shadow-xs transition-colors"
              >
                <MessageCircle className="w-4 h-4" />
                <span>Get WhatsApp Pass</span>
              </button>

              <button
                onClick={handleModalClose}
                className="py-3 px-5 rounded-xl text-xs sm:text-sm font-semibold bg-white border border-[#D9C4BE] text-[#2D2424] hover:bg-[#FAF7F5]"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          /* 5-Step Booking Form */
          <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
            {/* Step 1: Select Services with Search */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-xs font-bold uppercase tracking-wider text-[#4A3C3C]">
                  1. Select Service(s) ({selectedServiceIds.length} selected)
                </label>
                <span className="text-xs font-semibold text-[#8C3A42]">
                  ₹{totalAmount.toLocaleString('en-IN')}
                </span>
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#8C7A7A] absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search services..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 bg-[#FAF7F5] border border-[#DDD0CB] rounded-lg text-xs"
                />
              </div>

              <div className="max-h-44 overflow-y-auto space-y-1.5 border border-[#EDE1DD] p-2 rounded-xl bg-[#FAF7F5]">
                {filteredServices.map((srv) => {
                  const isChecked = selectedServiceIds.includes(srv.id);
                  return (
                    <div
                      key={srv.id}
                      onClick={() => toggleService(srv.id)}
                      className={`flex items-center justify-between p-2 rounded-lg cursor-pointer text-xs transition-colors ${
                        isChecked
                          ? 'bg-[#FAF0F1] border border-[#E8C5C8] text-[#2D2424]'
                          : 'bg-white hover:bg-[#F3ECE8] text-[#544545] border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-4 h-4 rounded flex items-center justify-center border ${
                            isChecked ? 'bg-[#8C3A42] border-[#8C3A42] text-white' : 'border-[#C4B2AD]'
                          }`}
                        >
                          {isChecked && <Check className="w-3 h-3" />}
                        </div>
                        <div>
                          <p className="font-semibold">{srv.name}</p>
                          <p className="text-[10px] text-[#7A6B6B]">{srv.category} • {srv.durationMinutes} mins</p>
                        </div>
                      </div>
                      <span className="font-semibold text-[#8C3A42] font-serif-luxury text-sm">
                        ₹{srv.price.toLocaleString('en-IN')}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Step 2: Choose Date */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-[#4A3C3C] flex items-center gap-1">
                <CalendarIcon className="w-3.5 h-3.5 text-[#8C3A42]" />
                <span>2. Choose Date</span>
              </label>
              <input
                type="date"
                min={todayStr}
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl px-3 py-2 text-xs sm:text-sm text-[#2D2424] focus:outline-none focus:ring-2 focus:ring-[#8C3A42]/20"
                required
              />
            </div>

            {/* Step 3: Preferred Time Slot */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-[#4A3C3C] flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-[#8C3A42]" />
                <span>3. Preferred Time Slot</span>
              </label>
              <select
                value={selectedTimeSlot}
                onChange={(e) => setSelectedTimeSlot(e.target.value)}
                className="w-full bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl px-3 py-2 text-xs sm:text-sm text-[#2D2424] focus:outline-none focus:ring-2 focus:ring-[#8C3A42]/20"
              >
                {TIME_SLOTS.map((slot) => (
                  <option key={slot} value={slot}>
                    {slot}
                  </option>
                ))}
              </select>
            </div>

            {/* Step 4: Customer Details */}
            <div className="space-y-3">
              <label className="text-xs font-bold uppercase tracking-wider text-[#4A3C3C] block">
                4. Customer Details
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="relative">
                    <User className="w-3.5 h-3.5 text-[#7A6B6B] absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder="Customer Name *"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="w-full bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl pl-9 pr-3 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#8C3A42]/20"
                      required
                    />
                  </div>
                </div>

                <div>
                  <div className="relative">
                    <Phone className="w-3.5 h-3.5 text-[#7A6B6B] absolute left-3 top-2.5" />
                    <input
                      type="tel"
                      placeholder="WhatsApp Mobile *"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      className="w-full bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl pl-9 pr-3 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#8C3A42]/20"
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="relative">
                  <Mail className="w-3.5 h-3.5 text-[#7A6B6B] absolute left-3 top-2.5" />
                  <input
                    type="email"
                    placeholder="Email Address (Optional)"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    className="w-full bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl pl-9 pr-3 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#8C3A42]/20"
                  />
                </div>

                <input
                  type="text"
                  placeholder="Special requests or notes (Optional)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl px-3 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#8C3A42]/20"
                />
              </div>
            </div>

            {errorMsg && (
              <div className="p-2.5 bg-red-50 text-red-700 text-xs rounded-xl border border-red-200">
                {errorMsg}
              </div>
            )}

            {/* Step 5: Confirm Appointment */}
            <div className="pt-2 border-t border-[#E8DDD8]">
              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 bg-[#8C3A42] hover:bg-[#742F36] text-white py-3.5 rounded-xl font-semibold text-sm shadow-md transition-all cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>5. Confirm Appointment • ₹{totalAmount.toLocaleString('en-IN')}</span>
              </button>
            </div>
          </form>
        )}

      </div>
    </div>
  );
};
