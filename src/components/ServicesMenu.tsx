import React, { useState } from 'react';
import { 
  Sparkles, 
  Clock, 
  Calendar, 
  Search, 
  Check, 
  Plus, 
  Star,
  Scissors,
  Flame
} from 'lucide-react';
import { SalonService } from '../types/salon';
import { SALON_INFO } from '../data/initialData';

interface ServicesMenuProps {
  services: SalonService[];
  onSelectForBooking: (service: SalonService) => void;
  onAddToBill?: (service: SalonService) => void;
}

export const ServicesMenu: React.FC<ServicesMenuProps> = ({
  services,
  onSelectForBooking,
  onAddToBill,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const categories = [
    'All',
    'Bridal & Makeup',
    'Hair Styling & Care',
    'Skin & Facials',
    'Nails & Feet',
    'Spa & Body',
    'Waxing & Threading',
  ];

  const filteredServices = services.filter((srv) => {
    // Only active/public services should be displayed to customers
    if (srv.active === false) return false;

    const matchesCategory = selectedCategory === 'All' || srv.category === selectedCategory;
    const matchesSearch =
      srv.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      srv.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      srv.category.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <section id="menu" className="py-16 bg-white border-y border-[#EBE1DC]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto space-y-3 mb-10">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#FAF0F1] border border-[#EAC9CB] text-[#8C3A42] text-xs font-semibold uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Complete Salon & Spa Menu</span>
          </div>
          <h2 className="font-serif-luxury text-3xl sm:text-4xl lg:text-5xl font-bold text-[#2D2424]">
            Services Crafted For Your Radiance
          </h2>
          <p className="text-sm sm:text-base text-[#6E5E5E] font-light">
            Every service is tailored with dermatologically tested European and organic formulations, 
            performed by master cosmetologists and bridal artists.
          </p>
        </div>

        {/* Search & Category Filter Controls */}
        <div className="space-y-4 mb-10">
          
          {/* Search bar */}
          <div className="max-w-md mx-auto relative">
            <Search className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9C8B8B]" />
            <input
              type="text"
              placeholder="Search services (e.g., Keratin, Balayage, 24K Gold, Hydra)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-11 pr-4 py-2.5 bg-[#FAF7F5] border border-[#D9C4BE] rounded-xl text-sm text-[#2D2424] placeholder-[#9C8B8B] focus:outline-none focus:ring-2 focus:ring-[#8C3A42]/30 focus:border-[#8C3A42] transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#7A6B6B] hover:text-[#2D2424]"
              >
                Clear
              </button>
            )}
          </div>

          {/* Category Pills */}
          <div className="flex flex-wrap justify-center gap-2">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-medium transition-all ${
                  selectedCategory === cat
                    ? 'bg-[#8C3A42] text-white shadow-sm'
                    : 'bg-[#FAF7F5] text-[#5A4B4B] hover:bg-[#F2EAE6] border border-[#E3D6D2]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Service Cards Grid */}
        {filteredServices.length === 0 ? (
          <div className="text-center py-12 bg-[#FAF7F5] rounded-2xl border border-dashed border-[#D9C8C4] max-w-md mx-auto p-6">
            <Scissors className="w-8 h-8 text-[#9C8B8B] mx-auto mb-2" />
            <p className="text-base font-medium text-[#2D2424]">No services matched "{searchQuery}"</p>
            <p className="text-xs text-[#7A6B6B] mt-1">Try searching for other treatments or reset the category filter.</p>
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('All');
              }}
              className="mt-4 px-4 py-2 text-xs font-semibold text-[#8C3A42] bg-white border border-[#D9C4BE] rounded-lg hover:bg-[#F7EBEB]"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredServices.map((service) => (
              <div
                key={service.id}
                className="bg-[#FAF7F5] rounded-2xl border border-[#E6D9D5] overflow-hidden flex flex-col justify-between hover:shadow-md hover:border-[#D6B5B8] transition-all group"
              >
                <div>
                  {/* Service Image banner */}
                  <div className="h-48 w-full overflow-hidden relative">
                    <img
                      src={service.image || 'https://images.unsplash.com/photo-1560869713-7d0a29430803?auto=format&fit=crop&w=600&q=80'}
                      alt={service.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
                    
                    {/* Tier badge */}
                    <div className="absolute top-3 left-3">
                      <span className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-white/90 backdrop-blur-xs text-[#2D2424] shadow-xs">
                        {service.tier || 'Signature'}
                      </span>
                    </div>

                    {/* Popular badge */}
                    {service.popular && (
                      <div className="absolute top-3 right-3">
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-[#8C3A42] text-white shadow-xs">
                          <Flame className="w-3 h-3 fill-current" />
                          <span>Popular</span>
                        </span>
                      </div>
                    )}

                    {/* Duration badge */}
                    <div className="absolute bottom-3 left-3 text-white flex items-center gap-1 text-xs font-medium bg-black/40 backdrop-blur-xs px-2.5 py-1 rounded-md">
                      <Clock className="w-3.5 h-3.5 text-[#E8C5C8]" />
                      <span>{service.durationMinutes} mins</span>
                    </div>

                    {/* Price on image bottom right */}
                    <div className="absolute bottom-3 right-3 text-white">
                      <span className="font-serif-luxury text-xl font-bold bg-[#2D2424]/80 backdrop-blur-xs px-3 py-1 rounded-md">
                        {SALON_INFO.currency}{service.price.toLocaleString('en-IN')}
                      </span>
                    </div>
                  </div>

                  {/* Body Content */}
                  <div className="p-5 space-y-2.5">
                    <span className="text-[11px] uppercase tracking-wider font-semibold text-[#8C3A42]">
                      {service.category}
                    </span>
                    <h3 className="font-serif-luxury text-xl font-bold text-[#2D2424] group-hover:text-[#8C3A42] transition-colors leading-snug">
                      {service.name}
                    </h3>
                    <p className="text-xs text-[#635555] line-clamp-2 leading-relaxed">
                      {service.description}
                    </p>
                  </div>
                </div>

                {/* Footer Action Buttons */}
                <div className="p-5 pt-0 border-t border-[#EDE1DD] mt-2 flex items-center gap-2">
                  <button
                    onClick={() => onSelectForBooking(service)}
                    id={`book-service-${service.id}`}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-[#8C3A42] hover:bg-[#732B32] text-white py-2.5 px-3 rounded-xl text-xs font-semibold transition-colors shadow-xs"
                  >
                    <Calendar className="w-3.5 h-3.5" />
                    <span>Book Slot</span>
                  </button>

                  {onAddToBill && (
                    <button
                      onClick={() => onAddToBill(service)}
                      id={`bill-service-${service.id}`}
                      title="Add to current billing order"
                      className="flex items-center justify-center gap-1 bg-white hover:bg-[#F3ECE8] text-[#544545] border border-[#D9C4BE] py-2.5 px-3 rounded-xl text-xs font-medium transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5 text-[#8C3A42]" />
                      <span>Add to Bill</span>
                    </button>
                  )}
                </div>

              </div>
            ))}
          </div>
        )}

        {/* Custom Package Callout */}
        <div className="mt-12 bg-gradient-to-r from-[#FAF0F1] to-[#F5E6E7] rounded-2xl p-6 sm:p-8 border border-[#E8C5C8] flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="space-y-1 text-center md:text-left">
            <h4 className="font-serif-luxury text-xl sm:text-2xl font-bold text-[#2D2424]">
              Planning a Destination Wedding or Group Bridal Party?
            </h4>
            <p className="text-xs sm:text-sm text-[#665454]">
              We offer bespoke on-venue bridal luxury packages including mother-of-the-bride and bridesmaid glam.
            </p>
          </div>
          <button
            onClick={() => {
              const el = document.getElementById('enquiry');
              if (el) el.scrollIntoView({ behavior: 'smooth' });
            }}
            className="whitespace-nowrap px-5 py-3 rounded-xl text-xs sm:text-sm font-semibold bg-[#2D2424] text-white hover:bg-black transition-colors"
          >
            Custom Bridal Consultation →
          </button>
        </div>

      </div>
    </section>
  );
};
