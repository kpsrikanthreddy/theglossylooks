import React from 'react';
import { 
  Sparkles, 
  Calendar, 
  Receipt, 
  Image as ImageIcon, 
  PhoneCall, 
  MessageCircle, 
  ShieldCheck, 
  Menu as MenuIcon, 
  X,
  Compass,
  MapPin,
  Scissors
} from 'lucide-react';
import { SALON_INFO } from '../data/initialData';
import { getSalonWhatsAppUrl } from '../utils/whatsapp';

interface NavbarProps {
  activeTab: 'customer' | 'admin';
  setActiveTab: (tab: 'customer' | 'admin') => void;
  onOpenBooking: () => void;
  activeSection: string;
  setActiveSection: (sec: string) => void;
  appointmentCount: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  onOpenBooking,
  activeSection,
  setActiveSection,
  appointmentCount,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  const handleNavClick = (sectionId: string) => {
    setActiveTab('customer');
    setActiveSection(sectionId);
    setMobileMenuOpen(false);
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-[#FAF7F5]/95 backdrop-blur-md border-b border-[#E8DDD8] transition-all">
      {/* Top micro bar for salon announcements */}
      <div className="bg-[#2D2424] text-[#FAF7F5] px-4 py-1.5 text-xs">
        <div className="max-w-7xl mx-auto flex flex-wrap justify-between items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-[#E5B5B7] animate-pulse"></span>
            <span className="font-light tracking-wide text-xs">
              Jubilee Hills, Hyderabad • Open Today 9:30 AM – 8:30 PM • Complimentary Bridal Consultations
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <a 
              href={`tel:${SALON_INFO.phone}`} 
              className="flex items-center gap-1 text-[#E5B5B7] hover:text-white transition-colors"
              id="topbar-call-link"
            >
              <PhoneCall className="w-3.5 h-3.5" />
              <span>{SALON_INFO.phone}</span>
            </a>
            <a 
              href={getSalonWhatsAppUrl()} 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[#4ADE80] hover:text-white transition-colors"
              id="topbar-whatsapp-link"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              <span>WhatsApp Us</span>
            </a>
          </div>
        </div>
      </div>

      {/* Main navigation */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          
          {/* Salon Logo */}
          <div 
            onClick={() => handleNavClick('hero')} 
            className="flex items-center gap-3 cursor-pointer group"
            id="brand-logo-btn"
          >
            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[#E8C5C8] to-[#D99B9F] flex items-center justify-center shadow-sm border border-[#D9B8B9] group-hover:scale-105 transition-transform">
              <Sparkles className="w-6 h-6 text-[#2D2424]" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-serif-luxury text-2xl font-bold tracking-tight text-[#2D2424]">
                  Glossy Looks
                </span>
                <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-[#F3E5E6] text-[#8C3A42] border border-[#E8C5C8]">
                  Women Salon
                </span>
              </div>
              <p className="text-[11px] text-[#7A6B6B] tracking-wider uppercase font-medium">
                Luxury Hair, Bridal & Spa Studio
              </p>
            </div>
          </div>

          {/* Desktop Navigation Links */}
          <nav className="hidden lg:flex items-center space-x-1">
            <button
              onClick={() => handleNavClick('menu')}
              id="nav-menu-btn"
              className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'customer' && activeSection === 'menu'
                  ? 'text-[#8C3A42] bg-[#F7EBEB]'
                  : 'text-[#4A3E3E] hover:text-[#2D2424] hover:bg-[#F3ECE8]'
              }`}
            >
              Services Menu
            </button>

            <button
              onClick={() => handleNavClick('artists')}
              id="nav-artists-btn"
              className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'customer' && activeSection === 'artists'
                  ? 'text-[#8C3A42] bg-[#F7EBEB]'
                  : 'text-[#4A3E3E] hover:text-[#2D2424] hover:bg-[#F3ECE8]'
              }`}
            >
              Artists
            </button>

            <button
              onClick={() => handleNavClick('gallery')}
              id="nav-gallery-btn"
              className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                activeTab === 'customer' && activeSection === 'gallery'
                  ? 'text-[#8C3A42] bg-[#F7EBEB]'
                  : 'text-[#4A3E3E] hover:text-[#2D2424] hover:bg-[#F3ECE8]'
              }`}
            >
              <ImageIcon className="w-4 h-4 text-[#8C3A42]" />
              Portfolio Gallery
            </button>

            <button
              onClick={() => handleNavClick('enquiry')}
              id="nav-enquiry-btn"
              className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'customer' && activeSection === 'enquiry'
                  ? 'text-[#8C3A42] bg-[#F7EBEB]'
                  : 'text-[#4A3E3E] hover:text-[#2D2424] hover:bg-[#F3ECE8]'
              }`}
            >
              Enquire
            </button>

            <button
              onClick={() => handleNavClick('contact')}
              id="nav-contact-btn"
              className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1 ${
                activeTab === 'customer' && activeSection === 'contact'
                  ? 'text-[#8C3A42] bg-[#F7EBEB]'
                  : 'text-[#4A3E3E] hover:text-[#2D2424] hover:bg-[#F3ECE8]'
              }`}
            >
              <MapPin className="w-4 h-4 text-[#8C3A42]" />
              Contact & Map
            </button>
          </nav>

          {/* Action CTAs & Staff Portal Switch */}
          <div className="hidden sm:flex items-center gap-3">
            {/* Staff / Admin Portal Toggle Button */}
            <button
              onClick={() => {
                if (activeTab === 'admin') {
                  setActiveTab('customer');
                  setActiveSection('hero');
                } else {
                  setActiveTab('admin');
                }
              }}
              id="toggle-staff-portal-btn"
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all border ${
                activeTab === 'admin'
                  ? 'bg-[#2D2424] text-[#FAF7F5] border-[#2D2424] shadow-sm'
                  : 'bg-white text-[#5A4B4B] border-[#D9C8C4] hover:bg-[#F7EBEB] hover:text-[#8C3A42]'
              }`}
            >
              <ShieldCheck className="w-4 h-4 text-[#C98A8E]" />
              <span>{activeTab === 'admin' ? 'Customer View' : 'Staff & Billing Portal'}</span>
            </button>

            {/* Book Appointment CTA */}
            <button
              onClick={onOpenBooking}
              id="navbar-book-btn"
              className="flex items-center gap-2 bg-[#8C3A42] hover:bg-[#742F36] text-white px-4 py-2.5 rounded-lg text-sm font-semibold shadow-sm transition-all hover:shadow hover:-translate-y-0.5"
            >
              <Calendar className="w-4 h-4" />
              <span>Book Appointment</span>
            </button>
          </div>

          {/* Mobile hamburger button */}
          <div className="lg:hidden flex items-center gap-2">
            <button
              onClick={onOpenBooking}
              className="bg-[#8C3A42] text-white p-2 rounded-lg text-xs font-medium flex items-center gap-1"
            >
              <Calendar className="w-4 h-4" />
              <span>Book</span>
            </button>

            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              id="mobile-menu-toggle-btn"
              className="p-2 rounded-lg text-[#2D2424] hover:bg-[#F3ECE8]"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <MenuIcon className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile dropdown menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-[#E8DDD8] bg-[#FAF7F5] px-4 pt-3 pb-6 space-y-2">
          <button
            onClick={() => handleNavClick('menu')}
            className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-[#2D2424] hover:bg-[#F3ECE8]"
          >
            Services & Price Menu
          </button>
          <button
            onClick={() => handleNavClick('artists')}
            className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-[#2D2424] hover:bg-[#F3ECE8]"
          >
            Our Master Stylists & Artists
          </button>
          <button
            onClick={() => handleNavClick('gallery')}
            className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-[#2D2424] hover:bg-[#F3ECE8]"
          >
            Artist Works & Gallery
          </button>
          <button
            onClick={() => handleNavClick('enquiry')}
            className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-[#2D2424] hover:bg-[#F3ECE8]"
          >
            Customer Enquiries
          </button>
          <button
            onClick={() => handleNavClick('contact')}
            className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-[#2D2424] hover:bg-[#F3ECE8]"
          >
            Salon Location & Google Maps
          </button>

          <div className="pt-3 border-t border-[#E8DDD8] flex flex-col gap-2">
            <button
              onClick={() => {
                setActiveTab(activeTab === 'admin' ? 'customer' : 'admin');
                setMobileMenuOpen(false);
              }}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold bg-[#2D2424] text-white"
            >
              <ShieldCheck className="w-4 h-4 text-[#E5B5B7]" />
              <span>{activeTab === 'admin' ? 'Switch to Customer View' : 'Staff Admin & Billing Portal'}</span>
            </button>
            <a
              href={getSalonWhatsAppUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold bg-[#22C55E] text-white"
            >
              <MessageCircle className="w-4 h-4" />
              <span>WhatsApp Customer Support</span>
            </a>
          </div>
        </div>
      )}
    </header>
  );
};
