import React from 'react';
import { 
  Sparkles, 
  MapPin, 
  Phone, 
  Mail, 
  Clock, 
  Instagram, 
  MessageCircle, 
  ShieldCheck, 
  Heart,
  Navigation
} from 'lucide-react';
import { SALON_INFO } from '../data/initialData';
import { getSalonWhatsAppUrl } from '../utils/whatsapp';

interface FooterProps {
  onNavigate: (section: string) => void;
  onOpenBooking: () => void;
  onOpenAdmin: () => void;
}

export const Footer: React.FC<FooterProps> = ({
  onNavigate,
  onOpenBooking,
  onOpenAdmin,
}) => {
  return (
    <footer className="bg-[#261E1E] text-[#FAF7F5] pt-16 pb-12 border-t border-[#3B2F2F]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-10 pb-12 border-b border-[#3D3232]">
          
          {/* Brand & Bio */}
          <div className="lg:col-span-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#E8C5C8] to-[#D99B9F] flex items-center justify-center text-[#2D2424] shadow-sm">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <span className="font-serif-luxury text-2xl font-bold tracking-tight text-white">
                  Glossy Looks
                </span>
                <p className="text-[10px] text-[#C98A8E] uppercase tracking-wider font-semibold">
                  Women Salon & Spa
                </p>
              </div>
            </div>

            <p className="text-xs text-[#B8A7A7] leading-relaxed font-light">
              Hyderabad’s premier bespoke bridal salon and aesthetic beauty studio. 
              Dedicated exclusively to empowering women with effortless radiance, international color artistry, and transformative wellness.
            </p>

            <div className="flex items-center gap-3 pt-1">
              <a
                href={getSalonWhatsAppUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="w-8 h-8 rounded-full bg-[#3D3232] hover:bg-[#25D366] text-white flex items-center justify-center transition-colors"
                aria-label="WhatsApp"
              >
                <MessageCircle className="w-4 h-4" />
              </a>
              <a
                href="https://instagram.com"
                target="_blank"
                rel="noopener noreferrer"
                className="w-8 h-8 rounded-full bg-[#3D3232] hover:bg-[#E1306C] text-white flex items-center justify-center transition-colors"
                aria-label="Instagram"
              >
                <Instagram className="w-4 h-4" />
              </a>
              <a
                href={`tel:${SALON_INFO.phone}`}
                className="w-8 h-8 rounded-full bg-[#3D3232] hover:bg-[#8C3A42] text-white flex items-center justify-center transition-colors"
                aria-label="Call Salon"
              >
                <Phone className="w-4 h-4" />
              </a>
            </div>
          </div>

          {/* Quick Links */}
          <div className="lg:col-span-2 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#E8C5C8]">
              Salon Services
            </h4>
            <ul className="space-y-2 text-xs text-[#B8A7A7]">
              <li>
                <button onClick={() => onNavigate('menu')} className="hover:text-white transition-colors">
                  Bridal HD Makeovers
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('menu')} className="hover:text-white transition-colors">
                  Parisian Balayage
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('menu')} className="hover:text-white transition-colors">
                  Keratin & Hair Botox
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('menu')} className="hover:text-white transition-colors">
                  24K Gold Hydra Facials
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('menu')} className="hover:text-white transition-colors">
                  Chrome Gel Nail Extensions
                </button>
              </li>
            </ul>
          </div>

          {/* Experience & Artists */}
          <div className="lg:col-span-3 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#E8C5C8]">
              Studio & Artists
            </h4>
            <ul className="space-y-2 text-xs text-[#B8A7A7]">
              <li>
                <button onClick={() => onNavigate('artists')} className="hover:text-white transition-colors">
                  Master Stylists & Artists
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('gallery')} className="hover:text-white transition-colors">
                  Artist Portfolio & Reels
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('enquiry')} className="hover:text-white transition-colors">
                  Bridal Package Enquiries
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('contact')} className="hover:text-white transition-colors">
                  Google Maps & Directions
                </button>
              </li>
              <li>
                <button onClick={onOpenAdmin} className="text-[#E8C5C8] hover:underline font-medium">
                  Staff & Billing Portal →
                </button>
              </li>
            </ul>
          </div>

          {/* Contact & Hours */}
          <div className="lg:col-span-3 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#E8C5C8]">
              Salon Address & Hours
            </h4>
            <div className="space-y-2 text-xs text-[#B8A7A7]">
              <p className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-[#C98A8E] shrink-0 mt-0.5" />
                <span>{SALON_INFO.address}</span>
              </p>
              <p className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-[#C98A8E] shrink-0" />
                <span>{SALON_INFO.openingHours}</span>
              </p>
              <p className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-[#C98A8E] shrink-0" />
                <span>{SALON_INFO.phone}</span>
              </p>
            </div>

            <div className="pt-2">
              <button
                onClick={onOpenBooking}
                className="w-full py-2 px-3 rounded-lg text-xs font-semibold bg-[#8C3A42] hover:bg-[#742F36] text-white transition-colors"
              >
                Book Appointment Online
              </button>
            </div>
          </div>

        </div>

        {/* Bottom copyright and hygiene assurance */}
        <div className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#8A7979]">
          <p>© {new Date().getFullYear()} Glossy Looks Women Salon. All Rights Reserved.</p>
          <div className="flex items-center gap-4 text-[11px]">
            <span>100% Sterilized Tools</span>
            <span>•</span>
            <span>Private Bridal Dressing Rooms</span>
            <span>•</span>
            <span>Complimentary WiFi & Valet</span>
          </div>
        </div>

      </div>
    </footer>
  );
};
