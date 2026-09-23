import React from 'react';
import { 
  MapPin, 
  Phone, 
  Mail, 
  Clock, 
  Navigation, 
  MessageCircle, 
  Car, 
  Train, 
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
            Conveniently located in the heart of Jubilee Hills, featuring private bridal suites, 
            complimentary valet parking, and warm hospitality.
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
                  <h4 className="font-serif-luxury text-lg font-bold text-[#2D2424]">
                    Salon Location
                  </h4>
                  <p className="text-xs text-[#524444] leading-relaxed mt-1">
                    {SALON_INFO.address}
                  </p>
                  <p className="text-[11px] text-[#7A6B6B] mt-1">
                    Landmark: Near Peddamma Temple Metro & Opposite Designer Boulevard
                  </p>
                </div>
              </div>

              {/* Transit & Parking Badges */}
              <div className="pt-2 flex flex-wrap gap-2 text-xs">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-[#D9C4BE] rounded-lg text-[#524444]">
                  <Car className="w-3.5 h-3.5 text-[#8C3A42]" />
                  <span>Free Valet Parking</span>
                </span>
                <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-[#D9C4BE] rounded-lg text-[#524444]">
                  <Train className="w-3.5 h-3.5 text-[#8C3A42]" />
                  <span>3 mins from Metro</span>
                </span>
              </div>
            </div>

            {/* Operating Hours Card */}
            <div className="bg-[#FAF7F5] rounded-2xl p-6 border border-[#E6DDD8] space-y-2">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#FAF0F1] text-[#8C3A42] border border-[#EAC9CB] flex items-center justify-center shrink-0">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-serif-luxury text-lg font-bold text-[#2D2424]">
                    Operating Hours
                  </h4>
                  <p className="text-xs text-[#524444] mt-0.5">
                    {SALON_INFO.openingHours}
                  </p>
                  <p className="text-[11px] text-[#22C55E] font-semibold mt-0.5 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-[#22C55E] inline-block"></span>
                    Open All 7 Days (Late appointments for Brides on request)
                  </p>
                </div>
              </div>
            </div>

            {/* Direct Connect Buttons Card */}
            <div className="bg-[#FAF7F5] rounded-2xl p-6 border border-[#E6DDD8] space-y-3">
              <h4 className="font-serif-luxury text-lg font-bold text-[#2D2424]">
                Reach Out Instantly
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <a
                  href={`tel:${SALON_INFO.phone}`}
                  className="flex items-center justify-center gap-2 bg-white hover:bg-[#F5ECE8] border border-[#D9C4BE] text-[#2D2424] py-2.5 px-3 rounded-xl text-xs font-semibold transition-colors"
                >
                  <Phone className="w-3.5 h-3.5 text-[#8C3A42]" />
                  <span>Call {SALON_INFO.phone}</span>
                </a>

                <a
                  href={getSalonWhatsAppUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20bd5a] text-white py-2.5 px-3 rounded-xl text-xs font-semibold transition-colors"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span>WhatsApp Chat</span>
                </a>
              </div>

              <div className="pt-2 text-center">
                <a
                  href={SALON_INFO.googleMapsDirectionsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-[#8C3A42] font-semibold hover:underline"
                >
                  <Navigation className="w-3.5 h-3.5" />
                  <span>Open Turn-by-Turn Directions in Google Maps</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>

          </div>

          {/* Right Column: Google Maps Interactive Embed */}
          <div className="lg:col-span-7 flex flex-col">
            <div className="bg-[#FAF7F5] rounded-2xl p-3 border border-[#E6DDD8] shadow-sm flex-1 flex flex-col">
              
              {/* Map Top Bar */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-[#E8DDD8] mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#EA4335]"></span>
                  <span className="text-xs font-bold text-[#2D2424]">Google Maps Live Location</span>
                </div>
                <a
                  href={SALON_INFO.googleMapsDirectionsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold text-[#8C3A42] hover:underline flex items-center gap-1"
                >
                  <span>Get Directions</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              {/* Map Iframe */}
              <div className="w-full flex-1 min-h-[380px] rounded-xl overflow-hidden border border-[#D9C4BE] relative">
                <iframe
                  title="Glossy Looks Women Salon Google Maps Location"
                  src={SALON_INFO.googleMapsEmbedUrl}
                  width="100%"
                  height="100%"
                  style={{ border: 0, minHeight: '380px' }}
                  allowFullScreen={true}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  className="w-full h-full"
                ></iframe>

                {/* Floating Map Pin Badge */}
                <div className="absolute top-3 left-3 bg-white/95 backdrop-blur-xs px-3 py-2 rounded-xl shadow-md border border-[#D9C4BE] text-xs space-y-0.5 pointer-events-none">
                  <p className="font-bold text-[#2D2424]">Glossy Looks Women Salon</p>
                  <p className="text-[11px] text-[#7A6B6B]">Road No. 36, Jubilee Hills</p>
                </div>
              </div>

              {/* Map Footer Note */}
              <div className="px-3 pt-3 flex items-center justify-between text-[11px] text-[#7A6B6B]">
                <span>Coordinates: 17.4300° N, 78.4042° E</span>
                <span>Wheelchair Accessible Entrance Available</span>
              </div>

            </div>
          </div>

        </div>

      </div>
    </section>
  );
};
