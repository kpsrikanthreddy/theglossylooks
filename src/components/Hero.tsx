import React from 'react';
import { 
  Sparkles, 
  Calendar, 
  ArrowRight, 
  Star, 
  ShieldCheck, 
  Award, 
  Clock, 
  HeartHandshake, 
  MessageCircle,
  Scissors
} from 'lucide-react';
import { SALON_INFO } from '../data/initialData';
import { getSalonWhatsAppUrl } from '../utils/whatsapp';

interface HeroProps {
  onOpenBooking: () => void;
  onExploreMenu: () => void;
  onViewGallery: () => void;
  onOpenAdmin: () => void;
}

export const Hero: React.FC<HeroProps> = ({
  onOpenBooking,
  onExploreMenu,
  onViewGallery,
  onOpenAdmin,
}) => {
  return (
    <section id="hero" className="relative overflow-hidden pt-8 pb-16 lg:pt-14 lg:pb-24">
      {/* Subtle warm luxury decorative background glow */}
      <div className="absolute top-0 right-0 -mr-40 -mt-40 w-96 h-96 rounded-full bg-[#F3D7D9]/40 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 -ml-40 -mb-40 w-96 h-96 rounded-full bg-[#EBDAD3]/50 blur-3xl pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          
          {/* Left Column: Headline and Actions */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* Elegant luxury pill badge */}
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#F5E6E7] border border-[#E5C4C6] text-[#8C3A42] text-xs font-semibold tracking-wide">
              <Sparkles className="w-3.5 h-3.5 text-[#8C3A42]" />
              <span>Couture Bridal, Balayage & Aesthetic Facials</span>
            </div>

            {/* Main Title */}
            <div className="space-y-3">
              <h1 className="font-serif-luxury text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-[#2D2424] leading-[1.12]">
                Unveil Your Most <br />
                <span className="italic font-normal text-[#8C3A42]">Radiant & Glossy</span> Look
              </h1>
              <p className="text-base sm:text-lg text-[#615252] leading-relaxed max-w-2xl font-light">
                Welcome to <strong className="font-semibold text-[#2D2424]">Glossy Looks Women Salon</strong>. 
                Experience bespoke bridal makeovers, signature hair coloring, and rejuvenating skin therapies 
                curated by award-winning artists in a tranquil private luxury haven.
              </p>
            </div>

            {/* Key Service Highlights Pills */}
            <div className="flex flex-wrap gap-2 pt-1">
              <span className="px-3 py-1 bg-white border border-[#E3D4D0] rounded-full text-xs font-medium text-[#4D3F3F] shadow-xs">
                ✨ HD Airbrush Bridal
              </span>
              <span className="px-3 py-1 bg-white border border-[#E3D4D0] rounded-full text-xs font-medium text-[#4D3F3F] shadow-xs">
                💇 Parisian Balayage & Keratin
              </span>
              <span className="px-3 py-1 bg-white border border-[#E3D4D0] rounded-full text-xs font-medium text-[#4D3F3F] shadow-xs">
                💎 24K Gold Hydra Facials
              </span>
              <span className="px-3 py-1 bg-white border border-[#E3D4D0] rounded-full text-xs font-medium text-[#4D3F3F] shadow-xs">
                💅 Chrome Gel Nail Extensions
              </span>
            </div>

            {/* Primary Action Buttons */}
            <div className="flex flex-wrap items-center gap-3 pt-3">
              <button
                onClick={onOpenBooking}
                id="hero-book-now-btn"
                className="flex items-center gap-2 bg-[#8C3A42] hover:bg-[#742F36] text-white px-6 py-3.5 rounded-xl text-base font-semibold shadow-md transition-all hover:shadow-lg hover:-translate-y-0.5"
              >
                <Calendar className="w-5 h-5" />
                <span>Book Appointment</span>
              </button>

              <button
                onClick={onExploreMenu}
                id="hero-services-btn"
                className="flex items-center gap-2 bg-white hover:bg-[#FAF4F2] text-[#2D2424] border border-[#D9C4BE] px-5 py-3.5 rounded-xl text-base font-semibold shadow-xs transition-colors"
              >
                <span>View Menu & Prices</span>
                <ArrowRight className="w-4 h-4 text-[#8C3A42]" />
              </button>

              <a
                href={getSalonWhatsAppUrl('Hello! I would like to book a consultation at Glossy Looks Women Salon.')}
                target="_blank"
                rel="noopener noreferrer"
                id="hero-whatsapp-btn"
                className="flex items-center gap-2 bg-[#25D366] hover:bg-[#20bd5a] text-white px-4 py-3.5 rounded-xl text-sm font-semibold shadow-xs transition-colors"
              >
                <MessageCircle className="w-4 h-4" />
                <span>WhatsApp</span>
              </a>
            </div>

            {/* Trust and Social Proof Metrics */}
            <div className="pt-6 border-t border-[#E8DDD8] grid grid-cols-3 gap-4">
              <div>
                <div className="flex items-center gap-1 text-[#D97706]">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-current" />
                  ))}
                  <span className="text-sm font-bold text-[#2D2424] ml-1">4.95</span>
                </div>
                <p className="text-xs text-[#7A6B6B] mt-0.5">Over 2,400+ 5-Star Reviews</p>
              </div>

              <div>
                <p className="text-lg font-bold text-[#2D2424] font-serif-luxury">1,200+</p>
                <p className="text-xs text-[#7A6B6B]">Brides Styled Perfectly</p>
              </div>

              <div>
                <p className="text-lg font-bold text-[#2D2424] font-serif-luxury">100%</p>
                <p className="text-xs text-[#7A6B6B]">Cruelty-Free Pure Luxury</p>
              </div>
            </div>

          </div>

          {/* Right Column: Visual Editorial Collage */}
          <div className="lg:col-span-5 relative">
            <div className="relative mx-auto max-w-md lg:max-w-none">
              
              {/* Main Feature Image */}
              <div className="rounded-2xl overflow-hidden shadow-xl border-4 border-white aspect-[4/5] relative group">
                <img
                  src="https://images.unsplash.com/photo-1560869713-7d0a29430803?auto=format&fit=crop&w=800&q=80"
                  alt="Glossy Looks Hair and Makeup Styling"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
                
                {/* Overlay Badge */}
                <div className="absolute bottom-5 left-5 right-5 text-white">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-[#E8C5C8]">Signature Transformation</p>
                      <h3 className="font-serif-luxury text-2xl font-bold">Priya Sharma & Team</h3>
                    </div>
                    <button
                      onClick={onViewGallery}
                      className="bg-white/20 backdrop-blur-md hover:bg-white/30 text-white text-xs font-semibold px-3 py-1.5 rounded-lg border border-white/30 transition-colors"
                    >
                      View Gallery
                    </button>
                  </div>
                </div>
              </div>

              {/* Floating Mini Card: Appointment Slots */}
              <div className="absolute -bottom-6 -left-6 bg-white rounded-xl shadow-lg border border-[#E8DDD8] p-4 max-w-xs hidden sm:block">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#F7EBEB] flex items-center justify-center text-[#8C3A42]">
                    <Clock className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-[#2D2424]">Today's Availability</p>
                    <p className="text-[11px] text-[#22C55E] font-semibold flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-[#22C55E] inline-block animate-pulse"></span>
                      Open • 5 slots left today
                    </p>
                  </div>
                </div>
              </div>

              {/* Floating Mini Card: Staff Portal quick link */}
              <div className="absolute -top-4 -right-4 bg-[#2D2424] text-white rounded-xl shadow-lg p-3 max-w-[190px] hidden sm:block">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#E5B5B7]" />
                  <div>
                    <p className="text-[11px] font-semibold">Staff & POS Desk</p>
                    <button
                      onClick={onOpenAdmin}
                      className="text-[10px] text-[#E5B5B7] hover:underline"
                    >
                      Open Salon Admin →
                    </button>
                  </div>
                </div>
              </div>

            </div>
          </div>

        </div>
      </div>
    </section>
  );
};
