import React, { useState, useMemo } from 'react';
import { 
  Calendar as CalendarIcon, 
  Clock, 
  User, 
  Phone, 
  Mail, 
  Check, 
  Sparkles, 
  MessageCircle, 
  CheckCircle2,
  FileText,
  Search,
  CheckSquare,
  Square,
  ArrowRight
} from 'lucide-react';
import { SalonService, Artist, Appointment } from '../types/salon';
import { SALON_INFO } from '../data/initialData';
import { getAppointmentWhatsAppMessage, openWhatsApp } from '../utils/whatsapp';

interface PublicBookingPageProps {
  services: SalonService[];
  artists?: Artist[];
  initialSelectedService?: SalonService | null;
  initialSelectedArtist?: Artist | null;
  onAppointmentCreated: (appointment: Appointment) => void;
  onNavigate: (to: string) => void;
}

const TIME_SLOTS = [
  '09:30 AM', '10:15 AM', '11:00 AM', '11:45 AM',
  '12:30 PM', '01:30 PM', '02:15 PM', '03:00 PM',
  '03:45 PM', '04:30 PM', '05:15 PM', '06:00 PM',
  '06:45 PM', '07:30 PM'
];

export const PublicBookingPage: React.FC<PublicBookingPageProps> = ({
  services,
  initialSelectedService,
  onAppointmentCreated,
  onNavigate,
}) => {
  const activeServices = useMemo(() => {
    return services.filter(s => s.active !== false);
  }, [services]);

  // Search & Category Filter
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  // Selected Services
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>(() => {
    if (initialSelectedService) return [initialSelectedService.id];
    return activeServices.length > 0 ? [activeServices[0].id] : [];
  });

  // Date and Time
  const todayStr = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<string>('11:00 AM');

  // Customer Details
  const [customerName, setCustomerName] = useState<string>('');
  const [customerPhone, setCustomerPhone] = useState<string>('');
  const [customerEmail, setCustomerEmail] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  const [createdAppointment, setCreatedAppointment] = useState<Appointment | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Extract all unique categories
  const categories = useMemo(() => {
    const cats = Array.from(new Set(activeServices.map(s => s.category)));
    return ['All', ...cats];
  }, [activeServices]);

  // Filtered Services by Search Term and Category
  const filteredServices = useMemo(() => {
    const query = searchTerm.toLowerCase().trim();
    return activeServices.filter(s => {
      const matchesCategory = selectedCategory === 'All' || s.category === selectedCategory;
      if (!matchesCategory) return false;
      if (!query) return true;

      const nameMatch = s.name.toLowerCase().includes(query);
      const catMatch = s.category.toLowerCase().includes(query);
      const descMatch = (s.description || '').toLowerCase().includes(query);
      return nameMatch || catMatch || descMatch;
    });
  }, [activeServices, searchTerm, selectedCategory]);

  const selectedServices = activeServices.filter((s) => selectedServiceIds.includes(s.id));
  const totalAmount = selectedServices.reduce((acc, curr) => acc + curr.price, 0);
  const totalDuration = selectedServices.reduce((acc, curr) => acc + curr.durationMinutes, 0);

  const toggleService = (serviceId: string) => {
    if (selectedServiceIds.includes(serviceId)) {
      if (selectedServiceIds.length === 1) {
        setErrorMsg('Please keep at least one service selected.');
        return;
      }
      setSelectedServiceIds(selectedServiceIds.filter((id) => id !== serviceId));
      setErrorMsg('');
    } else {
      setSelectedServiceIds([...selectedServiceIds, serviceId]);
      setErrorMsg('');
    }
  };

  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (selectedServiceIds.length === 0) {
      setErrorMsg('Please select at least one salon service.');
      return;
    }

    if (!customerName.trim()) {
      setErrorMsg('Please enter customer full name.');
      return;
    }
    const cleanDigits = customerPhone.replace(/\D/g, '');
    if (!customerPhone.trim() || cleanDigits.length < 10) {
      setErrorMsg('Please enter a valid 10-digit WhatsApp mobile number.');
      return;
    }

    setIsSubmitting(true);
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
      bookedBy: 'customer',
      totalAmount: totalAmount,
      durationMinutes: totalDuration,
      createdAt: new Date().toISOString().split('T')[0],
    };

    try {
      onAppointmentCreated(newAppointment);
      setCreatedAppointment(newAppointment);
    } catch (err: any) {
      setErrorMsg(err.message || 'Booking submission error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // SUCCESS CONFIRMATION VIEW
  if (createdAppointment) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="bg-white rounded-3xl p-6 sm:p-10 shadow-xl border border-[#EDE1DD] text-center space-y-6 animate-in fade-in zoom-in-95 duration-200">
          <div className="w-16 h-16 rounded-full bg-[#ECFDF5] text-[#10B981] flex items-center justify-center mx-auto shadow-xs border border-[#A7F3D0]">
            <CheckCircle2 className="w-10 h-10" />
          </div>

          <div className="space-y-2">
            <span className="text-xs uppercase font-bold tracking-widest text-[#8C3A42] bg-[#FAF0F1] px-3.5 py-1 rounded-full">
              Booking Confirmed
            </span>
            <h2 className="font-serif-luxury text-3xl font-bold text-[#2D2424]">
              We Look Forward to Pampering You!
            </h2>
            <p className="text-sm text-[#665454]">
              Your appointment is registered at The Glossy Looks Women Salon.
            </p>
          </div>

          {/* Booking Summary Ticket Card */}
          <div className="bg-[#FAF7F5] p-5 sm:p-6 rounded-2xl border border-[#E8DDD8] text-left space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-[#E8DDD8]">
              <div>
                <p className="text-[11px] uppercase font-bold text-[#8C3A42] tracking-wider">Pass / Ref Code</p>
                <p className="font-mono text-lg font-bold text-[#2D2424]">{createdAppointment.referenceCode}</p>
              </div>
              <span className="px-3 py-1 bg-[#ECFDF5] text-[#065F46] border border-[#A7F3D0] rounded-full text-xs font-bold uppercase">
                Confirmed
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-[#8C7A7A]">Guest Name:</span>
                <p className="font-semibold text-sm text-[#2D2424]">{createdAppointment.customerName}</p>
              </div>
              <div>
                <span className="text-[#8C7A7A]">WhatsApp Phone:</span>
                <p className="font-semibold text-sm text-[#2D2424]">{createdAppointment.customerPhone}</p>
              </div>
              <div>
                <span className="text-[#8C7A7A]">Date & Time:</span>
                <p className="font-semibold text-sm text-[#2D2424]">{createdAppointment.date} at {createdAppointment.timeSlot}</p>
              </div>
              <div>
                <span className="text-[#8C7A7A]">Estimated Total:</span>
                <p className="font-semibold text-sm text-[#8C3A42]">₹{createdAppointment.totalAmount.toLocaleString('en-IN')}</p>
              </div>
            </div>

            <div className="pt-2 border-t border-[#E8DDD8]">
              <span className="text-[11px] text-[#8C7A7A] block mb-1">Selected Services:</span>
              <ul className="space-y-1">
                {createdAppointment.serviceNames.map((name, i) => (
                  <li key={i} className="text-xs font-medium text-[#2D2424] flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[#8C3A42]" />
                    <span>{name}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Action CTAs */}
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              onClick={() => {
                const msg = getAppointmentWhatsAppMessage(createdAppointment);
                openWhatsApp(createdAppointment.customerPhone, msg);
              }}
              className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-semibold bg-[#25D366] hover:bg-[#20bd5a] text-white shadow-xs transition-colors"
            >
              <MessageCircle className="w-4 h-4" />
              <span>Get WhatsApp Pass</span>
            </button>

            <button
              onClick={() => {
                setCreatedAppointment(null);
                onNavigate('/services');
              }}
              className="py-3 px-5 rounded-xl text-sm font-semibold bg-white border border-[#D9C4BE] text-[#2D2424] hover:bg-[#FAF7F5] transition-colors"
            >
              Explore More Services
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* Title */}
      <div className="text-center space-y-2 mb-8 sm:mb-10">
        <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#FAF0F1] text-[#8C3A42] text-xs font-semibold uppercase tracking-wider">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Bespoke Beauty Slot</span>
        </div>
        <h1 className="font-serif-luxury text-3xl sm:text-4xl font-bold text-[#2D2424]">
          Book Your Salon Slot
        </h1>
        <p className="text-xs sm:text-sm text-[#7A6B6B] max-w-lg mx-auto">
          Select your services from our live menu, pick a date & time, and confirm your slot instantly.
        </p>
      </div>

      <form onSubmit={handleBookingSubmit} className="space-y-8">
        
        {/* STEP 1: SELECT SERVICES WITH FAST SEARCH & CATEGORIES */}
        <div className="bg-white rounded-2xl p-5 sm:p-7 shadow-xs border border-[#E8DDD8] space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#F0E6E3]">
            <div className="flex items-center gap-2.5">
              <span className="w-7 h-7 rounded-full bg-[#8C3A42] text-white flex items-center justify-center text-xs font-bold">
                1
              </span>
              <h2 className="font-serif-luxury text-xl font-bold text-[#2D2424]">
                Select Salon Service(s)
              </h2>
            </div>
            <div className="text-xs text-[#7A6B6B]">
              <span className="font-semibold text-[#8C3A42]">{selectedServiceIds.length}</span> selected • ₹{totalAmount.toLocaleString('en-IN')}
            </div>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="w-4 h-4 text-[#8C7A7A] absolute left-3.5 top-3" />
            <input
              type="text"
              placeholder="Search services by name, hair, facial, bridal, nail, wax..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-[#FAF7F5] border border-[#DDD0CB] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#8C3A42]/30"
            />
          </div>

          {/* Category Filter Pills */}
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {categories.map((cat) => (
              <button
                type="button"
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  selectedCategory === cat
                    ? 'bg-[#8C3A42] text-white shadow-xs'
                    : 'bg-[#FAF7F5] text-[#554545] hover:bg-[#F3ECE8] border border-[#E8DDD8]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Services Grid with Photos */}
          {filteredServices.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#7A6B6B] bg-[#FAF7F5] rounded-xl border border-dashed border-[#DDD0CB]">
              No services match "{searchTerm}". Try a different keyword or category.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 max-h-[460px] overflow-y-auto pr-1">
              {filteredServices.map((srv) => {
                const isSelected = selectedServiceIds.includes(srv.id);
                return (
                  <div
                    key={srv.id}
                    onClick={() => toggleService(srv.id)}
                    className={`p-3 rounded-xl border cursor-pointer transition-all flex gap-3 items-center ${
                      isSelected
                        ? 'border-[#8C3A42] bg-[#FAF0F1] shadow-xs'
                        : 'border-[#EDE1DD] bg-white hover:border-[#D9C4BE] hover:bg-[#FAF7F5]'
                    }`}
                  >
                    {/* Service Photo */}
                    <div className="w-16 h-16 rounded-lg overflow-hidden shrink-0 bg-[#EFE8E5] relative">
                      <img
                        src={srv.image || 'https://images.unsplash.com/photo-1560869713-7d0a29430803?auto=format&fit=crop&w=200&q=80'}
                        alt={srv.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                      {isSelected && (
                        <div className="absolute inset-0 bg-[#8C3A42]/30 flex items-center justify-center">
                          <Check className="w-5 h-5 text-white" />
                        </div>
                      )}
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] uppercase font-bold text-[#8C7A7A] truncate">
                          {srv.category}
                        </span>
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-[#8C3A42] shrink-0" />
                        ) : (
                          <Square className="w-4 h-4 text-[#C4B3AF] shrink-0" />
                        )}
                      </div>
                      <h3 className="font-semibold text-xs sm:text-sm text-[#2D2424] truncate mt-0.5">
                        {srv.name}
                      </h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="font-bold text-xs text-[#8C3A42]">
                          ₹{srv.price.toLocaleString('en-IN')}
                        </span>
                        <span className="text-[11px] text-[#7A6B6B] flex items-center gap-0.5">
                          <Clock className="w-3 h-3 text-[#A89895]" />
                          <span>{srv.durationMinutes} min</span>
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* STEP 2: CHOOSE DATE */}
        <div className="bg-white rounded-2xl p-5 sm:p-7 shadow-xs border border-[#E8DDD8] space-y-4">
          <div className="flex items-center gap-2.5 pb-3 border-b border-[#F0E6E3]">
            <span className="w-7 h-7 rounded-full bg-[#8C3A42] text-white flex items-center justify-center text-xs font-bold">
              2
            </span>
            <h2 className="font-serif-luxury text-xl font-bold text-[#2D2424]">
              Choose Date
            </h2>
          </div>

          <div className="max-w-xs">
            <label className="block text-xs font-semibold text-[#554545] mb-1.5">
              Select Booking Date
            </label>
            <input
              type="date"
              min={todayStr}
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              required
              className="w-full px-3.5 py-2.5 bg-[#FAF7F5] border border-[#DDD0CB] rounded-xl text-sm text-[#2D2424] focus:outline-none focus:ring-2 focus:ring-[#8C3A42]/30 font-medium"
            />
          </div>
        </div>

        {/* STEP 3: PREFERRED TIME SLOT */}
        <div className="bg-white rounded-2xl p-5 sm:p-7 shadow-xs border border-[#E8DDD8] space-y-4">
          <div className="flex items-center gap-2.5 pb-3 border-b border-[#F0E6E3]">
            <span className="w-7 h-7 rounded-full bg-[#8C3A42] text-white flex items-center justify-center text-xs font-bold">
              3
            </span>
            <h2 className="font-serif-luxury text-xl font-bold text-[#2D2424]">
              Preferred Time Slot
            </h2>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-7 gap-2">
            {TIME_SLOTS.map((slot) => (
              <button
                type="button"
                key={slot}
                onClick={() => setSelectedTimeSlot(slot)}
                className={`py-2 px-2 text-xs font-medium rounded-xl border text-center transition-all ${
                  selectedTimeSlot === slot
                    ? 'border-[#8C3A42] bg-[#8C3A42] text-white shadow-xs font-semibold'
                    : 'border-[#EDE1DD] bg-[#FAF7F5] text-[#2D2424] hover:bg-[#F3ECE8]'
                }`}
              >
                {slot}
              </button>
            ))}
          </div>
        </div>

        {/* STEP 4: CUSTOMER DETAILS */}
        <div className="bg-white rounded-2xl p-5 sm:p-7 shadow-xs border border-[#E8DDD8] space-y-4">
          <div className="flex items-center gap-2.5 pb-3 border-b border-[#F0E6E3]">
            <span className="w-7 h-7 rounded-full bg-[#8C3A42] text-white flex items-center justify-center text-xs font-bold">
              4
            </span>
            <h2 className="font-serif-luxury text-xl font-bold text-[#2D2424]">
              Customer Details
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#554545] mb-1">
                Full Name <span className="text-[#8C3A42]">*</span>
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-[#8C7A7A] absolute left-3.5 top-3" />
                <input
                  type="text"
                  placeholder="e.g., Deepika Reddy"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  required
                  className="w-full pl-10 pr-3.5 py-2.5 bg-[#FAF7F5] border border-[#DDD0CB] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#8C3A42]/30"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#554545] mb-1">
                WhatsApp Mobile Number <span className="text-[#8C3A42]">*</span>
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 text-[#8C7A7A] absolute left-3.5 top-3" />
                <input
                  type="tel"
                  placeholder="+91 98765 43210"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  required
                  className="w-full pl-10 pr-3.5 py-2.5 bg-[#FAF7F5] border border-[#DDD0CB] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#8C3A42]/30"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#554545] mb-1">
                Email Address (Optional)
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-[#8C7A7A] absolute left-3.5 top-3" />
                <input
                  type="email"
                  placeholder="deepika@example.com"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-2.5 bg-[#FAF7F5] border border-[#DDD0CB] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#8C3A42]/30"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#554545] mb-1">
                Special Requests or Notes (Optional)
              </label>
              <input
                type="text"
                placeholder="Allergies, bridal date, preferences..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[#FAF7F5] border border-[#DDD0CB] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#8C3A42]/30"
              />
            </div>
          </div>
        </div>

        {/* STEP 5: CONFIRM APPOINTMENT */}
        <div className="bg-[#FAF7F5] rounded-2xl p-5 sm:p-7 border border-[#E8DDD8] space-y-4">
          <div className="flex items-center gap-2.5 pb-3 border-b border-[#E8DDD8]">
            <span className="w-7 h-7 rounded-full bg-[#8C3A42] text-white flex items-center justify-center text-xs font-bold">
              5
            </span>
            <h2 className="font-serif-luxury text-xl font-bold text-[#2D2424]">
              Confirm Appointment
            </h2>
          </div>

          {/* Running Total & Summary */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-4 rounded-xl border border-[#EDE1DD]">
            <div>
              <p className="text-xs text-[#7A6B6B]">
                {selectedServices.length} service(s) selected • Approx {totalDuration} min
              </p>
              <p className="text-xs text-[#554545] mt-0.5">
                Date: <strong className="text-[#2D2424]">{selectedDate}</strong> at <strong className="text-[#2D2424]">{selectedTimeSlot}</strong>
              </p>
            </div>
            <div className="text-right">
              <span className="text-[11px] uppercase tracking-wider text-[#8C7A7A] block">Total Amount</span>
              <span className="font-serif-luxury text-2xl font-bold text-[#8C3A42]">
                ₹{totalAmount.toLocaleString('en-IN')}
              </span>
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 bg-[#FDF2F2] border border-[#F8B4B4] rounded-xl text-xs text-[#9B1C1C]">
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-4 rounded-xl bg-[#8C3A42] hover:bg-[#742F36] text-white font-semibold text-base shadow-md transition-all hover:shadow-lg disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
          >
            {isSubmitting ? (
              <span>Scheduling Your Slot...</span>
            ) : (
              <>
                <CheckCircle2 className="w-5 h-5" />
                <span>Confirm Salon Appointment (₹{totalAmount.toLocaleString('en-IN')})</span>
              </>
            )}
          </button>
        </div>

      </form>
    </div>
  );
};
