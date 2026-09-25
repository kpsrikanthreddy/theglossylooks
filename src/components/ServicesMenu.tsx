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

interface ServiceGroupData {
  groupName: string;
  category: string;
  image: string;
  description: string;
  popular: boolean;
  tier: string;
  items: SalonService[];
}

const GroupedServiceCard: React.FC<{
  group: ServiceGroupData;
  onSelectForBooking: (service: SalonService) => void;
  onAddToBill?: (service: SalonService) => void;
}> = ({ group, onSelectForBooking, onAddToBill }) => {
  const [selectedVariantId, setSelectedVariantId] = useState<string>(group.items[0].id);
  const currentService = group.items.find((i) => i.id === selectedVariantId) || group.items[0];
  const hasMultipleVariants = group.items.length > 1;

  return (
    <div className="bg-[#FAF7F5] rounded-2xl border border-[#E6D9D5] overflow-hidden flex flex-col justify-between hover:shadow-md hover:border-[#D6B5B8] transition-all group">
      <div>
        {/* Service Image banner (Parent service / service group owns the image) */}
        <div className="h-48 w-full overflow-hidden relative">
          <img
            src={group.image}
            alt={group.groupName}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

          {/* Tier badge */}
          <div className="absolute top-3 left-3">
            <span className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-white/90 backdrop-blur-xs text-[#2D2424] shadow-xs">
              {group.tier}
            </span>
          </div>

          {/* Popular badge */}
          {group.popular && (
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
            <span>{currentService.durationMinutes} mins</span>
          </div>

          {/* Price on image bottom right */}
          <div className="absolute bottom-3 right-3 text-white">
            <span className="font-serif-luxury text-xl font-bold bg-[#2D2424]/85 backdrop-blur-xs px-3 py-1 rounded-md">
              {SALON_INFO.currency}{currentService.price.toLocaleString('en-IN')}
            </span>
          </div>
        </div>

        {/* Body Content */}
        <div className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-[#8C3A42]">
              {group.category}
            </span>
            {hasMultipleVariants && (
              <span className="text-[11px] font-medium text-stone-500 bg-[#EFE8E5] px-2 py-0.5 rounded-full">
                {group.items.length} Options
              </span>
            )}
          </div>
          <h3 className="font-serif-luxury text-xl font-bold text-[#2D2424] group-hover:text-[#8C3A42] transition-colors leading-snug">
            {group.groupName}
          </h3>
          <p className="text-xs text-[#635555] line-clamp-2 leading-relaxed">
            {currentService.description || group.description}
          </p>

          {/* Variant Selector / Lengths / Areas */}
          {hasMultipleVariants && (
            <div className="pt-2">
              <label className="block text-[11px] font-semibold text-stone-700 uppercase tracking-wider mb-1.5">
                Select Variant / Area:
              </label>
              <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
                {group.items.map((item) => {
                  const isSelected = item.id === selectedVariantId;
                  const label =
                    item.variantName ||
                    item.name.replace(group.groupName, '').replace(/^[-—:\s]+/, '') ||
                    item.name;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedVariantId(item.id)}
                      className={`text-xs px-2.5 py-1.5 rounded-lg border text-left flex items-center justify-between gap-2 transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-[#8C3A42] text-white border-[#8C3A42] font-semibold shadow-xs'
                          : 'bg-white text-stone-700 border-stone-200 hover:border-[#D6B5B8] hover:bg-[#FAF0F1]'
                      }`}
                    >
                      <span>{label}</span>
                      <span className={isSelected ? 'text-white/90 font-bold' : 'text-[#8C3A42] font-semibold'}>
                        ₹{item.price}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer Action Buttons */}
      <div className="p-5 pt-0 border-t border-[#EDE1DD] mt-2 flex items-center gap-2">
        <button
          onClick={() => onSelectForBooking(currentService)}
          id={`book-service-${currentService.id}`}
          className="flex-1 flex items-center justify-center gap-1.5 bg-[#8C3A42] hover:bg-[#732B32] text-white py-2.5 px-3 rounded-xl text-xs font-semibold transition-colors shadow-xs cursor-pointer"
        >
          <Calendar className="w-3.5 h-3.5" />
          <span>Book {currentService.variantName ? `(${currentService.variantName})` : 'Slot'}</span>
        </button>

        {onAddToBill && (
          <button
            onClick={() => onAddToBill(currentService)}
            id={`bill-service-${currentService.id}`}
            title="Add to current billing order"
            className="flex items-center justify-center gap-1 bg-white hover:bg-[#F3ECE8] text-[#544545] border border-[#D9C4BE] py-2.5 px-3 rounded-xl text-xs font-medium transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-[#8C3A42]" />
            <span>Add</span>
          </button>
        )}
      </div>
    </div>
  );
};

export const ServicesMenu: React.FC<ServicesMenuProps> = ({
  services,
  onSelectForBooking,
  onAddToBill,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const categories = [
    'All',
    'Threading & Waxing',
    'Skin Care & Facials',
    'Body Care & Massage',
    'Manicure & Pedicure',
    'Hair Cut, Wash & Styling',
    'Hair Colour',
    'Hair Spa & Treatments',
    'Pre-Bridal Packages',
  ];

  const activeServices = services.filter((srv) => srv.active !== false);

  const filteredServices = activeServices.filter((srv) => {
    const matchesCategory = selectedCategory === 'All' || srv.category === selectedCategory;
    const matchesSearch =
      srv.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      srv.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      srv.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (srv.serviceGroup && srv.serviceGroup.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (srv.variantName && srv.variantName.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  // Group services by serviceGroup so variants share the parent image and group card
  const groupedCards = React.useMemo(() => {
    const map = new Map<string, SalonService[]>();
    filteredServices.forEach((srv) => {
      const groupKey = srv.serviceGroup || srv.name;
      if (!map.has(groupKey)) {
        map.set(groupKey, []);
      }
      map.get(groupKey)!.push(srv);
    });
    return Array.from(map.entries()).map(([groupName, items]) => ({
      groupName,
      category: items[0].category,
      image: items[0].image || 'https://images.unsplash.com/photo-1560869713-7d0a29430803?auto=format&fit=crop&w=600&q=80',
      description: items[0].description,
      popular: items.some(i => i.popular),
      tier: items[0].tier || 'Signature',
      items,
    }));
  }, [filteredServices]);

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
        {groupedCards.length === 0 ? (
          <div className="text-center py-12 bg-[#FAF7F5] rounded-2xl border border-dashed border-[#D9C8C4] max-w-md mx-auto p-6">
            <Scissors className="w-8 h-8 text-[#9C8B8B] mx-auto mb-2" />
            <p className="text-base font-medium text-[#2D2424]">No services matched "{searchQuery}"</p>
            <p className="text-xs text-[#7A6B6B] mt-1">Try searching for other treatments or reset the category filter.</p>
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('All');
              }}
              className="mt-4 px-4 py-2 text-xs font-semibold text-[#8C3A42] bg-white border border-[#D9C4BE] rounded-lg hover:bg-[#F7EBEB] cursor-pointer"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {groupedCards.map((group) => (
              <GroupedServiceCard
                key={group.groupName}
                group={group}
                onSelectForBooking={onSelectForBooking}
                onAddToBill={onAddToBill}
              />
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
