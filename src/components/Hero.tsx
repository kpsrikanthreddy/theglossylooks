import React from 'react';
import { 
  Calendar, 
  ArrowRight, 
  Sparkles, 
  Star, 
  ShieldCheck, 
  Award, 
  Clock 
} from 'lucide-react';

interface HeroProps {
  onOpenBooking: () => void;
  onExploreMenu: () => void;
  onViewGallery: () => void;
  onOpenAdmin?: () => void;
}

export const Hero: React.FC<HeroProps> = ({
  onOpenBooking,
  onExploreMenu,
  onViewGallery,
}) => {
  return (
    <section id="hero" className="relative overflow-hidden pt-6 pb-14 lg:pt-10 lg:pb-20">
      {/* Subtle warm luxury decorative background glow */}
      <div className="absolute top-0 right-0 -mr-40 -mt-40 w-96 h-96 rounded-full bg-[#F3D7D9]/40 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 -ml-40 -mb-40 w-96 h-96 rounded-full bg-[#EBDAD3]/50 blur-3xl pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          
          {/* Left Column: Headline and Actions */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* Main Title - No awkward badge or empty spacing */}
            <div className="space-y-3">
              <h1 className="font-serif-luxury text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-[#2D2424] leading-[1.12]">
                Unveil Your Most <br />
                <span className="italic font-normal text-[#8C3A42]">Radiant & Glossy</span> Look
              </h1>
              <p className="text-base sm:text-lg text-[#615252] leading-relaxed max-w-2xl font-light">
                Welcome to <strong className="font-semibold text-[#2D2424]">The Glossy Looks Professional Women Salon</strong>, Gachibowli. 
                Experience bespoke bridal makeovers, signature hair coloring, and rejuvenating skin therapies 
                curated by acclaimed artists in a private luxury sanctuary.
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

            {/* Clean Primary Call to Action */}
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <button
                onClick={onOpenBooking}
                id="hero-book-now-btn"
                className="flex items-center gap-2 bg-[#8C3A42] hover:bg-[#742F36] text-white px-7 py-3.5 rounded-xl text-base font-semibold shadow-md transition-all hover:shadow-lg hover:-translate-y-0.5 cursor-pointer"
              >
                <Calendar className="w-5 h-5" />
                <span>Book Appointment</span>
              </button>

              <button
                onClick={onExploreMenu}
                id="hero-explore-menu-btn"
                className="inline-flex items-center gap-2 text-sm font-semibold text-[#8C3A42] hover:text-[#5B2329] px-3 py-2 transition-colors cursor-pointer group"
              >
                <span>Explore Full Menu</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>

            {/* Trust Badges */}
            <div className="grid grid-cols-3 gap-4 pt-4 border-t border-[#E8DDD8] max-w-lg">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-[#FAF0F1] flex items-center justify-center shrink-0 text-[#8C3A42]">
                  <Star className="w-4 h-4 fill-current" />
                </div>
                <div>
                  <p className="text-xs font-bold text-[#2D2424]">4.9 / 5.0</p>
                  <p className="text-[11px] text-[#7A6B6B]">Google Verified</p>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-[#FAF0F1] flex items-center justify-center shrink-0 text-[#8C3A42]">
                  <Award className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs font-bold text-[#2D2424]">1,200+ Brides</p>
                  <p className="text-[11px] text-[#7A6B6B]">Sculpted</p>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-[#FAF0F1] flex items-center justify-center shrink-0 text-[#8C3A42]">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs font-bold text-[#2D2424]">7 Days Open</p>
                  <p className="text-[11px] text-[#7A6B6B]">9:30 AM – 8:30 PM</p>
                </div>
              </div>
            </div>

          </div>

          {/* Right Column: Visual Showcase */}
          <div className="lg:col-span-5 relative">
            <div className="relative mx-auto max-w-md lg:max-w-none">
              <div className="relative rounded-3xl overflow-hidden shadow-2xl border-4 border-white aspect-[4/5] group">
                <img
                  src="https://images.unsplash.com/photo-1560869713-7d0a29430803?auto=format&fit=crop&w=800&q=80"
                  alt="The Glossy Looks Salon Experience"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                <div className="absolute bottom-6 left-6 right-6 text-white space-y-1">
                  <span className="text-xs font-medium uppercase tracking-wider text-[#F7D8DA]">Gachibowli, Hyderabad</span>
                  <h3 className="font-serif-luxury text-xl font-bold">Luxury Aesthetic & Hair Studio</h3>
                </div>
              </div>

              {/* Floating review card */}
              <div className="absolute -bottom-5 -left-5 bg-white p-3.5 rounded-2xl shadow-xl border border-[#EDE1DD] flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#8C3A42] text-white flex items-center justify-center font-bold text-xs">
                  GL
                </div>
                <div>
                  <div className="flex items-center gap-1 text-[#EAB308]">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className="w-3 h-3 fill-current" />
                    ))}
                  </div>
                  <p className="text-xs font-bold text-[#2D2424]">Women Exclusive Salon</p>
                  <p className="text-[10px] text-[#7A6B6B]">Vinayak Nagar, Hyderabad</p>
                </div>
              </div>

            </div>
          </div>

        </div>
      </div>
    </section>
  );
};
