import React, { useState, useEffect } from 'react';
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
  Plus, 
  Minus,
  CheckCircle2,
  FileText
} from 'lucide-react';
import { SalonService, Artist, Appointment } from '../types/salon';
import { SALON_INFO } from '../data/initialData';
import { getAppointmentWhatsAppMessage, openWhatsApp } from '../utils/whatsapp';

interface AppointmentBookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  services: SalonService[];
  artists: Artist[];
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
  artists,
  initialSelectedService,
  initialSelectedArtist,
  onAppointmentCreated,
  defaultRole = 'customer',
}) => {
  // Form state
  const [bookedBy, setBookedBy] = useState<'customer' | 'staff'>(defaultRole);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [selectedArtistId, setSelectedArtistId] = useState<string>('any');
  
  // Date setup: default to tomorrow or today
  const todayStr = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<string>('11:00 AM');

  const [customerName, setCustomerName] = useState<string>('');
  const [customerPhone, setCustomerPhone] = useState<string>('');
  const [customerEmail, setCustomerEmail] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  // Confirmation view state
  const [createdAppointment, setCreatedAppointment] = useState<Appointment | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Sync initial selections when opened
  useEffect(() => {
    if (isOpen) {
      if (initialSelectedService) {
        setSelectedServiceIds([initialSelectedService.id]);
      } else if (selectedServiceIds.length === 0 && services.length > 0) {
        setSelectedServiceIds([services[0].id]);
      }

      if (initialSelectedArtist) {
        setSelectedArtistId(initialSelectedArtist.id);
      }
      setCreatedAppointment(null);
      setErrorMsg('');
    }
  }, [isOpen, initialSelectedService, initialSelectedArtist]);

  if (!isOpen) return null;

  // Selected services calculations
  const selectedServices = services.filter((s) => selectedServiceIds.includes(s.id));
  const totalAmount = selectedServices.reduce((acc, curr) => acc + curr.price, 0);
  const totalDuration = selectedServices.reduce((acc, curr) => acc + curr.durationMinutes, 0);

  const toggleService = (serviceId: string) => {
    if (selectedServiceIds.includes(serviceId)) {
      if (selectedServiceIds.length === 1) {
        setErrorMsg('Please select at least one service.');
        return;
      }
      setSelectedServiceIds(selectedServiceIds.filter((id) => id !== serviceId));
    } else {
      setSelectedServiceIds([...selectedServiceIds, serviceId]);
      setErrorMsg('');
    }
  };

  const handleBookingSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim()) {
      setErrorMsg('Please enter customer name.');
      return;
    }
    if (!customerPhone.trim() || customerPhone.replace(/\D/g, '').length < 10) {
      setErrorMsg('Please enter a valid 10-digit WhatsApp phone number.');
      return;
    }
    if (selectedServiceIds.length === 0) {
      setErrorMsg('Please select at least one salon service.');
      return;
    }

    const artistObj = artists.find((a) => a.id === selectedArtistId);
    const refCode = `GLS-${Math.floor(1000 + Math.random() * 9000)}`;

    const newAppointment: Appointment = {
      id: `apt-${Date.now()}`,
      referenceCode: refCode,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      customerEmail: customerEmail.trim() || undefined,
      serviceIds: selectedServiceIds,
      serviceNames: selectedServices.map((s) => s.name),
      artistId: artistObj ? artistObj.id : undefined,
      artistName: artistObj ? artistObj.name : 'Any Available Top Specialist',
      date: selectedDate,
      timeSlot: selectedTimeSlot,
      notes: notes.trim() || undefined,
      status: 'confirmed',
      bookedBy: bookedBy,
      totalAmount: totalAmount,
      createdAt: new Date().toISOString().split('T')[0],
    };

    onAppointmentCreated(newAppointment);
    setCreatedAppointment(newAppointment);
  };

  const handleWhatsAppSend = () => {
    if (createdAppointment) {
      const msg = getAppointmentWhatsAppMessage(createdAppointment);
      openWhatsApp(createdAppointment.customerPhone, msg);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl border border-[#D9C4BE] my-8 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="bg-[#FAF7F5] px-6 py-4 border-b border-[#E8DDD8] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-[#FAF0F1] border border-[#EAC9CB] flex items-center justify-center text-[#8C3A42]">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-serif-luxury text-xl font-bold text-[#2D2424]">
                {createdAppointment ? 'Appointment Confirmed!' : 'Book Salon Appointment'}
              </h3>
              <p className="text-[11px] text-[#7A6B6B]">
                {createdAppointment ? 'Reference saved to schedule' : 'Instant slot confirmation & WhatsApp reminder'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#7A6B6B] hover:text-[#2D2424] hover:bg-[#EFE8E5] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        {createdAppointment ? (
          /* Success Confirmation Screen */
          <div className="p-6 sm:p-8 space-y-6">
            <div className="text-center space-y-2">
              <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-9 h-9" />
              </div>
              <h4 className="font-serif-luxury text-2xl font-bold text-[#2D2424]">
                Booking Confirmed, {createdAppointment.customerName}!
              </h4>
              <p className="text-xs text-[#6B5A5A] max-w-md mx-auto">
                Your appointment has been scheduled at Glossy Looks Women Salon. 
                We have generated your luxury booking pass.
              </p>
            </div>

            {/* Ticket Card */}
            <div className="bg-[#FAF7F5] rounded-xl p-5 border border-[#E3D6D2] space-y-3">
              <div className="flex justify-between items-center pb-3 border-b border-[#E8DDD8]">
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#8C3A42] tracking-wider">Booking Ref</span>
                  <p className="font-mono text-base font-bold text-[#2D2424]">{createdAppointment.referenceCode}</p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-[#7A6B6B] tracking-wider">Slot</span>
                  <p className="text-xs font-semibold text-[#2D2424]">{createdAppointment.date} at {createdAppointment.timeSlot}</p>
                </div>
              </div>

              <div>
                <span className="text-[11px] font-semibold text-[#665454]">Services Booked:</span>
                <ul className="text-xs text-[#2D2424] list-disc list-inside mt-1 space-y-0.5">
                  {createdAppointment.serviceNames.map((s, idx) => (
                    <li key={idx}>{s}</li>
                  ))}
                </ul>
              </div>

              <div className="flex justify-between items-center pt-2 border-t border-[#E8DDD8] text-xs">
                <div>
                  <span className="text-[#6B5A5A]">Assigned Specialist: </span>
                  <span className="font-semibold text-[#2D2424]">{createdAppointment.artistName}</span>
                </div>
                <div className="font-serif-luxury text-lg font-bold text-[#8C3A42]">
                  {SALON_INFO.currency}{createdAppointment.totalAmount.toLocaleString('en-IN')}
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleWhatsAppSend}
                id="booking-whatsapp-confirm-btn"
                className="flex-1 flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20bd5a] text-white py-3 px-4 rounded-xl text-xs sm:text-sm font-semibold shadow-xs transition-colors"
              >
                <MessageCircle className="w-4 h-4" />
                <span>Send Details to Customer WhatsApp</span>
              </button>

              <button
                onClick={onClose}
                className="flex items-center justify-center py-3 px-4 rounded-xl text-xs sm:text-sm font-semibold bg-[#2D2424] text-white hover:bg-black transition-colors"
              >
                Done
              </button>
            </div>

          </div>
        ) : (
          /* Booking Form */
          <form onSubmit={handleBookingSubmit} className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
            
            {/* Booked By Toggle (Customer vs Salon Staff) */}
            <div className="bg-[#FAF7F5] p-1.5 rounded-xl border border-[#E3D6D2] flex items-center justify-between text-xs">
              <span className="text-[11px] font-medium text-[#665454] px-2">Booking Mode:</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setBookedBy('customer')}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                    bookedBy === 'customer'
                      ? 'bg-white text-[#8C3A42] font-semibold shadow-xs border border-[#D9C4BE]'
                      : 'text-[#6B5A5A] hover:text-[#2D2424]'
                  }`}
                >
                  Customer Self-Book
                </button>
                <button
                  type="button"
                  onClick={() => setBookedBy('staff')}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1 ${
                    bookedBy === 'staff'
                      ? 'bg-[#2D2424] text-white font-semibold shadow-xs'
                      : 'text-[#6B5A5A] hover:text-[#2D2424]'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-[#E8C5C8]" />
                  <span>Salon Staff / Front Desk</span>
                </button>
              </div>
            </div>

            {errorMsg && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">
                {errorMsg}
              </div>
            )}

            {/* 1. Services Selection */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-xs font-bold uppercase tracking-wider text-[#4A3C3C]">
                  1. Select Service(s)
                </label>
                <span className="text-xs text-[#8C3A42] font-medium">
                  {selectedServices.length} Selected • {totalDuration} mins • {SALON_INFO.currency}{totalAmount.toLocaleString('en-IN')}
                </span>
              </div>

              <div className="max-h-40 overflow-y-auto border border-[#E3D6D2] rounded-xl p-2 bg-[#FAF7F5] space-y-1.5">
                {services.map((srv) => {
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
                        {SALON_INFO.currency}{srv.price.toLocaleString('en-IN')}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 2. Stylist / Artist Preference */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-[#4A3C3C]">
                2. Preferred Specialist
              </label>
              <select
                value={selectedArtistId}
                onChange={(e) => setSelectedArtistId(e.target.value)}
                className="w-full bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl px-3 py-2 text-xs sm:text-sm text-[#2D2424] focus:outline-none focus:ring-2 focus:ring-[#8C3A42]/20"
              >
                <option value="any">✨ Any Available Top Specialist (Fastest Confirmation)</option>
                {artists.map((artist) => (
                  <option key={artist.id} value={artist.id}>
                    {artist.name} — {artist.role} ({artist.rating}★)
                  </option>
                ))}
              </select>
            </div>

            {/* 3. Date & Time Slot */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-[#4A3C3C] flex items-center gap-1">
                  <CalendarIcon className="w-3.5 h-3.5 text-[#8C3A42]" />
                  <span>3. Choose Date</span>
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

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-[#4A3C3C] flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-[#8C3A42]" />
                  <span>Time Slot</span>
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
            </div>

            {/* 4. Customer Details */}
            <div className="space-y-3 pt-2 border-t border-[#E8DDD8]">
              <label className="text-xs font-bold uppercase tracking-wider text-[#4A3C3C]">
                4. Customer Information
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <span className="text-[11px] text-[#615252]">Full Name *</span>
                  <div className="relative">
                    <User className="w-3.5 h-3.5 text-[#9C8B8B] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="e.g. Radhika Sharma"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl text-xs sm:text-sm text-[#2D2424] focus:outline-none focus:ring-2 focus:ring-[#8C3A42]/20"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-[11px] text-[#615252]">WhatsApp Mobile Number *</span>
                  <div className="relative">
                    <Phone className="w-3.5 h-3.5 text-[#9C8B8B] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="tel"
                      placeholder="e.g. +91 98765 43210"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl text-xs sm:text-sm text-[#2D2424] focus:outline-none focus:ring-2 focus:ring-[#8C3A42]/20"
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-[11px] text-[#615252]">Email (Optional for e-invoice)</span>
                <div className="relative">
                  <Mail className="w-3.5 h-3.5 text-[#9C8B8B] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    placeholder="e.g. radhika@example.com"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl text-xs sm:text-sm text-[#2D2424] focus:outline-none focus:ring-2 focus:ring-[#8C3A42]/20"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-[11px] text-[#615252]">Special Requests or Occasion (Optional)</span>
                <textarea
                  rows={2}
                  placeholder="e.g. Engagement party tonight, please prep skin for heavy camera lighting..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full p-2.5 bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl text-xs text-[#2D2424] focus:outline-none focus:ring-2 focus:ring-[#8C3A42]/20"
                />
              </div>
            </div>

            {/* Total Summary Footer */}
            <div className="pt-3 border-t border-[#E8DDD8] flex items-center justify-between">
              <div>
                <p className="text-[11px] text-[#7A6B6B]">Estimated Total</p>
                <p className="font-serif-luxury text-xl font-bold text-[#8C3A42]">
                  {SALON_INFO.currency}{totalAmount.toLocaleString('en-IN')}
                </p>
              </div>

              <button
                type="submit"
                id="submit-booking-btn"
                className="flex items-center gap-2 bg-[#8C3A42] hover:bg-[#742F36] text-white py-3 px-6 rounded-xl text-xs sm:text-sm font-semibold shadow-xs transition-colors"
              >
                <span>Confirm Reservation</span>
                <Check className="w-4 h-4" />
              </button>
            </div>

          </form>
        )}

      </div>
    </div>
  );
};
