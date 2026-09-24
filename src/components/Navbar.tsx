import React, { useState } from 'react';
import { 
  Sparkles, 
  Menu as MenuIcon, 
  X
} from 'lucide-react';

interface NavbarProps {
  currentPath: string;
  onNavigate: (to: string) => void;
  onOpenBooking?: () => void;
  appointmentCount?: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentPath,
  onNavigate,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLinkClick = (to: string) => {
    setMobileMenuOpen(false);
    onNavigate(to);
  };

  const isActive = (path: string) => {
    if (path === '/' && (currentPath === '/' || currentPath === '')) return true;
    return currentPath === path;
  };

  return (
    <header className="sticky top-0 z-40 bg-[#FAF7F5]/95 backdrop-blur-md border-b border-[#E8DDD8] transition-all">
      {/* Clean main navigation container - No top information bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          
          {/* Logo & Brand Name */}
          <div 
            onClick={() => handleLinkClick('/')} 
            className="flex items-center gap-3 cursor-pointer group shrink-0"
            id="brand-logo-btn"
          >
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-gradient-to-br from-[#E8C5C8] to-[#D99B9F] flex items-center justify-center shadow-xs border border-[#D9B8B9] group-hover:scale-105 transition-transform">
              <Sparkles className="w-5 h-5 sm:w-6 sm:h-6 text-[#2D2424]" />
            </div>
            <div>
              <span className="font-serif-luxury text-xl sm:text-2xl font-bold tracking-tight text-[#2D2424] block">
                The Glossy Looks
              </span>
              <p className="text-[11px] sm:text-xs text-[#7A6B6B] tracking-wide font-medium">
                Professional Women Salon
              </p>
            </div>
          </div>

          {/* Desktop Navigation Links: Home | Services | Artists | Gallery | Contact Us */}
          <nav className="hidden md:flex items-center space-x-1 lg:space-x-2">
            <button
              onClick={() => handleLinkClick('/')}
              id="nav-home-btn"
              className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive('/')
                  ? 'text-[#8C3A42] bg-[#F7EBEB] font-semibold'
                  : 'text-[#4A3E3E] hover:text-[#2D2424] hover:bg-[#F3ECE8]'
              }`}
            >
              Home
            </button>

            <button
              onClick={() => handleLinkClick('/services')}
              id="nav-services-btn"
              className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive('/services')
                  ? 'text-[#8C3A42] bg-[#F7EBEB] font-semibold'
                  : 'text-[#4A3E3E] hover:text-[#2D2424] hover:bg-[#F3ECE8]'
              }`}
            >
              Services
            </button>

            <button
              onClick={() => handleLinkClick('/artists')}
              id="nav-artists-btn"
              className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive('/artists')
                  ? 'text-[#8C3A42] bg-[#F7EBEB] font-semibold'
                  : 'text-[#4A3E3E] hover:text-[#2D2424] hover:bg-[#F3ECE8]'
              }`}
            >
              Artists
            </button>

            <button
              onClick={() => handleLinkClick('/gallery')}
              id="nav-gallery-btn"
              className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive('/gallery')
                  ? 'text-[#8C3A42] bg-[#F7EBEB] font-semibold'
                  : 'text-[#4A3E3E] hover:text-[#2D2424] hover:bg-[#F3ECE8]'
              }`}
            >
              Gallery
            </button>

            <button
              onClick={() => handleLinkClick('/contact')}
              id="nav-contact-btn"
              className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive('/contact')
                  ? 'text-[#8C3A42] bg-[#F7EBEB] font-semibold'
                  : 'text-[#4A3E3E] hover:text-[#2D2424] hover:bg-[#F3ECE8]'
              }`}
            >
              Contact Us
            </button>
          </nav>

          {/* Mobile hamburger button */}
          <div className="md:hidden flex items-center">
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
        <div className="md:hidden border-t border-[#E8DDD8] bg-[#FAF7F5] px-4 pt-3 pb-6 space-y-2 shadow-lg animate-in slide-in-from-top-2 duration-150">
          <button
            onClick={() => handleLinkClick('/')}
            className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              isActive('/') ? 'bg-[#F7EBEB] text-[#8C3A42] font-semibold' : 'text-[#2D2424] hover:bg-[#F3ECE8]'
            }`}
          >
            Home
          </button>
          <button
            onClick={() => handleLinkClick('/services')}
            className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              isActive('/services') ? 'bg-[#F7EBEB] text-[#8C3A42] font-semibold' : 'text-[#2D2424] hover:bg-[#F3ECE8]'
            }`}
          >
            Services
          </button>
          <button
            onClick={() => handleLinkClick('/artists')}
            className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              isActive('/artists') ? 'bg-[#F7EBEB] text-[#8C3A42] font-semibold' : 'text-[#2D2424] hover:bg-[#F3ECE8]'
            }`}
          >
            Artists
          </button>
          <button
            onClick={() => handleLinkClick('/gallery')}
            className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              isActive('/gallery') ? 'bg-[#F7EBEB] text-[#8C3A42] font-semibold' : 'text-[#2D2424] hover:bg-[#F3ECE8]'
            }`}
          >
            Gallery
          </button>
          <button
            onClick={() => handleLinkClick('/contact')}
            className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              isActive('/contact') ? 'bg-[#F7EBEB] text-[#8C3A42] font-semibold' : 'text-[#2D2424] hover:bg-[#F3ECE8]'
            }`}
          >
            Contact Us
          </button>
        </div>
      )}
    </header>
  );
};
