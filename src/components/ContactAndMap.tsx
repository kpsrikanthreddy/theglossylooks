import React from 'react';
import { 
  MapPin, 
  Phone, 
  Mail, 
  Clock, 
  Navigation, 
  MessageCircle, 
  Car, 
  CheckCircle, 
  ExternalLink 
} from 'lucide-react';
import { SALON_INFO } from '../data/initialData';
import { getSalonWhatsAppUrl } from '../utils/whatsapp';

export const ContactAndMap: React.FC = () => {
  return (
    <section id="contact" className="py-16 bg-white border-b border-[#EBE1DC]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="text-center max-w-2xl mx-auto space-y-3 mb-12">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#FAF0F1] border border-[#EAC9CB] text-[#8C3A42] text-xs font-semibold uppercase tracking-wider">
            <MapPin className="w-3.5 h-3.5" />
            <span>Visit Our Studio</span>
          </div>
          <h2 className="font-serif-luxury text-3xl sm:text-4xl lg:text-5xl font-bold text-[#2D2424]">
            Contact Us & Google Maps
          </h2>
          <p className="text-sm sm:text-base text-[#6E5E5E] font-light">
            Conveniently located in Vinayak Nagar, Gachibowli, Hyderabad. Featuring private luxury suites, 
            reserved parking, and warm hospitality.
          </p>
        </div>

        {/* Content Grid: Contact Details on Left, Google Maps on Right */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          
          {/* Left Column: Contact Cards */}
          <div className="lg:col-span-5 flex flex-col justify-between space-y-4">
            
            {/* Salon Address Card */}
            <div className="bg-[#FAF7F5] rounded-2xl p-6 border border-[#E6DDD8] space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-[#FAF0F1] text-[#8C3A42] border border-[#EAC9CB] flex items-center justify-center shrink-0">
                  <MapPin className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-serif-luxury text-lg font-bold text-[#2D2424]">
                    Salon Location
                  </h3>
                  <p className="text-xs text-[#524444] leading-relaxed mt-1">
                    {SALON_INFO.address}
                  </p>
                  <p className="text-[11px] text-[#7A6B6B] mt-1">
                    Landmark: Vinayak Nagar, Gachibowli (near DLF Cyber City), Hyderabad
                  </p>
                </div>
              </div>

              <div className="pt-2 flex gap-3">
                <a
                  href={SALON_INFO.googleMapsDirectionsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#8C3A42] hover:text-[#5B2329]"
                >
                  <Navigation className="w-3.5 h-3.5" />
                  <span>Get Driving Directions</span>
                </a>
              </div>
            </div>

            {/* Timings & Opening Hours Card */}
            <div className="bg-[#FAF7F5] rounded-2xl p-6 border border-[#E6DDD8] space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-[#FAF0F1] text-[#8C3A42] border border-[#EAC9CB] flex items-center justify-center shrink-0">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-serif-luxury text-lg font-bold text-[#2D2424]">
                    Studio Hours
                  </h3>
                  <p className="text-xs text-[#524444] leading-relaxed mt-1">
                    {SALON_INFO.openingHours}
                  </p>
                  <div className="mt-2 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 text-[11px] font-semibold border border-emerald-200">
                    <CheckCircle className="w-3 h-3 text-emerald-600" />
                    <span>Open Today For Walk-Ins & Appointments</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Direct Connect Options (Phone & WhatsApp) */}
            <div className="bg-[#FAF7F5] rounded-2xl p-6 border border-[#E6DDD8] space-y-3">
              <h4 className="font-serif-luxury text-sm font-bold text-[#2D2424]">
                Reach Out Directly
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <a
                  href={`tel:${SALON_INFO.phone}`}
                  className="flex items-center gap-2 p-3 bg-white rounded-xl border border-[#E6DDD8] text-[#2D2424] hover:border-[#8C3A42] transition-colors"
                >
                  <Phone className="w-4 h-4 text-[#8C3A42]" />
                  <div>
                    <span className="text-[10px] text-[#7A6B6B] block">Call Reception</span>
                    <span className="font-semibold">{SALON_INFO.phone}</span>
                  </div>
                </a>

                <a
                  href={getSalonWhatsAppUrl('Hello! I would like to inquire about appointments and services.')}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 p-3 bg-[#25D366] text-white rounded-xl hover:bg-[#20bd5a] transition-colors"
                >
                  <MessageCircle className="w-4 h-4" />
                  <div>
                    <span className="text-[10px] opacity-80 block">Chat with Us</span>
                    <span className="font-semibold">WhatsApp Concierge</span>
                  </div>
                </a>
              </div>
            </div>

          </div>

          {/* Right Column: Google Maps Interactive Embed */}
          <div className="lg:col-span-7 bg-[#FAF7F5] rounded-3xl overflow-hidden border border-[#E6DDD8] p-2 min-h-[380px] shadow-sm flex flex-col">
            <div className="flex-1 rounded-2xl overflow-hidden relative">
              <iframe
                title="The Glossy Looks Salon Google Map Location"
                src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3806.273167195454!2d78.358245!3d17.441221!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3bcb93dc8c12345%3A0x6b82937!2sVinayak+Nagar%2C+Gachibowli%2C+Hyderabad!5e0!3m2!1sen!2sin!4v1700000000000!5m2!1sen!2sin"
                width="100%"
                height="100%"
                style={{ border: 0, minHeight: '380px' }}
                allowFullScreen={true}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="w-full h-full object-cover"
              />
            </div>
            
            <div className="p-3 bg-white rounded-xl mt-2 flex items-center justify-between text-xs text-[#6B5A5A]">
              <span>📍 31, Vinayak Nagar, Gachibowli, Hyderabad</span>
              <a
                href={SALON_INFO.googleMapsDirectionsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-[#8C3A42] hover:underline flex items-center gap-1"
              >
                <span>Open in Google Maps</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
};
